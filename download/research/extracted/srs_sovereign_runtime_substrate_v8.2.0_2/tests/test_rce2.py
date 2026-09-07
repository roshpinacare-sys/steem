"""Tests for RCE-2 — Reality Computation Engine v2: Computational World Model."""
from __future__ import annotations

import time
import random
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ===========================================================================
# State Universe
# ===========================================================================

def test_state_universe_add_and_query():
    from rce.rce2 import StateUniverse, ComputationState
    universe = StateUniverse()
    s1 = ComputationState("s1", "seg", (1.0, 0.0, 1.0), True)
    s2 = ComputationState("s2", "seg", (0.0, 1.0, 0.0), False)
    universe.add_state(s1)
    universe.add_state(s2)
    assert len(universe.states["seg"]) == 2

def test_state_universe_consensus():
    from rce.rce2 import StateUniverse, ComputationState
    universe = StateUniverse()
    for i in range(10):
        universe.add_state(ComputationState(
            f"s{i}", "test", (1.0, 1.0), True))
    result = universe.query_consensus("test", (1.0, 1.0), k=5)
    assert result is not None
    assert result[0] == True
    assert result[1] > 0.9

def test_state_universe_consensus_insufficient_data():
    from rce.rce2 import StateUniverse
    universe = StateUniverse()
    assert universe.query_consensus("test", (1.0,), k=5) is None

def test_state_universe_invariant_registration():
    from rce.rce2 import StateUniverse
    universe = StateUniverse()
    universe.register_invariant("seg", (0,), (0.0,), False)
    result = universe.query_invariants("seg", (0.0, 1.0, 1.0))
    assert result == False

def test_state_universe_law_registration():
    from rce.rce2 import StateUniverse
    universe = StateUniverse()
    universe.discover_law("seg", (0, 1), (1.0, 1.0), 0.1, True, 0.95)
    law = universe.query_laws("seg", (1.05, 0.95, 0.5))
    assert law is not None
    assert law.predicted_outcome == True


# ===========================================================================
# Compression Discovery
# ===========================================================================

def test_discover_invariants_finds_pattern():
    from rce.rce2 import StateUniverse, ComputationState, CompressionDiscovery
    universe = StateUniverse()
    # When feature[0] = 0.0, outcome is always False
    for _ in range(10):
        universe.add_state(ComputationState(
            "s", "test", (0.0, random.random(), random.random()), False))
    for _ in range(10):
        universe.add_state(ComputationState(
            "s", "test", (1.0, random.random(), random.random()), True))
    discovery = CompressionDiscovery(universe)
    invariants = discovery.discover_invariants("test", min_confidence=0.5)
    assert len(invariants) > 0
    # Feature 0 should be an invariant
    found_feat0 = any(0 in inv[0] for inv in invariants)
    assert found_feat0

def test_compression_score():
    from rce.rce2 import StateUniverse, ComputationState, CompressionDiscovery
    universe = StateUniverse()
    for _ in range(20):
        f0 = random.choice([0.0, 1.0])
        universe.add_state(ComputationState(
            "s", "test", (f0, random.random(), random.random(), random.random()),
            f0 == 1.0))
    discovery = CompressionDiscovery(universe)
    score = discovery.compression_score("test")
    # If feature 0 determines outcome, 3 out of 4 features are irrelevant
    assert score > 0.5

def test_discover_decision_regions():
    from rce.rce2 import StateUniverse, ComputationState, CompressionDiscovery
    universe = StateUniverse()
    # Two clusters: (0,0) → False, (1,1) → True
    for _ in range(10):
        universe.add_state(ComputationState("s", "test", (0.1, 0.1), False))
    for _ in range(10):
        universe.add_state(ComputationState("s", "test", (0.9, 0.9), True))
    discovery = CompressionDiscovery(universe)
    laws = discovery.discover_decision_regions("test", min_samples=5, radius=0.3)
    assert len(laws) >= 1


# ===========================================================================
# Reality Simulator
# ===========================================================================

def test_simulator_escalates_with_no_data():
    from rce.rce2 import StateUniverse, CompressionDiscovery, RealitySimulator, RCE2Outcome
    universe = StateUniverse()
    discovery = CompressionDiscovery(universe)
    sim = RealitySimulator(universe, discovery, min_states_for_prediction=100)
    result, outcome, conf, cost = sim.predict("test", (1.0,), lambda: 42, 1000.0)
    assert outcome == RCE2Outcome.ESCALATED
    assert result == 42

def test_simulator_predicts_with_invariant():
    from rce.rce2 import StateUniverse, CompressionDiscovery, RealitySimulator, RCE2Outcome
    universe = StateUniverse()
    universe.register_invariant("test", (0,), (0.0,), False)
    discovery = CompressionDiscovery(universe)
    sim = RealitySimulator(universe, discovery)
    result, outcome, conf, cost = sim.predict("test", (0.0, 1.0), lambda: "wrong", 1000.0)
    assert outcome == RCE2Outcome.INVARIANT
    assert result == False
    assert conf == 1.0

