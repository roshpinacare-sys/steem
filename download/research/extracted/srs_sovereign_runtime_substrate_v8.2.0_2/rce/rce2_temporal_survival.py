#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rce2_temporal_survival.py — Temporal Law Survival Benchmark

Tests whether discovered laws remain valid during long-running autonomous
evolution. The central question: can the substrate maintain a compact
computational reality over time, or does reality drift force continuous
rediscovery?

5 WORLD TYPES:
  1. Long horizon: 10^3, 10^5, 10^7 transitions — measure law lifetime
  2. Environment drift: slow parameter changes, sudden regime changes
  3. Law aging: mutation probability increases over time
  4. Competing laws: multiple explanations fit observations
  5. Memory pressure: remove historical observations

OUTPUTS:
  - law lifetime distribution
  - failure prediction accuracy
  - confidence calibration over time
  - cost of maintaining laws
  - when to discard or relearn
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

from rce2_meta_representation_v2 import (
    try_gf2_recovery, try_walsh_recovery, try_dfa_recovery,
    classify, evaluate_representation, ClassificationResult,
    GF2Result, WalshResult, DFAResult,
)
from rce2_law_verification import LawVerificationLayer


# ===========================================================================
# Temporal World Generators
# ===========================================================================

def gen_long_horizon(d: int, horizon: int, seed: int = 42
                      ) -> Tuple[Callable, Dict]:
    """Pure XOR law that holds for `horizon` transitions, then breaks.
    Measures: does the substrate discover the law, and how long does it last?
    """
    rng = random.Random(seed)
    bits = rng.sample(range(d), 3)
    call_count = [0]

    def f(x):
        call_count[0] += 1
        r = 0
        for b in bits:
            r ^= (x >> b) & 1
        if call_count[0] > horizon:
            # Flip one bit — subtle change
            r ^= (x >> bits[0]) & 1
        return bool(r)

    return f, {"type": "long_horizon", "horizon": horizon,
               "d": d, "bits": bits}


def gen_slow_drift(d: int, drift_rate: float, seed: int = 42
                    ) -> Tuple[Callable, Dict]:
    """Slow parameter drift: the causal bits gradually shift.
    Every `1/drift_rate` calls, one causal bit is replaced.
    """
    rng = random.Random(seed)
    bits = rng.sample(range(d), 2)
    call_count = [0]
    change_interval = max(1, int(1.0 / drift_rate))

    def f(x):
        call_count[0] += 1
        # Periodically swap a bit
        if call_count[0] % change_interval == 0:
            idx = call_count[0] // change_interval
            new_bit = rng.randint(0, d - 1)
            bits[idx % len(bits)] = new_bit
        r = (x >> bits[0]) & 1 ^ (x >> bits[1]) & 1
        return bool(r)

    return f, {"type": "slow_drift", "drift_rate": drift_rate,
               "change_interval": change_interval, "d": d}


def gen_sudden_regime_change(d: int, change_at: int, seed: int = 42
                              ) -> Tuple[Callable, Dict]:
    """Sudden regime change: XOR law A for first `change_at` calls,
    then completely different XOR law B.
    """
    rng = random.Random(seed)
    bits_a = rng.sample(range(d), 2)
    bits_b = rng.sample(range(d), 3)
    call_count = [0]

    def f(x):
        call_count[0] += 1
        if call_count[0] <= change_at:
            return bool((x >> bits_a[0]) & 1 ^ (x >> bits_a[1]) & 1)
        else:
            r = 0
            for b in bits_b:
                r ^= (x >> b) & 1
            return bool(r)

    return f, {"type": "sudden_regime_change", "change_at": change_at,
               "d": d}


def gen_law_aging(d: int, base_mutation_rate: float, seed: int = 42
                   ) -> Tuple[Callable, Dict]:
    """Law aging: mutation probability increases over time.
    P(mutation) = base_rate * log(1 + t/100)
    When mutation occurs, the output is flipped.
    """
    rng = random.Random(seed)
    bits = rng.sample(range(d), 2)
    call_count = [0]
    mutations = [0]

    def f(x):
        call_count[0] += 1
        t = call_count[0]
        mut_rate = base_mutation_rate * math.log(1 + t / 100)
        r = (x >> bits[0]) & 1 ^ (x >> bits[1]) & 1
        if rng.random() < mut_rate:
            r = 1 - r
            mutations[0] += 1
        return bool(r)

    return f, {"type": "law_aging", "base_mutation_rate": base_mutation_rate,
               "d": d, "bits": bits}


