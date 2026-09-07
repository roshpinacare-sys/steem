"""Adversarial tests for RCE-2 v6.21 Byzantine-Robust Federated Learning."""
from __future__ import annotations

import random
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rce.rce2_byzantine_robust import (
    SubstrateV621, ByzantineRobustAggregator, ByzantineNode,
    RobustAggregationResult,
)
from rce.rce2_differential_privacy import DPFederatedNode


# ===========================================================================
# A. Robust Aggregator Tests
# ===========================================================================

class TestByzantineRobustAggregator:
    """Test the robust aggregation methods."""

    def test_trimmed_mean_filters_outliers(self):
        """Trimmed mean should filter extreme outliers."""
        agg = ByzantineRobustAggregator(method="trimmed_mean", trim_fraction=0.2)
        estimates = [
            ("A", 0.5, 0.1, 100),  # honest
            ("B", 0.6, 0.1, 100),  # honest
            ("C", 0.55, 0.1, 100), # honest
            ("D", 0.52, 0.1, 100), # honest
            ("E", 0.58, 0.1, 100), # honest
            ("F", 10.0, 0.1, 100), # Byzantine (inflated)
        ]
        robust_ace, n_byz = agg.aggregate_trimmed_mean(estimates)
        # Trimmed mean should be close to honest values (~0.55), not 10.0
        assert 0.4 < robust_ace < 0.8, (
            f"Trimmed mean {robust_ace} should be close to honest values, not skewed by outlier")

    def test_median_of_means_robust(self):
        """Median-of-means should be robust to outliers."""
        agg = ByzantineRobustAggregator(method="median_of_means", n_groups=3)
        estimates = [
            ("A", 0.5, 0.1, 100),
            ("B", 0.6, 0.1, 100),
            ("C", 0.55, 0.1, 100),
            ("D", 0.52, 0.1, 100),
            ("E", 0.58, 0.1, 100),
            ("F", 10.0, 0.1, 100),  # Byzantine
        ]
        robust_ace, _ = agg.aggregate_median_of_means(estimates)
        assert 0.3 < robust_ace < 1.0, (
            f"Median-of-means {robust_ace} should be robust to outlier")

    def test_krum_selects_honest_node(self):
        """Krum should select an honest node's estimate."""
        agg = ByzantineRobustAggregator(method="krum", n_byzantine=1)
        estimates = [
            ("A", 0.5, 0.1, 100),
            ("B", 0.55, 0.1, 100),
            ("C", 0.52, 0.1, 100),
            ("D", 0.58, 0.1, 100),
            ("E", 0.51, 0.1, 100),
            ("F", 10.0, 0.1, 100),  # Byzantine
        ]
        robust_ace, _ = agg.aggregate_krum(estimates)
        # Krum should select one of the honest nodes (0.5-0.58)
        assert 0.4 < robust_ace < 0.7, (
            f"Krum selected {robust_ace}, should be close to honest values")

    def test_aggregate_returns_results(self):
        """aggregate should return results for all features."""
        agg = ByzantineRobustAggregator(method="trimmed_mean")
        feature_estimates = {
            0: [("A", 0.5, 0.1, 100), ("B", 0.6, 0.1, 100)],
            1: [("A", 0.1, 0.1, 100), ("B", 0.2, 0.1, 100)],
        }
        results = agg.aggregate(feature_estimates)
        assert len(results) == 2
        assert 0 in results
        assert 1 in results

    def test_get_robust_causal_features(self):
        """get_robust_causal_features should return causal indices."""
        agg = ByzantineRobustAggregator(method="trimmed_mean", ace_threshold=0.1)
        feature_estimates = {
            0: [("A", 0.5, 0.1, 100), ("B", 0.6, 0.1, 100)],  # causal
            1: [("A", 0.05, 0.1, 100), ("B", 0.02, 0.1, 100)],  # not causal
        }
        agg.aggregate(feature_estimates)
        causal = agg.get_robust_causal_features()
        assert 0 in causal
        assert 1 not in causal


# ===========================================================================
# B. Byzantine Node Tests
# ===========================================================================

