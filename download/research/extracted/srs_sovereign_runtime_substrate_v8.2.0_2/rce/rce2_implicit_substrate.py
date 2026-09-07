#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rce2_implicit_substrate.py — Implicit Computational Substrate

CHALLENGE: Can a computational substrate emerge from local execution
primitives WITHOUT ever constructing explicit symbolic laws?

DESIGN:
  Instead of discovering a law L and then applying L to new inputs,
  the implicit substrate maintains a LOCAL STATE that is updated by
  each observation. Prediction is done by QUERYING the local state,
  not by executing a symbolic law.

  The implicit substrate uses three primitives:
    1. OBSERVE(x, y): update internal state based on (x, y)
    2. PREDICT(x): query internal state for prediction
    3. VERIFY(x, y): check if prediction matches reality

  No symbolic law is ever constructed. The "law" is IMPLICIT in the
  internal state — it emerges from the accumulation of local updates.

TWO IMPLICIT MODELS:

  A. Locality-Sensitive Hash (LSH) Memory
     - Hash each observation into a k-bit locality-sensitive fingerprint
     - Store (hash → outcome) in a hash table
     - Predict by hashing the query and looking up nearby hashes
     - "Law" = the hash table's structure (implicit, never extracted)
     - No explicit feature selection, no symbolic representation

  B. Reservoir Computing (Echo State Network)
     - Fixed random projection of input into high-dimensional reservoir
     - Linear readout trained on observations
     - "Law" = the readout weights (implicit, not interpretable)
     - No feature selection, no symbolic law, no verification of a "law"

COMPARISON:
  Explicit (current): discover law L → verify L → apply L
  Implicit (LSH):     observe (x,y) → store in hash table → lookup
  Implicit (Reservoir): observe (x,y) → update readout → project + threshold

KEY QUESTION: Is explicit law discovery an optimization or an unnecessary
intermediate artifact?
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


# ===========================================================================
# IMPLICIT SUBSTRATE A: Locality-Sensitive Hash Memory
# ===========================================================================

class LSHMemory:
    """Locality-Sensitive Hash memory.

    No explicit law is constructed. Observations are stored in a hash
    table indexed by a locality-sensitive fingerprint. Prediction looks
    up nearby hashes and returns the majority vote.

    The "law" is IMPLICIT: it exists only as the statistical structure
    of the hash table. No symbolic representation is ever extracted.
    """

    def __init__(self, d: int, n_hash_bits: int = 16,
                 n_tables: int = 5, k_neighbors: int = 7) -> None:
        self.d = d
        self.n_hash_bits = n_hash_bits
        self.n_tables = n_tables
        self.k_neighbors = k_neighbors
        # Generate random hash projections (one per table)
        rng = random.Random(42)
        self.projections = []
        for _ in range(n_tables):
            table_proj = []
            for _ in range(n_hash_bits):
                # Random hyperplane: random d-bit vector
                vec = [rng.gauss(0, 1) for _ in range(d)]
                table_proj.append(vec)
            self.projections.append(table_proj)
        # Hash tables: {hash_value: [(state, outcome), ...]}
        self.tables: List[Dict[int, List[Tuple[int, bool]]]] = [
            defaultdict(list) for _ in range(n_tables)
        ]
        self.n_observations = 0
        self.total_storage = 0  # bytes

    def _hash(self, state: int, table_idx: int) -> int:
        """Compute locality-sensitive hash of state."""
        bits = [(state >> i) & 1 for i in range(self.d)]
        hash_val = 0
        for bit_idx, proj in enumerate(self.projections[table_idx]):
            dot = sum(b * p for b, p in zip(bits, proj))
            if dot > 0:
                hash_val |= (1 << bit_idx)
        return hash_val

    def observe(self, state: int, outcome: bool) -> None:
        """Store an observation in all hash tables."""
        for t in range(self.n_tables):
            h = self._hash(state, t)
            self.tables[t][h].append((state, outcome))
        self.n_observations += 1
        self.total_storage = self.n_observations * 8  # ~8 bytes per obs

    def predict(self, state: int) -> Tuple[Optional[bool], float, int]:
        """Predict outcome by looking up nearby hashes.

        Returns (prediction, confidence, cost).
        If no neighbors found, returns (None, 0, cost).
        """
        cost = 0
        votes_true = 0
        votes_false = 0
        total_weight = 0.0

        for t in range(self.n_tables):
            h = self._hash(state, t)
            cost += self.n_hash_bits * self.d  # hash computation cost

            # Look in exact hash bucket
            if h in self.tables[t]:
                for s, o in self.tables[t][h]:
                    # Weight by Hamming distance (closer = more weight)
                    dist = bin(state ^ s).count('1')
                    weight = 1.0 / (dist + 1)
                    if o:
                        votes_true += weight
                    else:
                        votes_false += weight
                    total_weight += weight
                    cost += 1

            # Also check neighboring hashes (Hamming distance 1)
            for bit in range(self.n_hash_bits):
                neighbor_h = h ^ (1 << bit)
                if neighbor_h in self.tables[t]:
                    for s, o in self.tables[t][neighbor_h]:
                        dist = bin(state ^ s).count('1')
                        if dist <= self.d // 2:  # only use nearby states
                            weight = 1.0 / (dist + 1)
                            if o:
                                votes_true += weight
                            else:
                                votes_false += weight
                            total_weight += weight
                        cost += 1

        if total_weight == 0:
            return None, 0.0, cost

        confidence = max(votes_true, votes_false) / total_weight
        prediction = votes_true > votes_false
        return prediction, confidence, cost

    def get_storage(self) -> int:
        return self.total_storage


