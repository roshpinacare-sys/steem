#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rce2_hidden_world_benchmark.py — Hidden World Generalization Benchmark

The classifier does NOT know the true class of any world.
It discovers a representation, then we test generalization on held-out states.

ADVERSARIAL GOAL: Find cases where the substrate believes it discovered a
compact law but the law does not generalize. False positive compression
is more dangerous than failure.

WORLD DISTRIBUTIONS:
  1. Polynomial Boolean functions (degree 2, 3, 4)
  2. Cellular automata (Rule 30, Rule 90, Rule 110, Rule 184)
  3. Graph transition systems (random graph dynamics)
  4. Short program-generated dynamics (Turing machine fragments)
  5. Chaotic discrete systems (logistic map discretized)
  6. Random structured systems (juntas, DNF formulas)

METRICS:
  - representation discovery accuracy
  - false compression rate (claimed compression but <95% generalization)
  - UNKNOWN rate
  - confidence calibration
  - compute spent vs compute saved
  - lifetime break-even point
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


# ===========================================================================
# HIDDEN WORLD GENERATORS
# ===========================================================================

def gen_polynomial_boolean(d: int, degree: int, seed: int = 42
                            ) -> Tuple[Callable, Dict]:
    """Polynomial Boolean function: XOR of random degree-k monomials.

    Degree 1 = linear (GF(2) recoverable)
    Degree 2 = quadratic (Walsh may work if sparse)
    Degree 3+ = higher order (harder for all families)
    """
    rng = random.Random(seed)
    n_terms = rng.randint(3, 10)
    terms = []
    for _ in range(n_terms):
        bits = rng.sample(range(d), min(degree, d))
        mask = sum(1 << b for b in bits)
        terms.append(mask)

    def f(state: int) -> bool:
        result = 0
        for mask in terms:
            result ^= bin(state & mask).count('1') % 2
        return bool(result)

    return f, {"source": "polynomial_boolean", "degree": degree,
               "n_terms": n_terms, "d": d,
               "kc_estimate": n_terms * degree}


def gen_cellular_automaton(d: int, rule: int, seed: int = 42
                            ) -> Tuple[Callable, Dict]:
    """Elementary cellular automaton: treat the d-bit state as a CA row,
    apply the rule once, and return the center cell.

    Rule 30: chaotic (used in Mathematica's RNG)
    Rule 90: linear (XOR of neighbors) — GF(2) recoverable
    Rule 110: Turing-complete
    Rule 184: traffic flow model
    """
    def f(state: int) -> bool:
        # Pick 3 consecutive bits from the middle
        mid = d // 2
        left = (state >> ((mid - 1) % d)) & 1
        center = (state >> mid) & 1
        right = (state >> ((mid + 1) % d)) & 1
        neighborhood = (left << 2) | (center << 1) | right
        return bool((rule >> neighborhood) & 1)

    return f, {"source": "cellular_automaton", "rule": rule,
               "d": d, "kc_estimate": 8}  # rule is 8 bits


