"""Adversarial tests for RCE-2 v6.19 Federated Causal Learning."""
from __future__ import annotations

import random
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rce.rce2_federated_causal import (
    SubstrateV619, FederatedCausalLearner, FederatedNode,
    LocalCausalEstimate, FederatedCausalEstimate,
)


# ===========================================================================
# A. Federated Node Tests
# ===========================================================================

class TestFederatedNode:
    """Test individual federated nodes."""

    def test_add_data_stores_locally(self):
        """add_data should store data locally."""
        node = FederatedNode("test", n_features=2)
        node.add_data((1.0, 0.0), True)
        assert len(node.local_data) == 1

    def test_compute_local_estimates_returns_estimates(self):
        """compute_local_estimates should return estimates."""
        node = FederatedNode("test", n_features=2)
        rng = random.Random(42)
        for _ in range(30):
            f = (float(rng.random() > 0.3), float(rng.random() > 0.5))
            node.add_data(f, bool(f[0]))
        estimates = node.compute_local_estimates()
        assert len(estimates) == 2
        assert all(isinstance(e, LocalCausalEstimate) for e in estimates)

    def test_local_estimates_do_not_contain_raw_data(self):
        """Local estimates should NOT contain raw data."""
        node = FederatedNode("test", n_features=2)
        node.add_data((1.0, 0.0), True)
        estimates = node.compute_local_estimates()
        for est in estimates:
            # Should only have aggregate statistics, no raw observations
            assert hasattr(est, "ace_estimate")
            assert hasattr(est, "variance")
            assert hasattr(est, "n_samples")
            assert not hasattr(est, "raw_features")  # no raw data
            assert not hasattr(est, "raw_outcomes")


# ===========================================================================
# B. Federated Aggregation Tests
# ===========================================================================

class TestFederatedAggregation:
    """Test the federated aggregation logic."""

    def test_aggregate_combines_estimates(self):
        """Aggregation should combine estimates from multiple nodes."""
        learner = FederatedCausalLearner(ace_threshold=0.1)
        # Node A: ACE=0.5, var=0.1
        learner.submit_estimates("A", [
            LocalCausalEstimate("A", 0, 0.5, 0.1, 100, 50, 50, True)
        ])
        # Node B: ACE=0.7, var=0.2
        learner.submit_estimates("B", [
            LocalCausalEstimate("B", 0, 0.7, 0.2, 100, 50, 50, True)
        ])
        result = learner.aggregate()
        est = result[0]
        # Inverse-variance weighted: w_A=10, w_B=5
        # ACE_fed = (10*0.5 + 5*0.7) / 15 = 8.5/15 ≈ 0.567
        assert 0.5 < est.federated_ace < 0.7
        assert est.n_nodes == 2

    def test_federated_ci_tighter_than_local(self):
        """Federated CI should be tighter than any local CI."""
        learner = FederatedCausalLearner(ace_threshold=0.1)
        learner.submit_estimates("A", [
            LocalCausalEstimate("A", 0, 0.5, 0.1, 100, 50, 50, True)
        ])
        learner.submit_estimates("B", [
            LocalCausalEstimate("B", 0, 0.5, 0.1, 100, 50, 50, True)
        ])
        result = learner.aggregate()
        est = result[0]
        # Local CI width = 2 * 1.96 * sqrt(0.1) ≈ 1.24
        # Federated CI width = 2 * 1.96 * sqrt(1/20) ≈ 0.88
        local_ci_width = 2 * 1.96 * math.sqrt(0.1)
        fed_ci_width = est.confidence_interval[1] - est.confidence_interval[0]
        assert fed_ci_width < local_ci_width

    def test_majority_vote_determines_causal(self):
        """Causal classification should use majority vote."""
        learner = FederatedCausalLearner(ace_threshold=0.1)
        # 2 nodes say causal, 1 says not
        learner.submit_estimates("A", [
            LocalCausalEstimate("A", 0, 0.5, 0.1, 100, 50, 50, True)
        ])
        learner.submit_estimates("B", [
            LocalCausalEstimate("B", 0, 0.6, 0.1, 100, 50, 50, True)
        ])
        learner.submit_estimates("C", [
            LocalCausalEstimate("C", 0, 0.05, 0.1, 100, 50, 50, False)
        ])
        result = learner.aggregate()
        est = result[0]
        # 2/3 nodes say causal -> weighted vote = 200/300 = 0.67 > 0.5
        assert est.vote_rate > 0.5
        assert est.is_causal

    def test_inverse_variance_weighting(self):
        """Higher-precision nodes should have more weight."""
        learner = FederatedCausalLearner(ace_threshold=0.1)
        # Node A: low variance (high precision) -> ACE=0.5
        learner.submit_estimates("A", [
            LocalCausalEstimate("A", 0, 0.5, 0.01, 1000, 500, 500, True)
        ])
        # Node B: high variance (low precision) -> ACE=0.9
        learner.submit_estimates("B", [
            LocalCausalEstimate("B", 0, 0.9, 1.0, 10, 5, 5, True)
        ])
        result = learner.aggregate()
        est = result[0]
        # w_A = 100, w_B = 1 -> ACE_fed ≈ (100*0.5 + 1*0.9) / 101 ≈ 0.504
        assert abs(est.federated_ace - 0.5) < 0.1


