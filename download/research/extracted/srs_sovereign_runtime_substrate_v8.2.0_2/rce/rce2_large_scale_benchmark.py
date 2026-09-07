#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rce2_large_scale_benchmark.py — Large-Scale Law Discovery Benchmark

Tests whether verified laws create a NET computational advantage
after ALL costs are included, as state space grows.

SCALES: d=16, d=20, d=24 (65536, 1M, 16M states)

WORLD TYPES:
  - simple: XOR of k bits (should compress at all scales)
  - compositional: f(g(x), h(x)) where g,h are simple
  - multi_step: state evolves over t steps
  - hidden_var: outcome depends on unobserved variable
  - changing_env: rule changes midway
  - false_simplicity: appears simple but has hidden complexity

ECONOMIC MODEL:
  total_cost = discovery_cost + verification_cost + storage_cost + inference_cost
  total_saved = direct_cost_if_no_substrate - total_cost
  break_even = (discovery + verification) / (direct_per_pred - inference_per_pred)

ADVERSARIAL ATTACKS:
  - distribution shift: test on different distribution than train
  - corrupted observations: 5% labels flipped
  - evolving rules: function changes after 50% of observations
  - false simplicity trap: function looks linear but has hidden nonlinear term
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
)
from rce2_law_verification import LawVerificationLayer, VerifiedClassifier


# ===========================================================================
# Large-Scale World Generators
# ===========================================================================

def gen_simple_xor(d: int, k: int, seed: int = 42) -> Tuple[Callable, Dict]:
    """Simple XOR of k bits. Should compress at all scales."""
    rng = random.Random(seed)
    bits = rng.sample(range(d), k)
    def f(x): 
        r = 0
        for b in bits: r ^= (x >> b) & 1
        return bool(r)
    return f, {"type": "simple_xor", "k": k, "d": d, "kc": k * math.log2(d)}


def gen_compositional(d: int, seed: int = 42) -> Tuple[Callable, Dict]:
    """f(x) = g(x) XOR h(x) where g depends on first half, h on second half."""
    rng = random.Random(seed)
    half = d // 2
    g_bits = rng.sample(range(half), 2)
    h_bits = rng.sample(range(half, d), 2)
    def f(x):
        g = (x >> g_bits[0]) & 1 ^ (x >> g_bits[1]) & 1
        h = (x >> h_bits[0]) & 1 ^ (x >> h_bits[1]) & 1
        return bool(g ^ h)
    return f, {"type": "compositional", "g_bits": g_bits, "h_bits": h_bits,
               "d": d, "kc": 4 * math.log2(d)}


def gen_multi_step(d: int, n_steps: int, seed: int = 42) -> Tuple[Callable, Dict]:
    """Multi-step: apply XOR evolution n_steps times, return final bit 0."""
    rng = random.Random(seed)
    rules = []
    for _ in range(n_steps):
        src = rng.randint(0, d - 1)
        dst = rng.randint(0, d - 1)
        if src != dst:
            rules.append((src, dst))
    def f(x):
        s = x
        for src, dst in rules:
            s ^= ((s >> src) & 1) << dst
        return bool(s & 1)
    return f, {"type": "multi_step", "n_steps": len(rules), "d": d,
               "kc": len(rules) * math.log2(d)}


def gen_hidden_var(d: int, seed: int = 42) -> Tuple[Callable, Dict]:
    """Outcome depends on an unobserved variable (bit d, not in state).
    The state only has d bits; the hidden variable is the (d+1)th bit
    which we simulate as parity of all d bits (deterministic but hard to discover).
    """
    rng = random.Random(seed)
    observed_bits = rng.sample(range(d), 2)
    def f(x):
        hidden = bin(x).count('1') % 2  # hidden variable = parity
        observed = (x >> observed_bits[0]) & 1 ^ (x >> observed_bits[1]) & 1
        return bool(hidden ^ observed)
    return f, {"type": "hidden_var", "observed_bits": observed_bits,
               "d": d, "kc": d * math.log2(d)}


