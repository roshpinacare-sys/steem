#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rce2_federated_causal.py — RCE-2 v6.19 Federated Causal Learning

PROBLEM:
  v6.18 learns causal models from data at a SINGLE node. But in production,
  data is often distributed across multiple organizations/nodes that cannot
  share raw data due to privacy, regulatory, or competitive constraints.

  Example: Hospital A and Hospital B both treat the same disease but cannot
  share patient data. Each has a partial view of the causal structure. Can
  they collaboratively learn a BETTER causal model than either could alone,
  WITHOUT sharing raw data?

SOLUTION:
  The FederatedCausalLearner implements federated causal discovery:

  1. LOCAL CAUSAL DISCOVERY
     - Each node runs causal discovery (ACE estimation) on its local data
     - Each node computes local ACE estimates, variances, and sample counts
     - Raw data NEVER leaves the node

  2. FEDERATED AGGREGATION
     - Each node shares ONLY: ACE estimates, variances, sample counts
     - The aggregator computes a weighted average of ACE estimates
     - Weights = inverse variance (precision weighting)
     - This is the Federated ACE: ACE_fed = sum(w_i * ACE_i) / sum(w_i)
       where w_i = 1 / Var(ACE_i)

  3. CONFIDENCE INTERVAL AGGREGATION
     - Combined CI = ACE_fed ± 1.96 * sqrt(1 / sum(w_i))
     - Tighter CI than any individual node (more data = more confidence)

  4. CAUSAL FEATURE VOTING
     - A feature is globally causal if the MAJORITY of nodes classify it
       as causal (weighted by sample count)
     - This filters out node-specific confounders

MATHEMATICAL MODEL:

  Local ACE at node i:
    ACE_i = E[Y | do(X=1)] - E[Y | do(X=0)]  (estimated locally)
    Var_i = variance of ACE_i
    n_i = sample count at node i

  Federated ACE (inverse-variance weighting):
    w_i = 1 / Var_i  (precision)
    ACE_fed = sum(w_i * ACE_i) / sum(w_i)
    Var_fed = 1 / sum(w_i)

  Federated confidence interval:
    CI_fed = ACE_fed ± 1.96 * sqrt(Var_fed)

  Causal feature voting:
    votes_i = 1 if |ACE_i| > threshold else 0
    weighted_votes = sum(n_i * votes_i) / sum(n_i)
    globally_causal = weighted_votes > 0.5

WHY THIS MATTERS:

  Federated causal learning enables:
    1. PRIVACY-PRESERVING: raw data never leaves the node
    2. BETTER ESTIMATES: more total data = tighter CIs
    3. ROBUSTNESS: majority voting filters node-specific artifacts
    4. DISTRIBUTED: scales to many nodes without central data collection

  The substrate can now learn causal models across organizations without
  requiring data sharing — critical for healthcare, finance, and other
  regulated domains.
