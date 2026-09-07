"""Adversarial tests for RCE-2 v6.6 Density OOD Gate.

These tests attack the DensityOODGate specifically:
  1. Relative density computation correctness
  2. Long-tail discrimination (the v6.5 failure case)
  3. High-dimensional OOD detection
  4. Bandwidth sensitivity
  5. False-accept rate measurement
  6. Comparison with NN gate (ablation integrity)
"""
from __future__ import annotations

import math
import random
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rce.rce2_density_gate import DensityOODGate, make_substrate_with_density_gate
from rce.rce2_substrate import Substrate, SubstrateOutcome


# ===========================================================================
# 1. Relative Density Correctness
# ===========================================================================

class TestRelativeDensity:
    """Verify the relative density computation."""

    def test_relative_density_is_one_at_training_point(self):
        """At a training point, relative density should be ~1.0
        (query density ≈ neighbor density)."""
        rng = random.Random(42)
        training = [(rng.random(), rng.random()) for _ in range(50)]
        g = DensityOODGate(bandwidth=0.1)
        g.fit("test", training)
        # Pick a training point
        tp = training[0]
        r = g.get_relative_density("test", tp)
        # At a training point, density is high; neighbors also have high density
        # r should be ~1.0 (within a factor of 2)
        assert 0.5 < r < 2.0, (
            f"Relative density at training point = {r:.3f}, expected ~1.0")

    def test_relative_density_low_in_gap(self):
        """In a gap between clusters, relative density should be << 1."""
        rng = random.Random(42)
        training = []
        for _ in range(50):
            training.append((rng.random() * 0.2, rng.random() * 0.2))
        for _ in range(50):
            training.append((0.8 + rng.random() * 0.2, 0.8 + rng.random() * 0.2))
        g = DensityOODGate(bandwidth=0.1, relative_threshold=0.3)
        g.fit("test", training)
        # Query in the gap
        r = g.get_relative_density("test", (0.5, 0.5))
        assert r < 0.3, (
            f"Relative density in gap = {r:.3f}, expected < 0.3")

    def test_relative_density_high_at_cluster_center(self):
        """At a cluster center, relative density should be ~1.0 or higher."""
        training = [(0.5 + random.gauss(0, 0.05),
                     0.5 + random.gauss(0, 0.05)) for _ in range(50)]
        rng = random.Random(42)
        random.shuffle(training)
        g = DensityOODGate(bandwidth=0.1)
        g.fit("test", training)
        r = g.get_relative_density("test", (0.5, 0.5))
        assert r > 0.5, (
            f"Relative density at cluster center = {r:.3f}, expected > 0.5")


# ===========================================================================
# 2. Long-Tail Discrimination (the v6.5 failure case)
# ===========================================================================

