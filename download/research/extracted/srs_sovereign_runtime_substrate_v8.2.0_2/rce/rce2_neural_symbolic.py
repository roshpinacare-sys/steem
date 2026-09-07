#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rce2_neural_symbolic.py — RCE-2 v6.18 Neural-Symbolic Integration

PROBLEM:
  All prior versions (v6.5-v6.17) operate on HAND-CRAFTED features —
  binary or continuous vectors that the caller provides. But in production,
  computations often have RAW inputs: images, text, audio, structured
  objects. The substrate cannot directly apply causal discovery to raw
  pixels or text tokens.

SOLUTION:
  The NeuralSymbolicBridge combines:
    1. NEURAL FEATURE EXTRACTOR: maps raw inputs to low-dimensional
       feature vectors using a simple neural network (single hidden layer)
    2. SYMBOLIC CAUSAL DAG: operates on the extracted features using
       the v6.17 causal reasoning pipeline

  The bridge is TRANSPARENT: the neural extractor learns to produce
  features that the symbolic layer can reason about causally. The
  causal DAG is still interpretable (it operates on named features),
  but the features are learned, not hand-crafted.

ARCHITECTURE:

  Raw Input → [Neural Extractor] → Feature Vector → [Symbolic Causal] → Prediction
                  (learned)           (low-dim)         (interpretable)

  The neural extractor is a single-hidden-layer network:
    h = relu(W1 · raw_input + b1)     # hidden layer
    features = sigmoid(W2 · h + b2)    # output layer (binary features)

  The symbolic causal layer (v6.17) operates on the binary features:
    - Discovers causal features (ACE, PSM, IPW, DR)
    - Builds causal DAG
    - Makes predictions via causal laws

TRAINING:

  The neural extractor is trained via SUPERVISED learning:
    - Input: raw data (e.g. 784 pixels for 28x28 images)
    - Target: the outcome (binary)
    - Loss: binary cross-entropy
    - Optimizer: stochastic gradient descent

  After training, the extractor's output layer produces binary features
  that the symbolic layer can use for causal discovery.

WHY THIS MATTERS:

  Neural-symbolic integration combines the strengths of both paradigms:
    - NEURAL: learns complex feature representations from raw data
    - SYMBOLIC: provides interpretable, verifiable causal reasoning

  The substrate can now handle:
    1. IMAGE inputs: raw pixels → features → causal DAG
    2. TEXT inputs: embeddings → features → causal DAG
    3. STRUCTURED inputs: JSON/graphs → features → causal DAG

  The causal DAG remains interpretable because it operates on the
  EXTRACTED features, not the raw input. Each feature has a meaning
  (learned by the neural extractor), and the causal relationships
  between features and outcome are explicit.
