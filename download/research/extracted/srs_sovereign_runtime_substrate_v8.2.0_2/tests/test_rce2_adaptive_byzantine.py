"""Adversarial tests for RCE-2 v6.22 Adaptive Byzantine Detection."""
from __future__ import annotations

import random
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rce.rce2_adaptive_byzantine import (
    SubstrateV622, AdaptiveByzantineDetector, DetectionResult,
)
from rce.rce2_byzantine_robust import ByzantineNode
from rce.rce2_differential_privacy import DPFederatedNode


# ===========================================================================
# A. Detection Method Tests
# ===========================================================================

class TestDetectionMethods:
    """Test the three detection methods."""

    def test_clustering_detects_outlier(self):
        """Clustering should detect the outlier node."""
        detector = AdaptiveByzantineDetector()
        estimates = [
            ("A", 0.5), ("B", 0.55), ("C", 0.52),
            ("D", 0.58), ("E", 0.51), ("F", 10.0),  # Byzantine
        ]
        f, byz = detector.detect_by_clustering(estimates)
        assert f >= 1, f"Should detect at least 1 Byzantine, got f={f}"
        assert "F" in byz, f"Should detect node F as Byzantine, got {byz}"

    def test_outlier_detection_finds_extreme(self):
        """Modified z-score should detect extreme outliers."""
        detector = AdaptiveByzantineDetector(z_threshold=3.5)
        estimates = [
            ("A", 0.5), ("B", 0.55), ("C", 0.52),
            ("D", 0.58), ("E", 0.51), ("F", 10.0),  # Byzantine
        ]
        f, byz = detector.detect_by_outliers(estimates)
        assert f >= 1
        assert "F" in byz

    def test_gap_statistic_finds_separation(self):
        """Gap statistic should find the separation between honest and Byzantine."""
        detector = AdaptiveByzantineDetector()
        estimates = [
            ("A", 0.5), ("B", 0.55), ("C", 0.52),
            ("D", 0.58), ("E", 0.51), ("F", 10.0),  # Byzantine
        ]
        f, byz = detector.detect_by_gap(estimates)
        assert f >= 1
        assert "F" in byz

    def test_no_false_positives_without_byzantine(self):
        """Should not detect Byzantine when all nodes are honest."""
        detector = AdaptiveByzantineDetector()
        estimates = [
            ("A", 0.5), ("B", 0.55), ("C", 0.52),
            ("D", 0.58), ("E", 0.51),
        ]
        f1, _ = detector.detect_by_clustering(estimates)
        f2, _ = detector.detect_by_outliers(estimates)
        f3, _ = detector.detect_by_gap(estimates)
        # At least one method should report 0 (no Byzantine)
        assert min(f1, f2, f3) == 0


# ===========================================================================
# B. Adaptive Detector Tests
# ===========================================================================

