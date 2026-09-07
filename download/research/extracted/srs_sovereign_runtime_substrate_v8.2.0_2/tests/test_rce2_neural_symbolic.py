"""Adversarial tests for RCE-2 v6.18 Neural-Symbolic Integration."""
from __future__ import annotations

import random
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rce.rce2_neural_symbolic import (
    SubstrateV618, NeuralFeatureExtractor, NeuralSymbolicBridge,
    NeuralSymbolicConfig,
)


# ===========================================================================
# A. Neural Feature Extractor Tests
# ===========================================================================

class TestNeuralFeatureExtractor:
    """Test the neural feature extractor."""

    def test_extract_returns_correct_dim(self):
        """extract should return a vector of the correct dimension."""
        ext = NeuralFeatureExtractor(input_dim=4, hidden_dim=8, output_dim=3)
        features = ext.extract((1.0, 0.0, 1.0, 0.0))
        assert len(features) == 3

    def test_extract_binary_returns_binary(self):
        """extract_binary should return 0.0 or 1.0 values."""
        ext = NeuralFeatureExtractor(input_dim=4, hidden_dim=8, output_dim=3)
        features = ext.extract_binary((1.0, 0.0, 1.0, 0.0))
        assert all(v in [0.0, 1.0] for v in features)

    def test_train_step_reduces_loss(self):
        """Training should reduce loss over time."""
        ext = NeuralFeatureExtractor(input_dim=4, hidden_dim=8, output_dim=2,
                                      learning_rate=0.1)
        rng = random.Random(42)
        # Generate data
        data = [((float(rng.random() > 0.5), float(rng.random() > 0.5),
                  float(rng.random() > 0.5), float(rng.random() > 0.5)),
                 float(rng.random() > 0.5)) for _ in range(50)]
        # Train and check loss decreases
        losses = ext.train([d[0] for d in data], [d[1] for d in data], n_epochs=5)
        assert losses[-1] <= losses[0] + 0.01, (
            f"Loss should not increase: {losses[0]} -> {losses[-1]}")

    def test_get_feature_names(self):
        """Feature names should be returned."""
        ext = NeuralFeatureExtractor(input_dim=4, output_dim=5)
        names = ext.get_feature_names()
        assert len(names) == 5
        assert all("neural_feature" in n for n in names)


# ===========================================================================
# B. Neural-Symbolic Bridge Tests
# ===========================================================================

class TestNeuralSymbolicBridge:
    """Test the neural-symbolic bridge."""

    def test_train_extractor_returns_losses(self):
        """train_extractor should return a list of losses."""
        config = NeuralSymbolicConfig(input_dim=8, hidden_dim=8, output_dim=4,
                                       n_epochs=3)
        bridge = NeuralSymbolicBridge(config)
        rng = random.Random(42)
        raw_inputs = [tuple(rng.random() for _ in range(8)) for _ in range(30)]
        outcomes = [bool(rng.random() > 0.5) for _ in range(30)]
        losses = bridge.train_extractor(raw_inputs, outcomes)
        assert len(losses) == 3

    def test_extract_features_correct_dim(self):
        """extract_features should return the correct dimension."""
        config = NeuralSymbolicConfig(input_dim=8, hidden_dim=8, output_dim=4,
                                       n_epochs=1)
        bridge = NeuralSymbolicBridge(config)
        rng = random.Random(42)
        raw_inputs = [tuple(random.Random(i).random() for _ in range(8)) for i in range(10)]
        outcomes = [True] * 10
        bridge.train_extractor(raw_inputs, outcomes)
        features = bridge.extract_features(tuple(random.random() for _ in range(8)))
        assert len(features) == 4

    def test_train_symbolic_works(self):
        """train_symbolic should train the symbolic substrate."""
        config = NeuralSymbolicConfig(input_dim=8, hidden_dim=8, output_dim=4,
                                       n_epochs=2)
        bridge = NeuralSymbolicBridge(config)
        rng = random.Random(42)
        raw_inputs = [tuple(rng.random() for _ in range(8)) for _ in range(30)]
        outcomes = [bool(rng.random() > 0.5) for _ in range(30)]
        bridge.train_extractor(raw_inputs, outcomes)
        bridge.train_symbolic("test", raw_inputs, outcomes)
        # Symbolic substrate should have states
        assert len(bridge.symbolic_substrate.v616.v615.online_refiners) > 0


# ===========================================================================
# C. Substrate Integration Tests
# ===========================================================================