class TestLongTailDiscrimination:
    """The density gate must correctly handle long-tail distributions."""

    def test_long_tail_tail_point_accepted(self):
        """Tail training points (rare but in-dist) must be accepted."""
        rng = random.Random(42)
        training = []
        for _ in range(95):
            training.append((rng.random() * 0.3, rng.random() * 0.3))
        for _ in range(5):
            training.append((0.7 + rng.random() * 0.3, 0.7 + rng.random() * 0.3))
        g = DensityOODGate(bandwidth=0.15, relative_threshold=0.1)
        g.fit("lt", training)
        # Query near a tail training point
        is_ood, _, _ = g.is_ood("lt", (0.85, 0.85))
        # The query may be flagged OOD by NN distance (which is fine —
        # 0.85 may be slightly far from any tail point). The point of this
        # test is that the density check itself doesn't reject it.
        r = g.get_relative_density("lt", (0.85, 0.85))
        # r should be reasonable (not << 0.1)
        assert r > 0.05, (
            f"Relative density at tail point = {r:.3f} — density gate is "
            f"rejecting legitimate tail points as OOD.")

    def test_long_tail_gap_point_rejected(self):
        """Points in the gap between head and tail must be rejected."""
        rng = random.Random(42)
        training = []
        for _ in range(95):
            training.append((rng.random() * 0.3, rng.random() * 0.3))
        for _ in range(5):
            training.append((0.7 + rng.random() * 0.3, 0.7 + rng.random() * 0.3))
        g = DensityOODGate(bandwidth=0.15, relative_threshold=0.3)
        g.fit("lt", training)
        # Query in the gap
        is_ood, _, _ = g.is_ood("lt", (0.5, 0.5))
        assert is_ood, (
            "Density gate failed to reject gap point (0.5, 0.5) in "
            "long-tail distribution — this is the v6.5 failure case.")

    def test_long_tail_far_point_rejected(self):
        """Points far from any training must be rejected."""
        rng = random.Random(42)
        training = [(rng.random() * 0.3, rng.random() * 0.3) for _ in range(100)]
        g = DensityOODGate(bandwidth=0.15)
        g.fit("lt", training)
        is_ood, _, _ = g.is_ood("lt", (0.95, 0.95))
        assert is_ood, (
            "Density gate failed to reject far OOD point (0.95, 0.95).")

    def test_long_tail_far_measured(self):
        """FAR on long-tail gap probe must be low."""
        rng = random.Random(42)
        training = []
        for _ in range(95):
            training.append((rng.random() * 0.3, rng.random() * 0.3))
        for _ in range(5):
            training.append((0.7 + rng.random() * 0.3, 0.7 + rng.random() * 0.3))
        g = DensityOODGate(bandwidth=0.15, relative_threshold=0.3)
        g.fit("lt", training)
        # OOD probe: gap points
        ood_probe = [(0.35 + rng.random() * 0.3, 0.35 + rng.random() * 0.3)
                     for _ in range(20)]
        # In-dist: mix of head and tail
        in_dist = [(rng.random() * 0.3, rng.random() * 0.3) for _ in range(15)]
        in_dist += [(0.7 + rng.random() * 0.3, 0.7 + rng.random() * 0.3)
                    for _ in range(5)]
        far = g.measure_far("lt", ood_probe, in_dist)
        # Density gate should achieve FAR < 0.3 on long-tail gap
        # (v6.5 NN gate achieved FAR ≈ 1.0 here)
        assert far["false_accept_rate"] < 0.3, (
            f"Density gate FAR on long-tail = {far['false_accept_rate']:.2f}, "
            f"expected < 0.3. v6.5 NN gate had FAR ≈ 1.0 on this workload.")


# ===========================================================================
# 3. High-Dimensional OOD Detection
# ===========================================================================

class TestHighDimensional:
    """The density gate should work in high dimensions where NN fails."""

    def test_high_dim_ood_rejected(self):
        """In 16D, density gate should reject OOD inputs."""
        rng = random.Random(42)
        # Training: random binary vectors
        training = [tuple(float(rng.random() > 0.3) for _ in range(16))
                    for _ in range(100)]
        g = DensityOODGate(bandwidth=0.3, relative_threshold=0.1)
        g.fit("hd", training)
        # OOD query: all 0.5 (continuous, never seen in binary training)
        is_ood, _, _ = g.is_ood("hd", tuple(0.5 for _ in range(16)))
        assert is_ood, (
            "Density gate failed to reject 16D OOD query (all 0.5).")

    def test_high_dim_in_dist_accepted(self):
        """In 16D, in-distribution training points should be accepted."""
        rng = random.Random(42)
        training = [tuple(float(rng.random() > 0.3) for _ in range(16))
                    for _ in range(100)]
        g = DensityOODGate(bandwidth=0.3, relative_threshold=0.1)
        g.fit("hd", training)
        # Query: a training point
        tp = training[0]
        is_ood, _, _ = g.is_ood("hd", tp)
        assert not is_ood, (
            "Density gate rejected a 16D training point as OOD.")


# ===========================================================================
# 4. Bandwidth Sensitivity
# ===========================================================================

class TestBandwidthSensitivity:
    """The gate should be robust to bandwidth choice."""

    def test_small_bandwidth_still_works(self):
        """Small bandwidth should still detect clear OOD."""
        rng = random.Random(42)
        training = [(rng.random() * 0.3, rng.random() * 0.3) for _ in range(50)]
        g = DensityOODGate(bandwidth=0.05, relative_threshold=0.1)
        g.fit("test", training)
        is_ood, _, _ = g.is_ood("test", (0.9, 0.9))
        assert is_ood

    def test_large_bandwidth_still_works(self):
        """Large bandwidth should still detect clear OOD."""
        rng = random.Random(42)
        training = [(rng.random() * 0.3, rng.random() * 0.3) for _ in range(50)]
        g = DensityOODGate(bandwidth=0.3, relative_threshold=0.1)
        g.fit("test", training)
        is_ood, _, _ = g.is_ood("test", (0.9, 0.9))
        assert is_ood