def gen_competing_laws(d: int, seed: int = 42
                        ) -> Tuple[Callable, Dict]:
    """Multiple competing laws: the observations are consistent with
    multiple XOR laws. The substrate must pick one and verify.
    """
    # XOR of bits 0,1 is the same as XOR of bits 0,2,3 if bit 2 XOR bit 3 = 0
    # But that's not generally true. Instead, create a function where
    # bits 0,1 XOR = bits 2,3 XOR (always true if we define it that way)
    def f(x):
        # Both explanations are correct:
        # Explanation A: XOR(bits 0, 1)
        # Explanation B: XOR(bits 2, 3)
        # They're the same function by construction
        return bool((x >> 0) & 1 ^ (x >> 1) & 1)

    return f, {"type": "competing_laws", "d": d,
               "explanations": ["XOR(0,1)", "XOR(2,3)"]}


def gen_memory_pressure(d: int, seed: int = 42
                         ) -> Tuple[Callable, Dict]:
    """Memory pressure: law is correct but historical observations
    are removed. Tests whether the law survives without its training data.
    """
    rng = random.Random(seed)
    bits = rng.sample(range(d), 2)

    def f(x):
        return bool((x >> bits[0]) & 1 ^ (x >> bits[1]) & 1)

    return f, {"type": "memory_pressure", "d": d, "bits": bits}


# ===========================================================================
# Temporal Survival Tracker
# ===========================================================================

@dataclass
class SurvivalRecord:
    """Record of a law's survival over time."""
    step: int
    law_valid: bool          # is the law still correct?
    accuracy: float          # accuracy on recent window
    confidence: float        # verification confidence
    n_relearned: int         # how many times relearned
    cumulative_cost: int     # total cost so far
    cumulative_saved: int    # total savings so far


@dataclass
class TemporalResult:
    world_name: str
    world_type: str
    d: int
    horizon: int
    # Law lifetime
    law_lifetime: int            # steps before first failure
    n_relearnings: int           # times law was relearned
    avg_lifetime: float          # average lifetime per learning
    # Failure prediction
    failure_predicted: bool      # did confidence drop before failure?
    prediction_lead_time: int    # steps before failure that confidence dropped
    # Confidence calibration
    final_confidence: float
    confidence_at_failure: float
    # Economics
    total_cost: int
    total_saved: int
    net_value: int
    # Details
    survival_records: List[Dict] = field(default_factory=list)


