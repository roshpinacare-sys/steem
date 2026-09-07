#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rce2_adversarial_reliability.py — Adversarial Law Reliability Benchmark

GOAL: Find the mathematical limit of verified law discovery.

6 adversarial world types designed to fool the substrate:
  1. Rare exception: 99.99% follow law, 0.01% violate it
  2. Delayed failure: training+validation perfect, failure after long horizon
  3. Evolving law: law changes after unknown time T
  4. Hidden variable: observed state insufficient
  5. Compositional explosion: simple laws combine into complex system
  6. Adaptive adversary: generates states maximizing false acceptance

METRICS:
  - false law acceptance probability (P_false_accept)
  - false rejection probability (P_false_reject)
  - detection latency (observations before detection)
  - verification cost growth
  - minimum observation budget required
  - lifetime economic value after adversarial failures
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
from rce2_law_verification import LawVerificationLayer, VerifiedClassifier


# ===========================================================================
# Adversarial World Generators
# ===========================================================================

def gen_rare_exception(d: int, rarity: float, seed: int = 42
                        ) -> Tuple[Callable, Dict]:
    """99.99% follow XOR law, rarity fraction violate it.

    The violation states are random — NOT structured. The substrate must
    discover that exceptions exist and escalate rather than accept the law.
    """
    rng = random.Random(seed)
    bits = rng.sample(range(d), 2)
    # Pre-generate violation states
    state_space = 1 << d
    n_violations = max(1, int(state_space * rarity))
    violation_states = set()
    while len(violation_states) < n_violations:
        violation_states.add(rng.randint(0, state_space - 1))

    def f(x):
        base = (x >> bits[0]) & 1 ^ (x >> bits[1]) & 1
        if x in violation_states:
            return bool(1 - base)  # flip
        return bool(base)

    return f, {"type": "rare_exception", "rarity": rarity,
               "n_violations": n_violations, "d": d,
               "bits": bits, "kc": 2 * math.log2(d) + n_violations}


def gen_delayed_failure(d: int, horizon: int, seed: int = 42
                         ) -> Tuple[Callable, Dict]:
    """Training and validation are perfectly consistent (XOR law).
    Failure appears only after `horizon` predictions — the function
    has a hidden state counter that flips the rule after `horizon` calls.

    The substrate cannot detect this from observations alone — the
    counter is internal state, not in the feature vector.
    """
    rng = random.Random(seed)
    bits = rng.sample(range(d), 2)
    call_count = [0]

    def f(x):
        call_count[0] += 1
        base = (x >> bits[0]) & 1 ^ (x >> bits[1]) & 1
        if call_count[0] > horizon:
            return bool(1 - base)  # flip after horizon
        return bool(base)

    return f, {"type": "delayed_failure", "horizon": horizon,
               "d": d, "bits": bits, "kc": 2 * math.log2(d) + math.log2(horizon)}


def gen_evolving_law(d: int, change_point: int, seed: int = 42
                      ) -> Tuple[Callable, Dict]:
    """Law changes after `change_point` observations.
    Rule A (XOR of 2 bits) for first change_point calls,
    Rule B (XOR of 3 different bits) after.
    """
    rng = random.Random(seed)
    bits_a = rng.sample(range(d), 2)
    bits_b = rng.sample(range(d), 3)
    call_count = [0]

    def f(x):
        call_count[0] += 1
        if call_count[0] <= change_point:
            return bool((x >> bits_a[0]) & 1 ^ (x >> bits_a[1]) & 1)
        else:
            r = 0
            for b in bits_b:
                r ^= (x >> b) & 1
            return bool(r)

    return f, {"type": "evolving_law", "change_point": change_point,
               "bits_a": bits_a, "bits_b": bits_b,
               "d": d, "kc": 5 * math.log2(d)}