# ===========================================================================
# IMPLICIT SUBSTRATE B: Reservoir Computing
# ===========================================================================

class ReservoirComputer:
    """Echo State Network for implicit computation.

    Fixed random reservoir + linear readout. No explicit law is
    constructed — the readout weights ARE the implicit model.
    """

    def __init__(self, d: int, reservoir_size: int = 100,
                 seed: int = 42) -> None:
        self.d = d
        self.reservoir_size = reservoir_size
        rng = random.Random(seed)
        # Fixed random input-to-reservoir weights
        self.W_in = [[rng.gauss(0, 1) for _ in range(d)]
                      for _ in range(reservoir_size)]
        # Readout weights (trained online)
        self.W_out = [0.0] * reservoir_size
        self.bias = 0.0
        self.n_observations = 0
        self.learning_rate = 0.01

    def _reservoir(self, state: int) -> List[float]:
        """Compute reservoir activation (tanh of random projection)."""
        bits = [(state >> i) & 1 for i in range(self.d)]
        activation = []
        for i in range(self.reservoir_size):
            dot = sum(b * w for b, w in zip(bits, self.W_in[i]))
            activation.append(math.tanh(dot))
        return activation

    def observe(self, state: int, outcome: bool) -> None:
        """Update readout weights via online gradient descent."""
        activation = self._reservoir(state)
        target = 1.0 if outcome else -1.0

        # Forward pass
        output = self.bias + sum(w * a for w, a in zip(self.W_out, activation))

        # Online update (gradient descent on squared error)
        error = output - target
        self.bias -= self.learning_rate * error
        for i in range(self.reservoir_size):
            self.W_out[i] -= self.learning_rate * error * activation[i]

        self.n_observations += 1

    def predict(self, state: int) -> Tuple[Optional[bool], float, int]:
        """Predict by projecting through reservoir and readout."""
        activation = self._reservoir(state)
        cost = self.reservoir_size * self.d  # reservoir computation
        output = self.bias + sum(w * a for w, a in zip(self.W_out, activation))
        cost += self.reservoir_size  # readout computation

        prediction = output > 0
        confidence = 1.0 / (1.0 + math.exp(-abs(output)))
        return prediction, confidence, cost

    def get_storage(self) -> int:
        return self.reservoir_size * 8 + 8  # weights + bias


# ===========================================================================
# Benchmark: Implicit vs Explicit
# ===========================================================================