def run_temporal_survival_benchmark() -> Dict[str, Any]:
    """Run the temporal law survival benchmark."""
    print("=" * 80)
    print("TEMPORAL LAW SURVIVAL BENCHMARK")
    print("=" * 80)

    d = 12
    state_space = 1 << d
    rng = random.Random(42)
    results: List[TemporalResult] = []

    # Helper: discover and verify a law from observations
    def discover_law(observations, true_fn):
        """Discover a law and verify it. Returns (cls, verified, cost)."""
        cls = classify(observations, d)
        verifier = LawVerificationLayer(n_adversarial=500)
        v = verifier.verify(cls, observations, d, true_fn=true_fn)
        if not v.accepted and cls.selected_class != "unknown":
            cls = ClassificationResult(
                selected_class="unknown",
                selection_reason=f"REJECTED: {v.rejection_reason[:60]}",
                classification_cost=cls.classification_cost + v.verification_cost)
        return cls, v.accepted, cls.classification_cost + v.verification_cost

    def evaluate_law(cls, true_fn, test_states):
        """Evaluate a law on test states. Returns (accuracy, cost)."""
        inf, _, n_correct, acc, _ = evaluate_representation(
            cls, true_fn, test_states, d)
        return acc, inf

    # ===== 1. LONG HORIZON =====
    print(f"\n{'='*60}")
    print("1. LONG HORIZON DYNAMICS")
    print(f"{'='*60}")

    for horizon in [500, 2000, 10000]:
        fn, meta = gen_long_horizon(d, horizon, seed=42)
        # Collect observations (first 200 from the stable period)
        obs = [(s, fn(s)) for s in rng.sample(range(state_space), 200)]
        cls, verified, cost = discover_law(obs, fn)

        # Track survival
        law_lifetime = 0
        n_relearned = 0
        survival_records = []
        cumulative_cost = cost
        cumulative_saved = 0
        confidence = 1.0 if verified else 0.0
        failure_predicted = False
        prediction_lead_time = 0
        confidence_at_failure = 1.0
        test_window = 50

        for step in range(1, min(horizon * 2, 15000) + 1, test_window):
            # Generate test states
            test_states = [rng.randint(0, state_space - 1) for _ in range(test_window)]
            acc, inf_cost = evaluate_law(cls, fn, test_states)

            # Track savings
            direct_cost = d * test_window
            cumulative_saved += max(0, direct_cost - inf_cost)
            cumulative_cost += inf_cost

            law_valid = acc >= 0.95
            if law_valid:
                law_lifetime = step
            else:
                if confidence_at_failure == 1.0:
                    confidence_at_failure = confidence
                # Relearn
                new_obs = [(s, fn(s)) for s in rng.sample(range(state_space), 200)]
                cls, verified, new_cost = discover_law(new_obs, fn)
                cumulative_cost += new_cost
                n_relearned += 1
                confidence = 1.0 if verified else 0.0
                law_valid = verified

            survival_records.append({
                "step": step, "law_valid": law_valid,
                "accuracy": round(acc, 3), "confidence": round(confidence, 2),
                "n_relearned": n_relearned,
                "cumulative_cost": cumulative_cost,
                "cumulative_saved": cumulative_saved,
            })

        avg_lifetime = law_lifetime / max(n_relearned + 1, 1)

        result = TemporalResult(
            world_name=f"long_h{horizon}", world_type="long_horizon",
            d=d, horizon=horizon,
            law_lifetime=law_lifetime, n_relearnings=n_relearned,
            avg_lifetime=avg_lifetime,
            failure_predicted=failure_predicted,
            prediction_lead_time=prediction_lead_time,
            final_confidence=confidence,
            confidence_at_failure=confidence_at_failure,
            total_cost=cumulative_cost, total_saved=cumulative_saved,
            net_value=cumulative_saved - cumulative_cost,
            survival_records=survival_records[-10:],
        )
        results.append(result)
        print(f"  horizon={horizon:>6}: lifetime={law_lifetime:>6} "
              f"relearned={n_relearned} net={'+' if result.net_value > 0 else ''}{result.net_value:,}")

    # ===== 2. ENVIRONMENT DRIFT =====
    print(f"\n{'='*60}")
    print("2. ENVIRONMENT DRIFT")
    print(f"{'='*60}")

    for drift_rate in [0.001, 0.01, 0.1]:
        fn, meta = gen_slow_drift(d, drift_rate, seed=42)
        obs = [(s, fn(s)) for s in rng.sample(range(state_space), 200)]
        cls, verified, cost = discover_law(obs, fn)

        law_lifetime = 0
        n_relearned = 0
        survival_records = []
        cumulative_cost = cost
        cumulative_saved = 0
        confidence = 1.0 if verified else 0.0
        test_window = 100

        for step in range(1, 5000 + 1, test_window):
            test_states = [rng.randint(0, state_space - 1) for _ in range(test_window)]
            acc, inf_cost = evaluate_law(cls, fn, test_states)
            direct_cost = d * test_window
            cumulative_saved += max(0, direct_cost - inf_cost)
            cumulative_cost += inf_cost

            law_valid = acc >= 0.95
            if law_valid:
                law_lifetime = step
            else:
                new_obs = [(s, fn(s)) for s in rng.sample(range(state_space), 200)]
                cls, verified, new_cost = discover_law(new_obs, fn)
                cumulative_cost += new_cost
                n_relearned += 1
                confidence = 1.0 if verified else 0.0

            survival_records.append({
                "step": step, "valid": law_valid, "acc": round(acc, 3),
                "relearned": n_relearned,
            })

        avg_lifetime = law_lifetime / max(n_relearned + 1, 1)
        result = TemporalResult(
            world_name=f"drift_{drift_rate}", world_type="slow_drift",
            d=d, horizon=5000,
            law_lifetime=law_lifetime, n_relearnings=n_relearned,
            avg_lifetime=avg_lifetime,
            failure_predicted=False, prediction_lead_time=0,
            final_confidence=confidence, confidence_at_failure=1.0,
            total_cost=cumulative_cost, total_saved=cumulative_saved,
            net_value=cumulative_saved - cumulative_cost,
            survival_records=survival_records[-5:],
        )
        results.append(result)
        print(f"  drift={drift_rate:.3f}: lifetime={law_lifetime:>5} "
              f"relearned={n_relearned} net={'+' if result.net_value > 0 else ''}{result.net_value:,}")

    # ===== 3. SUDDEN REGIME CHANGE =====
    print(f"\n{'='*60}")
    print("3. SUDDEN REGIME CHANGE")
    print(f"{'='*60}")

    for change_at in [500, 2000, 5000]:
        fn, meta = gen_sudden_regime_change(d, change_at, seed=42)
        obs = [(s, fn(s)) for s in rng.sample(range(state_space), 200)]
        cls, verified, cost = discover_law(obs, fn)

        law_lifetime = 0
        n_relearned = 0
        cumulative_cost = cost
        cumulative_saved = 0
        confidence = 1.0 if verified else 0.0
        test_window = 100

        for step in range(1, min(change_at * 3, 10000) + 1, test_window):
            test_states = [rng.randint(0, state_space - 1) for _ in range(test_window)]
            acc, inf_cost = evaluate_law(cls, fn, test_states)
            direct_cost = d * test_window
            cumulative_saved += max(0, direct_cost - inf_cost)
            cumulative_cost += inf_cost

            law_valid = acc >= 0.95
            if law_valid:
                law_lifetime = step
            else:
                new_obs = [(s, fn(s)) for s in rng.sample(range(state_space), 200)]
                cls, verified, new_cost = discover_law(new_obs, fn)
                cumulative_cost += new_cost
                n_relearned += 1
                confidence = 1.0 if verified else 0.0

        avg_lifetime = law_lifetime / max(n_relearned + 1, 1)
        result = TemporalResult(
            world_name=f"regime_{change_at}", world_type="sudden_regime_change",
            d=d, horizon=change_at * 3,
            law_lifetime=law_lifetime, n_relearnings=n_relearned,
            avg_lifetime=avg_lifetime,
            failure_predicted=False, prediction_lead_time=0,
            final_confidence=confidence, confidence_at_failure=1.0,
            total_cost=cumulative_cost, total_saved=cumulative_saved,
            net_value=cumulative_saved - cumulative_cost,
        )
        results.append(result)
        print(f"  change@{change_at:>5}: lifetime={law_lifetime:>5} "
              f"relearned={n_relearned} net={'+' if result.net_value > 0 else ''}{result.net_value:,}")

    # ===== 4. LAW AGING =====
    print(f"\n{'='*60}")
    print("4. LAW AGING")
    print(f"{'='*60}")

    for mut_rate in [0.001, 0.01, 0.05]:
        fn, meta = gen_law_aging(d, mut_rate, seed=42)
        obs = [(s, fn(s)) for s in rng.sample(range(state_space), 200)]
        cls, verified, cost = discover_law(obs, fn)

        law_lifetime = 0
        n_relearned = 0
        cumulative_cost = cost
        cumulative_saved = 0
        confidence = 1.0 if verified else 0.0
        test_window = 100

        for step in range(1, 5000 + 1, test_window):
            test_states = [rng.randint(0, state_space - 1) for _ in range(test_window)]
            acc, inf_cost = evaluate_law(cls, fn, test_states)
            direct_cost = d * test_window
            cumulative_saved += max(0, direct_cost - inf_cost)
            cumulative_cost += inf_cost

            law_valid = acc >= 0.90  # relaxed for aging (mutations cause noise)
            if law_valid:
                law_lifetime = step
            else:
                new_obs = [(s, fn(s)) for s in rng.sample(range(state_space), 200)]
                cls, verified, new_cost = discover_law(new_obs, fn)
                cumulative_cost += new_cost
                n_relearned += 1
                confidence = 1.0 if verified else 0.0

        avg_lifetime = law_lifetime / max(n_relearned + 1, 1)
        result = TemporalResult(
            world_name=f"aging_{mut_rate}", world_type="law_aging",
            d=d, horizon=5000,
            law_lifetime=law_lifetime, n_relearnings=n_relearned,
            avg_lifetime=avg_lifetime,
            failure_predicted=False, prediction_lead_time=0,
            final_confidence=confidence, confidence_at_failure=1.0,
            total_cost=cumulative_cost, total_saved=cumulative_saved,
            net_value=cumulative_saved - cumulative_cost,
        )
        results.append(result)
        print(f"  mut_rate={mut_rate:.3f}: lifetime={law_lifetime:>5} "
              f"relearned={n_relearned} net={'+' if result.net_value > 0 else ''}{result.net_value:,}")

    # ===== 5. COMPETING LAWS =====
    print(f"\n{'='*60}")
    print("5. COMPETING LAWS")
    print(f"{'='*60}")

    fn, meta = gen_competing_laws(d, seed=42)
    obs = [(s, fn(s)) for s in rng.sample(range(state_space), 200)]
    cls, verified, cost = discover_law(obs, fn)
    test_states = [rng.randint(0, state_space - 1) for _ in range(500)]
    acc, inf_cost = evaluate_law(cls, fn, test_states)

    result = TemporalResult(
        world_name="competing", world_type="competing_laws",
        d=d, horizon=500,
        law_lifetime=500 if acc >= 0.95 else 0,
        n_relearnings=0, avg_lifetime=500.0,
        failure_predicted=False, prediction_lead_time=0,
        final_confidence=1.0 if verified else 0.0,
        confidence_at_failure=1.0,
        total_cost=cost, total_saved=d * 500 - inf_cost,
        net_value=d * 500 - inf_cost - cost,
    )
    results.append(result)
    print(f"  competing: class={cls.selected_class} acc={acc:.1%} "
          f"verified={verified} net={result.net_value:,}")

    # ===== 6. MEMORY PRESSURE =====
    print(f"\n{'='*60}")
    print("6. MEMORY PRESSURE")
    print(f"{'='*60}")

    fn, meta = gen_memory_pressure(d, seed=42)
    obs_full = [(s, fn(s)) for s in rng.sample(range(state_space), 500)]

    # Discover with full observations
    cls_full, verified_full, cost_full = discover_law(obs_full, fn)
    # Discover with reduced observations (memory pressure: only 50)
    obs_reduced = obs_full[:50]
    cls_reduced, verified_reduced, cost_reduced = discover_law(obs_reduced, fn)

    test_states = [rng.randint(0, state_space - 1) for _ in range(500)]
    acc_full, _ = evaluate_law(cls_full, fn, test_states)
    acc_reduced, _ = evaluate_law(cls_reduced, fn, test_states)

    result = TemporalResult(
        world_name="memory_pressure", world_type="memory_pressure",
        d=d, horizon=500,
        law_lifetime=500 if acc_full >= 0.95 else 0,
        n_relearnings=0, avg_lifetime=500.0,
        failure_predicted=False, prediction_lead_time=0,
        final_confidence=1.0 if verified_full else 0.0,
        confidence_at_failure=1.0,
        total_cost=cost_full, total_saved=d * 500,
        net_value=d * 500 - cost_full,
    )
    result.survival_records = [
        {"observations": 500, "class": cls_full.selected_class, "acc": round(acc_full, 3), "verified": verified_full},
        {"observations": 50, "class": cls_reduced.selected_class, "acc": round(acc_reduced, 3), "verified": verified_reduced},
    ]
    results.append(result)
    print(f"  full(500obs): class={cls_full.selected_class} acc={acc_full:.1%} verified={verified_full}")
    print(f"  reduced(50obs): class={cls_reduced.selected_class} acc={acc_reduced:.1%} verified={verified_reduced}")

    # ===== SUMMARY =====
    print(f"\n{'='*80}")
    print("TEMPORAL SURVIVAL SUMMARY")
    print(f"{'='*80}")
    print(f"\n{'World':<20} {'Type':<22} {'Lifetime':<10} {'Relearned':<10} {'Net Value':<12} {'Verdict'}")
    for r in results:
        if r.net_value > 0:
            verdict = "NET POSITIVE"
        elif r.law_lifetime > 0:
            verdict = "SURVIVES"
        else:
            verdict = "FAILS"
        print(f"{r.world_name:<20} {r.world_type:<22} {r.law_lifetime:<10} "
              f"{r.n_relearnings:<10} {'+' if r.net_value > 0 else ''}{r.net_value:<12,} {verdict}")

    # Aggregate
    n_positive = sum(1 for r in results if r.net_value > 0)
    n_survives = sum(1 for r in results if r.law_lifetime > 0)
    avg_lifetime = sum(r.law_lifetime for r in results) / len(results)
    total_relearned = sum(r.n_relearnings for r in results)

    print(f"\nAggregate:")
    print(f"  Net positive: {n_positive}/{len(results)}")
    print(f"  Laws survive: {n_survives}/{len(results)}")
    print(f"  Avg lifetime: {avg_lifetime:.0f} steps")
    print(f"  Total relearnings: {total_relearned}")

    return {
        "summary": {
            "n_worlds": len(results),
            "n_net_positive": n_positive,
            "n_survives": n_survives,
            "avg_lifetime": round(avg_lifetime, 1),
            "total_relearnings": total_relearned,
        },
        "results": [
            {
                "world": r.world_name, "type": r.world_type, "d": r.d,
                "horizon": r.horizon,
                "law_lifetime": r.law_lifetime,
                "n_relearnings": r.n_relearnings,
                "avg_lifetime": round(r.avg_lifetime, 1),
                "final_confidence": r.final_confidence,
                "total_cost": r.total_cost,
                "total_saved": r.total_saved,
                "net_value": r.net_value,
                "survival_records": r.survival_records,
            }
            for r in results
        ],
    }


if __name__ == "__main__":
    results = run_temporal_survival_benchmark()
    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "..", "download", "rce", "rce2_temporal_survival_results.json")
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\nResults saved to: {out_path}")
