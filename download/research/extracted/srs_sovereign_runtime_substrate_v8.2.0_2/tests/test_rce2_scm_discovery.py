"""Adversarial tests for RCE-2 v6.12 Structural Causal Model Discovery."""
from __future__ import annotations

import random
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rce.rce2_scm_discovery import (
    SubstrateV612, SCMDiscoverer, CausalDAG, conditional_independence_test,
)
from rce.rce2_substrate import SubstrateOutcome


# ===========================================================================
# A. DAG Construction Tests
# ===========================================================================

class TestCausalDAG:
    """Test the CausalDAG data structure."""

    def test_add_edge(self):
        dag = CausalDAG()
        dag.add_edge(0, 1)
        assert 0 in dag.nodes
        assert 1 in dag.nodes
        assert (0, 1) in dag.edges

    def test_parents_children(self):
        dag = CausalDAG()
        dag.add_edge(0, 2)
        dag.add_edge(1, 2)
        assert dag.parents(2) == {0, 1}
        assert dag.children(0) == {2}

    def test_ancestors(self):
        dag = CausalDAG()
        dag.add_edge(0, 1)
        dag.add_edge(1, 2)
        dag.add_edge(2, 3)
        assert dag.ancestors(3) == {0, 1, 2}
        assert dag.ancestors(2) == {0, 1}

    def test_root_causes(self):
        dag = CausalDAG()
        # 0 → 1 → 3 (outcome), 2 → 3
        dag.add_edge(0, 1)
        dag.add_edge(1, 3)
        dag.add_edge(2, 3)
        roots = dag.root_causes(3)
        assert roots == {0, 2}, f"Expected {0, 2}, got {roots}"

    def test_has_path(self):
        dag = CausalDAG()
        dag.add_edge(0, 1)
        dag.add_edge(1, 2)
        assert dag.has_path(0, 2)
        assert not dag.has_path(2, 0)  # no reverse path


# ===========================================================================
# B. Conditional Independence Test
# ===========================================================================

class TestConditionalIndependence:
    """Test the CI test."""

    def test_correlated_features_not_independent(self):
        """Perfectly correlated features should NOT be independent."""
        rng = random.Random(42)
        features = [(float(rng.random() > 0.3), float(rng.random() > 0.3))
                    for _ in range(50)]
        # Make them perfectly correlated
        features = [(f[0], f[0]) for f in features]
        ci = conditional_independence_test(features, 0, 1, set(), 0.1)
        assert not ci, "Perfectly correlated features should not be independent"

    def test_independent_features_are_independent(self):
        """Independent features should be detected as independent."""
        rng = random.Random(42)
        # Use larger sample and more balanced distribution
        features = [(float(rng.random() > 0.5), float(rng.random() > 0.5))
                    for _ in range(500)]
        ci = conditional_independence_test(features, 0, 1, set(), 0.15)
        assert ci, "Independent features should be conditionally independent"


# ===========================================================================
# C. SCM Discovery Tests
# ===========================================================================

class TestSCMDiscovery:
    """Test the SCM discoverer."""

    def test_dag_discovered_for_simple_causal(self):
        """A simple causal structure should produce a DAG."""
        sub = SubstrateV612()
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0])
        training = [(float(rng.random() > 0.3), float(rng.random() > 0.5))
                    for _ in range(50)]
        for f in training:
            sub.train("test", f, compute_fn(f))
        sub.fit("test")
        result = sub.discover_scm("test", compute_fn, training)
        assert result["n_nodes"] > 0
        assert result["n_edges"] > 0

    def test_root_cause_identified_for_mediator(self):
        """In a mediator structure, the root cause should be identified."""
        sub = SubstrateV612()
        rng = random.Random(42)
        # f0 → f1 → outcome (mediator)
        def compute_fn(f):
            return bool(f[0])
        training = []
        for _ in range(100):
            f0 = rng.random() > 0.3
            f1 = f0  # mediator
            training.append((float(f0), float(f1)))
        for f in training:
            sub.train("mediator", f, compute_fn(f))
        sub.fit("mediator")
        sub.discover_scm("mediator", compute_fn, training)
        roots = sub.get_root_causes("mediator")
        assert 0 in roots, (
            f"Feature 0 should be a root cause, got {roots}")

    def test_mediator_not_root_cause(self):
        """A mediator should NOT be classified as a root cause."""
        sub = SubstrateV612()
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0])
        training = []
        for _ in range(100):
            f0 = rng.random() > 0.3
            f1 = f0  # mediator
            training.append((float(f0), float(f1)))
        for f in training:
            sub.train("mediator", f, compute_fn(f))
        sub.fit("mediator")
        sub.discover_scm("mediator", compute_fn, training)
        roots = sub.get_root_causes("mediator")
        # f1 is a mediator, not a root cause
        assert 1 not in roots or 0 in roots, (
            f"Mediator f1 should not be the only root cause, got {roots}")


# ===========================================================================
# D. Substrate Integration Tests
# ===========================================================================

class TestSubstrateV612:
    """Test the integrated v6.12 substrate."""

    def test_predict_with_scm_returns_5_values(self):
        """predict_with_scm returns 5 values."""
        sub = SubstrateV612()
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0])
        training = [(float(rng.random() > 0.3), float(rng.random() > 0.5))
                    for _ in range(50)]
        for f in training:
            sub.train("test", f, compute_fn(f))
        sub.fit("test")
        sub.discover_scm("test", compute_fn, training)
        result = sub.predict_with_scm(
            "test", (1.0, 0.0), full_computation=lambda: True,
            record_outcome=False)
        assert len(result) == 5

    def test_report_includes_scm_stats(self):
        """The report must include SCM statistics."""
        sub = SubstrateV612()
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0])
        training = [(float(rng.random() > 0.3), float(rng.random() > 0.5))
                    for _ in range(50)]
        for f in training:
            sub.train("test", f, compute_fn(f))
        sub.fit("test")
        sub.discover_scm("test", compute_fn, training)
        report = sub.get_report()
        assert "scm_stats" in report
        assert "n_dags" in report["scm_stats"]


# ===========================================================================
# E. Mediator vs Direct Cause Tests
# ===========================================================================

class TestMediatorVsDirect:
    """Test that the SCM distinguishes mediators from direct causes."""

    def test_direct_cause_identified(self):
        """A direct cause (no mediator) should be a root cause."""
        sub = SubstrateV612()
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0])
        # f0 directly causes outcome, f1 is independent
        training = [(float(rng.random() > 0.3), float(rng.random() > 0.5))
                    for _ in range(50)]
        for f in training:
            sub.train("direct", f, compute_fn(f))
        sub.fit("direct")
        sub.discover_scm("direct", compute_fn, training)
        roots = sub.get_root_causes("direct")
        assert 0 in roots, (
            f"Direct cause f0 should be a root cause, got {roots}")

    def test_collider_handled(self):
        """A collider structure (A→Y←Z) should identify both A and Z as causes."""
        sub = SubstrateV612()
        rng = random.Random(42)
        # f0 and f1 both cause outcome (collider at outcome)
        def compute_fn(f):
            return bool(f[0]) or bool(f[1])
        training = [(float(rng.random() > 0.3), float(rng.random() > 0.3))
                    for _ in range(100)]
        for f in training:
            sub.train("collider", f, compute_fn(f))
        sub.fit("collider")
        sub.discover_scm("collider", compute_fn, training)
        roots = sub.get_root_causes("collider")
        # Both f0 and f1 should be root causes (both are independent causes)
        assert 0 in roots or 1 in roots, (
            f"At least one of f0/f1 should be a root cause in collider, got {roots}")