# ===========================================================================
# C. Substrate Integration Tests
# ===========================================================================

class TestSubstrateV619:
    """Test the integrated v6.19 substrate."""

    def test_add_node_creates_node(self):
        """add_node should create and register a node."""
        sub = SubstrateV619()
        node = sub.add_node("test", n_features=2)
        assert node.node_id == "test"
        assert "test" in sub.nodes

    def test_add_data_to_node_works(self):
        """add_data_to_node should add data to the specified node."""
        sub = SubstrateV619()
        sub.add_data_to_node("test", (1.0, 0.0), True)
        assert len(sub.nodes["test"].local_data) == 1

    def test_run_federated_learning_returns_stats(self):
        """run_federated_learning should return statistics."""
        sub = SubstrateV619()
        rng = random.Random(42)
        for _ in range(30):
            f = (float(rng.random() > 0.3), float(rng.random() > 0.5))
            sub.add_data_to_node("A", f, bool(f[0]))
        for _ in range(30):
            f = (float(rng.random() > 0.3), float(rng.random() > 0.5))
            sub.add_data_to_node("B", f, bool(f[0]))
        result = sub.run_federated_learning()
        assert "n_nodes" in result
        assert result["n_nodes"] == 2

    def test_get_federated_causal_features(self):
        """get_federated_causal_features should return causal feature indices."""
        sub = SubstrateV619()
        rng = random.Random(42)
        for _ in range(50):
            f = (float(rng.random() > 0.3), float(rng.random() > 0.5))
            sub.add_data_to_node("A", f, bool(f[0]))
        for _ in range(50):
            f = (float(rng.random() > 0.3), float(rng.random() > 0.5))
            sub.add_data_to_node("B", f, bool(f[0]))
        sub.run_federated_learning()
        causal = sub.get_federated_causal_features()
        assert 0 in causal, "f0 should be causal"

    def test_report_includes_federated_stats(self):
        """The report must include federated statistics."""
        sub = SubstrateV619()
        rng = random.Random(42)
        for _ in range(20):
            f = (float(rng.random() > 0.3),)
            sub.add_data_to_node("A", f, bool(f[0]))
        sub.run_federated_learning()
        report = sub.get_report()
        assert "federated_stats" in report
        assert "nodes" in report


# ===========================================================================
# D. Privacy Preservation Tests
# ===========================================================================