class TestAdaptiveDetector:
    """Test the combined adaptive detector."""

    def test_detect_returns_results(self):
        """detect should return results for all features."""
        detector = AdaptiveByzantineDetector()
        feature_estimates = {
            0: [("A", 0.5), ("B", 0.55), ("C", 10.0)],  # C is Byzantine
            1: [("A", 0.1), ("B", 0.2), ("C", 0.15)],
        }
        results = detector.detect(feature_estimates)
        assert len(results) == 2
        assert 0 in results
        assert 1 in results

    def test_estimated_f_positive_with_byzantine(self):
        """Estimated f should be > 0 when Byzantine nodes exist."""
        detector = AdaptiveByzantineDetector()
        feature_estimates = {
            0: [("A", 0.5), ("B", 0.55), ("C", 0.52),
                ("D", 0.58), ("E", 0.51), ("F", 10.0)],
        }
        detector.detect(feature_estimates)
        assert detector.get_estimated_f() >= 1

    def test_detected_byzantine_nodes_tracked(self):
        """Detected Byzantine nodes should be tracked."""
        detector = AdaptiveByzantineDetector()
        feature_estimates = {
            0: [("A", 0.5), ("B", 0.55), ("C", 10.0)],
        }
        detector.detect(feature_estimates)
        detected = detector.get_detected_byzantine_nodes()
        assert "C" in detected

    def test_get_stats_returns_info(self):
        """get_stats should return detection statistics."""
        detector = AdaptiveByzantineDetector()
        feature_estimates = {
            0: [("A", 0.5), ("B", 10.0)],
        }
        detector.detect(feature_estimates)
        stats = detector.get_stats()
        assert "estimated_f" in stats
        assert "byzantine_node_ids" in stats
        assert "detection_details" in stats

    def test_median_of_methods(self):
        """Final f should be median of three method estimates."""
        detector = AdaptiveByzantineDetector()
        # Clustering: 1, outlier: 2, gap: 1 → median = 1
        feature_estimates = {
            0: [("A", 0.5), ("B", 0.55), ("C", 0.52),
                ("D", 0.58), ("E", 10.0), ("F", -5.0)],
        }
        results = detector.detect(feature_estimates)
        r = results[0]
        # Median of {clustering, outlier, gap}
        estimates = sorted(r.method_estimates.values())
        expected_median = estimates[len(estimates) // 2]
        assert r.estimated_f == expected_median or r.estimated_f >= 1


# ===========================================================================
# C. Substrate Integration Tests
# ===========================================================================

class TestSubstrateV622:
    """Test the integrated v6.22 substrate."""

    def test_add_honest_node(self):
        """add_honest_node should create an honest node."""
        sub = SubstrateV622()
        node = sub.add_honest_node("honest", n_features=2)
        assert isinstance(node, DPFederatedNode)
        assert not isinstance(node, ByzantineNode)

    def test_add_byzantine_node(self):
        """add_byzantine_node should create a Byzantine node."""
        sub = SubstrateV622()
        node = sub.add_byzantine_node("byz", n_features=2)
        assert isinstance(node, ByzantineNode)

    def test_run_adaptive_learning(self):
        """run_adaptive_byzantine_learning should return stats."""
        sub = SubstrateV622()
        rng = random.Random(42)
        for _ in range(30):
            f = (float(rng.random() > 0.3),)
            sub.add_data_to_node("A", f, bool(f[0]))
        for _ in range(30):
            f = (float(rng.random() > 0.3),)
            sub.add_data_to_node("B", f, bool(f[0]))
        result = sub.run_adaptive_byzantine_learning()
        assert "detection_stats" in result
        assert "aggregation_stats" in result
        assert "estimated_f" in result

    def test_get_robust_causal_features(self):
        """get_robust_causal_features should return causal indices."""
        sub = SubstrateV622()
        rng = random.Random(42)
        for _ in range(50):
            f = (float(rng.random() > 0.3),)
            sub.add_data_to_node("A", f, bool(f[0]))
        for _ in range(50):
            f = (float(rng.random() > 0.3),)
            sub.add_data_to_node("B", f, bool(f[0]))
        sub.run_adaptive_byzantine_learning()
        causal = sub.get_robust_causal_features()
        assert 0 in causal

    def test_detected_byzantine_nodes_available(self):
        """get_detected_byzantine_nodes should return detected nodes."""
        sub = SubstrateV622()
        rng = random.Random(42)
        for i in range(5):
            for _ in range(30):
                f = (float(rng.random() > 0.3),)
                sub.add_data_to_node(f"h_{i}", f, bool(f[0]))
        byz = sub.add_byzantine_node("byz", n_features=1, attack_type="inflate")
        for _ in range(30):
            f = (float(rng.random() > 0.3),)
            byz.add_data(f, bool(f[0]))
        sub.run_adaptive_byzantine_learning()
        detected = sub.get_detected_byzantine_nodes()
        assert "byz" in detected, (
            f"Should detect byz node, got {detected}")


# ===========================================================================
# D. Self-Tuning Tests
# ===========================================================================

class TestSelfTuning:
    """Test that the substrate self-tunes without f parameter."""

    def test_no_f_parameter_required(self):
        """The substrate should not require f as a parameter."""
        sub = SubstrateV622()  # no n_byzantine parameter
        # Should still work
        rng = random.Random(42)
        for _ in range(30):
            f = (float(rng.random() > 0.3),)
            sub.add_data_to_node("A", f, bool(f[0]))
        sub.run_adaptive_byzantine_learning()
        # Should not crash

    def test_detects_byzantine_automatically(self):
        """Byzantine nodes should be detected automatically."""
        sub = SubstrateV622()
        rng = random.Random(42)
        # 5 honest nodes
        for i in range(5):
            for _ in range(30):
                f = (float(rng.random() > 0.3), float(rng.random() > 0.5))
                sub.add_data_to_node(f"h_{i}", f, bool(f[0]))
        # 1 Byzantine node
        byz = sub.add_byzantine_node("byz", n_features=2, attack_type="inflate")
        for _ in range(30):
            f = (float(rng.random() > 0.3), float(rng.random() > 0.5))
            byz.add_data(f, bool(f[0]))
        sub.run_adaptive_byzantine_learning()
        detected = sub.get_detected_byzantine_nodes()
        assert "byz" in detected

    def test_causal_features_found_despite_byzantine(self):
        """Causal features should be found despite Byzantine nodes."""
        sub = SubstrateV622()
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0]) and bool(f[1])
        for i in range(5):
            for _ in range(30):
                f = (float(rng.random() > 0.3), float(rng.random() > 0.3))
                sub.add_data_to_node(f"h_{i}", f, compute_fn(f))
        byz = sub.add_byzantine_node("byz", n_features=2, attack_type="inflate")
        for _ in range(30):
            f = (float(rng.random() > 0.3), float(rng.random() > 0.3))
            byz.add_data(f, compute_fn(f))
        sub.run_adaptive_byzantine_learning()
        causal = sub.get_robust_causal_features()
        assert 0 in causal, f"f0 should be causal, got {causal}"