def test_simulator_predicts_with_consensus():
    from rce.rce2 import StateUniverse, ComputationState, CompressionDiscovery, RealitySimulator, RCE2Outcome
    universe = StateUniverse()
    for _ in range(20):
        universe.add_state(ComputationState("s", "test", (1.0, 1.0), True))
    discovery = CompressionDiscovery(universe)
    sim = RealitySimulator(universe, discovery, min_confidence=0.8, min_states_for_prediction=5)
    result, outcome, conf, cost = sim.predict("test", (1.0, 1.0), lambda: False, 1000.0)
    assert outcome == RCE2Outcome.CONSENSUS
    assert result == True
    assert conf > 0.8

def test_simulator_learns_from_escalation():
    from rce.rce2 import StateUniverse, CompressionDiscovery, RealitySimulator, RCE2Outcome
    universe = StateUniverse()
    discovery = CompressionDiscovery(universe)
    sim = RealitySimulator(universe, discovery, min_states_for_prediction=5)
    # First 5 calls: escalate and learn
    for i in range(5):
        sim.predict("test", (float(i),), lambda: i, 1000.0)
    assert len(universe.states["test"]) == 5
    assert sim.stats.escalations == 5

def test_simulator_stats():
    from rce.rce2 import StateUniverse, CompressionDiscovery, RealitySimulator, RCE2Outcome
    universe = StateUniverse()
    discovery = CompressionDiscovery(universe)
    sim = RealitySimulator(universe, discovery, min_states_for_prediction=5)
    sim.predict("test", (1.0,), lambda: 42, 1000.0)  # escalate
    stats = sim.get_stats()
    assert stats["total_evaluations"] == 1
    assert stats["escalations"] == 1

def test_simulator_verify_prediction():
    from rce.rce2 import StateUniverse, CompressionDiscovery, RealitySimulator
    universe = StateUniverse()
    discovery = CompressionDiscovery(universe)
    sim = RealitySimulator(universe, discovery)
    assert sim.verify_prediction("test", (1.0,), True, True) == True
    assert sim.verify_prediction("test", (1.0,), True, False) == False
    assert sim.stats.law_correct == 1
    assert sim.stats.law_incorrect == 1


# ===========================================================================
# Feature Extractors
# ===========================================================================

def test_extract_seg_features():
    from rce.rce2 import extract_seg_features
    class MockMut:
        def __init__(self):
            self.evidence_chain = {"admissible": True, "seq": 1, "sqa_certificate_ref": "ref", "z3_witness_hash": "h"}
            self.z3_witness_hash = "h"
            self.risk_class = "medium"
            self.seq = 1
    features = extract_seg_features(MockMut())
    assert len(features) == 6
    assert features[0] == 1.0  # admissible
    assert features[1] == 1.0  # seq matches
    assert features[2] == 1.0  # has ref
    assert features[3] == 1.0  # has hash
    assert features[4] == 1.0  # hash nonempty
    assert features[5] == 1.0  # medium risk

def test_extract_policy_features():
    from rce.rce2 import extract_policy_features
    ctx = {"request_tenant": "acme", "resource_tenant": "acme",
           "risk_class": "low", "action": "mutation:submit", "mutations_last_minute": 10}
    features = extract_policy_features(ctx)
    assert len(features) == 4
    assert features[0] == 1.0  # same tenant
    assert features[1] == 0.0  # low risk
    assert features[2] == 0.0  # not delete
    assert features[3] == 0.0  # not rate exceeded


# ===========================================================================
# End-to-End: Learning + Prediction
# ===========================================================================

def test_e2e_seg_world_model():
    """End-to-end: learn SEG outcomes, predict without executing."""
    from rce.rce2 import StateUniverse, ComputationState, CompressionDiscovery, RealitySimulator, RCE2Outcome
    universe = StateUniverse()
    discovery = CompressionDiscovery(universe)
    sim = RealitySimulator(universe, discovery, min_confidence=0.9, min_states_for_prediction=10)

    random.seed(42)

    # Train: 30 examples
    def seg(a, s, r, h):
        if not a: return False
        if not s: return False
        if not r: return False
        if not h: return False
        return True

    for _ in range(30):
        a, s, r, h = [random.random() > 0.2 for _ in range(4)]
        features = (float(a), float(s), float(r), float(h))
        result = seg(a, s, r, h)
        universe.add_state(ComputationState("s", "seg", features, result))

    # Test: 20 new examples
    correct = 0
    eliminated = 0
    for _ in range(20):
        a, s, r, h = [random.random() > 0.2 for _ in range(4)]
        features = (float(a), float(s), float(r), float(h))
        predicted, outcome, conf, cost = sim.predict("seg", features, lambda: seg(a,s,r,h), 1000.0)
        actual = seg(a, s, r, h)
        if predicted == actual: correct += 1
        if outcome != RCE2Outcome.ESCALATED: eliminated += 1

    # Should eliminate significant computation
    assert eliminated > 5  # at least 25% eliminated
    assert correct >= 18   # at least 90% accuracy

def test_benchmark_rce2():
    from rce.rce2 import benchmark_rce2
    results = benchmark_rce2()
    assert results["computation_eliminated_pct"] > 50.0
    assert results["accuracy_pct"] > 90.0
    assert results["rce2_cost_us"] < results["direct_cost_us"]