class TestPrivacyPreservation:
    """Test that raw data is never shared."""

    def test_node_estimates_contain_no_raw_data(self):
        """Node estimates should not contain raw observations."""
        node = FederatedNode("test", n_features=2)
        node.add_data((1.0, 0.0), True)
        node.add_data((0.0, 1.0), False)
        estimates = node.compute_local_estimates()
        for est in estimates:
            # Check that no raw data is in the estimate
            assert not hasattr(est, "features")
            assert not hasattr(est, "outcomes")
            assert not hasattr(est, "raw_data")
            # Only aggregate statistics
            assert hasattr(est, "ace_estimate")
            assert hasattr(est, "n_samples")

    def test_federated_learner_only_receives_aggregates(self):
        """The federated learner should only receive aggregate statistics."""
        learner = FederatedCausalLearner(ace_threshold=0.1)
        node = FederatedNode("test", n_features=2)
        node.add_data((1.0, 0.0), True)
        estimates = node.compute_local_estimates()
        learner.submit_estimates("test", estimates)
        # Verify the learner only has aggregate data
        for est in learner.node_estimates["test"]:
            assert isinstance(est, LocalCausalEstimate)
            assert not hasattr(est, "raw_features")


# ===========================================================================
# E. Multi-Node Scenario Tests
# ===========================================================================

class TestMultiNodeScenarios:
    """Test federated learning with multiple nodes."""

    def test_three_nodes_find_causal_features(self):
        """Three nodes should collaboratively find causal features."""
        sub = SubstrateV619()
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0]) and bool(f[1])
        for _ in range(50):
            f = (float(rng.random() > 0.3), float(rng.random() > 0.3))
            sub.add_data_to_node("A", f, compute_fn(f))
        for _ in range(50):
            f = (float(rng.random() > 0.5), float(rng.random() > 0.5))
            sub.add_data_to_node("B", f, compute_fn(f))
        for _ in range(50):
            f = (float(rng.random() > 0.4), float(rng.random() > 0.4))
            sub.add_data_to_node("C", f, compute_fn(f))
        sub.run_federated_learning()
        causal = sub.get_federated_causal_features()
        assert 0 in causal
        assert 1 in causal

    def test_federated_better_than_single_node(self):
        """Federated estimates should have tighter CIs than single-node."""
        sub = SubstrateV619()
        rng = random.Random(42)
        # 3 nodes with 30 observations each
        for node_id in ["A", "B", "C"]:
            for _ in range(30):
                f = (float(rng.random() > 0.3), float(rng.random() > 0.5))
                sub.add_data_to_node(node_id, f, bool(f[0]))
        sub.run_federated_learning()
        fed_est = sub.federated_learner.federated_estimates[0]
        # Single node (30 obs) would have wider CI
        single_node = sub.nodes["A"]
        single_estimates = single_node.compute_local_estimates()
        single_est = single_estimates[0]
        fed_ci_width = fed_est.confidence_interval[1] - fed_est.confidence_interval[0]
        single_ci_width = 2 * 1.96 * math.sqrt(single_est.variance)
        assert fed_ci_width < single_ci_width, (
            f"Federated CI ({fed_ci_width:.3f}) should be tighter than "
            f"single-node CI ({single_ci_width:.3f})")

    def test_heterogeneous_nodes(self):
        """Nodes with different data distributions should still aggregate."""
        sub = SubstrateV619()
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0])
        # Node A: f0 mostly 1 (but some 0s for variation)
        for _ in range(50):
            f0 = 1.0 if rng.random() < 0.8 else 0.0
            f = (f0, float(rng.random() > 0.5))
            sub.add_data_to_node("A", f, compute_fn(f))
        # Node B: f0 mostly 0 (but some 1s for variation)
        for _ in range(50):
            f0 = 0.0 if rng.random() < 0.8 else 1.0
            f = (f0, float(rng.random() > 0.5))
            sub.add_data_to_node("B", f, compute_fn(f))
        sub.run_federated_learning()
        causal = sub.get_federated_causal_features()
        # f0 should still be identified as causal despite heterogeneity
        assert 0 in causal, (
            f"f0 should be causal, got {causal}")


# Need math for CI width comparison
import math