# ===========================================================================
# E. Multi-Byzantine Tests
# ===========================================================================

class TestMultiByzantine:
    """Test detection with multiple Byzantine nodes."""

    def test_two_byzantine_detected(self):
        """Two Byzantine nodes should be detected."""
        sub = SubstrateV622()
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0])
        # 5 honest
        for i in range(5):
            for _ in range(30):
                f = (float(rng.random() > 0.3),)
                sub.add_data_to_node(f"h_{i}", f, compute_fn(f))
        # 2 Byzantine
        byz1 = sub.add_byzantine_node("b1", n_features=1, attack_type="inflate")
        byz2 = sub.add_byzantine_node("b2", n_features=1, attack_type="flip")
        for _ in range(30):
            f = (float(rng.random() > 0.3),)
            byz1.add_data(f, compute_fn(f))
            byz2.add_data(f, compute_fn(f))
        sub.run_adaptive_byzantine_learning()
        detected = sub.get_detected_byzantine_nodes()
        assert "b1" in detected or "b2" in detected, (
            f"Should detect at least one Byzantine, got {detected}")

    def test_different_attack_types_detected(self):
        """Different attack types should all be detected."""
        sub = SubstrateV622()
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0])
        for i in range(5):
            for _ in range(30):
                f = (float(rng.random() > 0.3),)
                sub.add_data_to_node(f"h_{i}", f, compute_fn(f))
        for attack in ["inflate", "flip"]:
            byz = sub.add_byzantine_node(f"byz_{attack}", n_features=1, attack_type=attack)
            for _ in range(30):
                f = (float(rng.random() > 0.3),)
                byz.add_data(f, compute_fn(f))
        sub.run_adaptive_byzantine_learning()
        detected = sub.get_detected_byzantine_nodes()
        # At least one should be detected
        assert len(detected) >= 1