class TestByzantineNode:
    """Test Byzantine (malicious) node behavior."""

    def test_inflate_attack(self):
        """Inflate attack should multiply ACE by 10."""
        node = ByzantineNode("byz", n_features=2, attack_type="inflate")
        rng = random.Random(42)
        for _ in range(30):
            f = (float(rng.random() > 0.3), float(rng.random() > 0.5))
            node.add_data(f, bool(f[0]))
        estimates = node.compute_dp_local_estimates()
        # The attacked ACE should be much larger than true ACE
        # (true ACE for f0 should be ~0.7, inflated should be ~7.0)
        assert estimates[0].ace_estimate > 1.0, (
            f"Inflated ACE {estimates[0].ace_estimate} should be > 1.0")

    def test_flip_attack(self):
        """Flip attack should negate the ACE."""
        node = ByzantineNode("byz", n_features=2, attack_type="flip")
        rng = random.Random(42)
        for _ in range(30):
            f = (float(rng.random() > 0.3), float(rng.random() > 0.5))
            node.add_data(f, bool(f[0]))
        estimates = node.compute_dp_local_estimates()
        # The flipped ACE should be negative (true ACE is positive for f0)
        assert estimates[0].ace_estimate < 0, (
            f"Flipped ACE {estimates[0].ace_estimate} should be negative")

    def test_byzantine_node_is_dpfederatednode(self):
        """ByzantineNode should be a subclass of DPFederatedNode."""
        node = ByzantineNode("byz", n_features=2)
        assert isinstance(node, DPFederatedNode)


# ===========================================================================
# C. Substrate Integration Tests
# ===========================================================================

class TestSubstrateV621:
    """Test the integrated v6.21 substrate."""

    def test_add_honest_node(self):
        """add_honest_node should create an honest node."""
        sub = SubstrateV621()
        node = sub.add_honest_node("honest", n_features=2)
        assert isinstance(node, DPFederatedNode)
        assert not isinstance(node, ByzantineNode)

    def test_add_byzantine_node(self):
        """add_byzantine_node should create a Byzantine node."""
        sub = SubstrateV621()
        node = sub.add_byzantine_node("byz", n_features=2, attack_type="inflate")
        assert isinstance(node, ByzantineNode)

    def test_run_byzantine_robust_learning(self):
        """run_byzantine_robust_learning should return stats."""
        sub = SubstrateV621()
        rng = random.Random(42)
        for _ in range(30):
            f = (float(rng.random() > 0.3),)
            sub.add_data_to_node("A", f, bool(f[0]))
        for _ in range(30):
            f = (float(rng.random() > 0.3),)
            sub.add_data_to_node("B", f, bool(f[0]))
        result = sub.run_byzantine_robust_learning()
        assert "aggregation_stats" in result
        assert "n_honest_nodes" in result
        assert "n_byzantine_nodes" in result

    def test_get_robust_causal_features(self):
        """get_robust_causal_features should return causal indices."""
        sub = SubstrateV621()
        rng = random.Random(42)
        for _ in range(50):
            f = (float(rng.random() > 0.3),)
            sub.add_data_to_node("A", f, bool(f[0]))
        for _ in range(50):
            f = (float(rng.random() > 0.3),)
            sub.add_data_to_node("B", f, bool(f[0]))
        sub.run_byzantine_robust_learning()
        causal = sub.get_robust_causal_features()
        assert 0 in causal

    def test_report_includes_node_info(self):
        """The report should include node information."""
        sub = SubstrateV621()
        sub.add_honest_node("A", n_features=2)
        sub.add_byzantine_node("B", n_features=2)
        report = sub.get_report()
        assert "nodes" in report
        assert report["nodes"]["A"]["type"] == "honest"
        assert report["nodes"]["B"]["type"] == "byzantine"


# ===========================================================================
# D. Byzantine Resilience Tests
# ===========================================================================

