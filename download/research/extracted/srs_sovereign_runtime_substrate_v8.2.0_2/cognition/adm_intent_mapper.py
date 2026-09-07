#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
adm_intent_mapper.py
====================

Operational realisation of the Admissible Behavior Set (Adm) defined in
Chapter 7 of the SRS specification.

The Adm is defined extensionally as a relation

    Adm ⊆ I × C × A × R

where
    I = set of agent intents (e.g. "diagnose", "rebalance", "promote")
    C = set of execution contexts (island, telemetry snapshot, epistemic state)
    A = set of certified AgeMem actions (ADD, UPDATE, DELETE, RETRIEVE,
        FILTER, SUMMARY, NOOP) with their tier (STM/LTM)
    R = set of certified reasoning traces (the policy's logprob + value +
        advantage triple, plus the ESR-id of the upstream evidence)

A tuple (i, c, a, r) ∈ Adm iff:
  (i) the action a is well-typed for the intent i (e.g. "diagnose" implies
      at least one RETRIEVE or FILTER; "promote" implies exactly one ADD
      with tier=LTM);
  (ii) the action a is compatible with the context c (e.g. DELETE only
       admissible when the parent_rid exists in the epistemic state and is
       not already tombstoned);
  (iii) the reasoning trace r is supported by at least one formal-proof
        reference (Z3 sat, Saarthi unsat, etc.) OR by an SQA quorum
        certificate;
  (iv) all of the above are certified by the Sovereign Execution Gate.

The mapper is invoked by the AgeMem policy before any tool is committed:
if the proposed (i, c, a, r) is not in Adm, the policy must re-sample.

Run:
    python3 adm_intent_mapper.py
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Set, Tuple


# ---------------------------------------------------------------------------
# 1. Domain types
# ---------------------------------------------------------------------------

class Intent(str, Enum):
    DIAGNOSE   = "diagnose"      # identify the root cause of an anomaly
    REBALANCE  = "rebalance"     # adjust allocator weights / power routes
    PROMOTE    = "promote"       # STM scratch note → LTM persistent record
    QUORUM_VAL = "quorum_validate"  # certify a proposed mutation
    REFACTOR   = "refactor"      # biomimetic self-healing code mutation
    RETIRE     = "retire"        # DELETE obsolete knowledge


class MemOp(str, Enum):
    ADD      = "ADD"
    UPDATE   = "UPDATE"
    DELETE   = "DELETE"
    RETRIEVE = "RETRIEVE"
    FILTER   = "FILTER"
    SUMMARY  = "SUMMARY"
    NOOP     = "NOOP"


class MemTier(str, Enum):
    STM = "STM"
    LTM = "LTM"


class ProofKind(str, Enum):
    Z3_SAT       = "z3_sat"        # Z3 returned sat — feasible witness exists
    Z3_UNSAT     = "z3_unsat"      # Z3 returned unsat — invariant holds
    SAARTHI_PROOFS = "saarthi"     # Saarthi RTL/I2C proof
    SQA_QUORUM   = "sqa_quorum"    # BLS aggregate signature quorum
    EMPIRICAL    = "empirical"     # hardware-in-loop rig pass


@dataclass(frozen=True)
class Context:
    """The execution context for an Adm lookup.

    island:        target power island (or 'global')
    theta:         current thermal coordinate snapshot
    epistemic_ids: rids currently believed-to-exist in the epistemic state
    tombstoned:    rids that have been soft-deleted
    risk_class:    SQA risk class for the proposed mutation
    """
    island: str
    theta: float
    epistemic_ids: Set[str]
    tombstoned: Set[str]
    risk_class: str  # "low" | "medium" | "high" | "critical"


@dataclass(frozen=True)
class Action:
    op: MemOp
    tier: MemTier
    parent_rid: Optional[str] = None


@dataclass(frozen=True)
class Reasoning:
    """A certified reasoning trace.

    The reasoning must carry at least one proof reference (Z3, Saarthi,
    SQA quorum, or empirical). The logprob / value / advantage are the
    policy's outputs that produced the action.
    """
    logprob: float
    value: float
    advantage: Optional[float]
    proof_refs: Tuple[ProofKind, ...]
    esr_evidence: Tuple[str, ...] = ()


# ---------------------------------------------------------------------------
# 2. Adm rule table — extensional definition of the admissible subset
# ---------------------------------------------------------------------------

