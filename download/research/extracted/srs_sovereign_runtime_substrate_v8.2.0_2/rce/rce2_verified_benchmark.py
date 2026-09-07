#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rce2_verified_benchmark.py — Benchmark with Law Verification Layer

Re-runs the Hidden World benchmark with the verification layer active.
Every discovered law must pass 4 verification stages before acceptance.
UNKNOWN is preferred over unsafe compression.
"""
from __future__ import annotations

import json
import math
import os
import random
import sys
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                 "..", "download"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from rce2_law_verification import VerifiedClassifier, LawVerificationLayer, VerificationResult
from rce2_hidden_world_benchmark import (
    gen_polynomial_boolean, gen_cellular_automaton, gen_graph_transition,
    gen_short_program, gen_chaotic_discrete, gen_random_junta, gen_dnf_formula,
)
from rce2_meta_representation_v2 import evaluate_representation


@dataclass
class VerifiedWorldResult:
    world_name: str
    source: str
    raw_class: str          # classifier's initial choice (before verification)
    verified_class: str     # final choice (after verification)
    raw_held_out: float     # held-out accuracy WITHOUT verification
    verified_held_out: float  # held-out accuracy WITH verification
    # Verification details
    mdl_reduction: float
    aic: float
    n_counterexamples: int
    n_adversarial: int
    verification_cost: int
    verification_rejected: bool  # was a law rejected by verification?
    rejection_reason: str
    # Verdict
    false_compression: bool
    correct_compression: bool
    correct_escalation: bool
    missed_opportunity: bool  # verification rejected a valid law?
    storage_bytes: int
    break_even: int


def run_verified_benchmark() -> Dict[str, Any]:
    """Run the hidden world benchmark with law verification."""
    print("=" * 80)
    print("VERIFIED BENCHMARK (Law Verification Layer Active)")
    print("=" * 80)

    d = 12
    state_space = 1 << d
    obs_budget = 300
    n_test = 300
    rng = random.Random(42)

    # Same worlds as hidden world benchmark
    worlds = []
    for deg in [1, 2, 3, 4]:
        for seed in [10, 20, 30]:
            fn, meta = gen_polynomial_boolean(d, deg, seed)
            worlds.append((f"poly_d{deg}_s{seed}", fn, meta))
    for rule in [30, 90, 110, 184]:
        fn, meta = gen_cellular_automaton(d, rule, seed=42)
        worlds.append((f"ca_rule{rule}", fn, meta))
    for n_nodes in [8, 16, 32, 64]:
        fn, meta = gen_graph_transition(d, n_nodes, seed=42)
        worlds.append((f"graph_n{n_nodes}", fn, meta))
    for seed in [100, 101, 102, 103, 104]:
        fn, meta = gen_short_program(d, seed)
        worlds.append((f"program_s{seed}", fn, meta))
    for seed in [200, 201, 202]:
        fn, meta = gen_chaotic_discrete(d, seed)
        worlds.append((f"chaotic_s{seed}", fn, meta))
    for k in [2, 3, 4, 6, 8]:
        fn, meta = gen_random_junta(d, k, seed=300 + k)
        worlds.append((f"junta_k{k}", fn, meta))
    for n_clauses in [3, 5, 10, 15]:
        fn, meta = gen_dnf_formula(d, n_clauses, seed=400 + n_clauses)
        worlds.append((f"dnf_c{n_clauses}", fn, meta))

    # Also run WITHOUT verification for comparison
    from rce2_meta_representation_v2 import classify

    results: List[VerifiedWorldResult] = []

    for name, fn, meta in worlds:
        t0 = time.time()

        # Generate observations
        observed_states = set()
        observations = []
        while len(observations) < obs_budget:
            state = rng.randint(0, state_space - 1)
            if state not in observed_states:
                observed_states.add(state)
                observations.append((state, fn(state)))

        # Held-out test states
        test_states = []
        while len(test_states) < n_test:
            state = rng.randint(0, state_space - 1)
            if state not in observed_states:
                test_states.append(state)

        # === WITHOUT VERIFICATION (baseline) ===
        raw_cls = classify(observations, d)
        raw_inf, raw_store, _, raw_acc, _ = evaluate_representation(
            raw_cls, fn, test_states, d)

        # === WITH VERIFICATION ===
        verifier = VerifiedClassifier(n_adversarial=500)
        verified_cls, verification = verifier.classify_and_verify(
            observations, d, true_fn=fn)

        v_inf, v_store, _, v_acc, _ = evaluate_representation(
            verified_cls, fn, test_states, d)

        # Determine verdicts
        raw_false = (raw_cls.selected_class != "unknown" and raw_acc < 0.95)
        v_false = (verified_cls.selected_class != "unknown" and v_acc < 0.95)
        v_correct_comp = (verified_cls.selected_class != "unknown" and v_acc >= 0.95)
        v_correct_esc = (verified_cls.selected_class == "unknown" and v_acc >= 0.99)
        # Missed opportunity: verification rejected a law that was actually correct
        missed = (raw_cls.selected_class != "unknown"
                   and verified_cls.selected_class == "unknown"
                   and raw_acc >= 0.95)

        C = d
        saving = C - (v_inf / max(n_test, 1))
        be = math.ceil(verified_cls.classification_cost / saving) if saving > 0 else -1

        elapsed = time.time() - t0

        result = VerifiedWorldResult(
            world_name=name,
            source=meta["source"],
            raw_class=raw_cls.selected_class,
            verified_class=verified_cls.selected_class,
            raw_held_out=round(raw_acc, 4),
            verified_held_out=round(v_acc, 4),
            mdl_reduction=verification.mdl_reduction,
            aic=round(verification.aic, 2),
            n_counterexamples=verification.n_counterexamples_found,
            n_adversarial=verification.n_adversarial_tested,
            verification_cost=verification.verification_cost,
            verification_rejected=(raw_cls.selected_class != "unknown"
                                    and verified_cls.selected_class == "unknown" and not verification.accepted),
            rejection_reason=verification.rejection_reason[:80] if verification.rejection_reason else "",
            false_compression=v_false,
            correct_compression=v_correct_comp,
            correct_escalation=v_correct_esc,
            missed_opportunity=missed,
            storage_bytes=v_store,
            break_even=be,
        )
        results.append(result)

        # Print
        if v_false:
            verdict = "FALSE"
        elif v_correct_comp:
            verdict = "OK"
        elif v_correct_esc:
            if was_rejected:
                verdict = "REJECTED→ESC"
            else:
                verdict = "ESC"
        else:
            verdict = "MARG"

        raw_verdict = f"raw={raw_cls.selected_class}({raw_acc:.0%})"
        v_verdict = f"v={verified_cls.selected_class}({v_acc:.0%})"
        was_rejected = (raw_cls.selected_class != "unknown" and verified_cls.selected_class == "unknown")
        reject = f" REJ: {verification.rejection_reason[:50]}" if was_rejected else ""

        print(f"[{name:<22}] {raw_verdict:<25} → {v_verdict:<25} {verdict}{reject}")

    # === SUMMARY ===
    print(f"\n{'='*80}")
    print("VERIFIED BENCHMARK SUMMARY")
    print(f"{'='*80}")

    n_total = len(results)
    n_raw_false = sum(1 for r in results if r.raw_held_out < 0.95 and r.raw_class != "unknown")
    n_v_false = sum(1 for r in results if r.false_compression)
    n_v_compressed = sum(1 for r in results if r.correct_compression)
    n_v_escalated = sum(1 for r in results if r.correct_escalation)
    n_rejected = sum(1 for r in results if r.verification_rejected)
    n_missed = sum(1 for r in results if r.missed_opportunity)

    print(f"\nTotal worlds: {n_total}")
    print(f"WITHOUT verification:")
    print(f"  False compression: {n_raw_false} ({n_raw_false/n_total*100:.0f}%)")
    print(f"  Compressed (≥95%): {sum(1 for r in results if r.raw_class != 'unknown' and r.raw_held_out >= 0.95)} ({sum(1 for r in results if r.raw_class != 'unknown' and r.raw_held_out >= 0.95)/n_total*100:.0f}%)")
    print(f"WITH verification:")
    print(f"  False compression: {n_v_false} ({n_v_false/n_total*100:.0f}%)")
    print(f"  Correct compression: {n_v_compressed} ({n_v_compressed/n_total*100:.0f}%)")
    print(f"  Correct escalation: {n_v_escalated} ({n_v_escalated/n_total*100:.0f}%)")
    print(f"  Laws rejected by verification: {n_rejected}")
    print(f"  Missed opportunities (valid law rejected): {n_missed}")
    print(f"  Verification cost (avg): {sum(r.verification_cost for r in results)/n_total:.0f} ops/world")

    # Per-source
    print(f"\n{'World':<22} {'Source':<20} {'Raw':<8} {'Ver':<8} {'RawH%':<6} {'VerH%':<6} {'Rej':<5} {'Miss':<5} {'Verdict'}")
    for r in results:
        if r.false_compression:
            v = "FALSE"
        elif r.correct_compression:
            v = "OK"
        elif r.correct_escalation:
            v = "ESC"
        else:
            v = "MARG"
        print(f"{r.world_name:<22} {r.source:<20} {r.raw_class:<8} {r.verified_class:<8} "
              f"{r.raw_held_out*100:<6.0f} {r.verified_held_out*100:<6.0f} "
              f"{'Y' if r.verification_rejected else 'N':<5} "
              f"{'Y' if r.missed_opportunity else 'N':<5} {v}")

    # Comparison table
    print(f"\n{'='*80}")
    print("VERIFICATION IMPACT")
    print(f"{'='*80}")
    print(f"{'Metric':<35} {'Without':<15} {'With':<15} {'Change'}")
    print(f"{'False compression rate':<35} {n_raw_false/n_total*100:<15.1f} {n_v_false/n_total*100:<15.1f} {n_raw_false - n_v_false:+d} eliminated")
    print(f"{'Correct compression rate':<35} {sum(1 for r in results if r.raw_class != 'unknown' and r.raw_held_out >= 0.95)/n_total*100:<15.1f} {n_v_compressed/n_total*100:<15.1f} {'':>5}")
    print(f"{'UNKNOWN rate':<35} {sum(1 for r in results if r.raw_class == 'unknown')/n_total*100:<15.1f} {n_v_escalated/n_total*100:<15.1f} {'':>5}")
    print(f"{'Missed opportunities':<35} {'N/A':<15} {n_missed:<15d} {'':>5}")

    return {
        "summary": {
            "n_total": n_total,
            "without_verification": {
                "false_compression": n_raw_false,
                "false_rate": round(n_raw_false / n_total, 4),
            },
            "with_verification": {
                "false_compression": n_v_false,
                "false_rate": round(n_v_false / n_total, 4),
                "correct_compression": n_v_compressed,
                "correct_escalation": n_v_escalated,
                "laws_rejected": n_rejected,
                "missed_opportunities": n_missed,
            },
        },
        "results": [
            {
                "world": r.world_name,
                "source": r.source,
                "raw_class": r.raw_class,
                "verified_class": r.verified_class,
                "raw_held_out": r.raw_held_out,
                "verified_held_out": r.verified_held_out,
                "false_compression": r.false_compression,
                "correct_compression": r.correct_compression,
                "correct_escalation": r.correct_escalation,
                "verification_rejected": r.verification_rejected,
                "missed_opportunity": r.missed_opportunity,
                "rejection_reason": r.rejection_reason,
                "mdl_reduction": r.mdl_reduction,
                "aic": r.aic,
                "n_counterexamples": r.n_counterexamples,
                "n_adversarial": r.n_adversarial,
                "verification_cost": r.verification_cost,
                "storage_bytes": r.storage_bytes,
            }
            for r in results
        ],
    }


if __name__ == "__main__":
    results = run_verified_benchmark()
    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "..", "download", "rce", "rce2_verified_benchmark_results.json")
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\nResults saved to: {out_path}")