class TestByzantineResilience:
    """Test that the substrate survives Byzantine attacks."""

    def test_one_byzantine_node_survived(self):
        """One Byzantine node should not skew the aggregation."""
        sub = SubstrateV621(
            aggregation_method="trimmed_mean",
            n_byzantine=1,
            trim_fraction=0.2,
        )
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0])

        # 5 honest nodes
        for i in range(5):
            for _ in range(30):
                f = (float(rng.random() > 0.3), float(rng.random() > 0.5))
                sub.add_data_to_node(f"honest_{i}", f, compute_fn(f))

        # 1 Byzantine node (inflate)
        byz = sub.add_byzantine_node("byz", n_features=2, attack_type="inflate")
        for _ in range(30):
            f = (float(rng.random() > 0.3), float(rng.random() > 0.5))
            byz.add_data(f, compute_fn(f))

        sub.run_byzantine_robust_learning()
        causal = sub.get_robust_causal_features()
        # f0 should still be identified as causal despite the attack
        assert 0 in causal, (
            f"f0 should be causal despite Byzantine attack, got {causal}")

    def test_byzantine_ace_not_dominating(self):
        """Byzantine ACE should not dominate the aggregation."""
        sub = SubstrateV621(
            aggregation_method="trimmed_mean",
            trim_fraction=0.2,
        )
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0])

        # 5 honest nodes
        for i in range(5):
            for _ in range(30):
                f = (float(rng.random() > 0.3),)
                sub.add_data_to_node(f"h_{i}", f, compute_fn(f))

        # 1 Byzantine node (inflate to ACE=10)
        byz = sub.add_byzantine_node("byz", n_features=1, attack_type="inflate")
        for _ in range(30):
            f = (float(rng.random() > 0.3),)
            byz.add_data(f, compute_fn(f))

        sub.run_byzantine_robust_learning()
        # The robust ACE should be close to honest values (~0.7), not 10.0
        result = sub.aggregator.results.get(0)
        assert result is not None
        assert result.robust_ace < 2.0, (
            f"Robust ACE {result.robust_ace} should not be dominated by Byzantine (10.0)")

    def test_multiple_attack_types(self):
        """Different attack types should all be handled."""
        for attack in ["inflate", "deflate", "flip", "random"]:
            sub = SubstrateV621(aggregation_method="trimmed_mean")
            rng = random.Random(42)
            def compute_fn(f):
                return bool(f[0])
            for i in range(5):
                for _ in range(30):
                    f = (float(rng.random() > 0.3),)
                    sub.add_data_to_node(f"h_{i}", f, compute_fn(f))
            byz = sub.add_byzantine_node("byz", n_features=1, attack_type=attack)
            for _ in range(30):
                f = (float(rng.random() > 0.3),)
                byz.add_data(f, compute_fn(f))
            sub.run_byzantine_robust_learning()
            # Should not crash and should identify f0 as causal
            causal = sub.get_robust_causal_features()
            assert 0 in causal, (
                f"f0 should be causal despite {attack} attack, got {causal}")


# ===========================================================================
# E. Method Comparison Tests
# ===========================================================================

class TestMethodComparison:
    """Compare the three robust aggregation methods."""

    def test_all_methods_handle_byzantine(self):
        """All three methods should handle Byzantine nodes."""
        estimates = [
            ("A", 0.5, 0.1, 100),
            ("B", 0.55, 0.1, 100),
            ("C", 0.52, 0.1, 100),
            ("D", 0.58, 0.1, 100),
            ("E", 0.51, 0.1, 100),
            ("F", 10.0, 0.1, 100),  # Byzantine
        ]
        for method in ["trimmed_mean", "median_of_means", "krum"]:
            agg = ByzantineRobustAggregator(method=method, n_byzantine=1)
            if method == "trimmed_mean":
                robust, _ = agg.aggregate_trimmed_mean(estimates)
            elif method == "median_of_means":
                robust, _ = agg.aggregate_median_of_means(estimates)
            else:
                robust, _ = agg.aggregate_krum(estimates)
            assert 0.3 < robust < 1.0, (
                f"Method {method}: robust ACE {robust} should be close to honest values")

    def test_no_byzantine_all_methods_agree(self):
        """Without Byzantine nodes, all methods should give similar results."""
        estimates = [
            ("A", 0.5, 0.1, 100),
            ("B", 0.55, 0.1, 100),
            ("C", 0.52, 0.1, 100),
            ("D", 0.58, 0.1, 100),
            ("E", 0.51, 0.1, 100),
        ]
        results = {}
        for method in ["trimmed_mean", "median_of_means", "krum"]:
            agg = ByzantineRobustAggregator(method=method)
            if method == "trimmed_mean":
                results[method], _ = agg.aggregate_trimmed_mean(estimates)
            elif method == "median_of_means":
                results[method], _ = agg.aggregate_median_of_means(estimates)
            else:
                results[method], _ = agg.aggregate_krum(estimates)
        # All should be in a similar range
        values = list(results.values())
        assert max(values) - min(values) < 0.2, (
            f"Methods should agree without Byzantine: {results}")