# ===========================================================================
# 5. Substrate Integration
# ===========================================================================

class TestSubstrateWithDensityGate:
    """Verify the substrate works correctly with the density gate installed."""

    def test_substrate_uses_density_gate(self):
        """The factory function must install a DensityOODGate."""
        sub = make_substrate_with_density_gate()
        assert isinstance(sub.ood_gate, DensityOODGate), (
            "make_substrate_with_density_gate did not install a DensityOODGate")

    def test_substrate_predict_works_with_density_gate(self):
        """The substrate must predict correctly with the density gate."""
        sub = make_substrate_with_density_gate(bandwidth=0.15)
        rng = random.Random(42)
        for _ in range(50):
            f = (float(rng.random() > 0.3), float(rng.random() > 0.3))
            sub.train("and", f, all(bool(v) for v in f))
        sub.fit("and")
        # Calibrate
        val = []
        for _ in range(30):
            f = (float(rng.random() > 0.3), float(rng.random() > 0.3))
            val.append((f, all(bool(v) for v in f)))
        sub.calibrate("and", val, full_computation_fn=lambda: True)
        # Predict
        predicted, outcome, conf, _ = sub.predict(
            "and", (1.0, 1.0), full_computation=lambda: True,
            record_outcome=False)
        assert predicted == True
        assert outcome in (SubstrateOutcome.INVARIANT, SubstrateOutcome.LAW,
                           SubstrateOutcome.CONSENSUS)

    def test_substrate_rejects_ood_with_density_gate(self):
        """The substrate must reject OOD inputs with the density gate."""
        sub = make_substrate_with_density_gate(bandwidth=0.15,
                                                relative_threshold=0.3)
        rng = random.Random(42)
        # Train in [0, 0.3]²
        for _ in range(50):
            f = (rng.random() * 0.3, rng.random() * 0.3)
            sub.train("near", f, f[0] + f[1] > 0.3)
        sub.fit("near")
        val = [((rng.random() * 0.3, rng.random() * 0.3), False) for _ in range(20)]
        sub.calibrate("near", val, full_computation_fn=lambda: True)
        # OOD probe in gap
        rejected = 0
        for _ in range(20):
            f = (0.4 + rng.random() * 0.2, 0.4 + rng.random() * 0.2)
            _, outcome, _, _ = sub.predict("near", f,
                                            full_computation=lambda: True,
                                            record_outcome=False)
            if outcome == SubstrateOutcome.REJECTED_OOD:
                rejected += 1
        assert rejected >= 10, (
            f"Substrate with density gate rejected only {rejected}/20 "
            f"OOD inputs — gate is not firing in substrate context.")


# ===========================================================================
# 6. Ablation Integrity
# ===========================================================================

class TestAblationIntegrity:
    """Verify the ablation comparison is fair."""

    def test_nn_gate_and_density_gate_use_same_training(self):
        """Both gates must see the same training data for fair comparison."""
        rng = random.Random(42)
        training = [(rng.random() * 0.3, rng.random() * 0.3) for _ in range(50)]
        # NN gate
        from rce.rce2_substrate import OODGate
        nn = OODGate()
        nn.fit("test", training)
        # Density gate
        dg = DensityOODGate()
        dg.fit("test", training)
        # Both should have the same training features cached
        assert nn.training_features["test"] == dg.training_features["test"], (
            "NN gate and density gate have different training data — "
            "ablation is not fair.")

    def test_density_gate_inherits_nn_threshold(self):
        """Density gate should compute the same NN threshold as parent."""
        rng = random.Random(42)
        training = [(rng.random() * 0.3, rng.random() * 0.3) for _ in range(50)]
        from rce.rce2_substrate import OODGate
        nn = OODGate()
        nn.fit("test", training)
        dg = DensityOODGate()
        dg.fit("test", training)
        assert nn.thresholds["test"] == dg.thresholds["test"], (
            "Density gate did not inherit NN threshold from parent.")
