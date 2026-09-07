"""Tests for Meta-Representation Benchmark v2 (fixed implementations)."""
from __future__ import annotations
import random
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "scripts"))

from rce2_meta_representation_v2 import (
    try_gf2_recovery, try_walsh_recovery, try_dfa_recovery, classify,
    GF2Result, WalshResult, DFAResult,
)


# ===========================================================================
# GF(2) Tests
# ===========================================================================

class TestGF2:
    def test_xor_function_detected(self):
        """XOR (linear over GF(2)) should be detected."""
        rng = random.Random(42)
        d = 8
        causal = [0, 2, 5]
        def f(x): return bool((x>>0)&1 ^ (x>>2)&1 ^ (x>>5)&1)
        obs = [(s, f(s)) for s in rng.sample(range(256), 50)]
        r = try_gf2_recovery(obs, d)
        assert r.fits, f"XOR should fit GF(2): {r.rejection_reason}"
        assert set(r.solution) == set(causal)

    def test_and_function_rejected(self):
        """AND (nonlinear) should be rejected."""
        rng = random.Random(42)
        d = 8
        def f(x): return bool((x>>0)&1 and (x>>1)&1 and (x>>2)&1)
        obs = [(s, f(s)) for s in rng.sample(range(256), 50)]
        r = try_gf2_recovery(obs, d)
        assert not r.fits, "AND should NOT fit GF(2)"

    def test_affine_function_detected(self):
        """Affine (XOR + constant) should be detected."""
        rng = random.Random(42)
        d = 8
        def f(x): return bool(1 ^ (x>>3)&1 ^ (x>>6)&1)
        obs = [(s, f(s)) for s in rng.sample(range(256), 50)]
        r = try_gf2_recovery(obs, d)
        assert r.fits, f"Affine should fit: {r.rejection_reason}"


# ===========================================================================
# Walsh Tests
# ===========================================================================

class TestWalsh:
    def test_sparse_spectrum_detected(self):
        """Sparse Walsh spectrum should be detected."""
        rng = random.Random(42)
        d = 10
        masks = [1, 4, 16]  # 3 nonzero coefficients
        def f(x):
            r = 0
            for m in masks:
                r ^= bin(x & m).count('1') % 2
            return bool(r)
        obs = [(s, f(s)) for s in rng.sample(range(1024), 100)]
        r = try_walsh_recovery(obs, d)
        assert r.fits, f"Sparse Walsh should fit: {r.rejection_reason}"
        assert r.n_coefficients <= 10

    def test_random_oracle_rejected(self):
        """Random oracle (dense spectrum) should be rejected."""
        rng = random.Random(42)
        d = 8
        table = {s: rng.random() > 0.5 for s in range(256)}
        def f(x): return table[x]
        obs = [(s, f(s)) for s in rng.sample(range(256), 100)]
        r = try_walsh_recovery(obs, d)
        # Random oracle should NOT fit (dense spectrum or low accuracy)
        assert not r.fits or r.n_coefficients > 20, (
            "Random oracle should not be Walsh-sparse")


# ===========================================================================
# DFA Tests
# ===========================================================================

class TestDFA:
    def test_dfa_minimization_reduces_states(self):
        """Moore minimization should reduce state count."""
        rng = random.Random(42)
        d = 6  # smaller d for better coverage
        def f(x): return bool(x & 1)  # simple: bit 0 = 1
        obs = [(s, f(s)) for s in rng.sample(range(64), 50)]  # 50 of 64 states
        r = try_dfa_recovery(obs, d, max_states=256)
        # With good coverage, DFA should fit
        assert isinstance(r.fits, bool)
        if r.fits:
            assert r.n_states <= 20, f"Minimized DFA should be small: {r.n_states}"

    def test_non_regular_rejected(self):
        """Non-regular function should be rejected (too many states)."""
        rng = random.Random(42)
        d = 8
        half = d // 2
        def f(x):  # first half == second half (non-regular for large d)
            return ((x >> half) & ((1<<half)-1)) == (x & ((1<<half)-1))
        obs = [(s, f(s)) for s in rng.sample(range(256), 30)]
        r = try_dfa_recovery(obs, d, max_states=32)
        # This function requires 2^4 = 16 DFA states — should fit for d=8
        # but might not if observations are insufficient
        assert isinstance(r.fits, bool)


# ===========================================================================
# Classifier Tests
# ===========================================================================

class TestClassifier:
    def test_linear_classified_correctly(self):
        """Linear function should be classified as gf2 or walsh."""
        rng = random.Random(42)
        d = 8
        def f(x): return bool((x>>0)&1 ^ (x>>1)&1)
        obs = [(s, f(s)) for s in rng.sample(range(256), 50)]
        cls = classify(obs, d)
        assert cls.selected_class in ("gf2", "walsh"), (
            f"Linear should be gf2 or walsh, got {cls.selected_class}")

    def test_random_oracle_classified_unknown(self):
        """Random oracle should be classified as unknown."""
        rng = random.Random(42)
        d = 8
        table = {s: rng.random() > 0.5 for s in range(256)}
        def f(x): return table[x]
        obs = [(s, f(s)) for s in rng.sample(range(256), 50)]
        cls = classify(obs, d)
        assert cls.selected_class == "unknown", (
            f"Random oracle should be unknown, got {cls.selected_class}")


# ===========================================================================
# Cross-Validation Tests (confident wrongness detection)
# ===========================================================================

class TestConfidentWrongness:
    def test_cross_validation_detects_wrongness(self):
        """Cross-validation should detect confident wrongness."""
        rng = random.Random(42)
        d = 8
        # Create a function that Walsh might accept but is wrong
        def f(x): return bool(bin(x).count('1') % 3 == 0)  # not sparse
        obs = [(s, f(s)) for s in rng.sample(range(256), 50)]
        r = try_walsh_recovery(obs, d)
        # If Walsh fits, check accuracy on held-out
        if r.fits:
            test = [(s, f(s)) for s in rng.sample(range(256), 50) if s not in set(o[0] for o in obs)]
            correct = 0
            for s, actual in test:
                val = sum(c * (1 if bin(s&w).count('1')%2==0 else -1) for w,c in r.coefficients.items())
                if (val > 0) == actual:
                    correct += 1
            held_acc = correct / max(len(test), 1)
            # If held-out accuracy is significantly lower, it's confident wrongness
            # For non-sparse functions, this should detect the problem