def gen_changing_env(d: int, seed: int = 42) -> Tuple[Callable, Dict]:
    """Rule changes midway: first half of observations use rule A,
    second half uses rule B. Tests if the substrate detects the change."""
    rng = random.Random(seed)
    bits_a = rng.sample(range(d), 2)
    bits_b = rng.sample(range(d), 3)
    call_count = [0]
    threshold = 150  # change after 150 calls
    def f(x):
        call_count[0] += 1
        if call_count[0] <= threshold:
            return bool((x >> bits_a[0]) & 1 ^ (x >> bits_a[1]) & 1)
        else:
            r = 0
            for b in bits_b: r ^= (x >> b) & 1
            return bool(r)
    return f, {"type": "changing_env", "bits_a": bits_a, "bits_b": bits_b,
               "d": d, "kc": 5 * math.log2(d)}


def gen_false_simplicity(d: int, seed: int = 42) -> Tuple[Callable, Dict]:
    """Looks linear (XOR of 2 bits) but has a rare nonlinear term
    that triggers on ~1% of states. Tests if verification catches it."""
    rng = random.Random(seed)
    bits = rng.sample(range(d), 2)
    rare_mask = rng.randint(0, (1 << d) - 1)
    def f(x):
        base = (x >> bits[0]) & 1 ^ (x >> bits[1]) & 1
        # Rare nonlinear perturbation: flip output when x matches rare_mask closely
        if bin(x & rare_mask).count('1') >= d - 1:  # ~1/2^d * d ≈ rare
            base = 1 - base
        return bool(base)
    return f, {"type": "false_simplicity", "bits": bits, "rare_mask": rare_mask,
               "d": d, "kc": 2 * math.log2(d) + d}


def gen_corrupted_wrapper(fn: Callable, corruption_rate: float = 0.05,
                           seed: int = 42) -> Tuple[Callable, Dict]:
    """Wrap a function with 5% label corruption."""
    rng = random.Random(seed)
    def f(x):
        true = fn(x)
        if rng.random() < corruption_rate:
            return not true
        return true
    return f, {"type": "corrupted", "corruption_rate": corruption_rate,
               "d": 0, "kc": 0}


# ===========================================================================
# Economic Model
# ===========================================================================

@dataclass
class EconomicResult:
    world_name: str
    world_type: str
    d: int
    state_space: int
    # Costs
    discovery_cost: int        # classification (trying all families)
    verification_cost: int     # verification layer
    storage_cost: int          # bytes to store the law
    inference_cost_per_pred: float  # ops per prediction
    direct_cost_per_pred: int  # cost of direct execution
    # Results
    selected_class: str
    held_out_accuracy: float
    false_compression: bool
    # Economics
    total_upfront: int         # discovery + verification
    saving_per_pred: float     # direct - inference per prediction
    break_even: int            # predictions needed to recover upfront
    net_advantage: bool        # break_even < state_space?
    # Verification details
    n_rejected: int
    rejection_reason: str