# Intent → required ops (the action's op must be one of these)
INTENT_OPS: Dict[Intent, Set[MemOp]] = {
    Intent.DIAGNOSE:   {MemOp.RETRIEVE, MemOp.FILTER, MemOp.SUMMARY},
    Intent.REBALANCE:  {MemOp.UPDATE, MemOp.ADD, MemOp.SUMMARY},
    Intent.PROMOTE:    {MemOp.FILTER, MemOp.ADD, MemOp.SUMMARY},
    Intent.QUORUM_VAL: {MemOp.RETRIEVE, MemOp.UPDATE, MemOp.DELETE, MemOp.NOOP},
    Intent.REFACTOR:   {MemOp.RETRIEVE, MemOp.UPDATE, MemOp.DELETE},
    Intent.RETIRE:     {MemOp.DELETE},
}

# Intent → required tier (action's tier must match)
INTENT_TIER: Dict[Intent, MemTier] = {
    Intent.DIAGNOSE:   MemTier.LTM,   # reads
    Intent.REBALANCE:  MemTier.STM,   # mutation in working context
    Intent.PROMOTE:    MemTier.LTM,   # promotion target
    Intent.QUORUM_VAL: MemTier.STM,   # working-context certification
    Intent.REFACTOR:   MemTier.STM,   # code mutation
    Intent.RETIRE:     MemTier.STM,   # tombstone
}

# Intent → minimum required proof kinds
INTENT_PROOFS: Dict[Intent, Set[ProofKind]] = {
    Intent.DIAGNOSE:   {ProofKind.EMPIRICAL},
    Intent.REBALANCE:  {ProofKind.Z3_SAT, ProofKind.SQA_QUORUM},
    Intent.PROMOTE:    {ProofKind.SQA_QUORUM},
    Intent.QUORUM_VAL: {ProofKind.SQA_QUORUM, ProofKind.Z3_UNSAT},
    Intent.REFACTOR:   {ProofKind.SAARTHI_PROOFS, ProofKind.SQA_QUORUM},
    Intent.RETIRE:     {ProofKind.SQA_QUORUM},
}

# Risk class → quorum threshold (matches the SQA spec)
RISK_THRESHOLD: Dict[str, int] = {
    "low": 2, "medium": 3, "high": 4, "critical": 5,
}


# ---------------------------------------------------------------------------
# 3. Adm evaluator
# ---------------------------------------------------------------------------

@dataclass
class AdmViolation(Exception):
    """Raised when (i, c, a, r) ∉ Adm. Carries a structured diagnostic."""
    code: str
    detail: str

    def __str__(self) -> str:  # pragma: no cover - trivial
        return f"[Adm:{self.code}] {self.detail}"