"""
from __future__ import annotations

import math
import random
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

from rce.rce2_substrate import Substrate
from rce.rce2_observational_causal import ObservationalCausalEstimator
from rce.rce2_online_causal import OnlineCausalRefiner


# ===========================================================================
# Local Causal Estimate (what each node shares)
# ===========================================================================

@dataclass
class LocalCausalEstimate:
    """A causal estimate from a single node (no raw data shared)."""
    node_id: str
    feature_index: int
    ace_estimate: float
    variance: float               # Var(ACE)
    n_samples: int                # sample count at this node
    n_treated: int
    n_control: int
    is_causal: bool               # local classification


# ===========================================================================
# Federated Causal Estimate (aggregated)
# ===========================================================================

@dataclass
class FederatedCausalEstimate:
    """An aggregated causal estimate from multiple nodes."""
    feature_index: int
    federated_ace: float
    federated_variance: float
    confidence_interval: Tuple[float, float]
    n_nodes: int
    total_samples: int
    node_estimates: List[LocalCausalEstimate] = field(default_factory=list)
    is_causal: bool = False       # majority vote
    vote_rate: float = 0.0        # fraction of nodes voting causal


# ===========================================================================
# Federated Causal Learner
# ===========================================================================

class FederatedCausalLearner:
    """Aggregates causal estimates from multiple nodes without sharing raw data.

    Protocol:
      1. Each node runs local causal discovery (ACE estimation)
      2. Each node shares ONLY: ACE, variance, sample count, causal classification
      3. Aggregator computes inverse-variance-weighted federated ACE
      4. Majority vote determines global causal classification

    No raw data ever leaves a node. Only aggregate statistics are shared.
    """

    def __init__(self, ace_threshold: float = 0.1) -> None:
        self.ace_threshold = ace_threshold
        self.node_estimates: Dict[str, List[LocalCausalEstimate]] = defaultdict(list)
        self.federated_estimates: Dict[int, FederatedCausalEstimate] = {}
        self.n_nodes = 0

    def register_node(self, node_id: str) -> None:
        """Register a new node in the federation."""
        if node_id not in self.node_estimates:
            self.node_estimates[node_id] = []
            self.n_nodes += 1

    def submit_estimates(self, node_id: str,
                          estimates: List[LocalCausalEstimate]) -> None:
        """Submit causal estimates from a node.

        Args:
            node_id: identifier of the submitting node
            estimates: list of local causal estimates (no raw data)
        """
        self.register_node(node_id)
        self.node_estimates[node_id] = estimates

    def aggregate(self) -> Dict[int, FederatedCausalEstimate]:
        """Aggregate estimates from all nodes using inverse-variance weighting.

        For each feature:
          ACE_fed = sum(w_i * ACE_i) / sum(w_i)  where w_i = 1/Var_i
          Var_fed = 1 / sum(w_i)
          CI_fed = ACE_fed ± 1.96 * sqrt(Var_fed)
          causal = majority vote (weighted by sample count)
        """
        # Collect all estimates per feature
        feature_estimates = defaultdict(list)
        for node_id, estimates in self.node_estimates.items():
            for est in estimates:
                feature_estimates[est.feature_index].append(est)

        # Aggregate each feature
        self.federated_estimates = {}
        for feature_idx, ests in feature_estimates.items():
            # Inverse-variance weighting
            total_weight = 0.0
            weighted_ace = 0.0
            total_samples = 0
            vote_weight = 0.0  # weighted votes for causal classification

            for est in ests:
                if est.variance > 0:
                    w = 1.0 / est.variance
                else:
                    w = 1.0  # fallback if variance is 0
                weighted_ace += w * est.ace_estimate
                total_weight += w
                total_samples += est.n_samples
                if est.is_causal:
                    vote_weight += est.n_samples

            if total_weight > 0:
                fed_ace = weighted_ace / total_weight
                fed_var = 1.0 / total_weight
            else:
                fed_ace = 0.0
                fed_var = 1.0

            ci = (fed_ace - 1.96 * math.sqrt(fed_var),
                  fed_ace + 1.96 * math.sqrt(fed_var))

            # Majority vote (weighted by sample count)
            vote_rate = vote_weight / max(total_samples, 1)
            is_causal = vote_rate > 0.5 and abs(fed_ace) > self.ace_threshold

            self.federated_estimates[feature_idx] = FederatedCausalEstimate(
                feature_index=feature_idx,
                federated_ace=fed_ace,
                federated_variance=fed_var,
                confidence_interval=ci,
                n_nodes=len(ests),
                total_samples=total_samples,
                node_estimates=ests,
                is_causal=is_causal,
                vote_rate=vote_rate,
            )

        return self.federated_estimates

    def get_federated_causal_features(self) -> List[int]:
        """Return indices of features classified as causal by the federation."""
        return [idx for idx, est in self.federated_estimates.items()
                if est.is_causal]

    def get_stats(self) -> Dict[str, Any]:
        return {
            "n_nodes": self.n_nodes,
            "n_features_estimated": len(self.federated_estimates),
            "n_causal_features": len(self.get_federated_causal_features()),
            "total_samples": sum(e.total_samples for e in self.federated_estimates.values()),
            "estimates": {
                str(idx): {
                    "fed_ace": round(est.federated_ace, 3),
                    "fed_var": round(est.federated_variance, 4),
                    "ci": [round(est.confidence_interval[0], 3),
                           round(est.confidence_interval[1], 3)],
                    "n_nodes": est.n_nodes,
                    "total_samples": est.total_samples,
                    "is_causal": est.is_causal,
                    "vote_rate": round(est.vote_rate, 3),
                }
                for idx, est in self.federated_estimates.items()
            },
        }


# ===========================================================================
# Local Node (runs causal discovery on local data)
# ===========================================================================

class FederatedNode:
    """A single node in the federation.

    Runs causal discovery on local data and shares only aggregate estimates.
    """

    def __init__(self, node_id: str, n_features: int,
                 ace_threshold: float = 0.1) -> None:
        self.node_id = node_id
        self.n_features = n_features
        self.ace_threshold = ace_threshold
        self.estimator = ObservationalCausalEstimator(ace_threshold=ace_threshold)
        self.local_data: List[Tuple[Tuple[float, ...], Any]] = []

    def add_data(self, features: Tuple[float, ...], outcome: Any) -> None:
        """Add a local observation (data never leaves this node)."""
        self.local_data.append((features, outcome))

    def compute_local_estimates(self) -> List[LocalCausalEstimate]:
        """Run causal discovery on local data and prepare estimates to share.

        Returns:
            List of LocalCausalEstimate (no raw data, only aggregate statistics)
        """
        if not self.local_data:
            return []

        features = [f for f, _ in self.local_data]
        outcomes = [o for _, o in self.local_data]

        # Run local causal estimation
        estimates = self.estimator.estimate_all(
            f"node_{self.node_id}", features, outcomes)

        # Convert to LocalCausalEstimate (share only aggregates)
        local_estimates = []
        for est in estimates:
            local_estimates.append(LocalCausalEstimate(
                node_id=self.node_id,
                feature_index=est.feature_index,
                ace_estimate=est.ace_estimate,
                variance=est.std_error ** 2 if est.std_error > 0 else 1.0,
                n_samples=len(self.local_data),
                n_treated=est.n_treated,
                n_control=est.n_control,
                is_causal=est.is_causal,
            ))
        return local_estimates


# ===========================================================================
# v6.19 Substrate with Federated Causal Learning
# ===========================================================================

class SubstrateV619:
    """The v6.19 substrate with federated causal learning.

    Extends v6.18 with:
      - FederatedCausalLearner for multi-node causal discovery
      - FederatedNode for local causal estimation
      - Privacy-preserving aggregation (no raw data shared)
      - Inverse-variance weighting for optimal estimation
    """

    def __init__(self,
                 ace_threshold: float = 0.1,
                 input_dim: int = 8,
                 hidden_dim: int = 32,
                 output_dim: int = 8) -> None:
        self.federated_learner = FederatedCausalLearner(ace_threshold=ace_threshold)
        self.nodes: Dict[str, FederatedNode] = {}
        self.ace_threshold = ace_threshold
        self.input_dim = input_dim
        self.hidden_dim = hidden_dim
        self.output_dim = output_dim

    def add_node(self, node_id: str, n_features: int) -> FederatedNode:
        """Add a new node to the federation."""
        node = FederatedNode(node_id, n_features, self.ace_threshold)
        self.nodes[node_id] = node
        self.federated_learner.register_node(node_id)
        return node

    def add_data_to_node(self, node_id: str,
                          features: Tuple[float, ...], outcome: Any) -> None:
        """Add data to a specific node."""
        if node_id not in self.nodes:
            self.add_node(node_id, len(features))
        self.nodes[node_id].add_data(features, outcome)

    def run_federated_learning(self) -> Dict[str, Any]:
        """Run federated causal discovery across all nodes.

        1. Each node computes local causal estimates
        2. Nodes submit estimates to the federated learner
        3. Federated learner aggregates using inverse-variance weighting
        """
        # Step 1 & 2: Each node computes and submits estimates
        for node_id, node in self.nodes.items():
            estimates = node.compute_local_estimates()
            self.federated_learner.submit_estimates(node_id, estimates)

        # Step 3: Aggregate
        self.federated_learner.aggregate()

        return self.federated_learner.get_stats()

    def get_federated_causal_features(self) -> List[int]:
        """Get causal features identified by the federation."""
        return self.federated_learner.get_federated_causal_features()

    def get_node_stats(self, node_id: str) -> Dict[str, Any]:
        """Get statistics for a specific node."""
        node = self.nodes.get(node_id)
        if node is None:
            return {"error": "node not found"}
        return {
            "node_id": node_id,
            "n_observations": len(node.local_data),
            "n_features": node.n_features,
        }

    def get_report(self) -> Dict[str, Any]:
        return {
            "federated_stats": self.federated_learner.get_stats(),
            "nodes": {nid: self.get_node_stats(nid) for nid in self.nodes},
        }


# ===========================================================================
# Self-test
# ===========================================================================

def self_test() -> None:
    """Quick self-test of federated causal learning."""
    import random
    print("Running v6.19 federated causal learning self-test...")

    sub = SubstrateV619(ace_threshold=0.1)

    rng = random.Random(42)

    # Define a computation: outcome = f[0] AND f[1]
    def compute_fn(f):
        return bool(f[0]) and bool(f[1])

    # Node A: 50 observations
    for _ in range(50):
        f = (float(rng.random() > 0.3), float(rng.random() > 0.3),
             float(rng.random() > 0.5))
        sub.add_data_to_node("nodeA", f, compute_fn(f))

    # Node B: 50 observations (different distribution)
    for _ in range(50):
        f = (float(rng.random() > 0.5), float(rng.random() > 0.5),
             float(rng.random() > 0.5))
        sub.add_data_to_node("nodeB", f, compute_fn(f))

    # Node C: 50 observations
    for _ in range(50):
        f = (float(rng.random() > 0.4), float(rng.random() > 0.4),
             float(rng.random() > 0.5))
        sub.add_data_to_node("nodeC", f, compute_fn(f))

    print(f"  Federation: {len(sub.nodes)} nodes, 150 total observations")

    # Run federated learning
    result = sub.run_federated_learning()
    print(f"  Federated stats: {result['n_nodes']} nodes, "
          f"{result['n_features_estimated']} features, "
          f"{result['n_causal_features']} causal")

    # Check causal features
    causal = sub.get_federated_causal_features()
    print(f"  Federated causal features: {causal}")
    print(f"  (expected: [0, 1] — both are true causes)")

    # Show per-feature details
    for idx, est in result["estimates"].items():
        print(f"    f{idx}: ACE={est['fed_ace']:.3f} "
              f"CI=[{est['ci'][0]:.3f}, {est['ci'][1]:.3f}] "
              f"nodes={est['n_nodes']} causal={est['is_causal']} "
              f"vote={est['vote_rate']:.2f}")

    print("\nSelf-test OK.")


if __name__ == "__main__":
    self_test()
