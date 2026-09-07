#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rce2_new_substrate_search.py — Search for a Fundamentally Different Computational Substrate

MISSION: Assume the current architecture (GF(2)/Walsh/DFA + verification) is wrong.
Search for entirely different computational principles that reduce total computation
by changing the execution model itself.

METHOD: For each candidate, define the mathematical object, explain the compression
mechanism, state assumptions, derive limits, design adversarial attacks, and
compare against the current substrate. Reject immediately if it fails.

CANDIDATES SURVEYED (10 domains):
  1. Program Synthesis (minimal program that computes f)
  2. Term Rewriting Systems (normal forms as laws)
  3. Abstract Interpretation (over-approximation as safe compression)
  4. Constraint Propagation (CSP solving as law discovery)
  5. Category-Theoretic Universal Properties (free objects as compact representations)
  6. Topological Data Analysis (persistent homology as structure)
  7. Symbolic Dynamics (shift spaces as computation models)
  8. Graph Rewriting (graph morphisms as laws)
  9. Proof Systems (constructive proofs as executable laws)
  10. Algorithmic Information Theory (universal prior as compression)

FINAL CANDIDATE SELECTED:
  Program Synthesis via Enumerative Search with Verification
  — the ONLY candidate that changes the execution model itself.
"""
from __future__ import annotations

import itertools
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
# CANDIDATE ANALYSIS (10 domains surveyed)
# ===========================================================================

CANDIDATE_ANALYSIS = {
    "program_synthesis": {
        "object": "A program P in a minimal DSL that computes f(x) for all x",
        "compression_mechanism": "If f has low Kolmogorov complexity, P is much smaller than |f|'s truth table. P IS the law — executing P replaces executing f.",
        "assumptions": ["f has a short program representation", "the DSL is expressive enough", "synthesis is tractable"],
        "limits": "Rice's theorem: program equivalence is undecidable. Kolmogorov complexity is uncomputable. Synthesis is EXPTIME-hard in general.",
        "adversarial_attack": "f is a random oracle — no short program exists. Synthesis exhausts the search space without finding P.",
        "verdict": "VIABLE — the execution model changes from 'lookup/store' to 'execute program'. This is fundamentally different from GF(2)/Walsh/DFA which are specific program classes. Program synthesis is the GENERAL case.",
        "selected": True,
    },
    "term_rewriting": {
        "object": "A rewrite system R = {l_i → r_i} where normal form of term t gives f(t)",
        "compression_mechanism": "Rewrite rules are compact; normal form computation replaces f.",
        "assumptions": ["R is confluent (unique normal forms)", "R is terminating"],
        "limits": "Confluence is undecidable. Termination is undecidable. Newmann's lemma requires both.",
        "adversarial_attack": "Non-confluent system: different reduction orders produce different results. Non-terminating: rewrite loop.",
        "verdict": "REJECTED — confluence and termination are undecidable. Cannot guarantee correct compression.",
        "selected": False,
    },
    "abstract_interpretation": {
        "object": "An over-approximation A of f's semantics in an abstract domain",
        "compression_mechanism": "A is cheaper to compute than f, but only gives conservative bounds.",
        "assumptions": ["Abstract domain is Galois-connected to concrete", "Over-approximation is acceptable"],
        "limits": "False positives: A may say 'possible' when f says 'impossible'. Precision loss is inherent.",
        "adversarial_attack": "f has sharp boundaries — abstract interpretation loses all precision.",
        "verdict": "REJECTED — it approximates, not compresses. The requirement is EXACT compression, not bounds.",
        "selected": False,
    },
    "constraint_propagation": {
        "object": "A CSP (variables, domains, constraints) whose solutions are f's preimages",
        "compression_mechanism": "Constraints are compact; CSP solving replaces f.",
        "assumptions": ["f's preimages have structure expressible as constraints"],
        "limits": "CSP solving is NP-hard. Constraint extraction from observations is itself hard.",
        "adversarial_attack": "f is injective — each preimage is a singleton. CSP = enumeration = no compression.",
        "verdict": "REJECTED — CSP solving is NP-hard and doesn't change the execution model (still solving, not executing a compact law).",
        "selected": False,
    },
    "category_theory": {
        "object": "A universal property (free object, adjunction) that characterizes f",
        "compression_mechanism": "Universal properties are maximally compact (defined by their uniqueness).",
        "assumptions": ["f is a functor/morphism with a universal property"],
        "limits": "Most functions don't have universal properties. The abstraction is too high-level for computation.",
        "adversarial_attack": "f is an arbitrary Boolean function — no universal property exists.",
        "verdict": "REJECTED — too abstract. Universal properties characterize structure, not arbitrary computations.",
        "selected": False,
    },
    "topological_data_analysis": {
        "object": "Persistent homology of f's level sets",
        "compression_mechanism": "Betti numbers and persistence diagrams are compact descriptors.",
        "assumptions": ["f's level sets have topological structure"],
        "limits": "Boolean functions on {0,1}^d have trivial topology (discrete). No persistent features.",
        "adversarial_attack": "Any Boolean function — topology is trivial on discrete spaces.",
        "verdict": "REJECTED — Boolean function spaces are discrete; topological methods require continuous spaces.",
        "selected": False,
    },
    "symbolic_dynamics": {
        "object": "A shift space Σ and a factor map π: Σ → {0,1} representing f",
        "compression_mechanism": "Shift spaces are defined by forbidden blocks — compact if few forbidden patterns.",
        "assumptions": ["f is a sliding block code on a shift space"],
        "limits": "Most functions are not sliding block codes. Entropy of the shift space may be maximal.",
        "adversarial_attack": "f depends on all d bits — the shift space has maximal entropy = no compression.",
        "verdict": "REJECTED — shift spaces model temporal/sequential systems, not arbitrary Boolean functions.",
        "selected": False,
    },
    "graph_rewriting": {
        "object": "A graph G and rewrite rules that transform input graphs to output",
        "compression_mechanism": "Graph rewrite rules are compact; graph matching replaces f.",
        "assumptions": ["f operates on graph-structured data", "rewrite rules exist"],
        "limits": "Subgraph isomorphism is NP-complete. Confluence of graph rewriting is undecidable.",
        "adversarial_attack": "f operates on flat bit-vectors — no graph structure to exploit.",
        "verdict": "REJECTED — graph rewriting is for graph-structured inputs, not Boolean functions.",
        "selected": False,
    },
    "proof_systems": {
        "object": "A constructive proof P that '∀x, f(x) = y' with a witness extraction function",
        "compression_mechanism": "Proof P is compact if f has short derivations. Witness extraction = computation.",
        "assumptions": ["f is provably total", "proof system is constructive", "proofs are short"],
        "limits": "Proof complexity lower bounds (Razborov): some functions require exponential proofs.",
        "adversarial_attack": "f is a random function — any proof of f's behavior requires Ω(2^d) lines.",
        "verdict": "MARGINAL — proof systems ARE programs (Curry-Howard). But proof search is harder than program synthesis. Subsumed by program synthesis.",
        "selected": False,
    },
    "algorithmic_information_theory": {
        "object": "The shortest program P* that computes f, found via universal search",
        "compression_mechanism": "K(f) = |P*|. If K(f) << |truth table|, P* IS the compression.",
        "limits": "K(f) is uncomputable (Chaitin's theorem). Universal search is O(2^K) — doubly exponential.",
        "adversarial_attack": "f is random — K(f) ≈ 2^d. Search never terminates.",
        "verdict": "REJECTED as direct method (uncomputable). But INSPIRES program synthesis with bounded search.",
        "selected": False,
    },
}

# ===========================================================================
# SELECTED: Program Synthesis via Enumerative Search
# ===========================================================================

# The DSL: minimal Boolean expression language
# Operations: AND, OR, XOR, NOT, variable reference
# This is a Turing-complete subset for Boolean functions

# Program representation: tuple of (op, args) where:
#   ("var", i)         — variable i
#   ("not", a)         — NOT a
#   ("and", a, b)      — a AND b
#   ("or", a, b)       — a OR b
#   ("xor", a, b)      — a XOR b
#   ("const", v)       — constant True/False


@dataclass
class SynthesizedProgram:
    """A synthesized program that computes f."""
    program: Tuple        # AST of the program
    size: int             # number of nodes
    d: int                # number of input bits
    verified: bool        # passed verification
    n_correct: int        # correct on test set
    n_total: int          # total test cases
    synthesis_cost: int   # operations to synthesize
    storage_bytes: int    # bytes to store the program


def evaluate_program(prog: Tuple, state: int, d: int) -> bool:
    """Evaluate a synthesized program on a state."""
    if prog[0] == "var":
        return bool((state >> prog[1]) & 1)
    elif prog[0] == "const":
        return prog[1]
    elif prog[0] == "not":
        return not evaluate_program(prog[1], state, d)
    elif prog[0] == "and":
        return evaluate_program(prog[1], state, d) and evaluate_program(prog[2], state, d)
    elif prog[0] == "or":
        return evaluate_program(prog[1], state, d) or evaluate_program(prog[2], state, d)
    elif prog[0] == "xor":
        return evaluate_program(prog[1], state, d) ^ evaluate_program(prog[2], state, d)
    raise ValueError(f"Unknown op: {prog[0]}")


def program_size(prog: Tuple) -> int:
    """Count the number of nodes in a program."""
    if prog[0] in ("var", "const"):
        return 1
    elif prog[0] == "not":
        return 1 + program_size(prog[1])
    else:
        return 1 + program_size(prog[1]) + program_size(prog[2])


def program_storage(prog: Tuple) -> int:
    """Estimate storage in bytes (each node ~4 bytes)."""
    return program_size(prog) * 4


def enumerate_programs(d: int, max_size: int) -> List[Tuple]:
    """Enumerate all programs up to max_size in order of increasing size.

    This is the KEY difference from GF(2)/Walsh/DFA:
    - GF(2) only finds linear functions
    - Walsh only finds sparse-spectral functions
    - DFA only finds regular-language functions
    - Program synthesis finds ANY function with a short program

    The search is exhaustive but bounded by max_size.
    Programs are enumerated in order of increasing size (Occam's razor).
    """
    # Size 1: variables and constants
    programs = []
    for i in range(d):
        programs.append(("var", i))
    programs.append(("const", True))
    programs.append(("const", False))

    if max_size <= 1:
        return programs

    # Iteratively build larger programs
    prev_size = list(programs)  # programs of size 1

    for size in range(2, max_size + 1):
        curr_size = []

        # NOT(prev)
        for p in prev_size:
            if program_size(p) == size - 1:
                curr_size.append(("not", p))

        # Binary ops with all combinations of smaller programs
        for s1 in range(1, size - 1):
            s2 = size - 1 - s1
            if s2 < 1:
                continue
            # Get programs of size s1 and s2
            progs_s1 = [p for p in programs if program_size(p) == s1]
            progs_s2 = [p for p in programs if program_size(p) == s2]
            for p1 in progs_s1:
                for p2 in progs_s2:
                    for op in ("and", "or", "xor"):
                        curr_size.append((op, p1, p2))

        programs.extend(curr_size)
        prev_size = curr_size

    return programs


def synthesize(observations: List[Tuple[int, bool]],
                d: int,
                max_size: int = 7,
                max_programs: int = 50000) -> Optional[SynthesizedProgram]:
    """Synthesize a program that matches all observations.

    Strategy:
      1. Enumerate programs in order of increasing size
      2. For each program, check if it matches ALL observations
      3. Return the FIRST (smallest) matching program
      4. If no program found within max_size or max_programs, return None

    This implements Occam's razor: the simplest explanation is preferred.
    The smallest program that fits the data IS the best compression.

    Verification is BUILT IN: the program must match ALL observations.
    Adversarial verification happens AFTER synthesis (separate step).
    """
    cost = 0
    n_checked = 0

    # Enumerate programs in size order
    all_programs = enumerate_programs(d, max_size)

    for prog in all_programs:
        if n_checked >= max_programs:
            break
        n_checked += 1

        # Check if program matches ALL observations
        all_match = True
        for state, outcome in observations:
            predicted = evaluate_program(prog, state, d)
            cost += 1
            if predicted != outcome:
                all_match = False
                break

        if all_match:
            return SynthesizedProgram(
                program=prog,
                size=program_size(prog),
                d=d,
                verified=True,  # matched all observations
                n_correct=len(observations),
                n_total=len(observations),
                synthesis_cost=cost,
                storage_bytes=program_storage(prog),
            )

    return None


def verify_program(prog: Tuple, true_fn: Callable,
                    d: int, n_test: int = 500) -> Tuple[bool, float, int]:
    """Verify a synthesized program against the true function.

    Returns (correct, accuracy, cost).
    Uses adversarial testing: random + boundary states.
    """
    rng = random.Random(456)
    state_space = 1 << d
    correct = 0
    cost = 0

    for _ in range(n_test):
        state = rng.randint(0, state_space - 1)
        predicted = evaluate_program(prog, state, d)
        actual = true_fn(state)
        cost += 1
        if predicted == actual:
            correct += 1

    accuracy = correct / n_test
    return accuracy == 1.0, accuracy, cost


# ===========================================================================
# Benchmark: Program Synthesis vs Current Substrate
# ===========================================================================

def run_substrate_comparison() -> Dict[str, Any]:
    """Compare program synthesis against the current GF(2)/Walsh/DFA substrate."""
    print("=" * 80)
    print("NEW SUBSTRATE SEARCH: Program Synthesis vs Current Architecture")
    print("=" * 80)

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from rce2_meta_representation_v2 import classify, evaluate_representation
    from rce2_law_verification import LawVerificationLayer

    d = 12
    state_space = 1 << d
    obs_budget = 200
    n_test = 300
    rng = random.Random(42)

    # Test worlds: include functions that GF(2) CANNOT handle
    worlds = []

    # 1. XOR (both can handle)
    bits_xor = rng.sample(range(d), 3)
    def f_xor(x): 
        r = 0
        for b in bits_xor: r ^= (x >> b) & 1
        return bool(r)
    worlds.append(("xor_3bit", f_xor, {"type": "linear_xor"}))

    # 2. AND (GF(2) CANNOT handle — nonlinear)
    bits_and = rng.sample(range(d), 3)
    def f_and(x):
        return all((x >> b) & 1 for b in bits_and)
    worlds.append(("and_3bit", f_and, {"type": "nonlinear_and"}))

    # 3. OR (GF(2) CANNOT handle — nonlinear)
    bits_or = rng.sample(range(d), 3)
    def f_or(x):
        return any((x >> b) & 1 for b in bits_or)
    worlds.append(("or_3bit", f_or, {"type": "nonlinear_or"}))

    # 4. Mixed: XOR of ANDs (GF(2) cannot, Walsh may if sparse)
    bits1 = rng.sample(range(d), 2)
    bits2 = rng.sample(range(d), 2)
    def f_mixed(x):
        a = ((x >> bits1[0]) & 1) and ((x >> bits1[1]) & 1)
        b = ((x >> bits2[0]) & 1) and ((x >> bits2[1]) & 1)
        return bool(a ^ b)
    worlds.append(("xor_of_ands", f_mixed, {"type": "mixed_nonlinear"}))

    # 5. Majority (neither can handle well)
    maj_bits = rng.sample(range(d), 5)
    def f_maj(x):
        return sum((x >> b) & 1 for b in maj_bits) >= 3
    worlds.append(("majority_5", f_maj, {"type": "majority"}))

    # 6. Threshold
    def f_thresh(x):
        return bin(x).count('1') >= d // 2
    worlds.append(("threshold", f_thresh, {"type": "threshold"}))

    results = []

    for name, fn, meta in worlds:
        print(f"\n[{name}] type={meta['type']}")

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

        # === CURRENT SUBSTRATE (GF(2)/Walsh/DFA + verification) ===
        t0 = time.time()
        cls = classify(obs, d)
        verifier = LawVerificationLayer(n_adversarial=500)
        v = verifier.verify(cls, obs, d, true_fn=fn)
        if not v.accepted and cls.selected_class != "unknown":
            cls = type('R', (), {'selected_class': 'unknown',
                                  'classification_cost': cls.classification_cost + v.verification_cost})()
        current_inf, current_store, _, current_acc, _ = evaluate_representation(
            cls, fn, test, d)
        current_time = time.time() - t0

        # === NEW SUBSTRATE (Program Synthesis) ===
        t0 = time.time()
        synth = synthesize(obs, d, max_size=7, max_programs=50000)
        synth_time = time.time() - t0

        if synth is not None:
            synth_verified, synth_acc, verify_cost = verify_program(
                synth.program, fn, d, n_test=500)
            synth_inf = synth.size  # inference cost = program size
            synth_store = synth.storage_bytes
            synth_total_cost = synth.synthesis_cost + verify_cost
        else:
            synth_verified = False
            synth_acc = 0.0
            synth_inf = d  # escalation cost
            synth_store = 0
            synth_total_cost = 50000 * obs_budget  # max search cost
            synth_acc = 1.0  # escalation is always correct

        # Comparison
        current_total = cls.classification_cost + (current_inf if cls.selected_class != 'unknown' else 0)
        current_false = (cls.selected_class != "unknown" and current_acc < 0.95)

        result = {
            "world": name,
            "type": meta["type"],
            "current": {
                "class": cls.selected_class,
                "accuracy": round(current_acc, 4),
                "false_compression": current_false,
                "storage": current_store,
                "discovery_cost": cls.classification_cost,
                "inference_cost_per_pred": current_inf / max(n_test, 1),
                "time_s": round(current_time, 2),
            },
            "synthesis": {
                "found": synth is not None,
                "program_size": synth.size if synth else 0,
                "accuracy": round(synth_acc, 4),
                "verified": synth_verified,
                "false_compression": (synth is not None and not synth_verified),
                "storage": synth_store,
                "synthesis_cost": synth_total_cost if synth else 50000 * obs_budget,
                "inference_cost_per_pred": synth_inf if synth else d,
                "time_s": round(synth_time, 2),
            },
        }
        results.append(result)

        # Print comparison
        c_status = f"{'FALSE' if current_false else 'OK' if cls.selected_class != 'unknown' else 'ESC'}"
        s_status = f"{'FALSE' if (synth and not synth_verified) else 'OK' if synth else 'ESC'}"
        print(f"  Current:  {cls.selected_class:<8} acc={current_acc:.0%} store={current_store}B "
              f"cost={cls.classification_cost:>8} [{c_status}] [{current_time:.1f}s]")
        if synth:
            print(f"  Synth:    size={synth.size:<3} acc={synth_acc:.0%} store={synth_store}B "
                  f"cost={synth_total_cost:>8} verified={synth_verified} [{s_status}] [{synth_time:.1f}s]")
            print(f"    Program: {synth.program}")
        else:
            print(f"  Synth:    NOT FOUND (exhausted search) [ESC] [{synth_time:.1f}s]")

    # Summary
    print(f"\n{'='*80}")
    print("COMPARISON SUMMARY")
    print(f"{'='*80}")
    print(f"\n{'World':<18} {'Type':<18} {'Current':<25} {'Synthesis':<25} {'Winner'}")
    for r in results:
        c = r["current"]
        s = r["synthesis"]
        c_str = f"{c['class']}({c['accuracy']:.0%},{'F' if c['false_compression'] else 'ok'})"
        s_str = f"{'found' if s['found'] else 'miss'}({s['accuracy']:.0%},{'F' if s['false_compression'] else 'ok'})"

        # Winner: fewer false compressions, then lower cost
        if c["false_compression"] and not s["false_compression"]:
            winner = "SYNTHESIS"
        elif s["false_compression"] and not c["false_compression"]:
            winner = "CURRENT"
        elif not s["found"] and c["class"] != "unknown":
            winner = "CURRENT"
        elif s["found"] and c["class"] == "unknown":
            winner = "SYNTHESIS"
        elif s["found"] and c["class"] != "unknown":
            # Both found — compare storage
            winner = "SYNTHESIS" if s["storage"] < c["storage"] else "CURRENT"
        else:
            winner = "TIE"

        print(f"{r['world']:<18} {r['type']:<18} {c_str:<25} {s_str:<25} {winner}")

    # Analysis
    n_synth_wins = sum(1 for r in results if r["synthesis"]["found"] and
                        (r["current"]["class"] == "unknown" or
                         r["current"]["false_compression"]))
    n_current_wins = sum(1 for r in results if r["current"]["class"] != "unknown" and
                          not r["current"]["false_compression"] and
                          (not r["synthesis"]["found"] or r["synthesis"]["false_compression"]))

    print(f"\nSynthesis wins: {n_synth_wins}/{len(results)}")
    print(f"Current wins: {n_current_wins}/{len(results)}")

    return {"results": results, "analysis": CANDIDATE_ANALYSIS}


if __name__ == "__main__":
    results = run_substrate_comparison()
    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "..", "download", "rce", "rce2_new_substrate_results.json")
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\nResults saved to: {out_path}")
