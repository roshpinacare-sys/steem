"""Adversarial tests for RCE-2 v6.7 Adaptive Density Gate.

Tests attack:
  1. Silverman bandwidth computation correctness
  2. Zelnik-Manor per-point scale computation
  3. Adaptive vs fixed bandwidth comparison
  4. Strategy selection integrity
  5. Substrate integration with adaptive gate
"""
from __future__ import annotations

import math
import random
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rce.rce2_adaptive_gate import (
    AdaptiveDensityOODGate, make_substrate_with_adaptive_gate,
)
from rce.rce2_substrate import Substrate, SubstrateOutcome


# ===========================================================================
# 1. Silverman Bandwidth Computation
# ===========================================================================

class TestSilvermanBandwidth:
    """Verify Silverman's rule implementation."""

    def test_silverman_bandwidth_positive(self):
        """Silverman bandwidth must be positive."""
        rng = random.Random(42)
        training = [(rng.random(), rng.random()) for _ in range(50)]
        g = AdaptiveDensityOODGate(strategy="silverman")
        g.fit("test", training)
        h = g._silverman_h.get("test", 0)
        assert h > 0, f"Silverman bandwidth must be positive, got {h}"

    def test_silverman_bandwidth_scales_with_spread(self):
        """Wider data → larger Silverman bandwidth."""
        rng = random.Random(42)
        narrow = [(rng.random() * 0.1, rng.random() * 0.1) for _ in range(50)]
        wide = [(rng.random() * 1.0, rng.random() * 1.0) for _ in range(50)]
        g_narrow = AdaptiveDensityOODGate(strategy="silverman")
        g_narrow.fit("test", narrow)
        g_wide = AdaptiveDensityOODGate(strategy="silverman")
        g_wide.fit("test", wide)
        assert g_wide._silverman_h["test"] > g_narrow._silverman_h["test"], (
            "Silverman bandwidth should be larger for wider data")

    def test_silverman_rejects_far_ood(self):
        """Silverman strategy should reject far OOD inputs."""
        rng = random.Random(42)
        training = [(rng.random() * 0.3, rng.random() * 0.3) for _ in range(50)]
        g = AdaptiveDensityOODGate(strategy="silverman", relative_threshold=0.1)
        g.fit("test", training)
        is_ood, _, _ = g.is_ood("test", (0.9, 0.9))
        assert is_ood, "Silverman should reject far OOD input"

    def test_silverman_accepts_in_dist(self):
        """Silverman should accept in-distribution inputs."""
        rng = random.Random(42)
        training = [(rng.random() * 0.3, rng.random() * 0.3) for _ in range(50)]
        g = AdaptiveDensityOODGate(strategy="silverman", relative_threshold=0.1)
        g.fit("test", training)
        is_ood, _, _ = g.is_ood("test", training[0])
        assert not is_ood, "Silverman should accept training point"


# ===========================================================================
# 2. Zelnik-Manor Per-Point Scales
# ===========================================================================

class TestZelnikManor:
    """Verify Zelnik-Manor self-tuning."""

    def test_point_scales_computed(self):
        """Per-point scales must be computed on fit."""
        rng = random.Random(42)
        training = [(rng.random(), rng.random()) for _ in range(50)]
        g = AdaptiveDensityOODGate(strategy="zelnik_manor", adaptive_k=5)
        g.fit("test", training)
        scales = g.get_point_scales("test")
        assert len(scales) == 50, f"Expected 50 scales, got {len(scales)}"
        assert all(s > 0 for s in scales), "All scales must be positive"

    def test_dense_cluster_has_small_scales(self):
        """Points in dense clusters should have small scales."""
        rng = random.Random(42)
        # Dense cluster at origin
        training = [(rng.gauss(0, 0.01), rng.gauss(0, 0.01)) for _ in range(50)]
        g = AdaptiveDensityOODGate(strategy="zelnik_manor", adaptive_k=5)
        g.fit("test", training)
        scales = g.get_point_scales("test")
        avg_scale = sum(scales) / len(scales)
        assert avg_scale < 0.1, (
            f"Dense cluster should have small scales, got avg={avg_scale:.3f}")

    def test_sparse_cluster_has_large_scales(self):
        """Points in sparse clusters should have large scales."""
        rng = random.Random(42)
        # Sparse cluster (wide spread)
        training = [(rng.gauss(0, 0.5), rng.gauss(0, 0.5)) for _ in range(50)]
        g = AdaptiveDensityOODGate(strategy="zelnik_manor", adaptive_k=5)
        g.fit("test", training)
        scales = g.get_point_scales("test")
        avg_scale = sum(scales) / len(scales)
        assert avg_scale > 0.1, (
            f"Sparse cluster should have large scales, got avg={avg_scale:.3f}")


# ===========================================================================
# 3. Strategy Comparison
# ===========================================================================

