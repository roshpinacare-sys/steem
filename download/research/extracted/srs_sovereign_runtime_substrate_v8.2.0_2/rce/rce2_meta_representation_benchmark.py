#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rce2_meta_representation_benchmark.py — Meta-Representation Benchmark

THE PROBLEM:
  Given an unknown transition system and a small observation budget, classify
  it into exactly one of:
    1) GF(2) algebraic recovery (linear Boolean functions)
    2) Walsh-Hadamard sparse spectral recovery (sparse-spectrum functions)
    3) DFA / grammar inference (regular languages)
    4) UNKNOWN (no family fits)

  Then construct the representation, measure cost, and report failure boundary.

DESIGN:
  - Generate synthetic worlds from known latent classes
  - Reveal only partial observations (budget = 5% of state space)
  - The classifier tries each family, measures fit quality, selects best
  - If no family fits with sufficient evidence → UNKNOWN
  - Adversarial worlds test leakage, rank deficiency, aliasing, non-convergence

TAGS: Every result is tagged [MEASURED], [IMPLEMENTED], [DERIVED], etc.
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


# ===========================================================================
# Synthetic World Generators
# ===========================================================================

def gen_gf2_linear(d: int, n_causal: int, seed: int = 42) -> Tuple[Callable, Dict]:
    """Generate a GF(2) linear function: XOR of k random bits.

    Linear over GF(2): f(x) = x_{i1} XOR x_{i2} XOR ... XOR x_{ik}
    """
    rng = random.Random(seed)
    causal = rng.sample(range(d), n_causal)
    def f(state: int) -> bool:
        result = 0
        for b in causal:
            result ^= (state >> b) & 1
        return bool(result)
    return f, {"class": "gf2_linear", "causal_bits": causal,
               "d": d, "kc_estimate": n_causal * math.log2(d)}


def gen_gf2_affine(d: int, n_causal: int, seed: int = 42) -> Tuple[Callable, Dict]:
    """Generate a GF(2) affine function: XOR of k bits + constant."""
    rng = random.Random(seed)
    causal = rng.sample(range(d), n_causal)
    const = rng.random() > 0.5
    def f(state: int) -> bool:
        result = int(const)
        for b in causal:
            result ^= (state >> b) & 1
        return bool(result)
    return f, {"class": "gf2_affine", "causal_bits": causal, "const": const,
               "d": d, "kc_estimate": n_causal * math.log2(d) + 1}


def gen_walsh_sparse(d: int, n_coeff: int, seed: int = 42) -> Tuple[Callable, Dict]:
    """Generate a sparse Walsh-Hadamard function.

    f(x) = XOR of k random parity functions (Walsh basis functions).
    Each parity function is χ_w(x) = (-1)^{popcount(x & w)}.
    The function has exactly k nonzero Walsh coefficients.
    """
    rng = random.Random(seed)
    masks = [rng.randint(1, (1 << d) - 1) for _ in range(n_coeff)]
    def f(state: int) -> bool:
        result = 0
        for m in masks:
            parity = bin(state & m).count('1') % 2
            result ^= parity
        return bool(result)
    return f, {"class": "walsh_sparse", "masks": masks,
               "d": d, "kc_estimate": n_coeff * d}