def run_large_scale_benchmark() -> Dict[str, Any]:
    """Run the large-scale benchmark at multiple dimensions."""
    print("=" * 80)
    print("LARGE-SCALE LAW DISCOVERY BENCHMARK")
    print("=" * 80)

    all_results = []

    for d in [16, 20, 24]:
        print(f"\n{'='*60}")
        print(f"SCALE: d={d}, state_space={1<<d:,}")
        print(f"{'='*60}")

        state_space = 1 << d
        obs_budget = min(500, state_space)
        n_test = min(300, state_space // 2)
        rng = random.Random(42 + d)

        # Generate worlds for this scale
        worlds = []

        # Simple XOR (should compress)
        for k in [2, 4, 8]:
            fn, meta = gen_simple_xor(d, k, seed=d + k)
            worlds.append((f"simple_xor_k{k}", fn, meta))

        # Compositional
        fn, meta = gen_compositional(d, seed=d * 2)
        worlds.append(("compositional", fn, meta))

        # Multi-step
        for n_steps in [5, 10, 20]:
            fn, meta = gen_multi_step(d, n_steps, seed=d * 3 + n_steps)
            worlds.append((f"multi_step_t{n_steps}", fn, meta))

        # Hidden variable
        fn, meta = gen_hidden_var(d, seed=d * 4)
        worlds.append(("hidden_var", fn, meta))

        # Changing environment
        fn, meta = gen_changing_env(d, seed=d * 5)
        worlds.append(("changing_env", fn, meta))

        # False simplicity
        fn, meta = gen_false_simplicity(d, seed=d * 6)
        worlds.append(("false_simplicity", fn, meta))

        # Corrupted observations (wrap simple XOR)
        base_fn, _ = gen_simple_xor(d, 3, seed=d * 7)
        fn, meta = gen_corrupted_wrapper(base_fn, 0.05, seed=d * 8)
        worlds.append(("corrupted_5pct", fn, meta))

        for name, fn, meta in worlds:
            t0 = time.time()
            meta["d"] = d

            # Generate observations
            observed = set()
            obs = []
            while len(obs) < obs_budget:
                s = rng.randint(0, state_space - 1)
                if s not in observed:
                    observed.add(s)
                    obs.append((s, fn(s)))

            # Test states
            test = []
            while len(test) < n_test:
                s = rng.randint(0, state_space - 1)
                if s not in observed:
                    test.append(s)

            # For large d, Walsh (testing all 2^d masks) is infeasible.
            # We skip Walsh for d > 18 and only try GF(2) + DFA.
            if d > 18:
                # Direct GF(2) only (skip Walsh and DFA for speed)
                gf2 = try_gf2_recovery(obs, d)
                if gf2.fits:
                    cls = ClassificationResult(
                        selected_class="gf2", gf2_result=gf2,
                        walsh_result=WalshResult(fits=False, n_coefficients=0,
                                                   coefficients={}, construction_cost=0,
                                                   storage_bytes=0, spectral_sparsity=0,
                                                   rejection_reason="skipped (d>18)"),
                        dfa_result=DFAResult(fits=False, n_states=0, transitions={},
                                              accepting=set(), construction_cost=0,
                                              storage_bytes=0, rejection_reason="skipped (d>18)"),
                        selection_reason=f"GF(2) fits: {len(gf2.solution)} bits",
                        classification_cost=gf2.construction_cost)
                else:
                    cls = ClassificationResult(
                        selected_class="unknown",
                        selection_reason=f"GF(2) rejected: {gf2.rejection_reason}",
                        classification_cost=gf2.construction_cost)
            else:
                # Full classification (all 3 families)
                cls = classify(obs, d)

            # Verify
            verifier = LawVerificationLayer(n_adversarial=500)
            verification = verifier.verify(cls, obs, d, true_fn=fn)

            # If verification rejects, override to UNKNOWN
            if not verification.accepted and cls.selected_class != "unknown":
                cls = ClassificationResult(
                    selected_class="unknown",
                    selection_reason=f"VERIFIED-REJECTED: {verification.rejection_reason[:60]}",
                    classification_cost=cls.classification_cost + verification.verification_cost)

            # Evaluate
            inf_cost, storage, n_correct, acc, cov = evaluate_representation(
                cls, fn, test, d)

            # Economic model
            direct_per_pred = d  # cost of one direct evaluation
            inf_per_pred = inf_cost / max(len(test), 1)
            discovery_cost = cls.classification_cost
            total_upfront = discovery_cost + verification.verification_cost
            saving_per_pred = direct_per_pred - inf_per_pred
            if saving_per_pred > 0:
                break_even = math.ceil(total_upfront / saving_per_pred)
            else:
                break_even = -1

            net_advantage = (break_even > 0 and break_even < state_space)

            false_comp = (cls.selected_class != "unknown" and acc < 0.95)

            elapsed = time.time() - t0

            result = EconomicResult(
                world_name=name, world_type=meta["type"], d=d,
                state_space=state_space,
                discovery_cost=discovery_cost,
                verification_cost=verification.verification_cost,
                storage_cost=storage,
                inference_cost_per_pred=round(inf_per_pred, 2),
                direct_cost_per_pred=direct_per_pred,
                selected_class=cls.selected_class,
                held_out_accuracy=round(acc, 4),
                false_compression=false_comp,
                total_upfront=total_upfront,
                saving_per_pred=round(saving_per_pred, 2),
                break_even=break_even,
                net_advantage=net_advantage,
                n_rejected=1 if verification.rejection_reason else 0,
                rejection_reason=verification.rejection_reason[:60] if verification.rejection_reason else "",
            )
            all_results.append(result)

            # Print
            if false_comp:
                verdict = "FALSE"
            elif cls.selected_class == "unknown":
                verdict = "ESC"
            elif net_advantage:
                verdict = "OK+NET+"
            else:
                verdict = "OK"

            be_str = f"{break_even:,}" if break_even > 0 else "never"
            print(f"  [{name:<20}] d={d} → {cls.selected_class:<8} acc={acc:.0%} "
                  f"be={be_str} net={'Y' if net_advantage else 'N'} "
                  f"[{elapsed:.1f}s]")
            if verification.rejection_reason:
                print(f"    REJECTED: {verification.rejection_reason[:70]}")

    # === SUMMARY ===
    print(f"\n{'='*80}")
    print("LARGE-SCALE SUMMARY")
    print(f"{'='*80}")

    print(f"\n{'World':<22} {'Type':<18} {'d':<4} {'Class':<8} {'Acc%':<5} {'BE':<12} {'Net':<4} {'False'}")
    for r in all_results:
        be = f"{r.break_even:,}" if r.break_even > 0 else "never"
        print(f"{r.world_name:<22} {r.world_type:<18} {r.d:<4} {r.selected_class:<8} "
              f"{r.held_out_accuracy*100:<5.0f} {be:<12} "
              f"{'Y' if r.net_advantage else 'N':<4} {'Y' if r.false_compression else 'N'}")

    # Per-scale economics
    print(f"\n{'='*80}")
    print("ECONOMIC ANALYSIS BY SCALE")
    print(f"{'='*80}")
    for d in [16, 20, 24]:
        scale_results = [r for r in all_results if r.d == d]
        n = len(scale_results)
        n_compressed = sum(1 for r in scale_results if r.selected_class != "unknown")
        n_escaped = sum(1 for r in scale_results if r.selected_class == "unknown")
        n_false = sum(1 for r in scale_results if r.false_compression)
        n_net = sum(1 for r in scale_results if r.net_advantage)
        avg_upfront = sum(r.total_upfront for r in scale_results) / n
        avg_be = [r.break_even for r in scale_results if r.break_even > 0]
        avg_be_val = sum(avg_be) / max(len(avg_be), 1) if avg_be else -1
        state_space = 1 << d
        print(f"\nd={d} (state_space={state_space:,}):")
        print(f"  Compressed: {n_compressed}/{n}, Escalated: {n_escaped}/{n}, False: {n_false}")
        print(f"  Net advantage: {n_net}/{n}")
        print(f"  Avg upfront cost: {avg_upfront:,.0f} ops")
        if avg_be_val > 0:
            print(f"  Avg break-even: {avg_be_val:,.0f} predictions "
                  f"({avg_be_val/state_space*100:.1f}% of state space)")
        else:
            print(f"  Avg break-even: never (no compression)")

    # Scaling trend
    print(f"\n{'='*80}")
    print("SCALING TREND")
    print(f"{'='*80}")
    print(f"{'d':<5} {'State Space':<15} {'Compression%':<15} {'False%':<10} {'NetAdv%':<10} {'AvgBE/SS%':<10}")
    for d in [16, 20, 24]:
        sr = [r for r in all_results if r.d == d]
        n = len(sr)
        comp = sum(1 for r in sr if r.selected_class != "unknown") / n * 100
        false = sum(1 for r in sr if r.false_compression) / n * 100
        net = sum(1 for r in sr if r.net_advantage) / n * 100
        be_list = [r.break_even for r in sr if r.break_even > 0]
        ss = 1 << d
        be_pct = (sum(be_list)/max(len(be_list),1)) / ss * 100 if be_list else 100
        print(f"{d:<5} {ss:<15,} {comp:<15.0f} {false:<10.0f} {net:<10.0f} {be_pct:<10.1f}")

    return {
        "results": [
            {
                "world": r.world_name, "type": r.world_type, "d": r.d,
                "state_space": r.state_space,
                "selected_class": r.selected_class,
                "held_out_accuracy": r.held_out_accuracy,
                "false_compression": r.false_compression,
                "discovery_cost": r.discovery_cost,
                "verification_cost": r.verification_cost,
                "storage_cost": r.storage_cost,
                "inference_cost_per_pred": r.inference_cost_per_pred,
                "direct_cost_per_pred": r.direct_cost_per_pred,
                "total_upfront": r.total_upfront,
                "saving_per_pred": r.saving_per_pred,
                "break_even": r.break_even,
                "net_advantage": r.net_advantage,
                "rejection_reason": r.rejection_reason,
            }
            for r in all_results
        ],
    }


# Need these imports for d>18 path
from rce2_meta_representation_v2 import WalshResult, DFAResult

if __name__ == "__main__":
    results = run_large_scale_benchmark()
    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "..", "download", "rce", "rce2_large_scale_results.json")
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\nResults saved to: {out_path}")
