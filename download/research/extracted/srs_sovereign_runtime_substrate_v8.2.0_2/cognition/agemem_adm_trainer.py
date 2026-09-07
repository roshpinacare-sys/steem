#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
agemem_adm_trainer.py
=====================

Adm-gated Step-wise GRPO trainer for the AgeMem Controller.

This module operationalises the Admissible Behavior Set (Adm) as a
non-differentiable constraint within the GRPO training loop.  It wraps
the standard `GRPOTrainer` from `agemem_controller.py` and replaces the
ungated `policy.act()` sampler with the Adm-gated `decide_adm()` method
during rollout.  The reward function is augmented with:

  * Semantic Linearizability bonus (+0.15) for correct DELETE tombstoning
    (DELETE on a non-tombstoned parent whose rid is in the epistemic state)
  * Evidence Fabrication penalty (-1.0) if a proposed mutation fails the
    SQA Admission Gate verification (i.e. the evidence chain's `admissible`
    flag is False after the re-sampling loop exhausts `max_resample`)

The trainer uses a low `max_resample` (k=2) per the RFAE spec, so the
policy is forced to learn Adm-aligned action preferences rather than
relying on the re-sampling loop to find admissible actions.

Run:
    python3 agemem_adm_trainer.py
"""

from __future__ import annotations

import json
import math
import random
import sys
import time
import uuid
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

# Graceful degradation for torch (D5 fix). Mirrors the pattern in
# agemem_controller.py: the module imports successfully even when torch
# is not installed; callers must check TORCH_AVAILABLE before invoking
# any training primitive.
try:
    import torch
    TORCH_AVAILABLE = True
except ImportError:  # pragma: no cover - exercised only when torch is absent
    TORCH_AVAILABLE = False

    class _TorchStub:
        """Stand-in for the torch module."""

        def __getattr__(self, name: str) -> object:
            raise RuntimeError(
                f"torch is not available (cannot access torch.{name}). "
                f"Install with: pip install torch==2.2.2"
            )

    torch = _TorchStub()  # type: ignore[assignment]

# Re-use the controller components
try:
    from agemem_controller import (  # type: ignore[assignment]
        AgeMemController, AgeMemPolicy, GRPOConfig, GRPOTrainer,
        MemoryEnv, MemOp, MemTier, Step, Trajectory, EvidenceChain,
        TOOL_VOCAB, TOOL_TO_IDX, TORCH_AVAILABLE as _CTRL_TORCH_AVAILABLE,
    )
    from adm_intent_mapper import Intent, Context, ProofKind  # type: ignore[assignment]  # pragma: no cover
except ImportError:
    from cognition.agemem_controller import (
        AgeMemController, AgeMemPolicy, GRPOConfig, GRPOTrainer,
        MemoryEnv, MemOp, MemTier, Step, Trajectory, EvidenceChain,
        TOOL_VOCAB, TOOL_TO_IDX, TORCH_AVAILABLE as _CTRL_TORCH_AVAILABLE,
    )
    from cognition.adm_intent_mapper import Intent, Context, ProofKind

# Re-export the unified availability flag for downstream callers. Both
# this module and agemem_controller must agree (they share the same
# torch install).
TORCH_AVAILABLE = TORCH_AVAILABLE and _CTRL_TORCH_AVAILABLE


# ---------------------------------------------------------------------------
# 1. Reward shaping constants
# ---------------------------------------------------------------------------

SL_BONUS = 0.15          # Semantic Linearizability bonus for correct DELETE
EVIDENCE_FABRICATION_PENALTY = -1.0   # SQA gate failure penalty
ADM_ADMIT_BONUS = 0.10   # small bonus for first-attempt admission (efficiency)


# ---------------------------------------------------------------------------
# 2. Adm-gated GRPO trainer
# ---------------------------------------------------------------------------

@dataclass
class AdmGRPOConfig(GRPOConfig):
    """Configuration for the Adm-gated GRPO trainer."""
    max_resample: int = 2          # k=2 per the RFAE spec
    sl_bonus: float = SL_BONUS
    evidence_fab_penalty: float = EVIDENCE_FABRICATION_PENALTY
    admit_bonus: float = ADM_ADMIT_BONUS


class AdmGRPOTrainer(GRPOTrainer):
    """GRPO trainer that uses `decide_adm()` for rollouts.

    The trainer overrides `rollout_group` to call
    `AgeMemController.decide_adm()` instead of `policy.act()`.  Each
    step's reward is augmented with:
      - SL bonus if the step is a correct DELETE tombstoning
      - Evidence Fabrication penalty if the evidence chain is inadmissible
        after exhausting max_resample attempts
      - Small admit bonus if the first attempt is admitted (efficiency)

    The reward augmentation is applied BEFORE the tier-weighted scaling
    in the parent trainer, so the SL bonus and fabrication penalty
    survive the tier weighting intact.
    """

    def __init__(self, policy: AgeMemPolicy,
                 controller: AgeMemController,
                 cfg: Optional[AdmGRPOConfig] = None) -> None:
        super().__init__(policy, cfg or AdmGRPOConfig())
        self.controller = controller
        self.adm_cfg: AdmGRPOConfig = self.cfg  # type: ignore[assignment]

    # ---- intent inference ------------------------------------------------

    def _infer_intent(self, prompt: str) -> Intent:
        """Map a prompt to an Adm intent."""
        if "Diagnose" in prompt or "Resolve" in prompt:
            return Intent.DIAGNOSE
        elif "Promote" in prompt:
            return Intent.PROMOTE
        elif "Quorum" in prompt:
            return Intent.QUORUM_VAL
        elif "Rebalance" in prompt:
            return Intent.REBALANCE
        elif "Refactor" in prompt or "Heal" in prompt:
            return Intent.REFACTOR
        elif "Retire" in prompt or "Delete" in prompt:
            return Intent.RETIRE
        else:
            return Intent.DIAGNOSE  # default

    def _build_context(self, env: MemoryEnv, seed_rid: str) -> Context:
        """Build an Adm context from the environment state."""
        return Context(
            island="APU",
            theta=0.5,
            epistemic_ids={seed_rid},
            tombstoned=set(),
            risk_class="low",
        )

    # ---- rollout ---------------------------------------------------------

    def rollout_group(self, prompt: str, env: MemoryEnv) -> List[Trajectory]:
        """Sample G trajectories using decide_adm() instead of policy.act()."""
        trajs: List[Trajectory] = []
        intent = self._infer_intent(prompt)  # type: ignore[attr-defined]  # type: ignore[attr-defined]

        for _ in range(self.cfg.group_size):
            _, obs = env.reset(prompt)
            traj = Trajectory(prompt=prompt, group_id=str(uuid.uuid4()))
            # Seed record for parent_rid references
            seed_rec = self.controller.execute_tool(
                op=MemOp.ADD,
                content=f"seed for prompt: {prompt[:40]}",
                tier=MemTier.LTM, salience=0.6, tags=["seed"],
            )
            ctx = self._build_context(env, seed_rec.rid)  # type: ignore[attr-defined]  # type: ignore[attr-defined]

            for _t in range(self.cfg.traj_len):
                # Adm-gated decision
                op, tier, conf, chain, diags = self.controller.decide_adm(
                    obs, intent=intent, ctx=ctx,
                    parent_rid=seed_rec.rid,
                    max_resample=self.adm_cfg.max_resample,
                )
                # Compute the shaped reward
                raw_r, next_obs, done, _ = self._step_reward(  # type: ignore[attr-defined]
                    env, op, tier, chain, diags, seed_rec.rid,
                )
                # The policy's logprob/value come from the chain (decide_adm
                # already sampled from the policy; we just re-derive lp)
                lp = chain.reasoning.logprob
                val = chain.reasoning.value
                traj.steps.append(Step(
                    obs=obs.copy(), tool_idx=TOOL_TO_IDX[op.value],
                    tool_logprob=lp, tool_value=val,
                    reward=raw_r, tier=tier, done=done,
                ))
                obs = next_obs
                if done:
                    break
            trajs.append(traj)
        return trajs

    def _step_reward(self, env: MemoryEnv, op: MemOp, tier: MemTier,
                     chain: EvidenceChain, diags: List[str],
                     seed_rid: str) -> Tuple[float, np.ndarray, bool, MemTier]:
        """Compute the Adm-shaped reward for a single step.

        Augments the base environment reward with:
          - SL bonus (+0.15) for correct DELETE tombstoning
          - Evidence Fabrication penalty (-1.0) for inadmissible chain
          - Admit bonus (+0.10) for first-attempt admission
        """
        tool_idx = TOOL_TO_IDX[op.value]
        next_obs, base_r, done, env_tier = env.step(tool_idx)

        # Apply tier-weighted scaling (mirrors the parent trainer)
        if env_tier == MemTier.STM:
            reward = base_r * self.adm_cfg.stm_reward_scale
        else:
            reward = base_r * self.adm_cfg.ltm_reward_scale

        # SL bonus: correct DELETE tombstoning
        # "Correct" means: op == DELETE AND the parent is in epistemic_ids
        # AND the parent is not already tombstoned.
        if op == MemOp.DELETE:
            parent_in_state = (chain.action.parent_rid in chain.context.epistemic_ids
                               if hasattr(chain.context, "epistemic_ids") else False)
            parent_not_tombstoned = (chain.action.parent_rid not in chain.context.tombstoned
                                     if hasattr(chain.context, "tombstoned") else True)
            if parent_in_state and parent_not_tombstoned and chain.admissible:
                reward += self.adm_cfg.sl_bonus

        # Evidence Fabrication penalty: if the chain is inadmissible after
        # exhausting max_resample attempts, the controller fell back to a
        # default action.  This is a severe penalty because the policy is
        # producing actions that cannot be SQA-certified.
        if not chain.admissible:
            reward += self.adm_cfg.evidence_fab_penalty

        # Admit bonus: first-attempt admission is efficient
        if diags and "attempt 0: ADMITTED" in diags[0]:
            reward += self.adm_cfg.admit_bonus

        return reward, next_obs, done, env_tier


# ---------------------------------------------------------------------------
# 3. Adm-gated controller wrapper
# ---------------------------------------------------------------------------

class AdmAgeMemController(AgeMemController):
    """AgeMem controller that uses the Adm-gated GRPO trainer."""

    def __init__(self, policy: Optional[AgeMemPolicy] = None,
                 cfg: Optional[AdmGRPOConfig] = None,
                 env: Optional[MemoryEnv] = None) -> None:
        super().__init__(policy=policy, cfg=cfg or AdmGRPOConfig(), env=env)
        # Replace the trainer with the Adm-gated variant
        self.trainer = AdmGRPOTrainer(self.policy, self, self.cfg)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# 4. Self-test
# ---------------------------------------------------------------------------

def self_test(n_iters: int = 6) -> Dict[str, Any]:
    """Train the Adm-gated controller and report metrics."""

    if not TORCH_AVAILABLE:
        raise RuntimeError(
            "Adm-gated trainer self_test requires torch. Install with: "
            "pip install torch==2.2.2"
        )

    random.seed(0); np.random.seed(0); torch.manual_seed(0)

    cfg = AdmGRPOConfig(
        group_size=4, traj_len=4, update_epochs=2, lr=3e-3,
        max_resample=2,  # k=2 per the RFAE spec
        sl_bonus=SL_BONUS,
        evidence_fab_penalty=EVIDENCE_FABRICATION_PENALTY,
        admit_bonus=ADM_ADMIT_BONUS,
    )
    ctrl = AdmAgeMemController(cfg=cfg)

    history = []
    print("=" * 78)
    print("AgeMem-Adm Trainer — Step-wise GRPO with decide_adm() (k=2)")
    print(f"  SL bonus = +{cfg.sl_bonus:.2f}  (correct DELETE tombstoning)")
    print(f"  Evidence Fabrication penalty = {cfg.evidence_fab_penalty:.2f}  (inadmissible chain)")
    print(f"  Admit bonus = +{cfg.admit_bonus:.2f}  (first-attempt admission)")
    print("=" * 78)
    print(f"{'iter':>4} {'loss':>10} {'kl':>10} {'entropy':>10} "
          f"{'clip%':>8} {'ev':>10}")
    for it in range(n_iters):
        m = ctrl.train_step()
        history.append(m)
        print(f"{it:>4} {m['loss']:>10.4f} {m['kl']:>10.5f} "
              f"{m['entropy']:>10.4f} {m['clip_frac']*100:>7.1f}% "
              f"{m['explained_var']:>10.4f}")

    # Demonstrate an Adm-gated rollout
    print("\n[adm-rollout demo] executing an Adm-gated 4-step trajectory:")
    prompt, obs = ctrl.env.reset(MemoryEnv.PROMPTS[0])
    print(f"  prompt: {prompt}")
    trainer = ctrl.trainer  # type: ignore[assignment, attr-defined]
    intent = trainer._infer_intent(prompt)  # type: ignore[attr-defined]
    print(f"  intent: {intent.value}")
    seed_rec = ctrl.execute_tool(
        op=MemOp.ADD, content="demo seed for adm rollout",
        tier=MemTier.LTM, salience=0.6, tags=["demo-seed"],
    )
    ctx = trainer._build_context(ctrl.env, seed_rec.rid)  # type: ignore[attr-defined]

    for t in range(4):
        op, tier, conf, chain, diags = ctrl.decide_adm(
            obs, intent=intent, ctx=ctx,
            parent_rid=seed_rec.rid, max_resample=2,
        )
        rec = ctrl.execute_tool(
            op=op, content=f"adm-step-{t} on '{prompt[:24]}...'", tier=tier,
            salience=0.5 + 0.1 * t, tags=[f"adm-{t}"],
            parent_rid=seed_rec.rid, evidence_chain=chain,
        )
        print(f"  step {t}: op={op.value:<8} tier={tier.value:<3} "
              f"conf={conf:.3f} admissible={chain.admissible} "
              f"attempts={len(diags)} rid={rec.rid[:8]}")
        obs, _r, done, _ = ctrl.env.step(TOOL_TO_IDX[op.value])
        if done:
            break

    # Verify some ESR entries carry evidence chains
    ec_entries = [e for e in ctrl.esr_log if "evidence_chain" in e]
    print(f"\n[store] STM={len(ctrl.stm)}  LTM={len(ctrl.ltm)}  "
          f"ESR log={len(ctrl.esr_log)}  (with evidence_chain: {len(ec_entries)})")

    # Dump metrics
    metrics_path = "/home/z/my-project/download/agemem_adm_metrics.json"
    with open(metrics_path, "w", encoding="utf-8") as f:
        json.dump({
            "config": asdict(cfg),
            "history": history,
            "final_store": {"stm": len(ctrl.stm), "ltm": len(ctrl.ltm)},
            "esr_entries": len(ctrl.esr_log),
            "evidence_chain_entries": len(ec_entries),
            "reward_shaping": {
                "sl_bonus": SL_BONUS,
                "evidence_fab_penalty": EVIDENCE_FABRICATION_PENALTY,
                "admit_bonus": ADM_ADMIT_BONUS,
            },
        }, f, indent=2)
    print(f"[metrics] Adm-trainer history written to: {metrics_path}")

    # Sanity assertions
    assert len(history) == n_iters, "training history incomplete"
    final_loss = history[-1]["loss"]
    assert math.isfinite(final_loss), "final loss is non-finite"
    assert len(ec_entries) >= 1, "no evidence-chain entries produced"

    print("=" * 78)
    print("AgeMem-Adm Trainer self-test PASSED.")
    print("=" * 78)
    return {"history": history, "esr_entries": len(ctrl.esr_log),
            "evidence_chain_entries": len(ec_entries)}


if __name__ == "__main__":
    self_test()  # pragma: no cover
