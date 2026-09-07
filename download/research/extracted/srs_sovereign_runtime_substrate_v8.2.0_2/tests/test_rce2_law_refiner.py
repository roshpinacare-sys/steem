"""Adversarial tests for RCE-2 v6.9 Online Law Refinement."""
from __future__ import annotations

import random
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rce.rce2_law_refiner import (
    SubstrateV69, OnlineLawRefiner, RefinedLaw, LawStatus,
)
from rce.rce2_substrate import SubstrateOutcome


# ===========================================================================
# A. Law Invalidation Tests
# ===========================================================================

class TestLawInvalidation:
    """Test that laws are quarantined after repeated failures."""

    def test_law_quarantined_after_3_failures(self):
        """A law that fails 3 times must be quarantined."""
        sub = SubstrateV69()
        rng = random.Random(42)
        for _ in range(100):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            sub.train("and", f, all(bool(v) for v in f))
        sub.fit("and")
        val = []
        for _ in range(50):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            val.append((f, all(bool(v) for v in f)))
        sub.calibrate("and", val)

        # Find a law
        refined = sub.refiner.query_refined_law("and", (1.0, 1.0, 1.0))
        assert refined is not None
        assert refined.status == LawStatus.ACTIVE

        # Inject 3 failures
        for _ in range(3):
            sub.verify_and_refine("and", (1.0, 1.0, 1.0), refined, True, False)

        assert refined.status == LawStatus.QUARANTINED, (
            f"Law should be QUARANTINED after 3 failures, got {refined.status}")

    def test_quarantined_law_not_used(self):
        """A quarantined law must not be used for predictions."""
        sub = SubstrateV69()
        rng = random.Random(42)
        for _ in range(100):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            sub.train("and", f, all(bool(v) for v in f))
        sub.fit("and")
        val = []
        for _ in range(50):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            val.append((f, all(bool(v) for v in f)))
        sub.calibrate("and", val)

        # Quarantine the law for (1,1,1)
        refined = sub.refiner.query_refined_law("and", (1.0, 1.0, 1.0))
        for _ in range(3):
            sub.verify_and_refine("and", (1.0, 1.0, 1.0), refined, True, False)

        # Predict (1,1,1) — should NOT use the quarantined law
        predicted, outcome, conf, cost, matched = sub.predict_with_refinement(
            "and", (1.0, 1.0, 1.0), full_computation=lambda: True,
            record_outcome=False)
        assert matched is None or matched.status != LawStatus.QUARANTINED, (
            "Quarantined law was used for prediction")

    def test_law_becomes_suspect_after_1_failure(self):
        """A law that fails once becomes SUSPECT."""
        sub = SubstrateV69()
        rng = random.Random(42)
        for _ in range(100):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            sub.train("and", f, all(bool(v) for v in f))
        sub.fit("and")
        val = []
        for _ in range(50):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            val.append((f, all(bool(v) for v in f)))
        sub.calibrate("and", val)

        refined = sub.refiner.query_refined_law("and", (1.0, 1.0, 1.0))
        sub.verify_and_refine("and", (1.0, 1.0, 1.0), refined, True, False)
        assert refined.status == LawStatus.SUSPECT, (
            f"Law should be SUSPECT after 1 failure, got {refined.status}")


# ===========================================================================
# B. Confidence Decay Tests
# ===========================================================================

class TestConfidenceDecay:
    """Test that confidence decays on failures."""

    def test_confidence_decays_on_failure(self):
        """Each failure decays confidence by 0.7x."""
        sub = SubstrateV69()
        rng = random.Random(42)
        for _ in range(100):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            sub.train("and", f, all(bool(v) for v in f))
        sub.fit("and")
        val = []
        for _ in range(50):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            val.append((f, all(bool(v) for v in f)))
        sub.calibrate("and", val)

        refined = sub.refiner.query_refined_law("and", (1.0, 1.0, 1.0))
        original = refined.effective_confidence

        sub.verify_and_refine("and", (1.0, 1.0, 1.0), refined, True, False)
        after_1 = refined.effective_confidence

        # After 1 failure: confidence = original * reliability * 0.7
        # reliability = 0/(0+1) = 0, so effective_confidence = 0
        assert after_1 < original, (
            f"Confidence should decay: {original} → {after_1}")

    def test_confidence_restored_on_successes(self):
        """Successes rehabilitate SUSPECT laws."""
        sub = SubstrateV69()
        rng = random.Random(42)
        for _ in range(100):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            sub.train("and", f, all(bool(v) for v in f))
        sub.fit("and")
        val = []
        for _ in range(50):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            val.append((f, all(bool(v) for v in f)))
        sub.calibrate("and", val)

        refined = sub.refiner.query_refined_law("and", (1.0, 1.0, 1.0))
        # 1 failure → SUSPECT
        sub.verify_and_refine("and", (1.0, 1.0, 1.0), refined, True, False)
        assert refined.status == LawStatus.SUSPECT

        # 5 successes → rehabilitated to ACTIVE
        for _ in range(5):
            sub.verify_and_refine("and", (1.0, 1.0, 1.0), refined, True, True)
        assert refined.status == LawStatus.ACTIVE, (
            f"Law should be rehabilitated after 5 successes, got {refined.status}")


# ===========================================================================
# C. Radius Shrinking Tests
# ===========================================================================