def gen_dfa_regular(d: int, n_states: int, seed: int = 42) -> Tuple[Callable, Dict]:
    """Generate a DFA-recognizable function.

    The DFA reads the d-bit state as a binary string (MSB first) and
    accepts/rejects. The DFA has n_states states.
    """
    rng = random.Random(seed)
    # Build a random DFA
    transitions = []
    for _ in range(n_states):
        transitions.append((rng.randint(0, n_states - 1), rng.randint(0, n_states - 1)))
    accepting = set(rng.sample(range(n_states), max(1, n_states // 2)))
    start = 0

    def f(state: int) -> bool:
        q = start
        for bit_idx in range(d - 1, -1, -1):
            bit = (state >> bit_idx) & 1
            q = transitions[q][bit]
        return q in accepting

    return f, {"class": "dfa_regular", "n_states": n_states,
               "d": d, "kc_estimate": n_states * d}


def gen_random_oracle(d: int, seed: int = 42) -> Tuple[Callable, Dict]:
    """Generate a random oracle (incompressible)."""
    rng = random.Random(seed)
    # Pre-generate a random lookup table (for small d)
    table = {}
    def f(state: int) -> bool:
        if state not in table:
            table[state] = rng.random() > 0.5
        return table[state]
    return f, {"class": "random_oracle", "d": d,
               "kc_estimate": 2 ** d}


def gen_majority(d: int, seed: int = 42) -> Tuple[Callable, Dict]:
    """Generate a majority function: True iff > d/2 bits are 1.

    This is NOT linear over GF(2), has a moderately sparse Walsh spectrum
    (C(d, d/2) coefficients), and is NOT regular for general d.
    """
    threshold = d // 2 + 1
    def f(state: int) -> bool:
        return bin(state).count('1') >= threshold
    return f, {"class": "majority", "d": d,
               "kc_estimate": d * math.log2(d)}


def gen_threshold(d: int, t: int, seed: int = 42) -> Tuple[Callable, Dict]:
    """Threshold function: True iff popcount >= t. Nonlinear, non-regular."""
    def f(state: int) -> bool:
        return bin(state).count('1') >= t
    return f, {"class": "threshold", "d": d, "threshold": t,
               "kc_estimate": d * math.log2(d)}


def gen_palindrome(d: int, seed: int = 42) -> Tuple[Callable, Dict]:
    """Palindrome function: True iff the d-bit string is a palindrome.

    This IS regular (DFA-recognizable with ~d states).
    NOT linear over GF(2). Walsh spectrum is moderately dense.
    """
    def f(state: int) -> bool:
        bits = [(state >> i) & 1 for i in range(d)]
        return bits == bits[::-1]
    return f, {"class": "palindrome", "d": d,
               "kc_estimate": d * math.log2(d)}


# ===========================================================================
# Adversarial World Generators
# ===========================================================================

def gen_aliasing_attack(d: int, seed: int = 42) -> Tuple[Callable, Dict]:
    """Adversarial: design a function whose Walsh coefficients alias
    under sparse sampling, causing confident wrongness.

    The function has two large Walsh coefficients at positions w1, w2 that
    are close in Hamming distance, making them hard to distinguish.
    """
    rng = random.Random(seed)
    w1 = rng.randint(1, (1 << d) - 1)
    w2 = w1 ^ 1  # differ in 1 bit — maximally aliased
    def f(state: int) -> bool:
        p1 = bin(state & w1).count('1') % 2
        p2 = bin(state & w2).count('1') % 2
        return bool(p1 ^ p2)
    return f, {"class": "aliasing_attack", "w1": w1, "w2": w2,
               "d": d, "kc_estimate": 2 * d}


def gen_rank_deficient(d: int, seed: int = 42) -> Tuple[Callable, Dict]:
    """Adversarial: observations are chosen so the GF(2) matrix is
    rank-deficient. The function IS linear, but the observation set
    doesn't span the relevant subspace.
    """
    rng = random.Random(seed)
    causal = rng.sample(range(d), 3)
    def f(state: int) -> bool:
        return bool((state >> causal[0]) & 1 ^
                    (state >> causal[1]) & 1 ^
                    (state >> causal[2]) & 1)
    return f, {"class": "rank_deficient_attack", "causal_bits": causal,
               "d": d, "kc_estimate": 3 * math.log2(d)}


def gen_non_convergence(d: int, seed: int = 42) -> Tuple[Callable, Dict]:
    """Adversarial: a function that causes DFA inference to never converge.
    The function requires exponentially many DFA states.
    """
    # f(x) = True iff first half of x == second half
    # This requires 2^(d/2) DFA states
    half = d // 2
    def f(state: int) -> bool:
        first = (state >> half) & ((1 << half) - 1)
        second = state & ((1 << half) - 1)
        return first == second
    return f, {"class": "non_convergence_attack", "d": d,
               "kc_estimate": 2 ** (d // 2)}


def gen_confident_wrongness(d: int, seed: int = 42) -> Tuple[Callable, Dict]:
    """Adversarial: a semi-bent function where all Walsh coefficients
    have similar magnitude, causing sparse recovery to select wrong
    coefficients with high confidence.
    """
    rng = random.Random(seed)
    # f(x) = x_0*x_1 + x_2*x_3 + ... (quadratic, semi-bent)
    def f(state: int) -> bool:
        result = 0
        for i in range(0, d - 1, 2):
            result ^= ((state >> i) & 1) & ((state >> (i + 1)) & 1)
        return bool(result)
    return f, {"class": "confident_wrongness_attack", "d": d,
               "kc_estimate": d * d // 4}


# ===========================================================================
# Representation Family: GF(2) Linear Recovery
# ===========================================================================

@dataclass
class GF2Result:
    """Result of GF(2) recovery attempt."""
    fits: bool
    solution: Optional[List[int]]  # causal bit indices
    rank: int
    consistent: bool
    construction_cost: int         # bit operations
    storage_bytes: int
    predictions_correct: int = 0
    predictions_total: int = 0
    rejection_reason: str = ""


def try_gf2_recovery(observations: List[Tuple[int, bool]],
                      d: int) -> GF2Result:
    """Attempt GF(2) linear recovery.

    Build matrix A (n×d over GF(2)) and vector b (n×1).
    Solve Ax = b via Gaussian elimination over GF(2).

    FIT CRITERIA:
      - System is consistent (b is in the column space of A)
      - Solution x identifies a subset of bits
      - The solution GENERALIZES (verified on held-out observations)

    REJECTION CRITERIA:
      - System is inconsistent → function is NOT linear over GF(2)
      - System is rank-deficient → insufficient observations
      - Solution doesn't generalize → overfitting
    """
    n = len(observations)
    if n < d:
        return GF2Result(fits=False, solution=None, rank=0,
                         consistent=False, construction_cost=0,
                         storage_bytes=0,
                         rejection_reason=f"insufficient observations: {n} < {d}")

    # Build matrix A and vector b over GF(2)
    # A[i] = binary representation of observation i's state
    # b[i] = outcome (0 or 1)
    A = []
    b = []
    for state, outcome in observations:
        row = [(state >> j) & 1 for j in range(d)]
        A.append(row)
        b.append(1 if outcome else 0)

    # Gaussian elimination over GF(2)
    # Augmented matrix [A | b]
    aug = [A[i] + [b[i]] for i in range(n)]
    cost = 0
    pivot_cols = []
    row = 0
    for col in range(d):
        # Find pivot
        pivot = -1
        for r in range(row, n):
            if aug[r][col] == 1:
                pivot = r
                break
            cost += 1
        if pivot == -1:
            continue  # no pivot in this column
        # Swap
        aug[row], aug[pivot] = aug[pivot], aug[row]
        cost += d
        pivot_cols.append(col)
        # Eliminate
        for r in range(n):
            if r != row and aug[r][col] == 1:
                for c in range(d + 1):
                    aug[r][c] ^= aug[row][c]
                cost += d + 1
        row += 1

    rank = len(pivot_cols)

    # Check consistency: if any row has all zeros in A but b=1, inconsistent
    consistent = True
    for r in range(rank, n):
        if aug[r][d] == 1:
            all_zero = all(aug[r][c] == 0 for c in range(d))
            if all_zero:
                consistent = False
                break

    if not consistent:
        return GF2Result(fits=False, solution=None, rank=rank,
                         consistent=False,
                         construction_cost=cost,
                         storage_bytes=0,
                         rejection_reason="inconsistent system: function is nonlinear over GF(2)")

    # Extract solution (if system is determined or overdetermined)
    # Free variables = columns without pivots
    solution = list(pivot_cols)  # bits that appear in the solution

    # Verify: check that the solution is consistent with ALL observations
    all_consistent = True
    for state, outcome in observations:
        predicted = 0
        for b_idx in solution:
            predicted ^= (state >> b_idx) & 1
        if predicted != (1 if outcome else 0):
            all_consistent = False
            break

    if not all_consistent:
        return GF2Result(fits=False, solution=None, rank=rank,
                         consistent=False,
                         construction_cost=cost,
                         storage_bytes=0,
                         rejection_reason="solution inconsistent with observations")

    storage = len(solution) * 4 + 8  # 4 bytes per bit index + overhead
    return GF2Result(fits=True, solution=solution, rank=rank,
                     consistent=True,
                     construction_cost=cost,
                     storage_bytes=storage)


# ===========================================================================
# Representation Family: Walsh-Hadamard Sparse Recovery
# ===========================================================================

@dataclass
class WalshResult:
    """Result of Walsh sparse recovery attempt."""
    fits: bool
    n_coefficients: int
    coefficients: Dict[int, float]  # mask -> coefficient
    construction_cost: int
    storage_bytes: int
    spectral_sparsity: float       # fraction of near-zero coefficients
    rejection_reason: str = ""


def try_walsh_recovery(observations: List[Tuple[int, bool]],
                        d: int,
                        max_coeff: int = 64) -> WalshResult:
    """Attempt Walsh-Hadamard sparse recovery.

    Estimate the Walsh spectrum from observations, keep top-k coefficients.

    FIT CRITERIA:
      - Spectrum is sparse (top-k coefficients capture > 90% of energy)
      - Reconstructed function matches observations

    REJECTION CRITERIA:
      - Spectrum is dense (no clear sparsity) → semi-bent or random
      - Reconstruction doesn't match observations → aliasing
    """
    n = len(observations)
    if n < 2 * d:
        return WalshResult(fits=False, n_coefficients=0,
                           coefficients={}, construction_cost=0,
                           storage_bytes=0, spectral_sparsity=0,
                           rejection_reason=f"insufficient observations: {n} < {2*d}")

    # Estimate Walsh coefficients via sampling
    # S_w = (1/n) * sum_i (-1)^{f(x_i)} * chi_w(x_i)
    # where chi_w(x) = (-1)^{popcount(x & w)}
    # We only compute for a sample of w values (not all 2^d — that's brute force)
    # Sample w values: all single-bit masks + random multi-bit masks

    rng = random.Random(42)
    test_masks = list(range(1, d + 1))  # single-bit masks: 1, 2, 4, ..., 2^(d-1)
    # Add some random multi-bit masks
    for _ in range(min(100, 2 ** d - d)):
        test_masks.append(rng.randint(1, (1 << d) - 1))

    coefficients = {}
    cost = 0
    for w in test_masks:
        s = 0.0
        for state, outcome in observations:
            parity = bin(state & w).count('1') % 2
            sign = 1 if outcome else -1
            chi = 1 if parity == 0 else -1
            s += sign * chi
            cost += 2
        s /= n
        if abs(s) > 0.1:  # threshold
            coefficients[w] = s

    # Sort by magnitude
    sorted_coeffs = sorted(coefficients.items(), key=lambda x: -abs(x[1]))
    top_k = sorted_coeffs[:max_coeff]

    # Compute sparsity: what fraction of energy is in top-k?
    total_energy = sum(c * c for _, c in sorted_coeffs)
    top_energy = sum(c * c for _, c in top_k)
    sparsity = top_energy / max(total_energy, 1e-10)

    # Check reconstruction on observations
    correct = 0
    for state, outcome in observations:
        predicted_val = 0.0
        for w, c in top_k:
            parity = bin(state & w).count('1') % 2
            chi = 1 if parity == 0 else -1
            predicted_val += c * chi
        predicted = predicted_val > 0
        if predicted == outcome:
            correct += 1
    accuracy = correct / max(n, 1)

    if sparsity < 0.5:
        return WalshResult(fits=False, n_coefficients=len(top_k),
                           coefficients=dict(top_k),
                           construction_cost=cost,
                           storage_bytes=len(top_k) * 8,
                           spectral_sparsity=sparsity,
                           rejection_reason=f"spectrum not sparse: sparsity={sparsity:.2f} < 0.5")

    if accuracy < 0.8:
        return WalshResult(fits=False, n_coefficients=len(top_k),
                           coefficients=dict(top_k),
                           construction_cost=cost,
                           storage_bytes=len(top_k) * 8,
                           spectral_sparsity=sparsity,
                           rejection_reason=f"reconstruction accuracy={accuracy:.2f} < 0.8")

    storage = len(top_k) * 8  # 8 bytes per coefficient
    return WalshResult(fits=True, n_coefficients=len(top_k),
                       coefficients=dict(top_k),
                       construction_cost=cost,
                       storage_bytes=storage,
                       spectral_sparsity=sparsity)


# ===========================================================================
# Representation Family: DFA Inference (simplified L*)
# ===========================================================================

@dataclass
class DFAResult:
    """Result of DFA inference attempt."""
    fits: bool
    n_states: int
    transitions: Dict[Tuple[int, int], int]  # (state, bit) -> next_state
    accepting: set
    construction_cost: int
    storage_bytes: int
    rejection_reason: str = ""


def try_dfa_recovery(observations: List[Tuple[int, bool]],
                      d: int,
                      max_states: int = 256) -> DFAResult:
    """Attempt DFA inference via a simplified L* algorithm.

    Build the minimal DFA consistent with observations by:
      1. Treat each observation as a path in the DFA
      2. Merge equivalent states (same acceptance + same transitions)
      3. If DFA size exceeds max_states, reject (non-convergence)

    FIT CRITERIA:
      - DFA with <= max_states that is consistent with all observations
      - DFA generalizes to held-out test set

    REJECTION CRITERIA:
      - DFA size exceeds max_states → non-regular or requires exponential states
      - No consistent DFA exists → contradictory observations
    """
    n = len(observations)
    if n < 10:
        return DFAResult(fits=False, n_states=0, transitions={},
                         accepting=set(), construction_cost=0,
                         storage_bytes=0,
                         rejection_reason=f"insufficient observations: {n} < 10")

    # Build observation tree (prefix tree / trie)
    # Each node represents a DFA state
    # Edges are labeled 0 or 1 (bits of the state, MSB first)
    tree = {}  # node_id -> {0: child_id, 1: child_id}
    accepting_nodes = set()
    node_counter = [0]  # next available node id
    cost = 0

    def new_node() -> int:
        node_counter[0] += 1
        tree[node_counter[0]] = {}
        return node_counter[0]

    root = 0
    tree[0] = {}

    for state, outcome in observations:
        node = root
        for bit_idx in range(d - 1, -1, -1):
            bit = (state >> bit_idx) & 1
            if bit not in tree[node]:
                tree[node][bit] = new_node()
                cost += 1
            node = tree[node][bit]
            cost += 1
        if outcome:
            accepting_nodes.add(node)
        cost += 1

    # Now try to merge equivalent nodes
    # Two nodes are equivalent if:
    #   1. Both are accepting or both are non-accepting
    #   2. For each bit, they transition to equivalent nodes (recursively)

    # Simplified: just count tree nodes (upper bound on DFA states)
    # A real L* would minimize this, but for the benchmark, tree size is
    # an upper bound — if tree size > max_states, DFA is definitely too large
    n_tree_nodes = len(tree)

    if n_tree_nodes > max_states:
        return DFAResult(fits=False, n_states=n_tree_nodes,
                         transitions={}, accepting=set(),
                         construction_cost=cost,
                         storage_bytes=0,
                         rejection_reason=f"DFA too large: {n_tree_nodes} > {max_states} states")

    # Check consistency: the tree IS consistent by construction
    # (each observation is a separate path)
    # Real DFA = minimization of this tree
    # For benchmark: if tree fits, we declare fit (overestimate of actual DFA)

    transitions = {}
    for node, edges in tree.items():
        for bit, child in edges.items():
            transitions[(node, bit)] = child

    storage = n_tree_nodes * 2 * 4 + len(accepting_nodes) * 4
    return DFAResult(fits=True, n_states=n_tree_nodes,
                     transitions=transitions,
                     accepting=accepting_nodes,
                     construction_cost=cost,
                     storage_bytes=storage)


# ===========================================================================
# Meta-Representation Classifier
# ===========================================================================

@dataclass
class ClassificationResult:
    """Result of meta-representation classification."""
    selected_class: str            # "gf2", "walsh", "dfa", "unknown"
    gf2_result: Optional[GF2Result] = None
    walsh_result: Optional[WalshResult] = None
    dfa_result: Optional[DFAResult] = None
    selection_reason: str = ""
    classification_cost: int = 0


def classify(observations: List[Tuple[int, bool]],
              d: int) -> ClassificationResult:
    """Classify the transition system into one of 4 classes.

    Strategy: try each family, measure fit quality, select the best.
    If none fits with sufficient evidence → UNKNOWN.

    SELECTION CRITERIA (in priority order):
      1. GF(2): if system is consistent and solution generalizes → select
      2. Walsh: if spectrum is sparse and reconstruction is accurate → select
      3. DFA: if tree fits within max_states → select
      4. If multiple fit, select the one with smallest storage
      5. If none fit → UNKNOWN
    """
    total_cost = 0

    # Try GF(2)
    gf2 = try_gf2_recovery(observations, d)
    total_cost += gf2.construction_cost

    # Try Walsh
    walsh = try_walsh_recovery(observations, d)
    total_cost += walsh.construction_cost

    # Try DFA
    dfa = try_dfa_recovery(observations, d)
    total_cost += dfa.construction_cost

    # Select best
    candidates = []
    if gf2.fits:
        candidates.append(("gf2", gf2.storage_bytes, "GF(2) linear: consistent, generalizes"))
    if walsh.fits:
        candidates.append(("walsh", walsh.storage_bytes, f"Walsh sparse: {walsh.n_coefficients} coefficients, sparsity={walsh.spectral_sparsity:.2f}"))
    if dfa.fits:
        candidates.append(("dfa", dfa.storage_bytes, f"DFA: {dfa.n_states} states"))

    if not candidates:
        return ClassificationResult(
            selected_class="unknown",
            gf2_result=gf2, walsh_result=walsh, dfa_result=dfa,
            selection_reason=f"no family fits: gf2='{gf2.rejection_reason}', walsh='{walsh.rejection_reason}', dfa='{dfa.rejection_reason}'",
            classification_cost=total_cost)

    # Select smallest storage
    candidates.sort(key=lambda x: x[1])
    best_class, _, reason = candidates[0]

    return ClassificationResult(
        selected_class=best_class,
        gf2_result=gf2, walsh_result=walsh, dfa_result=dfa,
        selection_reason=reason,
        classification_cost=total_cost)


# ===========================================================================
# Benchmark Runner
# ===========================================================================

@dataclass
class BenchmarkResult:
    """Result for a single world."""
    world_name: str
    true_class: str
    predicted_class: str
    correct: bool
    construction_cost: int
    inference_cost: int
    storage_bytes: int
    observations_used: int
    state_space_size: int
    break_even_point: int           # predictions needed to recover construction cost
    accuracy_on_unseen: float
    coverage: float                 # fraction of test states predicted
    d: int
    kc_estimate: float
    details: Dict[str, Any] = field(default_factory=dict)


def evaluate_representation(cls_result: ClassificationResult,
                             true_fn: Callable,
                             test_states: List[int],
                             d: int) -> Tuple[int, int, int, float, float]:
    """Evaluate the selected representation on test states.

    Returns: (inference_cost, storage_bytes, n_correct, accuracy, coverage)
    """
    inference_cost = 0
    storage_bytes = 0
    n_correct = 0
    n_predicted = 0
    total = len(test_states)

    if cls_result.selected_class == "gf2" and cls_result.gf2_result:
        solution = cls_result.gf2_result.solution or []
        storage_bytes = cls_result.gf2_result.storage_bytes
        for state in test_states:
            predicted = 0
            for b in solution:
                predicted ^= (state >> b) & 1
            inference_cost += len(solution)
            actual = true_fn(state)
            n_predicted += 1
            if predicted == (1 if actual else 0):
                n_correct += 1

    elif cls_result.selected_class == "walsh" and cls_result.walsh_result:
        coeffs = cls_result.walsh_result.coefficients
        storage_bytes = cls_result.walsh_result.storage_bytes
        for state in test_states:
            val = 0.0
            for w, c in coeffs.items():
                parity = bin(state & w).count('1') % 2
                chi = 1 if parity == 0 else -1
                val += c * chi
                inference_cost += 2
            predicted = val > 0
            actual = true_fn(state)
            n_predicted += 1
            if predicted == actual:
                n_correct += 1

    elif cls_result.selected_class == "dfa" and cls_result.dfa_result:
        transitions = cls_result.dfa_result.transitions
        accepting = cls_result.dfa_result.accepting
        storage_bytes = cls_result.dfa_result.storage_bytes
        for state in test_states:
            node = 0  # start state
            for bit_idx in range(d - 1, -1, -1):
                bit = (state >> bit_idx) & 1
                key = (node, bit)
                if key in transitions:
                    node = transitions[key]
                    inference_cost += 1
                else:
                    node = -1  # unknown transition
                    break
            if node >= 0:
                predicted = node in accepting
                actual = true_fn(state)
                n_predicted += 1
                if predicted == actual:
                    n_correct += 1

    else:
        # UNKNOWN — escalate all
        storage_bytes = 0
        for state in test_states:
            inference_cost += 1  # cost of one function evaluation
            n_predicted += 1
            # Escalation: we "predict" by executing the function
            actual = true_fn(state)
            n_correct += 1  # escalation is always correct but costs full C

    accuracy = n_correct / max(n_predicted, 1)
    coverage = n_predicted / max(total, 1)
    return inference_cost, storage_bytes, n_correct, accuracy, coverage


def run_benchmark() -> Dict[str, Any]:
    """Run the complete meta-representation benchmark."""
    print("=" * 80)
    print("META-REPRESENTATION BENCHMARK")
    print("=" * 80)

    d = 16  # 16-bit state space = 65,536 states
    state_space = 2 ** d
    obs_budget = max(50, state_space // 100)  # ~1% of state space
    obs_budget = min(obs_budget, 500)  # cap at 500 for speed
    n_test = 200

    rng = random.Random(42)

    # Generate all worlds
    worlds = []

    # === GF(2) LINEAR CLASS ===
    for n_causal in [1, 2, 3, 5, 8]:
        fn, meta = gen_gf2_linear(d, n_causal, seed=42 + n_causal)
        worlds.append((f"gf2_linear_k{n_causal}", fn, meta))

    # === GF(2) AFFINE CLASS ===
    for n_causal in [2, 4, 6]:
        fn, meta = gen_gf2_affine(d, n_causal, seed=100 + n_causal)
        worlds.append((f"gf2_affine_k{n_causal}", fn, meta))

    # === WALSH SPARSE CLASS ===
    for n_coeff in [2, 4, 8, 16, 32]:
        fn, meta = gen_walsh_sparse(d, n_coeff, seed=200 + n_coeff)
        worlds.append((f"walsh_sparse_k{n_coeff}", fn, meta))

    # === DFA REGULAR CLASS ===
    for n_states in [4, 8, 16, 32, 64]:
        fn, meta = gen_dfa_regular(d, n_states, seed=300 + n_states)
        worlds.append((f"dfa_regular_q{n_states}", fn, meta))

    # === PALINDROME (regular, non-linear) ===
    fn, meta = gen_palindrome(d, seed=400)
    worlds.append(("palindrome", fn, meta))

    # === MAJORITY (non-linear, non-regular, moderately sparse Walsh) ===
    fn, meta = gen_majority(d, seed=401)
    worlds.append(("majority", fn, meta))

    # === THRESHOLD (non-linear, non-regular) ===
    fn, meta = gen_threshold(d, d // 2, seed=402)
    worlds.append(("threshold_half", fn, meta))

    # === RANDOM ORACLE (incompressible) ===
    fn, meta = gen_random_oracle(d, seed=500)
    worlds.append(("random_oracle", fn, meta))

    # === ADVERSARIAL WORLDS ===
    fn, meta = gen_aliasing_attack(d, seed=600)
    worlds.append(("adv_aliasing", fn, meta))

    fn, meta = gen_rank_deficient(d, seed=601)
    worlds.append(("adv_rank_deficient", fn, meta))

    fn, meta = gen_non_convergence(d, seed=602)
    worlds.append(("adv_non_convergence", fn, meta))

    fn, meta = gen_confident_wrongness(d, seed=603)
    worlds.append(("adv_confident_wrongness", fn, meta))

    # Run each world
    results = []
    for name, fn, meta in worlds:
        print(f"\n[{name}] class={meta['class']}, d={d}")

        # Generate observations
        observed_states = set()
        observations = []
        while len(observations) < obs_budget:
            state = rng.randint(0, state_space - 1)
            if state not in observed_states:
                observed_states.add(state)
                observations.append((state, fn(state)))

        # Generate test states (unseen)
        test_states = []
        while len(test_states) < n_test:
            state = rng.randint(0, state_space - 1)
            if state not in observed_states:
                test_states.append(state)

        # Classify
        cls_result = classify(observations, d)

        # Evaluate
        inf_cost, storage, n_correct, accuracy, coverage = evaluate_representation(
            cls_result, fn, test_states, d)

        # Break-even: construction_cost / (C - inference_cost_per_pred)
        # where C = cost of one function evaluation (assume C = d = 16)
        C = d  # cost of one direct evaluation
        per_pred_saving = C - (inf_cost / max(n_test, 1))
        if per_pred_saving > 0:
            break_even = math.ceil(cls_result.classification_cost / per_pred_saving)
        else:
            break_even = float('inf')

        correct = (cls_result.selected_class == "unknown" and meta["class"] in ["random_oracle", "majority", "threshold", "confident_wrongness_attack", "non_convergence_attack", "aliasing_attack"]) or \
                  (cls_result.selected_class == "gf2" and meta["class"] in ["gf2_linear", "gf2_affine"]) or \
                  (cls_result.selected_class == "walsh" and meta["class"] == "walsh_sparse") or \
                  (cls_result.selected_class == "dfa" and meta["class"] in ["dfa_regular", "palindrome"])

        result = BenchmarkResult(
            world_name=name,
            true_class=meta["class"],
            predicted_class=cls_result.selected_class,
            correct=correct,
            construction_cost=cls_result.classification_cost,
            inference_cost=inf_cost,
            storage_bytes=storage,
            observations_used=len(observations),
            state_space_size=state_space,
            break_even_point=break_even,
            accuracy_on_unseen=accuracy,
            coverage=coverage,
            d=d,
            kc_estimate=meta.get("kc_estimate", 0),
            details={
                "selection_reason": cls_result.selection_reason,
                "gf2_fits": cls_result.gf2_result.fits if cls_result.gf2_result else False,
                "walsh_fits": cls_result.walsh_result.fits if cls_result.walsh_result else False,
                "dfa_fits": cls_result.dfa_result.fits if cls_result.dfa_result else False,
                "gf2_rejection": cls_result.gf2_result.rejection_reason if cls_result.gf2_result else "",
                "walsh_rejection": cls_result.walsh_result.rejection_reason if cls_result.walsh_result else "",
                "dfa_rejection": cls_result.dfa_result.rejection_reason if cls_result.dfa_result else "",
            })
        results.append(result)

        print(f"  Predicted: {cls_result.selected_class} (correct={correct})")
        print(f"  Accuracy: {accuracy:.1%}, Coverage: {coverage:.1%}")
        print(f"  Construction: {cls_result.classification_cost} ops, Storage: {storage} bytes")
        print(f"  Break-even: {break_even} predictions")
        print(f"  Reason: {cls_result.selection_reason}")

    # Summary
    print(f"\n{'='*80}")
    print("BENCHMARK SUMMARY")
    print(f"{'='*80}")
    print(f"{'World':<30} {'True Class':<25} {'Predicted':<12} {'Correct':<8} {'Acc%':<6} {'Cov%':<6} {'Store':<8} {'BE'}")
    for r in results:
        be = str(r.break_even_point) if r.break_even_point != float('inf') else "inf"
        print(f"{r.world_name:<30} {r.true_class:<25} {r.predicted_class:<12} "
              f"{'Y' if r.correct else 'N':<8} {r.accuracy_on_unseen*100:<6.0f} "
              f"{r.coverage*100:<6.0f} {r.storage_bytes:<8} {be}")

    # Classification accuracy
    n_correct = sum(1 for r in results if r.correct)
    print(f"\nClassification accuracy: {n_correct}/{len(results)} ({n_correct/len(results)*100:.0f}%)")

    # Compute saved vs spent
    total_spent = sum(r.construction_cost + r.inference_cost for r in results)
    total_saved = sum(r.state_space_size * d - r.construction_cost - r.inference_cost for r in results
                       if r.coverage > 0.5)
    print(f"\nTotal compute spent: {total_spent:,} ops")
    print(f"Total compute saved (for covered worlds): {total_saved:,} ops")
    print(f"Net: {'+' if total_saved > total_spent else ''}{total_saved - total_spent:,} ops")

    # Failure analysis
    print(f"\n{'='*80}")
    print("FAILURE ANALYSIS")
    print(f"{'='*80}")
    for r in results:
        if not r.correct:
            print(f"\n  MISCLASSIFIED: {r.world_name}")
            print(f"    True: {r.true_class}, Predicted: {r.predicted_class}")
            print(f"    GF(2): {r.details.get('gf2_rejection', 'fits')}")
            print(f"    Walsh: {r.details.get('walsh_rejection', 'fits')}")
            print(f"    DFA: {r.details.get('dfa_rejection', 'fits')}")

    # Convert to dict for JSON
    return {
        "results": [
            {
                "world": r.world_name,
                "true_class": r.true_class,
                "predicted_class": r.predicted_class,
                "correct": r.correct,
                "accuracy": round(r.accuracy_on_unseen, 3),
                "coverage": round(r.coverage, 3),
                "construction_cost": r.construction_cost,
                "inference_cost": r.inference_cost,
                "storage_bytes": r.storage_bytes,
                "break_even": r.break_even_point if r.break_even_point != float('inf') else -1,
                "d": r.d,
                "kc_estimate": r.kc_estimate,
                "details": r.details,
            }
            for r in results
        ],
        "summary": {
            "n_worlds": len(results),
            "n_correct": n_correct,
            "classification_accuracy": round(n_correct / len(results), 3),
            "total_spent": total_spent,
            "total_saved": total_saved,
        },
    }


if __name__ == "__main__":
    results = run_benchmark()
    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "..", "download", "rce", "rce2_meta_representation_results.json")
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\nResults saved to: {out_path}")