def gen_graph_transition(d: int, n_nodes: int, seed: int = 42
                          ) -> Tuple[Callable, Dict]:
    """Graph transition system: interpret state as node index,
    follow a random edge, return whether the destination is in a
    target set.
    """
    rng = random.Random(seed)
    # Build random graph: each node has 2 outgoing edges (bit 0 and bit 1)
    edges = []
    for _ in range(n_nodes):
        edges.append((rng.randint(0, n_nodes - 1), rng.randint(0, n_nodes - 1)))
    target_set = set(rng.sample(range(n_nodes), max(1, n_nodes // 4)))

    def f(state: int) -> bool:
        node = state % n_nodes
        bit = (state >> (d - 1)) & 1  # use MSB to choose edge
        dest = edges[node][bit]
        return dest in target_set

    return f, {"source": "graph_transition", "n_nodes": n_nodes,
               "d": d, "kc_estimate": n_nodes * 2}


def gen_short_program(d: int, seed: int = 42
                       ) -> Tuple[Callable, Dict]:
    """Short program-generated dynamics: a random sequence of bit operations
    (AND, OR, XOR, NOT, SHIFT) applied to the state.
    """
    rng = random.Random(seed)
    ops = []
    for _ in range(rng.randint(3, 8)):
        op_type = rng.choice(["and", "or", "xor", "not", "shift"])
        bit1 = rng.randint(0, d - 1)
        bit2 = rng.randint(0, d - 1)
        ops.append((op_type, bit1, bit2))

    def f(state: int) -> bool:
        s = state
        for op, b1, b2 in ops:
            if op == "and":
                v = ((s >> b1) & 1) & ((s >> b2) & 1)
                s = (s & ~(1 << b1)) | (v << b1)
            elif op == "or":
                v = ((s >> b1) & 1) | ((s >> b2) & 1)
                s = (s & ~(1 << b1)) | (v << b1)
            elif op == "xor":
                v = ((s >> b1) & 1) ^ ((s >> b2) & 1)
                s = (s & ~(1 << b1)) | (v << b1)
            elif op == "not":
                s ^= (1 << b1)
            elif op == "shift":
                s = ((s << 1) | (s >> (d - 1))) & ((1 << d) - 1)
        return bool(s & 1)  # return bit 0

    return f, {"source": "short_program", "n_ops": len(ops),
               "d": d, "kc_estimate": len(ops) * math.log2(d)}


def gen_chaotic_discrete(d: int, seed: int = 42
                          ) -> Tuple[Callable, Dict]:
    """Chaotic discrete system: discretized logistic map.

    x_{n+1} = r * x_n * (1 - x_n), discretized to d bits.
    Return whether the trajectory reaches a fixed point (bit 0 = 1).
    """
    rng = random.Random(seed)
    r = 3.7 + rng.random() * 0.3  # chaotic regime [3.7, 4.0]

    def f(state: int) -> bool:
        x = state / max(1, (1 << d) - 1)  # normalize to [0, 1]
        for _ in range(10):  # iterate 10 steps
            x = r * x * (1 - x)
            x = x % 1.0  # keep in [0, 1)
        return x > 0.5

    return f, {"source": "chaotic_discrete", "r": round(r, 3),
               "d": d, "kc_estimate": 100}  # moderate complexity


def gen_random_junta(d: int, k: int, seed: int = 42
                      ) -> Tuple[Callable, Dict]:
    """Random k-junta: function depends on k of d bits via a random
    lookup table. If k is small, Walsh may detect it. If k is large,
    it's incompressible.
    """
    rng = random.Random(seed)
    relevant = rng.sample(range(d), k)
    table = [rng.random() > 0.5 for _ in range(1 << k)]

    def f(state: int) -> bool:
        idx = 0
        for i, b in enumerate(relevant):
            if (state >> b) & 1:
                idx |= (1 << i)
        return table[idx]

    return f, {"source": "random_junta", "k": k,
               "d": d, "kc_estimate": (1 << k)}


def gen_dnf_formula(d: int, n_clauses: int, seed: int = 42
                     ) -> Tuple[Callable, Dict]:
    """DNF formula: OR of n_clauses AND-terms. Each clause is an AND
    of 2-3 literals (possibly negated).
    """
    rng = random.Random(seed)
    clauses = []
    for _ in range(n_clauses):
        n_lits = rng.randint(2, 3)
        lits = []
        for _ in range(n_lits):
            bit = rng.randint(0, d - 1)
            neg = rng.random() > 0.5
            lits.append((bit, neg))
        clauses.append(lits)

    def f(state: int) -> bool:
        for clause in clauses:
            satisfied = True
            for bit, neg in clause:
                val = (state >> bit) & 1
                if neg:
                    val = 1 - val
                if not val:
                    satisfied = False
                    break
            if satisfied:
                return True
        return False

    return f, {"source": "dnf_formula", "n_clauses": n_clauses,
               "d": d, "kc_estimate": n_clauses * 3 * math.log2(d)}


# ===========================================================================
# Hidden World Benchmark Runner
# ===========================================================================

@dataclass
class HiddenWorldResult:
    world_name: str
    source: str           # true source distribution (NOT revealed to classifier)
    selected_class: str   # classifier's choice: gf2, walsh, dfa, unknown
    classification_cost: int
    inference_cost: int
    storage_bytes: int
    observations_used: int
    # Generalization test
    train_accuracy: float       # accuracy on training observations
    held_out_accuracy: float    # accuracy on held-out test states
    generalization_gap: float   # train_acc - held_out_acc
    # Verdict
    false_compression: bool     # claimed compression but held_out < 95%
    correct_escalation: bool     # UNKNOWN and truly incompressible
    correct_compression: bool    # compressed and held_out >= 95%
    # Compute
    break_even: int
    d: int
    kc_estimate: float
    details: Dict[str, Any] = field(default_factory=dict)


def run_hidden_world_benchmark() -> Dict[str, Any]:
    """Run the hidden world generalization benchmark."""
    print("=" * 80)
    print("HIDDEN WORLD GENERALIZATION BENCHMARK")
    print("=" * 80)

    d = 12
    state_space = 1 << d
    obs_budget = 300
    n_test = 300  # larger test set for reliable generalization measurement
    rng = random.Random(42)

    # Generate worlds from 6 distributions + varying parameters
    worlds = []

    # 1. Polynomial Boolean functions
    for deg in [1, 2, 3, 4]:
        for seed in [10, 20, 30]:
            fn, meta = gen_polynomial_boolean(d, deg, seed)
            worlds.append((f"poly_d{deg}_s{seed}", fn, meta))

    # 2. Cellular automata
    for rule in [30, 90, 110, 184]:
        fn, meta = gen_cellular_automaton(d, rule, seed=42)
        worlds.append((f"ca_rule{rule}", fn, meta))

    # 3. Graph transition systems
    for n_nodes in [8, 16, 32, 64]:
        fn, meta = gen_graph_transition(d, n_nodes, seed=42)
        worlds.append((f"graph_n{n_nodes}", fn, meta))

    # 4. Short program dynamics
    for seed in [100, 101, 102, 103, 104]:
        fn, meta = gen_short_program(d, seed)
        worlds.append((f"program_s{seed}", fn, meta))

    # 5. Chaotic discrete systems
    for seed in [200, 201, 202]:
        fn, meta = gen_chaotic_discrete(d, seed)
        worlds.append((f"chaotic_s{seed}", fn, meta))

    # 6. Random structured systems
    for k in [2, 3, 4, 6, 8]:
        fn, meta = gen_random_junta(d, k, seed=300 + k)
        worlds.append((f"junta_k{k}", fn, meta))

    for n_clauses in [3, 5, 10, 15]:
        fn, meta = gen_dnf_formula(d, n_clauses, seed=400 + n_clauses)
        worlds.append((f"dnf_c{n_clauses}", fn, meta))

    print(f"\nConfiguration: d={d}, state_space={state_space}, "
          f"obs_budget={obs_budget}, n_test={n_test}")
    print(f"Total worlds: {len(worlds)}")

    results: List[HiddenWorldResult] = []

    for name, fn, meta in worlds:
        t0 = time.time()

        # Generate observations (classifier sees ONLY these — no labels)
        observed_states = set()
        observations = []
        while len(observations) < obs_budget:
            state = rng.randint(0, state_space - 1)
            if state not in observed_states:
                observed_states.add(state)
                observations.append((state, fn(state)))

        # Generate held-out test states
        test_states = []
        while len(test_states) < n_test:
            state = rng.randint(0, state_space - 1)
            if state not in observed_states:
                test_states.append(state)

        # === CLASSIFIER OPERATES BLIND — no knowledge of true class ===
        cls_result = classify(observations, d)

        # Evaluate on held-out test states
        inf_cost, storage, n_correct, held_out_acc, coverage = \
            evaluate_representation(cls_result, fn, test_states, d)

        # Compute training accuracy (how well does it fit observations?)
        train_inf, _, train_correct, train_acc, _ = \
            evaluate_representation(cls_result, fn,
                                     [s for s, _ in observations[:100]], d)

        generalization_gap = train_acc - held_out_acc

        # Determine verdict
        false_compression = (cls_result.selected_class != "unknown"
                              and held_out_acc < 0.95)
        correct_escalation = (cls_result.selected_class == "unknown"
                               and held_out_acc >= 0.99)  # UNKNOWN always correct (escalation)
        correct_compression = (cls_result.selected_class != "unknown"
                                and held_out_acc >= 0.95)

        # Break-even
        C = d
        saving = C - (inf_cost / max(n_test, 1))
        if saving > 0:
            break_even = math.ceil(cls_result.classification_cost / saving)
        else:
            break_even = -1

        elapsed = time.time() - t0

        result = HiddenWorldResult(
            world_name=name,
            source=meta["source"],
            selected_class=cls_result.selected_class,
            classification_cost=cls_result.classification_cost,
            inference_cost=inf_cost,
            storage_bytes=storage,
            observations_used=len(observations),
            train_accuracy=round(train_acc, 4),
            held_out_accuracy=round(held_out_acc, 4),
            generalization_gap=round(generalization_gap, 4),
            false_compression=false_compression,
            correct_escalation=correct_escalation,
            correct_compression=correct_compression,
            break_even=break_even,
            d=d,
            kc_estimate=meta.get("kc_estimate", 0),
            details={
                "selection_reason": cls_result.selection_reason[:80],
                "gf2_fits": cls_result.gf2_result.fits if cls_result.gf2_result else False,
                "walsh_fits": cls_result.walsh_result.fits if cls_result.walsh_result else False,
                "dfa_fits": cls_result.dfa_result.fits if cls_result.dfa_result else False,
            })
        results.append(result)

        # Print result
        if false_compression:
            verdict = "FALSE COMPRESSION"
        elif correct_compression:
            verdict = "OK (compressed)"
        elif correct_escalation:
            verdict = "OK (escalated)"
        else:
            verdict = "MARGINAL"

        print(f"\n  [{name}] source={meta['source']}")
        print(f"    → {cls_result.selected_class} | {verdict}")
        print(f"    train_acc={train_acc:.1%} held_out_acc={held_out_acc:.1%} "
              f"gap={generalization_gap:.1%}")
        print(f"    storage={storage}B cost={cls_result.classification_cost} "
              f"be={break_even} [{elapsed:.1f}s]")

    # === SUMMARY ===
    print(f"\n{'='*80}")
    print("HIDDEN WORLD BENCHMARK SUMMARY")
    print(f"{'='*80}")

    n_total = len(results)
    n_compressed = sum(1 for r in results if r.correct_compression)
    n_escalated = sum(1 for r in results if r.correct_escalation)
    n_false = sum(1 for r in results if r.false_compression)
    n_marginal = n_total - n_compressed - n_escalated - n_false

    print(f"\nTotal worlds: {n_total}")
    print(f"Correct compression (held_out ≥ 95%): {n_compressed} ({n_compressed/n_total*100:.0f}%)")
    print(f"Correct escalation (UNKNOWN):         {n_escalated} ({n_escalated/n_total*100:.0f}%)")
    print(f"FALSE COMPRESSION (held_out < 95%):   {n_false} ({n_false/n_total*100:.0f}%)")
    print(f"Marginal:                             {n_marginal} ({n_marginal/n_total*100:.0f}%)")

    # Per-source breakdown
    print(f"\n{'World':<25} {'Source':<22} {'Class':<10} {'Train%':<8} {'Hold%':<8} {'Gap%':<8} {'Verdict'}")
    for r in results:
        if r.false_compression:
            v = "FALSE"
        elif r.correct_compression:
            v = "OK"
        elif r.correct_escalation:
            v = "ESC"
        else:
            v = "MARG"
        print(f"{r.world_name:<25} {r.source:<22} {r.selected_class:<10} "
              f"{r.train_accuracy*100:<8.0f} {r.held_out_accuracy*100:<8.0f} "
              f"{r.generalization_gap*100:<8.0f} {v}")

    # Per-source aggregate
    print(f"\nPer-source aggregate:")
    sources = defaultdict(list)
    for r in results:
        sources[r.source].append(r)
    for source, src_results in sorted(sources.items()):
        n = len(src_results)
        n_comp = sum(1 for r in src_results if r.correct_compression)
        n_esc = sum(1 for r in src_results if r.correct_escalation)
        n_false = sum(1 for r in src_results if r.false_compression)
        avg_hold = sum(r.held_out_accuracy for r in src_results) / n
        print(f"  {source:<22}: n={n}, compressed={n_comp}, escalated={n_esc}, "
              f"false={n_false}, avg_held_out={avg_hold:.1%}")

    # False compression details
    if n_false > 0:
        print(f"\n{'='*80}")
        print("FALSE COMPRESSION ANALYSIS (most dangerous failure mode)")
        print(f"{'='*80}")
        for r in results:
            if r.false_compression:
                print(f"\n  {r.world_name} (source={r.source})")
                print(f"    Selected: {r.selected_class}")
                print(f"    Train accuracy: {r.train_accuracy:.1%}")
                print(f"    Held-out accuracy: {r.held_out_accuracy:.1%}")
                print(f"    Generalization gap: {r.generalization_gap:.1%}")
                print(f"    Storage: {r.storage_bytes} bytes")
                print(f"    Reason: {r.details.get('selection_reason', '')}")

    # Compute accounting
    total_spent = sum(r.classification_cost + r.inference_cost for r in results)
    total_saved_if_deployed = sum(
        d * n_test - r.inference_cost
        for r in results if r.correct_compression
    )
    print(f"\nCompute accounting:")
    print(f"  Total classification + inference cost: {total_spent:,} ops")
    print(f"  Total saved (correct compressions only): {total_saved_if_deployed:,} ops")
    if total_saved_if_deployed > 0:
        print(f"  Net: {total_saved_if_deployed - total_spent:+,} ops")
    else:
        print(f"  Net: -{total_spent:,} ops (no compression achieved)")

    # Confidence calibration
    print(f"\nConfidence calibration:")
    for cls in ["gf2", "walsh", "dfa", "unknown"]:
        cls_results = [r for r in results if r.selected_class == cls]
        if cls_results:
            avg_hold = sum(r.held_out_accuracy for r in cls_results) / len(cls_results)
            n_false_cls = sum(1 for r in cls_results if r.false_compression)
            print(f"  {cls}: n={len(cls_results)}, avg_held_out={avg_hold:.1%}, "
                  f"false_positives={n_false_cls}")

    # Prepare JSON output
    return {
        "summary": {
            "n_total": n_total,
            "n_correct_compression": n_compressed,
            "n_correct_escalation": n_escalated,
            "n_false_compression": n_false,
            "n_marginal": n_marginal,
            "false_compression_rate": round(n_false / n_total, 4),
            "unknown_rate": round(n_escalated / n_total, 4),
        },
        "results": [
            {
                "world": r.world_name,
                "source": r.source,
                "selected_class": r.selected_class,
                "train_accuracy": r.train_accuracy,
                "held_out_accuracy": r.held_out_accuracy,
                "generalization_gap": r.generalization_gap,
                "false_compression": r.false_compression,
                "correct_compression": r.correct_compression,
                "correct_escalation": r.correct_escalation,
                "storage_bytes": r.storage_bytes,
                "classification_cost": r.classification_cost,
                "inference_cost": r.inference_cost,
                "break_even": r.break_even,
                "kc_estimate": r.kc_estimate,
                "details": r.details,
            }
            for r in results
        ],
    }


if __name__ == "__main__":
    results = run_hidden_world_benchmark()
    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "..", "download", "rce", "rce2_hidden_world_results.json")
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\nResults saved to: {out_path}")