def gen_hidden_variable(d: int, seed: int = 42
                         ) -> Tuple[Callable, Dict]:
    """Observed state is d bits. Outcome depends on a HIDDEN variable
    (the (d+1)th bit) which is the parity of all d observed bits.
    The minimal law requires computing the hidden variable from observations,
    making it a degree-d polynomial — incompressible for large d.
    """
    rng = random.Random(seed)
    obs_bits = rng.sample(range(d), 2)

    def f(x):
        hidden = bin(x).count('1') % 2  # parity = hidden variable
        observed = (x >> obs_bits[0]) & 1 ^ (x >> obs_bits[1]) & 1
        return bool(hidden ^ observed)

    return f, {"type": "hidden_variable", "obs_bits": obs_bits,
               "d": d, "kc": d * math.log2(d)}


def gen_compositional_explosion(d: int, n_layers: int, seed: int = 42
                                 ) -> Tuple[Callable, Dict]:
    """Multiple simple laws combine into one high-complexity system.
    Each layer XORs 2 bits and feeds the result to the next layer.
    After n_layers, the function depends on 2*n_layers bits via a
    deep composition that is linear over GF(2) but has high Walsh degree.
    """
    rng = random.Random(seed)
    layers = []
    for _ in range(n_layers):
        layers.append(rng.sample(range(d), 2))

    def f(x):
        result = 0
        for b1, b2 in layers:
            result ^= ((x >> b1) & 1) ^ ((x >> b2) & 1)
        return bool(result)

    return f, {"type": "compositional_explosion", "n_layers": n_layers,
               "d": d, "kc": 2 * n_layers * math.log2(d)}


def gen_adaptive_adversary(d: int, seed: int = 42
                            ) -> Tuple[Callable, Dict]:
    """Adaptive adversary: the function is designed to maximize false
    acceptance probability. It IS linear (XOR of 2 bits) but the
    adversary selects which 2 bits based on the verification strategy.

    Specifically: the function XORs bits 0 and 1, which the GF(2) solver
    will find immediately. But the adversary has planted a SECOND
    hidden pattern (bit 2 AND bit 3) that activates on ~25% of states
    and flips the output. The GF(2) solver will find the XOR pattern,
    and the verification's held-out test may miss the AND pattern if
    the held-out set doesn't include enough AND-active states.
    """
    def f(x):
        xor_part = (x >> 0) & 1 ^ (x >> 1) & 1
        # Hidden AND pattern: flips output when bits 2,3 are both 1
        and_part = ((x >> 2) & 1) & ((x >> 3) & 1)
        return bool(xor_part ^ and_part)

    return f, {"type": "adaptive_adversary", "d": d,
               "kc": 4 * math.log2(d)}


# ===========================================================================
# Benchmark Runner
# ===========================================================================

@dataclass
class AdversarialResult:
    world_name: str
    world_type: str
    d: int
    selected_class: str
    held_out_accuracy: float
    false_acceptance: bool     # law accepted but doesn't generalize
    false_rejection: bool      # law rejected but was actually valid
    detection_latency: int     # observations before detection (if evolving)
    verification_cost: int
    n_counterexamples: int
    n_adversarial_tested: int
    rejection_reason: str
    # Economics
    break_even: int
    lifetime_value: int        # net ops saved over state_space predictions