def evaluate(intent: Intent, ctx: Context,
             action: Action, reasoning: Reasoning) -> Tuple[bool, List[str]]:
    """Return (admissible, diagnostics).

    The diagnostics list is empty iff admissible=True; otherwise it lists
    each failed rule in priority order.
    """
    diags: List[str] = []

    # Rule (i): action's op must be in the intent's required-op set.
    if action.op not in INTENT_OPS[intent]:
        diags.append(
            f"R1_op_mismatch: intent={intent.value} requires op ∈ "
            f"{{ {', '.join(o.value for o in INTENT_OPS[intent])} }} "
            f"but action.op={action.op.value}"
        )

    # Rule (i.b): tier must match the intent's required tier.
    if action.tier != INTENT_TIER[intent]:
        diags.append(
            f"R1b_tier_mismatch: intent={intent.value} requires tier="
            f"{INTENT_TIER[intent].value} but action.tier={action.tier.value}"
        )

    # Rule (ii.a): DELETE / UPDATE / RETRIEVE require a valid parent_rid
    # that exists in the epistemic state and is not tombstoned.
    if action.op in (MemOp.DELETE, MemOp.UPDATE, MemOp.RETRIEVE):
        if action.parent_rid is None:
            diags.append(f"R2a_missing_parent: op={action.op.value} requires parent_rid")
        elif action.parent_rid not in ctx.epistemic_ids:
            diags.append(
                f"R2a_parent_not_in_state: parent_rid={action.parent_rid} "
                f"is not present in the current epistemic state"
            )
        elif action.parent_rid in ctx.tombstoned and action.op != MemOp.RETRIEVE:
            diags.append(
                f"R2a_parent_tombstoned: parent_rid={action.parent_rid} "
                f"is already tombstoned; only RETRIEVE may target it"
            )

    # Rule (ii.b): DELETE on a critical-risk context requires a higher
    # quorum threshold (mapped from RISK_THRESHOLD).
    if action.op == MemOp.DELETE and ctx.risk_class == "critical":
        if ProofKind.SQA_QUORUM not in reasoning.proof_refs:
            diags.append(
                "R2b_critical_delete_needs_sqa: DELETE on critical-risk "
                "context requires SQA quorum certification"
            )

    # Rule (iii): the reasoning trace must carry at least one proof
    # reference of every kind in INTENT_PROOFS[intent].
    have = set(reasoning.proof_refs)
    need = INTENT_PROOFS[intent]
    missing = need - have
    if missing:
        diags.append(
            f"R3_missing_proofs: intent={intent.value} requires proof kinds "
            f"{{ {', '.join(p.value for p in need)} }} but reasoning only "
            f"carries {{ {', '.join(p.value for p in have)} }}; "
            f"missing={{ {', '.join(p.value for p in missing)} }}"
        )

    # Rule (iii.b): every esr_evidence id must be non-empty and well-formed.
    for eid in reasoning.esr_evidence:
        if not eid or len(eid) < 8:
            diags.append(f"R3b_malformed_evidence: eid={eid!r}")

    # Rule (iv): the SEG quorum threshold must be met for the risk class.
    # The proof_refs carry an SQA_QUORUM marker iff the quorum was assembled;
    # the actual validator count is checked at the SEG layer, but we ensure
    # the marker exists here.
    if ProofKind.SQA_QUORUM in need and ProofKind.SQA_QUORUM not in have:
        diags.append("R4_no_sqa_marker: SQA quorum marker absent from proof_refs")

    return (len(diags) == 0, diags)


# ---------------------------------------------------------------------------
# 4. Demonstration
# ---------------------------------------------------------------------------

DEMO_CASES: List[Dict[str, Any]] = [
    {
        "label": "admissible diagnose (RETRIEVE on LTM)",
        "intent": Intent.DIAGNOSE,
        "ctx": Context(
            island="APU", theta=0.5,
            epistemic_ids={"rid-prior-incident-001"},
            tombstoned=set(),
            risk_class="low",
        ),
        "action": Action(op=MemOp.RETRIEVE, tier=MemTier.LTM,
                         parent_rid="rid-prior-incident-001"),
        "reasoning": Reasoning(
            logprob=-0.91, value=0.78, advantage=0.42,
            proof_refs=(ProofKind.EMPIRICAL,),
            esr_evidence=("rid-prior-incident-001",),
        ),
        "expected_admissible": True,
    },
    {
        "label": "inadmissible: DELETE without parent_rid",
        "intent": Intent.RETIRE,
        "ctx": Context(
            island="FPGA", theta=0.4,
            epistemic_ids={"rid-scratch-001"},
            tombstoned=set(),
            risk_class="medium",
        ),
        "action": Action(op=MemOp.DELETE, tier=MemTier.STM, parent_rid=None),
        "reasoning": Reasoning(
            logprob=-1.10, value=0.62, advantage=0.10,
            proof_refs=(ProofKind.SQA_QUORUM,),
        ),
        "expected_admissible": False,
    },
    {
        "label": "inadmissible: REBALANCE without Z3 sat witness",
        "intent": Intent.REBALANCE,
        "ctx": Context(
            island="FPGA", theta=0.5,
            epistemic_ids=set(), tombstoned=set(),
            risk_class="medium",
        ),
        "action": Action(op=MemOp.UPDATE, tier=MemTier.STM),
        "reasoning": Reasoning(
            logprob=-0.80, value=0.71, advantage=0.30,
            proof_refs=(ProofKind.SQA_QUORUM,),  # missing Z3_SAT
        ),
        "expected_admissible": False,
    },
    {
        "label": "admissible: critical-risk DELETE with SQA quorum",
        "intent": Intent.RETIRE,
        "ctx": Context(
            island="NISQ", theta=0.3,
            epistemic_ids={"rid-obsolete-belief-001"},
            tombstoned=set(),
            risk_class="critical",
        ),
        "action": Action(op=MemOp.DELETE, tier=MemTier.STM,
                         parent_rid="rid-obsolete-belief-001"),
        "reasoning": Reasoning(
            logprob=-1.05, value=0.68, advantage=0.18,
            proof_refs=(ProofKind.SQA_QUORUM,),
        ),
        "expected_admissible": True,
    },
    {
        "label": "inadmissible: QUORUM_VALIDATE without SQA + Z3_UNSAT",
        "intent": Intent.QUORUM_VAL,
        "ctx": Context(
            island="FPGA", theta=0.4,
            epistemic_ids={"rid-proposed-mutation-001"},
            tombstoned=set(),
            risk_class="high",
        ),
        "action": Action(op=MemOp.UPDATE, tier=MemTier.STM,
                         parent_rid="rid-proposed-mutation-001"),
        "reasoning": Reasoning(
            logprob=-0.95, value=0.74, advantage=0.25,
            proof_refs=(ProofKind.SQA_QUORUM,),  # missing Z3_UNSAT
        ),
        "expected_admissible": False,
    },
    {
        "label": "admissible: REFACTOR with Saarthi + SQA",
        "intent": Intent.REFACTOR,
        "ctx": Context(
            island="FPGA", theta=0.5,
            epistemic_ids={"rid-rtl-block-001"},
            tombstoned=set(),
            risk_class="high",
        ),
        "action": Action(op=MemOp.UPDATE, tier=MemTier.STM,
                         parent_rid="rid-rtl-block-001"),
        "reasoning": Reasoning(
            logprob=-0.88, value=0.81, advantage=0.45,
            proof_refs=(ProofKind.SAARTHI_PROOFS, ProofKind.SQA_QUORUM),
            esr_evidence=("rid-rtl-block-001",),
        ),
        "expected_admissible": True,
    },
]