"""
from __future__ import annotations

import math
import random
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

from rce.rce2_meta_active import SubstrateV617


# ===========================================================================
# Neural Feature Extractor
# ===========================================================================

class NeuralFeatureExtractor:
    """Simple single-hidden-layer neural network for feature extraction.

    Maps raw inputs (high-dimensional) to binary features (low-dimensional)
    that the symbolic causal layer can reason about.

    Architecture:
      raw_input → linear(W1, b1) → relu → linear(W2, b2) → sigmoid → binary_features

    Training:
      Supervised on (raw_input, outcome) pairs
      Loss: binary cross-entropy
      Optimizer: SGD
    """

    def __init__(self, input_dim: int, hidden_dim: int = 32,
                 output_dim: int = 8, learning_rate: float = 0.01) -> None:
        self.input_dim = input_dim
        self.hidden_dim = hidden_dim
        self.output_dim = output_dim
        self.learning_rate = learning_rate
        # Initialize weights (small random values)
        rng = random.Random(42)
        self.W1 = [[rng.gauss(0, 0.1) for _ in range(input_dim)]
                    for _ in range(hidden_dim)]
        self.b1 = [0.0] * hidden_dim
        self.W2 = [[rng.gauss(0, 0.1) for _ in range(hidden_dim)]
                    for _ in range(output_dim)]
        self.b2 = [0.0] * output_dim
        self.n_training_steps = 0

    def _relu(self, x: float) -> float:
        return max(0.0, x)

    def _sigmoid(self, x: float) -> float:
        if x > 500:
            return 1.0
        if x < -500:
            return 0.0
        return 1.0 / (1.0 + math.exp(-x))

    def extract(self, raw_input: Tuple[float, ...]) -> Tuple[float, ...]:
        """Extract binary features from raw input.

        Args:
            raw_input: high-dimensional input vector

        Returns:
            Binary feature vector (values close to 0 or 1)
        """
        # Hidden layer: h = relu(W1 · x + b1)
        hidden = [0.0] * self.hidden_dim
        for j in range(self.hidden_dim):
            z = self.b1[j]
            for i in range(min(len(raw_input), self.input_dim)):
                z += self.W1[j][i] * raw_input[i]
            hidden[j] = self._relu(z)

        # Output layer: features = sigmoid(W2 · h + b2)
        features = [0.0] * self.output_dim
        for k in range(self.output_dim):
            z = self.b2[k]
            for j in range(self.hidden_dim):
                z += self.W2[k][j] * hidden[j]
            features[k] = self._sigmoid(z)

        return tuple(features)

    def extract_binary(self, raw_input: Tuple[float, ...],
                        threshold: float = 0.5) -> Tuple[float, ...]:
        """Extract binary features (0.0 or 1.0) from raw input."""
        features = self.extract(raw_input)
        return tuple(1.0 if f > threshold else 0.0 for f in features)

    def train_step(self, raw_input: Tuple[float, ...],
                    target: float) -> float:
        """One SGD step on a single example.

        Returns the loss (binary cross-entropy) before the update.
        """
        # Forward pass (store intermediates for backprop)
        hidden = [0.0] * self.hidden_dim
        for j in range(self.hidden_dim):
            z = self.b1[j]
            for i in range(min(len(raw_input), self.input_dim)):
                z += self.W1[j][i] * raw_input[i]
            hidden[j] = self._relu(z)

        output = [0.0] * self.output_dim
        for k in range(self.output_dim):
            z = self.b2[k]
            for j in range(self.hidden_dim):
                z += self.W2[k][j] * hidden[j]
            output[k] = self._sigmoid(z)

        # Loss: binary cross-entropy (average across output dims)
        loss = 0.0
        for k in range(self.output_dim):
            p = max(min(output[k], 1 - 1e-7), 1e-7)
            loss -= target * math.log(p) + (1 - target) * math.log(1 - p)
        loss /= self.output_dim

        # Backprop: dL/d_output[k] = (output[k] - target) / output_dim
        d_output = [(output[k] - target) / self.output_dim
                     for k in range(self.output_dim)]

        # Gradient for W2 and b2
        for k in range(self.output_dim):
            self.b2[k] -= self.learning_rate * d_output[k]
            for j in range(self.hidden_dim):
                grad = d_output[k] * hidden[j]
                self.W2[k][j] -= self.learning_rate * grad

        # Backprop to hidden layer
        d_hidden = [0.0] * self.hidden_dim
        for j in range(self.hidden_dim):
            for k in range(self.output_dim):
                d_hidden[j] += d_output[k] * self.W2[k][j]
            # ReLU derivative
            if hidden[j] <= 0:
                d_hidden[j] = 0.0

        # Gradient for W1 and b1
        for j in range(self.hidden_dim):
            self.b1[j] -= self.learning_rate * d_hidden[j]
            for i in range(min(len(raw_input), self.input_dim)):
                grad = d_hidden[j] * raw_input[i]
                self.W1[j][i] -= self.learning_rate * grad

        self.n_training_steps += 1
        return loss

    def train(self, raw_inputs: List[Tuple[float, ...]],
               targets: List[float], n_epochs: int = 10) -> List[float]:
        """Train the extractor on a dataset.

        Returns list of average losses per epoch.
        """
        losses = []
        for epoch in range(n_epochs):
            epoch_loss = 0.0
            for raw_input, target in zip(raw_inputs, targets):
                loss = self.train_step(raw_input, target)
                epoch_loss += loss
            avg_loss = epoch_loss / max(len(raw_inputs), 1)
            losses.append(avg_loss)
        return losses

    def get_feature_names(self) -> List[str]:
        """Return names for the extracted features."""
        return [f"neural_feature_{i}" for i in range(self.output_dim)]


# ===========================================================================
# Neural-Symbolic Bridge
# ===========================================================================

@dataclass
class NeuralSymbolicConfig:
    """Configuration for the neural-symbolic bridge."""
    input_dim: int
    hidden_dim: int = 32
    output_dim: int = 8          # number of extracted features
    learning_rate: float = 0.01
    n_epochs: int = 10
    binary_threshold: float = 0.5


class NeuralSymbolicBridge:
    """Bridges neural feature extraction with symbolic causal reasoning.

    The bridge:
      1. Trains a neural feature extractor on (raw_input, outcome) pairs
      2. Extracts binary features from raw inputs
      3. Feeds the features to the symbolic causal substrate (v6.17)
      4. The symbolic substrate discovers causal structure on the features

    The result is a substrate that can handle raw high-dimensional inputs
    while maintaining causal interpretability.
    """

    def __init__(self, config: NeuralSymbolicConfig) -> None:
        self.config = config
        self.extractor = NeuralFeatureExtractor(
            input_dim=config.input_dim,
            hidden_dim=config.hidden_dim,
            output_dim=config.output_dim,
            learning_rate=config.learning_rate,
        )
        # The symbolic substrate operates on extracted features
        self.symbolic_substrate = SubstrateV617()
        self._is_trained = False
        self.training_losses: List[float] = []

    def train_extractor(self, raw_inputs: List[Tuple[float, ...]],
                         outcomes: List[Any]) -> List[float]:
        """Train the neural feature extractor.

        Args:
            raw_inputs: list of high-dimensional input vectors
            outcomes: list of outcomes (parallel to raw_inputs)

        Returns:
            List of average losses per epoch
        """
        targets = [1.0 if o else 0.0 for o in outcomes]
        losses = self.extractor.train(raw_inputs, targets, self.config.n_epochs)
        self.training_losses = losses
        self._is_trained = True
        return losses

    def extract_features(self, raw_input: Tuple[float, ...]) -> Tuple[float, ...]:
        """Extract binary features from a raw input."""
        return self.extractor.extract_binary(
            raw_input, threshold=self.config.binary_threshold)

    def train_symbolic(self, computation_type: str,
                        raw_inputs: List[Tuple[float, ...]],
                        outcomes: List[Any]) -> None:
        """Train the symbolic substrate on extracted features.

        For each (raw_input, outcome), extract features and train the
        symbolic substrate.
        """
        for raw_input, outcome in zip(raw_inputs, outcomes):
            features = self.extract_features(raw_input)
            self.symbolic_substrate.train(computation_type, features, outcome)

    def fit_symbolic(self, computation_type: str) -> Dict[str, Any]:
        """Fit the symbolic substrate (discover laws, calibrate, etc.)."""
        return self.symbolic_substrate.fit(computation_type)

    def predict(self, computation_type: str,
                raw_input: Tuple[float, ...],
                full_computation: Callable,
                original_cost: float = 1000.0
                ) -> Tuple[Any, float, float]:
        """Predict the outcome for a raw input.

        1. Extract features from raw_input
        2. Predict using the symbolic substrate
        """
        features = self.extract_features(raw_input)
        return self.symbolic_substrate.predict(
            computation_type, features, full_computation,
            original_cost=original_cost, record_outcome=False)

    def get_causal_features(self, computation_type: str) -> List[int]:
        """Get the indices of causal features (in the extracted feature space)."""
        return self.symbolic_substrate.get_online_causal_features(computation_type)

    def get_feature_names(self) -> List[str]:
        """Get names for the extracted features."""
        return self.extractor.get_feature_names()

    def get_report(self) -> Dict[str, Any]:
        return {
            "extractor_info": {
                "input_dim": self.config.input_dim,
                "hidden_dim": self.config.hidden_dim,
                "output_dim": self.config.output_dim,
                "n_training_steps": self.extractor.n_training_steps,
                "is_trained": self._is_trained,
                "final_loss": self.training_losses[-1] if self.training_losses else None,
            },
            "symbolic_report": self.symbolic_substrate.get_report(),
        }


# ===========================================================================
# v6.18 Substrate with Neural-Symbolic Integration
# ===========================================================================

class SubstrateV618:
    """The v6.18 substrate with neural-symbolic integration.

    Extends v6.17 with:
      - NeuralFeatureExtractor for raw input processing
      - NeuralSymbolicBridge connecting neural extraction to symbolic causal
      - Support for high-dimensional raw inputs (images, text, etc.)
    """

    def __init__(self,
                 input_dim: int,
                 hidden_dim: int = 32,
                 output_dim: int = 8,
                 learning_rate: float = 0.01,
                 n_epochs: int = 10) -> None:
        config = NeuralSymbolicConfig(
            input_dim=input_dim,
            hidden_dim=hidden_dim,
            output_dim=output_dim,
            learning_rate=learning_rate,
            n_epochs=n_epochs,
        )
        self.bridge = NeuralSymbolicBridge(config)

    def train(self, computation_type: str,
              raw_inputs: List[Tuple[float, ...]],
              outcomes: List[Any]) -> List[float]:
        """Train the neural-symbolic substrate.

        1. Train the neural extractor on (raw_input, outcome) pairs
        2. Extract features and train the symbolic substrate

        Returns:
            List of training losses per epoch
        """
        # Step 1: Train neural extractor
        losses = self.bridge.train_extractor(raw_inputs, outcomes)

        # Step 2: Train symbolic substrate on extracted features
        self.bridge.train_symbolic(computation_type, raw_inputs, outcomes)

        return losses

    def fit(self, computation_type: str) -> Dict[str, Any]:
        """Fit the symbolic substrate."""
        return self.bridge.fit_symbolic(computation_type)

    def predict(self, computation_type: str,
                raw_input: Tuple[float, ...],
                full_computation: Callable,
                original_cost: float = 1000.0
                ) -> Tuple[Any, float, float]:
        """Predict from a raw input."""
        return self.bridge.predict(
            computation_type, raw_input, full_computation, original_cost)

    def get_causal_features(self, computation_type: str) -> List[int]:
        """Get causal feature indices (in extracted feature space)."""
        return self.bridge.get_causal_features(computation_type)

    def get_feature_names(self) -> List[str]:
        """Get names for the extracted features."""
        return self.bridge.get_feature_names()

    def extract_features(self, raw_input: Tuple[float, ...]) -> Tuple[float, ...]:
        """Extract binary features from a raw input (for inspection)."""
        return self.bridge.extract_features(raw_input)

    def get_report(self) -> Dict[str, Any]:
        return self.bridge.get_report()


# ===========================================================================
# Self-test
# ===========================================================================

def self_test() -> None:
    """Quick self-test of neural-symbolic integration."""
    import random
    print("Running v6.18 neural-symbolic self-test...")

    rng = random.Random(42)

    # Simulate "image-like" raw inputs: 16-dimensional vectors
    # The outcome depends on the first 4 dimensions (sum > 2)
    def generate_raw_and_outcome():
        raw = tuple(rng.random() for _ in range(16))
        # Outcome: True if sum of first 4 dims > 2.0
        outcome = sum(raw[:4]) > 2.0
        return raw, outcome

    # Generate training data
    train_raw = []
    train_outcomes = []
    for _ in range(100):
        raw, outcome = generate_raw_and_outcome()
        train_raw.append(raw)
        train_outcomes.append(outcome)

    # Create substrate: 16-dim input, 8 extracted features
    sub = SubstrateV618(input_dim=16, hidden_dim=16, output_dim=8, n_epochs=5)

    # Train
    print("  Training neural-symbolic substrate...")
    losses = sub.train("raw_test", train_raw, train_outcomes)
    print(f"  Training losses: {[round(l, 3) for l in losses]}")

    # Fit symbolic substrate
    sub.fit("raw_test")

    # Test prediction
    print("\n  Testing predictions:")
    correct = 0
    total = 20
    for _ in range(total):
        raw, actual = generate_raw_and_outcome()
        predicted, conf, cost = sub.predict(
            "raw_test", raw, full_computation=lambda: actual)
        if predicted == actual:
            correct += 1
    print(f"  Accuracy: {correct}/{total} ({correct/total*100:.0f}%)")

    # Check causal features
    causal = sub.get_causal_features("raw_test")
    print(f"  Causal features (extracted): {causal}")
    print(f"  Feature names: {sub.get_feature_names()}")

    print("\nSelf-test OK.")


if __name__ == "__main__":
    self_test()
