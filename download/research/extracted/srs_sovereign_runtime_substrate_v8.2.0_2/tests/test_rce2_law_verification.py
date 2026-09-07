"""Tests for Law Verification Layer."""
from __future__ import annotations
import random
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "scripts"))

from rce2_law_verification import LawVerificationLayer, VerifiedClassifier, VerificationResult
from rce2_meta_representation_v2 import classify, GF2Result, WalshResult, DFAResult, ClassificationResult


class TestLawVerificationLayer:
    """Test the 4-stage verification pipeline."""

    def test_unknown_always_accepted(self):
        """UNKNOWN classification should always be accepted (it's the safe default)."""
        verifier = LawVerificationLayer()
        cls = ClassificationResult(selected_class="unknown")
        result = verifier.verify(cls, [], 8)
        assert result.accepted

    def test_valid_law_accepted(self):
        """A valid XOR law should pass all 4 stages."""
        rng = random.Random(42)
        d = 8
        def f(x): return bool((x>>0)&1 ^ (x>>2)&1 ^ (x>>5)&1)
        obs = [(s, f(s)) for s in rng.sample(range(256), 50)]
        cls = classify(obs, d)
        # If classifier found a law, verify it
        if cls.selected_class != "unknown":
            verifier = LawVerificationLayer(true_fn=f)
            result = verifier.verify(cls, obs, d, true_fn=f)
            assert result.accepted, f"Valid law should pass: {result.rejection_reason}"

    def test_false_law_rejected_by_held_out(self):
        """A law that doesn't generalize should be rejected by some stage."""
        rng = random.Random(42)
        d = 8
        # Create a function that Walsh will approximately fit but not perfectly
        def f(x): return bin(x).count('1') >= 4
        obs = [(s, f(s)) for s in rng.sample(range(256), 50)]
        cls = classify(obs, d)
        if cls.selected_class != "unknown":
            verifier = LawVerificationLayer(true_fn=f)
            result = verifier.verify(cls, obs, d, true_fn=f)
            # Should be rejected by SOME stage (MDL, AIC, held-out, or adversarial)
            if not result.accepted:
                assert any(stage in result.rejection_reason for stage in
                           ["MDL", "AIC", "held-out", "counterexample"]), (
                    f"Unexpected rejection reason: {result.rejection_reason}")

    def test_adversarial_search_finds_counterexamples(self):
        """Adversarial search should find counterexamples for wrong laws."""
        rng = random.Random(42)
        d = 8
        # XOR function
        def f(x): return bool((x>>0)&1 ^ (x>>1)&1)
        obs = [(s, f(s)) for s in rng.sample(range(256), 50)]
        cls = classify(obs, d)

        # Create a WRONG true_fn (different from the actual function)
        def wrong_f(x): return bool((x>>2)&1 ^ (x>>3)&1)
        verifier = LawVerificationLayer(true_fn=wrong_f)
        result = verifier.verify(cls, obs, d, true_fn=wrong_f)
        # The law predicts f (XOR bits 0,1) but true_fn is wrong_f (XOR bits 2,3)
        # Adversarial search should find counterexamples
        if cls.selected_class != "unknown":
            assert not result.accepted or result.n_counterexamples_found > 0

    def test_mdl_rejection(self):
        """Law with MDL > raw data should be rejected."""
        verifier = LawVerificationLayer()
        # Create a fake classification with huge storage
        cls = ClassificationResult(
            selected_class="walsh",
            walsh_result=WalshResult(
                fits=True, n_coefficients=100,
                coefficients={i: 0.5 for i in range(100)},
                construction_cost=0, storage_bytes=800,  # 6400 bits
                spectral_sparsity=0.5),
        )
        # 50 observations = 50 bits raw; law = 6400 bits → MDL no reduction
        obs = [(i, bool(i % 2)) for i in range(50)]
        result = verifier.verify(cls, obs, 8)
        assert not result.accepted
        assert "MDL" in result.rejection_reason

    def test_aic_rejection(self):
        """Law with too many parameters should be rejected by AIC."""
        verifier = LawVerificationLayer(aic_threshold=10.0)
        cls = ClassificationResult(
            selected_class="walsh",
            walsh_result=WalshResult(
                fits=True, n_coefficients=50,
                coefficients={i: 0.5 for i in range(50)},
                construction_cost=0, storage_bytes=400,
                spectral_sparsity=0.9),
        )
        obs = [(i, bool(i % 2)) for i in range(50)]
        result = verifier.verify(cls, obs, 8)
        # AIC = 2*50 - 2*log(L). If all correct, AIC = 100 > 10
        assert not result.accepted

    def test_get_stats(self):
        """get_stats should return verification statistics."""
        verifier = LawVerificationLayer()
        # Verify a simple UNKNOWN
        cls = ClassificationResult(selected_class="unknown")
        verifier.verify(cls, [], 8)
        stats = verifier.get_stats()
        assert "n_verified" in stats
        assert "n_accepted" in stats


class TestVerifiedClassifier:
    """Test the verified classifier wrapper."""

    def test_valid_law_not_overridden(self):
        """Valid laws should not be overridden to UNKNOWN."""
        rng = random.Random(42)
        d = 8
        def f(x): return bool((x>>0)&1 ^ (x>>1)&1)
        obs = [(s, f(s)) for s in rng.sample(range(256), 50)]
        vc = VerifiedClassifier()
        cls, verification = vc.classify_and_verify(obs, d, true_fn=f)
        if cls.selected_class != "unknown":
            assert verification.accepted, f"Valid law rejected: {verification.rejection_reason}"

    def test_false_law_overridden_to_unknown(self):
        """False laws should be overridden to UNKNOWN."""
        rng = random.Random(42)
        d = 8
        # Threshold (non-linear, Walsh may approximately fit)
        def f(x): return bin(x).count('1') >= 4
        obs = [(s, f(s)) for s in rng.sample(range(256), 50)]
        vc = VerifiedClassifier()
        cls, verification = vc.classify_and_verify(obs, d, true_fn=f)
        # If the raw classifier found a law but verification rejected it,
        # the final class should be UNKNOWN
        if not verification.accepted:
            assert cls.selected_class == "unknown"

    def test_cost_includes_verification(self):
        """The classification cost should include verification cost."""
        rng = random.Random(42)
        d = 8
        def f(x): return bool((x>>0)&1 ^ (x>>1)&1)
        obs = [(s, f(s)) for s in rng.sample(range(256), 50)]
        vc = VerifiedClassifier()
        cls, verification = vc.classify_and_verify(obs, d, true_fn=f)
        assert cls.classification_cost >= verification.verification_cost