class TestRadiusShrinking:
    """Test that law radius shrinks to exclude counterexamples."""

    def test_radius_shrinks_on_failure(self):
        """A law's radius shrinks when a counterexample is found."""
        sub = SubstrateV69()
        rng = random.Random(42)
        for _ in range(100):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            sub.train("and", f, all(bool(v) for v in f))
        sub.fit("and")
        val = []
        for _ in range(50):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            val.append((f, all(bool(v) for v in f)))
        sub.calibrate("and", val)

        refined = sub.refiner.query_refined_law("and", (1.0, 1.0, 1.0))
        original_radius = refined.radius

        # Inject a counterexample near the boundary
        # (1.0, 1.0, 0.9) is at distance 0.1 from (1,1,1)
        sub.verify_and_refine("and", (1.0, 1.0, 0.9), refined, True, False)
        assert refined.radius <= original_radius, (
            f"Radius should shrink: {original_radius} → {refined.radius}")

    def test_radius_does_not_grow(self):
        """Radius must never increase on failure."""
        sub = SubstrateV69()
        rng = random.Random(42)
        for _ in range(100):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            sub.train("and", f, all(bool(v) for v in f))
        sub.fit("and")
        val = []
        for _ in range(50):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            val.append((f, all(bool(v) for v in f)))
        sub.calibrate("and", val)

        refined = sub.refiner.query_refined_law("and", (1.0, 1.0, 1.0))
        original_radius = refined.radius
        for _ in range(3):
            sub.verify_and_refine("and", (1.0, 1.0, 1.0), refined, True, False)
        assert refined.radius <= original_radius, (
            f"Radius grew: {original_radius} → {refined.radius}")


# ===========================================================================
# D. Substrate Integration Tests
# ===========================================================================

class TestSubstrateV69:
    """Test the integrated v6.9 substrate."""

    def test_predict_with_refinement_returns_5_values(self):
        """predict_with_refinement returns (predicted, outcome, conf, cost, law)."""
        sub = SubstrateV69()
        rng = random.Random(42)
        for _ in range(100):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            sub.train("and", f, all(bool(v) for v in f))
        sub.fit("and")
        val = []
        for _ in range(50):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            val.append((f, all(bool(v) for v in f)))
        sub.calibrate("and", val)
        result = sub.predict_with_refinement(
            "and", (1.0, 1.0, 1.0), full_computation=lambda: True,
            record_outcome=False)
        assert len(result) == 5

    def test_verify_and_refine_returns_correctness(self):
        """verify_and_refine returns True if prediction was correct."""
        sub = SubstrateV69()
        rng = random.Random(42)
        for _ in range(100):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            sub.train("and", f, all(bool(v) for v in f))
        sub.fit("and")
        val = []
        for _ in range(50):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            val.append((f, all(bool(v) for v in f)))
        sub.calibrate("and", val)
        refined = sub.refiner.query_refined_law("and", (1.0, 1.0, 1.0))
        # Correct prediction
        ok = sub.verify_and_refine("and", (1.0, 1.0, 1.0), refined, True, True)
        assert ok == True
        # Wrong prediction
        ok = sub.verify_and_refine("and", (1.0, 1.0, 1.0), refined, True, False)
        assert ok == False

    def test_report_includes_refiner_stats(self):
        """The report must include refiner statistics."""
        sub = SubstrateV69()
        rng = random.Random(42)
        for _ in range(100):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            sub.train("and", f, all(bool(v) for v in f))
        sub.fit("and")
        val = []
        for _ in range(50):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            val.append((f, all(bool(v) for v in f)))
        sub.calibrate("and", val)
        for _ in range(10):
            sub.predict_with_refinement(
                "and", (1.0, 1.0, 1.0), full_computation=lambda: True)
        report = sub.get_report()
        assert "refiner_stats" in report
        assert "total_successes" in report["refiner_stats"]
        assert "total_failures" in report["refiner_stats"]


# ===========================================================================
# E. End-to-End: Self-Correction Tests
# ===========================================================================

class TestSelfCorrection:
    """Test that the substrate self-corrects when laws go wrong."""

    def test_broken_law_does_not_repeat_mistake(self):
        """After a law is quarantined, the substrate must not repeat
        the same wrong prediction via that law."""
        sub = SubstrateV69()
        rng = random.Random(42)
        for _ in range(100):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            sub.train("and", f, all(bool(v) for v in f))
        sub.fit("and")
        val = []
        for _ in range(50):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            val.append((f, all(bool(v) for v in f)))
        sub.calibrate("and", val)

        # Quarantine the (1,1,1)→True law by injecting failures
        refined = sub.refiner.query_refined_law("and", (1.0, 1.0, 1.0))
        for _ in range(3):
            sub.verify_and_refine("and", (1.0, 1.0, 1.0), refined, True, False)

        # Now predict (1,1,1) — should NOT use the quarantined law
        predicted, outcome, conf, cost, matched = sub.predict_with_refinement(
            "and", (1.0, 1.0, 1.0), full_computation=lambda: True,
            record_outcome=False)
        assert matched is None, (
            "Quarantined law was used — substrate did not self-correct")

    def test_refiner_stats_track_failures(self):
        """Refiner stats must track failure and quarantine counts."""
        sub = SubstrateV69()
        rng = random.Random(42)
        for _ in range(100):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            sub.train("and", f, all(bool(v) for v in f))
        sub.fit("and")
        val = []
        for _ in range(50):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            val.append((f, all(bool(v) for v in f)))
        sub.calibrate("and", val)

        refined = sub.refiner.query_refined_law("and", (1.0, 1.0, 1.0))
        for _ in range(3):
            sub.verify_and_refine("and", (1.0, 1.0, 1.0), refined, True, False)

        stats = sub.refiner.get_stats()
        assert stats["total_failures"] >= 3
        assert stats["laws_quarantined"] >= 1
        assert stats["quarantined_laws"] >= 1