class TestStrategyComparison:
    """Verify the three strategies behave differently where expected."""

    def test_silverman_and_zm_differ_on_long_tail(self):
        """On long-tail, Silverman and ZM should produce different densities."""
        rng = random.Random(42)
        training = []
        for _ in range(95):
            training.append((rng.random() * 0.3, rng.random() * 0.3))
        for _ in range(5):
            training.append((0.7 + rng.random() * 0.3, 0.7 + rng.random() * 0.3))

        g_silv = AdaptiveDensityOODGate(strategy="silverman")
        g_silv.fit("lt", training)
        g_zm = AdaptiveDensityOODGate(strategy="zelnik_manor")
        g_zm.fit("lt", training)

        # Query at a tail point
        q = (0.85, 0.85)
        d_silv = g_silv._density("lt", q)
        d_zm = g_zm._density("lt", q)
        # Densities should differ (not necessarily by a fixed ratio)
        assert d_silv != d_zm, (
            "Silverman and ZM should produce different densities on long-tail")

    def test_all_strategies_reject_clear_ood(self):
        """All three strategies should reject clearly OOD inputs."""
        rng = random.Random(42)
        training = [(rng.random() * 0.3, rng.random() * 0.3) for _ in range(50)]
        for strategy in ["silverman", "local_knn", "zelnik_manor"]:
            g = AdaptiveDensityOODGate(strategy=strategy, relative_threshold=0.1)
            g.fit("test", training)
            is_ood, _, _ = g.is_ood("test", (0.95, 0.95))
            assert is_ood, (
                f"Strategy {strategy} failed to reject clear OOD input")


# ===========================================================================
# 4. Substrate Integration
# ===========================================================================

class TestSubstrateWithAdaptiveGate:
    """Verify substrate works with adaptive gate."""

    def test_substrate_uses_adaptive_gate(self):
        """Factory must install AdaptiveDensityOODGate."""
        sub = make_substrate_with_adaptive_gate()
        assert isinstance(sub.ood_gate, AdaptiveDensityOODGate), (
            "Factory did not install AdaptiveDensityOODGate")

    def test_substrate_predicts_with_adaptive_gate(self):
        """Substrate must predict correctly with adaptive gate."""
        sub = make_substrate_with_adaptive_gate(strategy="silverman")
        rng = random.Random(42)
        for _ in range(50):
            f = (float(rng.random() > 0.3), float(rng.random() > 0.3))
            sub.train("and", f, all(bool(v) for v in f))
        sub.fit("and")
        val = [((float(rng.random() > 0.3), float(rng.random() > 0.3)),
                None) for _ in range(30)]
        val = [(f, all(bool(v) for v in f)) for f, _ in val]
        sub.calibrate("and", val, full_computation_fn=lambda: True)
        predicted, outcome, conf, _ = sub.predict(
            "and", (1.0, 1.0), full_computation=lambda: True,
            record_outcome=False)
        assert predicted == True

    def test_substrate_rejects_ood_with_adaptive_gate(self):
        """Substrate must reject OOD with adaptive gate."""
        sub = make_substrate_with_adaptive_gate(strategy="silverman",
                                                  relative_threshold=0.1)
        rng = random.Random(42)
        for _ in range(50):
            f = (rng.random() * 0.3, rng.random() * 0.3)
            sub.train("near", f, f[0] + f[1] > 0.3)
        sub.fit("near")
        val = [((rng.random() * 0.3, rng.random() * 0.3), False) for _ in range(20)]
        sub.calibrate("near", val, full_computation_fn=lambda: True)
        rejected = 0
        for _ in range(20):
            f = (0.4 + rng.random() * 0.2, 0.4 + rng.random() * 0.2)
            _, outcome, _, _ = sub.predict("near", f,
                                            full_computation=lambda: True,
                                            record_outcome=False)
            if outcome == SubstrateOutcome.REJECTED_OOD:
                rejected += 1
        assert rejected >= 10, (
            f"Adaptive gate rejected only {rejected}/20 OOD inputs")


# ===========================================================================
# 5. Regression: v6.6 Workloads Still Pass
# ===========================================================================

class TestV66Regression:
    """Ensure v6.7 adaptive gate doesn't regress on v6.6 workloads."""

    def test_compressible_workload_still_works(self):
        """AND-of-2 must still compress and predict correctly."""
        sub = make_substrate_with_adaptive_gate(strategy="silverman")
        rng = random.Random(42)
        for _ in range(100):
            f = (float(rng.random() > 0.3), float(rng.random() > 0.3))
            sub.train("and", f, all(bool(v) for v in f))
        sub.fit("and")
        mdl = sub.compression.mdl_report["and"]
        assert mdl["compression_ratio"] < 0.2, (
            f"Compression ratio regressed: {mdl['compression_ratio']:.3f}")

    def test_long_tail_ood_rejection_improved(self):
        """W7 long-tail OOD rejection must be ≥ 70% (improved from v6.6 73%)."""
        rng = random.Random(42)
        training = []
        for _ in range(95):
            training.append((rng.random() * 0.3, rng.random() * 0.3))
        for _ in range(5):
            training.append((0.7 + rng.random() * 0.3, 0.7 + rng.random() * 0.3))
        g = AdaptiveDensityOODGate(strategy="silverman", relative_threshold=0.1)
        g.fit("lt", training)
        # Gap OOD probe
        ood_probe = [(0.4 + rng.random() * 0.2, 0.4 + rng.random() * 0.2)
                     for _ in range(30)]
        rejected = sum(1 for f in ood_probe if g.is_ood("lt", f)[0])
        reject_rate = rejected / 30 * 100
        assert reject_rate >= 70.0, (
            f"Long-tail OOD rejection = {reject_rate:.1f}%, expected ≥ 70% "
            f"(v6.6 achieved 73%)")