@dataclass
class ComparisonResult:
    world_name: str
    world_type: str
    d: int
    # Explicit (GF(2)/Walsh/DFA + verification)
    explicit_class: str
    explicit_accuracy: float
    explicit_false: bool
    explicit_discovery_cost: int
    explicit_inference_cost: int
    explicit_storage: int
    # Implicit LSH
    lsh_accuracy: float
    lsh_confidence: float
    lsh_observe_cost: int
    lsh_inference_cost: int
    lsh_storage: int
    # Implicit Reservoir
    reservoir_accuracy: float
    reservoir_confidence: float
    reservoir_observe_cost: int
    reservoir_inference_cost: int
    reservoir_storage: int
    # Verdict
    winner: str  # "explicit", "lsh", "reservoir", "tie"


def run_implicit_vs_explicit() -> Dict[str, Any]:
    """Compare implicit substrates against explicit law discovery."""
    print("=" * 80)
    print("IMPLICIT vs EXPLICIT SUBSTRATE BENCHMARK")
    print("=" * 80)

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from rce2_meta_representation_v2 import classify, evaluate_representation
    from rce2_law_verification import LawVerificationLayer

    d = 12
    state_space = 1 << d
    obs_budget = 300
    n_test = 300
    rng = random.Random(42)

    # World generators (reused from hidden world benchmark)
    from rce2_hidden_world_benchmark import (
        gen_polynomial_boolean, gen_cellular_automaton, gen_short_program,
        gen_random_junta, gen_dnf_formula,
    )

    worlds = []
    # Linear (explicit should win)
    fn, m = gen_polynomial_boolean(d, 1, seed=10)
    worlds.append(("poly_linear", fn, m))
    # Nonlinear degree 2
    fn, m = gen_polynomial_boolean(d, 2, seed=10)
    worlds.append(("poly_deg2", fn, m))
    # Nonlinear degree 3
    fn, m = gen_polynomial_boolean(d, 3, seed=10)
    worlds.append(("poly_deg3", fn, m))
    # AND of 3 bits (nonlinear, synthesis found this)
    bits = rng.sample(range(d), 3)
    def f_and(x): return all((x >> b) & 1 for b in bits)
    worlds.append(("and_3bit", f_and, {"type": "nonlinear_and", "d": d}))
    # OR of 3 bits
    bits2 = rng.sample(range(d), 3)
    def f_or(x): return any((x >> b) & 1 for b in bits2)
    worlds.append(("or_3bit", f_or, {"type": "nonlinear_or", "d": d}))
    # CA rule 30 (chaotic)
    fn, m = gen_cellular_automaton(d, 30, seed=42)
    worlds.append(("ca_rule30", fn, m))
    # Short program
    fn, m = gen_short_program(d, seed=100)
    worlds.append(("program", fn, m))
    # Junta k=2 (sparse)
    fn, m = gen_random_junta(d, 2, seed=302)
    worlds.append(("junta_k2", fn, m))
    # Junta k=4 (denser)
    fn, m = gen_random_junta(d, 4, seed=304)
    worlds.append(("junta_k4", fn, m))
    # DNF 5 clauses
    fn, m = gen_dnf_formula(d, 5, seed=405)
    worlds.append(("dnf_5", fn, m))
    # Threshold (hard for all)
    def f_thresh(x): return bin(x).count('1') >= d // 2
    worlds.append(("threshold", f_thresh, {"type": "threshold", "d": d}))

    results = []

    for name, fn, meta in worlds:
        print(f"\n[{name}] type={meta.get('type', 'unknown')}")

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

        # === EXPLICIT SUBSTRATE ===
        t0 = time.time()
        cls = classify(obs, d)
        verifier = LawVerificationLayer(n_adversarial=500)
        v = verifier.verify(cls, obs, d, true_fn=fn)
        if not v.accepted and cls.selected_class != "unknown":
            cls = type('R', (), {'selected_class': 'unknown',
                                  'classification_cost': cls.classification_cost + v.verification_cost})()
        exp_inf, exp_store, _, exp_acc, _ = evaluate_representation(cls, fn, test, d)
        exp_time = time.time() - t0
        exp_false = (cls.selected_class != "unknown" and exp_acc < 0.95)

        # === IMPLICIT LSH ===
        t0 = time.time()
        lsh = LSHMemory(d, n_hash_bits=12, n_tables=5, k_neighbors=7)
        lsh_observe_cost = 0
        for s, o in obs:
            lsh.observe(s, o)
            lsh_observe_cost += d * 12 * 5  # hash computation
        lsh_correct = 0
        lsh_total_cost = 0
        lsh_conf_sum = 0.0
        lsh_n_predicted = 0
        for s in test:
            pred, conf, cost = lsh.predict(s)
            lsh_total_cost += cost
            if pred is not None:
                lsh_n_predicted += 1
                lsh_conf_sum += conf
                if pred == fn(s):
                    lsh_correct += 1
        lsh_acc = lsh_correct / max(lsh_n_predicted, 1)
        lsh_avg_conf = lsh_conf_sum / max(lsh_n_predicted, 1)
        lsh_inf_per_pred = lsh_total_cost / max(len(test), 1)
        lsh_time = time.time() - t0

        # === IMPLICIT RESERVOIR ===
        t0 = time.time()
        reservoir = ReservoirComputer(d, reservoir_size=100)
        res_observe_cost = 0
        for s, o in obs:
            reservoir.observe(s, o)
            res_observe_cost += d * 100 + 100  # forward + backward
        res_correct = 0
        res_total_cost = 0
        res_conf_sum = 0.0
        for s in test:
            pred, conf, cost = reservoir.predict(s)
            res_total_cost += cost
            res_conf_sum += conf
            if pred == fn(s):
                res_correct += 1
        res_acc = res_correct / len(test)
        res_avg_conf = res_conf_sum / len(test)
        res_inf_per_pred = res_total_cost / len(test)
        res_time = time.time() - t0

        # Determine winner
        if exp_false and lsh_acc >= 0.95:
            winner = "lsh"
        elif exp_false and res_acc >= 0.95:
            winner = "reservoir"
        elif not exp_false and exp_acc >= 0.95 and cls.selected_class != "unknown":
            # Explicit compressed correctly — compare cost
            if lsh_acc >= 0.95 and lsh_inf_per_pred < exp_inf / max(len(test), 1):
                winner = "lsh"
            elif res_acc >= 0.95 and res_inf_per_pred < exp_inf / max(len(test), 1):
                winner = "reservoir"
            else:
                winner = "explicit"
        elif cls.selected_class == "unknown":
            if lsh_acc >= 0.95:
                winner = "lsh"
            elif res_acc >= 0.95:
                winner = "reservoir"
            else:
                winner = "tie"  # all escalated
        else:
            winner = "tie"

        result = ComparisonResult(
            world_name=name, world_type=meta.get("type", "unknown"), d=d,
            explicit_class=cls.selected_class,
            explicit_accuracy=round(exp_acc, 4),
            explicit_false=exp_false,
            explicit_discovery_cost=cls.classification_cost,
            explicit_inference_cost=exp_inf,
            explicit_storage=exp_store,
            lsh_accuracy=round(lsh_acc, 4),
            lsh_confidence=round(lsh_avg_conf, 4),
            lsh_observe_cost=lsh_observe_cost,
            lsh_inference_cost=lsh_total_cost,
            lsh_storage=lsh.get_storage(),
            reservoir_accuracy=round(res_acc, 4),
            reservoir_confidence=round(res_avg_conf, 4),
            reservoir_observe_cost=res_observe_cost,
            reservoir_inference_cost=res_total_cost,
            reservoir_storage=reservoir.get_storage(),
            winner=winner,
        )
        results.append(result)

        print(f"  Explicit:   {cls.selected_class:<8} acc={exp_acc:.0%} "
              f"store={exp_store}B inf={exp_inf/max(len(test),1):.1f} "
              f"disc={cls.classification_cost:>8} [{'F' if exp_false else 'ok'}]")
        print(f"  LSH:         acc={lsh_acc:.0%} conf={lsh_avg_conf:.2f} "
              f"store={lsh.get_storage()}B inf={lsh_inf_per_pred:.1f} "
              f"obs={lsh_observe_cost}")
        print(f"  Reservoir:   acc={res_acc:.0%} conf={res_avg_conf:.2f} "
              f"store={reservoir.get_storage()}B inf={res_inf_per_pred:.1f} "
              f"obs={res_observe_cost}")
        print(f"  WINNER: {winner}")

    # === SUMMARY ===
    print(f"\n{'='*80}")
    print("IMPLICIT vs EXPLICIT SUMMARY")
    print(f"{'='*80}")

    print(f"\n{'World':<16} {'Type':<18} {'Explicit':<20} {'LSH':<20} {'Reservoir':<20} {'Winner'}")
    for r in results:
        e_str = f"{r.explicit_class}({r.explicit_accuracy:.0%})"
        l_str = f"{r.lsh_accuracy:.0%}(c={r.lsh_confidence:.1f})"
        r_str = f"{r.reservoir_accuracy:.0%}(c={r.reservoir_confidence:.1f})"
        print(f"{r.world_name:<16} {r.world_type:<18} {e_str:<20} {l_str:<20} {r_str:<20} {r.winner}")

    n_explicit = sum(1 for r in results if r.winner == "explicit")
    n_lsh = sum(1 for r in results if r.winner == "lsh")
    n_reservoir = sum(1 for r in results if r.winner == "reservoir")
    n_tie = sum(1 for r in results if r.winner == "tie")

    print(f"\nWins: explicit={n_explicit}, lsh={n_lsh}, reservoir={n_reservoir}, tie={n_tie}")

    # Cost comparison
    print(f"\n{'='*80}")
    print("COST COMPARISON")
    print(f"{'='*80}")
    print(f"{'World':<16} {'Exp Disc':<10} {'Exp Inf/p':<10} {'LSH Obs':<10} {'LSH Inf/p':<10} {'Res Obs':<10} {'Res Inf/p':<10}")
    for r in results:
        print(f"{r.world_name:<16} {r.explicit_discovery_cost:<10} "
              f"{r.explicit_inference_cost/max(n_test,1):<10.1f} "
              f"{r.lsh_observe_cost:<10} {r.lsh_inference_cost/max(n_test,1):<10.1f} "
              f"{r.reservoir_observe_cost:<10} {r.reservoir_inference_cost/max(n_test,1):<10.1f}")

    return {
        "summary": {
            "n_worlds": len(results),
            "explicit_wins": n_explicit,
            "lsh_wins": n_lsh,
            "reservoir_wins": n_reservoir,
            "ties": n_tie,
        },
        "results": [
            {
                "world": r.world_name, "type": r.world_type, "d": r.d,
                "explicit_class": r.explicit_class,
                "explicit_accuracy": r.explicit_accuracy,
                "explicit_false": r.explicit_false,
                "explicit_discovery_cost": r.explicit_discovery_cost,
                "explicit_inference_cost": r.explicit_inference_cost,
                "explicit_storage": r.explicit_storage,
                "lsh_accuracy": r.lsh_accuracy,
                "lsh_confidence": r.lsh_confidence,
                "lsh_observe_cost": r.lsh_observe_cost,
                "lsh_inference_cost": r.lsh_inference_cost,
                "lsh_storage": r.lsh_storage,
                "reservoir_accuracy": r.reservoir_accuracy,
                "reservoir_confidence": r.reservoir_confidence,
                "reservoir_observe_cost": r.reservoir_observe_cost,
                "reservoir_inference_cost": r.reservoir_inference_cost,
                "reservoir_storage": r.reservoir_storage,
                "winner": r.winner,
            }
            for r in results
        ],
    }


if __name__ == "__main__":
    results = run_implicit_vs_explicit()
    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "..", "download", "rce", "rce2_implicit_vs_explicit_results.json")
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\nResults saved to: {out_path}")