class TestSubstrateV618:
    """Test the integrated v6.18 substrate."""

    def test_train_returns_losses(self):
        """train should return a list of losses."""
        sub = SubstrateV618(input_dim=8, hidden_dim=8, output_dim=4, n_epochs=3)
        rng = random.Random(42)
        raw_inputs = [tuple(rng.random() for _ in range(8)) for _ in range(30)]
        outcomes = [bool(rng.random() > 0.5) for _ in range(30)]
        losses = sub.train("test", raw_inputs, outcomes)
        assert len(losses) == 3

    def test_predict_returns_3_values(self):
        """predict should return (predicted, confidence, cost)."""
        sub = SubstrateV618(input_dim=8, hidden_dim=8, output_dim=4, n_epochs=2)
        rng = random.Random(42)
        raw_inputs = [tuple(rng.random() for _ in range(8)) for _ in range(30)]
        outcomes = [bool(rng.random() > 0.5) for _ in range(30)]
        sub.train("test", raw_inputs, outcomes)
        sub.fit("test")
        result = sub.predict("test", tuple(rng.random() for _ in range(8)),
                              full_computation=lambda: True)
        assert len(result) == 3

    def test_get_causal_features(self):
        """get_causal_features should return a list of indices."""
        sub = SubstrateV618(input_dim=8, hidden_dim=8, output_dim=4, n_epochs=2)
        rng = random.Random(42)
        raw_inputs = [tuple(rng.random() for _ in range(8)) for _ in range(50)]
        outcomes = [sum(r[:4]) > 2.0 for r in raw_inputs]
        sub.train("test", raw_inputs, outcomes)
        sub.fit("test")
        causal = sub.get_causal_features("test")
        assert isinstance(causal, list)

    def test_get_feature_names(self):
        """get_feature_names should return names."""
        sub = SubstrateV618(input_dim=8, hidden_dim=8, output_dim=4)
        names = sub.get_feature_names()
        assert len(names) == 4

    def test_extract_features(self):
        """extract_features should return binary features."""
        sub = SubstrateV618(input_dim=8, hidden_dim=8, output_dim=4, n_epochs=1)
        rng = random.Random(42)
        raw_inputs = [tuple(rng.random() for _ in range(8)) for _ in range(10)]
        outcomes = [True] * 10
        sub.train("test", raw_inputs, outcomes)
        features = sub.extract_features(tuple(rng.random() for _ in range(8)))
        assert all(v in [0.0, 1.0] for v in features)

    def test_report_includes_extractor_info(self):
        """The report must include extractor information."""
        sub = SubstrateV618(input_dim=8, hidden_dim=8, output_dim=4, n_epochs=1)
        rng = random.Random(42)
        raw_inputs = [tuple(rng.random() for _ in range(8)) for _ in range(10)]
        outcomes = [True] * 10
        sub.train("test", raw_inputs, outcomes)
        report = sub.get_report()
        assert "extractor_info" in report
        assert report["extractor_info"]["input_dim"] == 8


# ===========================================================================
# D. End-to-End: Raw Input → Causal Prediction Tests
# ===========================================================================

class TestEndToEnd:
    """Test end-to-end raw input to causal prediction."""

    def test_raw_input_to_prediction(self):
        """Raw inputs should produce predictions."""
        sub = SubstrateV618(input_dim=16, hidden_dim=16, output_dim=8, n_epochs=3)
        rng = random.Random(42)
        # Generate data: outcome depends on first 4 dims
        raw_inputs = []
        outcomes = []
        for _ in range(80):
            raw = tuple(rng.random() for _ in range(16))
            outcome = sum(raw[:4]) > 2.0
            raw_inputs.append(raw)
            outcomes.append(outcome)
        sub.train("e2e", raw_inputs, outcomes)
        sub.fit("e2e")
        # Predict
        raw_test = tuple(rng.random() for _ in range(16))
        actual = sum(raw_test[:4]) > 2.0
        predicted, conf, cost = sub.predict(
            "e2e", raw_test, full_computation=lambda: actual)
        assert predicted is not None

    def test_high_dim_input_handled(self):
        """High-dimensional inputs should be handled."""
        sub = SubstrateV618(input_dim=64, hidden_dim=32, output_dim=8, n_epochs=2)
        rng = random.Random(42)
        raw_inputs = [tuple(rng.random() for _ in range(64)) for _ in range(50)]
        outcomes = [sum(r[:8]) > 4.0 for r in raw_inputs]
        sub.train("hd", raw_inputs, outcomes)
        sub.fit("hd")
        # Should not crash
        predicted, _, _ = sub.predict(
            "hd", tuple(rng.random() for _ in range(64)),
            full_computation=lambda: True)
        assert predicted is not None

    def test_causal_features_in_extracted_space(self):
        """Causal features should be in the extracted feature space."""
        sub = SubstrateV618(input_dim=16, hidden_dim=16, output_dim=6, n_epochs=3)
        rng = random.Random(42)
        raw_inputs = [tuple(rng.random() for _ in range(16)) for _ in range(80)]
        outcomes = [sum(r[:4]) > 2.0 for r in raw_inputs]
        sub.train("causal_test", raw_inputs, outcomes)
        sub.fit("causal_test")
        causal = sub.get_causal_features("causal_test")
        # Causal features should be indices in [0, output_dim)
        for idx in causal:
            assert 0 <= idx < 6, (
                f"Causal feature {idx} out of range [0, 6)")