def run_adversarial_reliability_benchmark() -> Dict[str, Any]:
    """Run the adversarial reliability benchmark."""
    print("=" * 80)
    print("ADVERSARIAL LAW RELIABILITY BENCHMARK")
    print("=" * 80)

    d = 16
    state_space = 1 << d
    obs_budget = 500
    n_test = 500
    rng = random.Random(42)
    results: List[AdversarialResult] = []

    # ===== 1. RARE EXCEPTION WORLDS =====
    print(f"\n{'='*60}")
    print("1. RARE EXCEPTION WORLDS")
    print(f"{'='*60}")

    for rarity in [1e-2, 1e-3, 1e-4, 1e-5, 1e-6, 1e-9]:
        fn, meta = gen_rare_exception(d, rarity, seed=42)
        n_violations = meta["n_violations"]
        observed = set()
        obs = []
        while len(obs) < obs_budget:
            s = rng.randint(0, state_space - 1)
            if s not in observed:
                observed.add(s)
                obs.append((s, fn(s)))
        test = []
        while len(test) < n_test:
            s = rng.randint(0, state_space - 1)
            if s not in observed:
                test.append(s)

        # For d=16, Walsh is feasible
        cls = classify(obs, d)
        verifier = LawVerificationLayer(n_adversarial=2000)
        verification = verifier.verify(cls, obs, d, true_fn=fn)
        if not verification.accepted and cls.selected_class != "unknown":
            cls = ClassificationResult(
                selected_class="unknown",
                selection_reason=f"VERIFIED-REJECTED: {verification.rejection_reason[:60]}",
                classification_cost=cls.classification_cost + verification.verification_cost)

        _, _, _, acc, _ = evaluate_representation(cls, fn, test, d)
        false_acc = (cls.selected_class != "unknown" and acc < 0.95)

        # Detection probability: did adversarial search find the violation?
        detection_prob = verification.n_counterexamples_found > 0

        result = AdversarialResult(
            world_name=f"rare_exc_{rarity:.0e}", world_type="rare_exception",
            d=d, selected_class=cls.selected_class, held_out_accuracy=round(acc, 4),
            false_acceptance=false_acc, false_rejection=False,
            detection_latency=0, verification_cost=verification.verification_cost,
            n_counterexamples=verification.n_counterexamples_found,
            n_adversarial_tested=verification.n_adversarial_tested,
            rejection_reason=verification.rejection_reason[:60] if verification.rejection_reason else "",
            break_even=0, lifetime_value=0)
        results.append(result)

        print(f"  rarity={rarity:.0e} n_violations={n_violations:>6} "
              f"→ {cls.selected_class:<8} acc={acc:.1%} false_acc={false_acc} "
              f"counterexamples={verification.n_counterexamples_found}")

    # ===== 2. DELAYED FAILURE WORLDS =====
    print(f"\n{'='*60}")
    print("2. DELAYED FAILURE WORLDS")
    print(f"{'='*60}")

    for horizon in [500, 1000, 5000, 10000]:
        fn, meta = gen_delayed_failure(d, horizon, seed=42)
        observed = set()
        obs = []
        while len(obs) < obs_budget:
            s = rng.randint(0, state_space - 1)
            if s not in observed:
                observed.add(s)
                obs.append((s, fn(s)))
        test = []
        while len(test) < n_test:
            s = rng.randint(0, state_space - 1)
            if s not in observed:
                test.append(s)

        cls = classify(obs, d)
        verifier = LawVerificationLayer(n_adversarial=2000)
        verification = verifier.verify(cls, obs, d, true_fn=fn)
        if not verification.accepted and cls.selected_class != "unknown":
            cls = ClassificationResult(
                selected_class="unknown",
                selection_reason=f"VERIFIED-REJECTED: {verification.rejection_reason[:60]}",
                classification_cost=cls.classification_cost + verification.verification_cost)

        _, _, _, acc, _ = evaluate_representation(cls, fn, test, d)
        # For delayed failure: test states are called AFTER horizon, so
        # the function has already flipped. The law should fail on test.
        false_acc = (cls.selected_class != "unknown" and acc < 0.95)

        result = AdversarialResult(
            world_name=f"delayed_h{horizon}", world_type="delayed_failure",
            d=d, selected_class=cls.selected_class, held_out_accuracy=round(acc, 4),
            false_acceptance=false_acc, false_rejection=False,
            detection_latency=horizon, verification_cost=verification.verification_cost,
            n_counterexamples=verification.n_counterexamples_found,
            n_adversarial_tested=verification.n_adversarial_tested,
            rejection_reason=verification.rejection_reason[:60] if verification.rejection_reason else "",
            break_even=0, lifetime_value=0)
        results.append(result)

        print(f"  horizon={horizon:>6} → {cls.selected_class:<8} acc={acc:.1%} "
              f"false_acc={false_acc} counterexamples={verification.n_counterexamples_found}")

    # ===== 3. EVOLVING LAW WORLDS =====
    print(f"\n{'='*60}")
    print("3. EVOLVING LAW WORLDS")
    print(f"{'='*60}")

    for change_point in [100, 250, 400, 500]:
        fn, meta = gen_evolving_law(d, change_point, seed=42)
        observed = set()
        obs = []
        while len(obs) < obs_budget:
            s = rng.randint(0, state_space - 1)
            if s not in observed:
                observed.add(s)
                obs.append((s, fn(s)))
        test = []
        while len(test) < n_test:
            s = rng.randint(0, state_space - 1)
            if s not in observed:
                test.append(s)

        cls = classify(obs, d)
        verifier = LawVerificationLayer(n_adversarial=2000)
        verification = verifier.verify(cls, obs, d, true_fn=fn)
        if not verification.accepted and cls.selected_class != "unknown":
            cls = ClassificationResult(
                selected_class="unknown",
                selection_reason=f"VERIFIED-REJECTED: {verification.rejection_reason[:60]}",
                classification_cost=cls.classification_cost + verification.verification_cost)

        _, _, _, acc, _ = evaluate_representation(cls, fn, test, d)
        false_acc = (cls.selected_class != "unknown" and acc < 0.95)

        result = AdversarialResult(
            world_name=f"evolving_t{change_point}", world_type="evolving_law",
            d=d, selected_class=cls.selected_class, held_out_accuracy=round(acc, 4),
            false_acceptance=false_acc, false_rejection=False,
            detection_latency=change_point, verification_cost=verification.verification_cost,
            n_counterexamples=verification.n_counterexamples_found,
            n_adversarial_tested=verification.n_adversarial_tested,
            rejection_reason=verification.rejection_reason[:60] if verification.rejection_reason else "",
            break_even=0, lifetime_value=0)
        results.append(result)

        print(f"  change@{change_point:>3} → {cls.selected_class:<8} acc={acc:.1%} "
              f"false_acc={false_acc} reason={verification.rejection_reason[:40] if verification.rejection_reason else 'accepted'}")

    # ===== 4. HIDDEN VARIABLE WORLDS =====
    print(f"\n{'='*60}")
    print("4. HIDDEN VARIABLE WORLDS")
    print(f"{'='*60}")

    for d_test in [8, 12, 16, 20, 24]:
        fn, meta = gen_hidden_variable(d_test, seed=42)
        ss = 1 << d_test
        obs = [(s, fn(s)) for s in rng.sample(range(ss), min(500, ss))]
        test = [s for s in rng.sample(range(ss), min(300, ss)) if s not in set(o[0] for o in obs)]

        if d_test > 18:
            gf2 = try_gf2_recovery(obs, d_test)
            if gf2.fits:
                cls = ClassificationResult(
                    selected_class="gf2", gf2_result=gf2,
                    walsh_result=WalshResult(fits=False, n_coefficients=0, coefficients={},
                                              construction_cost=0, storage_bytes=0,
                                              spectral_sparsity=0, rejection_reason="skipped"),
                    dfa_result=DFAResult(fits=False, n_states=0, transitions={}, accepting=set(),
                                          construction_cost=0, storage_bytes=0, rejection_reason="skipped"),
                    selection_reason="GF2", classification_cost=gf2.construction_cost)
            else:
                cls = ClassificationResult(selected_class="unknown",
                                            selection_reason=f"GF2: {gf2.rejection_reason}",
                                            classification_cost=gf2.construction_cost)
        else:
            cls = classify(obs, d_test)

        verifier = LawVerificationLayer(n_adversarial=2000)
        verification = verifier.verify(cls, obs, d_test, true_fn=fn)
        if not verification.accepted and cls.selected_class != "unknown":
            cls = ClassificationResult(selected_class="unknown",
                                        selection_reason=f"REJECTED: {verification.rejection_reason[:60]}",
                                        classification_cost=cls.classification_cost + verification.verification_cost)

        _, _, _, acc, _ = evaluate_representation(cls, fn, test, d_test)
        false_acc = (cls.selected_class != "unknown" and acc < 0.95)

        result = AdversarialResult(
            world_name=f"hidden_d{d_test}", world_type="hidden_variable",
            d=d_test, selected_class=cls.selected_class, held_out_accuracy=round(acc, 4),
            false_acceptance=false_acc, false_rejection=False,
            detection_latency=0, verification_cost=verification.verification_cost,
            n_counterexamples=verification.n_counterexamples_found,
            n_adversarial_tested=verification.n_adversarial_tested,
            rejection_reason=verification.rejection_reason[:60] if verification.rejection_reason else "",
            break_even=0, lifetime_value=0)
        results.append(result)

        print(f"  d={d_test:>2} → {cls.selected_class:<8} acc={acc:.1%} "
              f"false_acc={false_acc} reason={verification.rejection_reason[:40] if verification.rejection_reason else 'accepted'}")

    # ===== 5. COMPOSITIONAL EXPLOSION =====
    print(f"\n{'='*60}")
    print("5. COMPOSITIONAL EXPLOSION")
    print(f"{'='*60}")

    for n_layers in [1, 2, 4, 8, 16, 32]:
        fn, meta = gen_compositional_explosion(d, n_layers, seed=42)
        observed = set()
        obs = []
        while len(obs) < obs_budget:
            s = rng.randint(0, state_space - 1)
            if s not in observed:
                observed.add(s)
                obs.append((s, fn(s)))
        test = []
        while len(test) < n_test:
            s = rng.randint(0, state_space - 1)
            if s not in observed:
                test.append(s)

        cls = classify(obs, d)
        verifier = LawVerificationLayer(n_adversarial=2000)
        verification = verifier.verify(cls, obs, d, true_fn=fn)
        if not verification.accepted and cls.selected_class != "unknown":
            cls = ClassificationResult(selected_class="unknown",
                                        selection_reason=f"REJECTED: {verification.rejection_reason[:60]}",
                                        classification_cost=cls.classification_cost + verification.verification_cost)

        _, _, _, acc, _ = evaluate_representation(cls, fn, test, d)
        false_acc = (cls.selected_class != "unknown" and acc < 0.95)

        result = AdversarialResult(
            world_name=f"comp_l{n_layers}", world_type="compositional_explosion",
            d=d, selected_class=cls.selected_class, held_out_accuracy=round(acc, 4),
            false_acceptance=false_acc, false_rejection=False,
            detection_latency=0, verification_cost=verification.verification_cost,
            n_counterexamples=verification.n_counterexamples_found,
            n_adversarial_tested=verification.n_adversarial_tested,
            rejection_reason=verification.rejection_reason[:60] if verification.rejection_reason else "",
            break_even=0, lifetime_value=0)
        results.append(result)

        print(f"  layers={n_layers:>2} → {cls.selected_class:<8} acc={acc:.1%} "
              f"false_acc={false_acc}")

    # ===== 6. ADAPTIVE ADVERSARY =====
    print(f"\n{'='*60}")
    print("6. ADAPTIVE ADVERSARY")
    print(f"{'='*60}")

    for n_adv in [500, 1000, 2000, 5000]:
        fn, meta = gen_adaptive_adversary(d, seed=42)
        observed = set()
        obs = []
        while len(obs) < obs_budget:
            s = rng.randint(0, state_space - 1)
            if s not in observed:
                observed.add(s)
                obs.append((s, fn(s)))
        test = []
        while len(test) < n_test:
            s = rng.randint(0, state_space - 1)
            if s not in observed:
                test.append(s)

        cls = classify(obs, d)
        verifier = LawVerificationLayer(n_adversarial=n_adv)
        verification = verifier.verify(cls, obs, d, true_fn=fn)
        if not verification.accepted and cls.selected_class != "unknown":
            cls = ClassificationResult(selected_class="unknown",
                                        selection_reason=f"REJECTED: {verification.rejection_reason[:60]}",
                                        classification_cost=cls.classification_cost + verification.verification_cost)

        _, _, _, acc, _ = evaluate_representation(cls, fn, test, d)
        false_acc = (cls.selected_class != "unknown" and acc < 0.95)

        result = AdversarialResult(
            world_name=f"adv_n{n_adv}", world_type="adaptive_adversary",
            d=d, selected_class=cls.selected_class, held_out_accuracy=round(acc, 4),
            false_acceptance=false_acc, false_rejection=False,
            detection_latency=0, verification_cost=verification.verification_cost,
            n_counterexamples=verification.n_counterexamples_found,
            n_adversarial_tested=verification.n_adversarial_tested,
            rejection_reason=verification.rejection_reason[:60] if verification.rejection_reason else "",
            break_even=0, lifetime_value=0)
        results.append(result)

        print(f"  n_adv={n_adv:>5} → {cls.selected_class:<8} acc={acc:.1%} "
              f"false_acc={false_acc} counterexamples={verification.n_counterexamples_found}")

    # ===== SUMMARY =====
    print(f"\n{'='*80}")
    print("ADVERSARIAL RELIABILITY SUMMARY")
    print(f"{'='*80}")

    n_total = len(results)
    n_false = sum(1 for r in results if r.false_acceptance)
    n_rejected = sum(1 for r in results if r.selected_class == "unknown" and r.rejection_reason)
    n_correct_esc = sum(1 for r in results if r.selected_class == "unknown" and not r.false_acceptance)

    print(f"\nTotal adversarial worlds: {n_total}")
    print(f"False law acceptance: {n_false} ({n_false/n_total*100:.0f}%)")
    print(f"Correctly rejected/escalated: {n_correct_esc} ({n_correct_esc/n_total*100:.0f}%)")

    print(f"\n{'World':<22} {'Type':<22} {'Class':<8} {'Acc%':<6} {'False':<6} {'CE':<5} {'Reason'}")
    for r in results:
        print(f"{r.world_name:<22} {r.world_type:<22} {r.selected_class:<8} "
              f"{r.held_out_accuracy*100:<6.0f} {'Y' if r.false_acceptance else 'N':<6} "
              f"{r.n_counterexamples:<5} {r.rejection_reason[:40]}")

    # Per-type analysis
    print(f"\n{'='*80}")
    print("PER-TYPE ANALYSIS")
    print(f"{'='*80}")
    types = defaultdict(list)
    for r in results:
        types[r.world_type].append(r)
    for t, tr in sorted(types.items()):
        n = len(tr)
        n_false = sum(1 for r in tr if r.false_acceptance)
        avg_acc = sum(r.held_out_accuracy for r in tr) / n
        avg_ce = sum(r.n_counterexamples for r in tr) / n
        print(f"  {t:<25}: n={n}, false_accept={n_false}, avg_acc={avg_acc:.1%}, "
              f"avg_counterexamples={avg_ce:.1f}")

    return {
        "summary": {
            "n_total": n_total,
            "n_false_acceptance": n_false,
            "false_acceptance_rate": round(n_false / n_total, 4),
            "n_correct_escalation": n_correct_esc,
        },
        "results": [
            {
                "world": r.world_name, "type": r.world_type, "d": r.d,
                "selected_class": r.selected_class,
                "held_out_accuracy": r.held_out_accuracy,
                "false_acceptance": r.false_acceptance,
                "n_counterexamples": r.n_counterexamples,
                "n_adversarial_tested": r.n_adversarial_tested,
                "verification_cost": r.verification_cost,
                "rejection_reason": r.rejection_reason,
            }
            for r in results
        ],
    }


if __name__ == "__main__":
    results = run_adversarial_reliability_benchmark()
    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "..", "download", "rce", "rce2_adversarial_reliability_results.json")
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\nResults saved to: {out_path}")