def main() -> int:
    print("=" * 78)
    print("Adm Intent/Context → (Action, Reasoning) Mapper — Demonstration")
    print("=" * 78)
    print()
    print("Adm ⊆ I × C × A × R   where")
    print("  I = { diagnose, rebalance, promote, quorum_validate, refactor, retire }")
    print("  C = (island, theta, epistemic_ids, tombstoned, risk_class)")
    print("  A = (op, tier, parent_rid)  with op ∈ {ADD,UPDATE,DELETE,RETRIEVE,FILTER,SUMMARY,NOOP}")
    print("  R = (logprob, value, advantage, proof_refs, esr_evidence)")
    print()
    print(f"{'Case':<55} {'Expected':<10} {'Actual':<10} {'OK':<4}")
    print("-" * 78)

    all_ok = True
    for case in DEMO_CASES:
        admissible, diags = evaluate(
            case["intent"], case["ctx"], case["action"], case["reasoning"]
        )
        ok = (admissible == case["expected_admissible"])
        all_ok = all_ok and ok
        label = case["label"][:53]
        print(f"{label:<55} {str(case['expected_admissible']):<10} "
              f"{str(admissible):<10} {'✓' if ok else '✗':<4}")
        if diags:
            for d in diags:
                print(f"   ↳ {d}")
    print("-" * 78)
    print(f"Result: {'ALL CASES PASSED' if all_ok else 'SOME CASES FAILED'}")
    print("=" * 78)

    # Persist a machine-readable mapping table for the SRS docs
    out_path = "/home/z/my-project/download/adm_intent_mapping.json"
    table = {
        "intents": [i.value for i in Intent],
        "ops": [o.value for o in MemOp],
        "tiers": [t.value for t in MemTier],
        "proof_kinds": [p.value for p in ProofKind],
        "intent_required_ops": {
            i.value: sorted(o.value for o in ops)
            for i, ops in INTENT_OPS.items()
        },
        "intent_required_tier": {
            i.value: t.value for i, t in INTENT_TIER.items()
        },
        "intent_required_proofs": {
            i.value: sorted(p.value for p in ps)
            for i, ps in INTENT_PROOFS.items()
        },
        "risk_threshold": RISK_THRESHOLD,
        "demo_results": [
            {
                "label": c["label"],
                "intent": c["intent"].value,
                "expected": c["expected_admissible"],
                "actual": evaluate(c["intent"], c["ctx"], c["action"], c["reasoning"])[0],
            }
            for c in DEMO_CASES
        ],
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(table, f, indent=2)
    print(f"[adm] intent→action mapping table written to: {out_path}")
    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())  # pragma: no cover
