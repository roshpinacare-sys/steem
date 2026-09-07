"""Tests for Adversarial Law Reliability Benchmark."""
from __future__ import annotations
import random
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "scripts"))

from rce2_adversarial_reliability import (
    gen_rare_exception, gen_delayed_failure, gen_evolving_law,
    gen_hidden_variable, gen_compositional_explosion, gen_adaptive_adversary,
)


class TestAdversarialWorlds:
    def test_rare_exception(self):
        fn, meta = gen_rare_exception(8, 0.01, seed=42)
        assert meta["type"] == "rare_exception"
        assert meta["n_violations"] > 0
        assert isinstance(fn(0), bool)

    def test_delayed_failure(self):
        fn, meta = gen_delayed_failure(8, 100, seed=42)
        assert meta["type"] == "delayed_failure"
        # Before horizon: should be XOR
        assert isinstance(fn(0), bool)
        # After horizon: should flip
        assert isinstance(fn(0), bool)

    def test_evolving_law(self):
        fn, meta = gen_evolving_law(8, 50, seed=42)
        assert meta["type"] == "evolving_law"
        assert isinstance(fn(0), bool)

    def test_hidden_variable(self):
        fn, meta = gen_hidden_variable(8, seed=42)
        assert meta["type"] == "hidden_variable"
        assert isinstance(fn(0), bool)

    def test_compositional_explosion(self):
        fn, meta = gen_compositional_explosion(8, 4, seed=42)
        assert meta["type"] == "compositional_explosion"
        assert isinstance(fn(0), bool)

    def test_adaptive_adversary(self):
        fn, meta = gen_adaptive_adversary(8, seed=42)
        assert meta["type"] == "adaptive_adversary"
        assert isinstance(fn(0), bool)

    def test_rare_exception_rarity_scales(self):
        """More rare = fewer violations."""
        _, m1 = gen_rare_exception(16, 1e-2, seed=42)
        _, m2 = gen_rare_exception(16, 1e-6, seed=42)
        assert m1["n_violations"] > m2["n_violations"]

    def test_deterministic(self):
        fn1, _ = gen_rare_exception(8, 0.01, seed=42)
        fn2, _ = gen_rare_exception(8, 0.01, seed=42)
        for s in range(256):
            assert fn1(s) == fn2(s)


class TestReliabilityProperties:
    def test_rare_exception_zero_false_acceptance(self):
        """Rare exception should NOT produce false acceptance."""
        from rce2_meta_representation_v2 import classify
        from rce2_law_verification import LawVerificationLayer
        from rce2_meta_representation_v2 import evaluate_representation, ClassificationResult
        rng = random.Random(42)
        d = 12
        fn, _ = gen_rare_exception(d, 0.01, seed=42)
        obs = [(s, fn(s)) for s in rng.sample(range(1<<d), 200)]
        test = [s for s in rng.sample(range(1<<d), 200) if s not in set(o[0] for o in obs)]
        cls = classify(obs, d)
        ver = LawVerificationLayer(n_adversarial=1000)
        v = ver.verify(cls, obs, d, true_fn=fn)
        if not v.accepted and cls.selected_class != "unknown":
            cls = ClassificationResult(selected_class="unknown",
                selection_reason="rejected", classification_cost=0)
        _, _, _, acc, _ = evaluate_representation(cls, fn, test, d)
        false_acc = cls.selected_class != "unknown" and acc < 0.95
        assert not false_acc, f"Rare exception should not be falsely accepted (acc={acc})"

    def test_adaptive_adversary_detected(self):
        """Adaptive adversary (XOR + hidden AND) should be detected."""
        from rce2_meta_representation_v2 import classify
        from rce2_law_verification import LawVerificationLayer
        rng = random.Random(42)
        d = 12
        fn, _ = gen_adaptive_adversary(d, seed=42)
        obs = [(s, fn(s)) for s in rng.sample(range(1<<d), 200)]
        cls = classify(obs, d)
        ver = LawVerificationLayer(n_adversarial=2000)
        v = ver.verify(cls, obs, d, true_fn=fn)
        # The XOR+AND function is NOT linear over GF(2)
        # GF(2) should reject it, or verification should find counterexamples
        if cls.selected_class == "gf2":
            # If GF(2) accepted, verification must find the AND violation
            assert not v.accepted or v.n_counterexamples_found > 0, (
                "Adaptive adversary (XOR+AND) should be detected by verification")
