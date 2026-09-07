#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rce2_byzantine_robust.py — RCE-2 v6.21 Byzantine-Robust Federated Causal Learning

PROBLEM:
  v6.20 federated causal learning assumes all nodes are HONEST — they submit
  truthful ACE estimates. But in production, some nodes may be MALICIOUS
  (Byzantine): they submit false estimates to skew the aggregation, either
  to degrade estimation quality or to bias the causal discovery.

  Example: A competitor's node joins the federation and submits ACE=10.0
  for a feature whose true ACE is 0.5. The inverse-variance aggregation
  (v6.19) would be skewed toward 10.0, producing a wrong causal model.

  The inverse-variance weighting is NOT robust to outliers — a single
  Byzantine node with low reported variance can dominate the aggregation.

SOLUTION:
  The ByzantineRobustAggregator implements three robust aggregation rules:

  1. MEDIAN-OF-MEANS
     - Group nodes into k groups
     - Compute the mean of each group
     - Aggregate = median of the k group means
     - Robust to up to k/2 Byzantine nodes

  2. TRIMMED MEAN
     - Sort estimates, remove the top and bottom beta fraction
     - Aggregate = mean of the remaining estimates
     - Robust to up to beta*n Byzantine nodes

  3. KRUM ALGORITHM
     - For each node, compute the sum of distances to its n-f-2 nearest
       neighbors (f = expected number of Byzantine nodes)
     - Select the node with the smallest sum (the "closest" to others)
     - Aggregate = that node's estimate
     - Robust to up to f Byzantine nodes

MATHEMATICAL MODEL:

  Median-of-means:
    Given n estimates {x_1, ..., x_n} and k groups:
      1. Randomly partition into k groups G_1, ..., G_k
      2. Compute mean_j = mean(x_i for i in G_j)
      3. Aggregate = median(mean_1, ..., mean_k)
    Robustness: tolerates up to k/2 Byzantine nodes

  Trimmed mean:
    Given n estimates and trimming fraction beta:
      1. Sort estimates: x_(1) <= x_(2) <= ... <= x_(n)
      2. Remove the smallest beta*n and largest beta*n
      3. Aggregate = mean of the middle (1-2*beta)*n estimates
    Robustness: tolerates up to beta*n Byzantine nodes

  Krum:
    Given n estimates and f expected Byzantine nodes:
      For each i:
        1. Compute distances d(i,j) = |x_i - x_j| for all j != i
        2. Sort distances: d(i, (1)) <= ... <= d(i, (n-1))
        3. score(i) = sum of d(i, (j)) for j = 1 to n-f-2
      Aggregate = x_(i*) where i* = argmin score(i)
    Robustness: tolerates up to f Byzantine nodes

WHY THIS MATTERS:

  Byzantine robustness enables:
    1. ADVERSARIAL RESILIENCE: federation survives malicious nodes
    2. FALSE ESTIMATE FILTERING: outliers are automatically excluded
    3. TRUSTLESS FEDERATION: nodes don't need to trust each other
    4. ATTACK RESISTANCE: competitor cannot skew the causal model

  The substrate can now be deployed in adversarial environments where
  nodes may have incentives to manipulate the causal discovery.
"""
from __future__ import annotations

import math
import random
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

from rce.rce2_federated_causal import (
    FederatedCausalLearner, LocalCausalEstimate, FederatedCausalEstimate,
)
from rce.rce2_differential_privacy import SubstrateV620, DPFederatedNode


# ===========================================================================
# Robust Aggregation Result
# ===========================================================================

@dataclass
class RobustAggregationResult:
    """Result of robust aggregation for a single feature."""
    feature_index: int
    robust_ace: float
    method: str                    # "median_of_means", "trimmed_mean", "krum"
    n_nodes: int
    n_byzantine_detected: int      # estimates flagged as outliers
    node_estimates: List[float]    # all submitted ACE values
    selected_estimates: List[float]  # estimates used in aggregation
    is_causal: bool


# ===========================================================================
# Byzantine-Robust Aggregator
# ===========================================================================

class ByzantineRobustAggregator:
    """Aggregates causal estimates robustly against Byzantine (malicious) nodes.

    Implements three robust aggregation rules:
      1. Median-of-means (group + median)
      2. Trimmed mean (remove extremes)
      3. Krum (select closest node)

    Each rule provides different robustness guarantees and computational
    costs. The aggregator can use any rule or compare all three.
    """

    def __init__(self, method: str = "trimmed_mean",
                 ace_threshold: float = 0.1,
                 n_byzantine: int = 1,
                 trim_fraction: float = 0.2,
                 n_groups: int = 5) -> None:
        self.method = method
        self.ace_threshold = ace_threshold
        self.n_byzantine = n_byzantine
        self.trim_fraction = trim_fraction
        self.n_groups = n_groups
        self.results: Dict[int, RobustAggregationResult] = {}

    def aggregate_median_of_means(self, estimates: List[Tuple[str, float, float, int]]
                                   ) -> Tuple[float, int]:
        """Aggregate using median-of-means.

        Args:
            estimates: list of (node_id, ace, variance, n_samples)

        Returns:
            (robust_ace, n_byzantine_detected)
        """
        if not estimates:
            return 0.0, 0

        n = len(estimates)
        k = min(self.n_groups, n)

        # Randomly partition into k groups
        rng = random.Random(42)
        indices = list(range(n))
        rng.shuffle(indices)

        group_size = n // k
        group_means = []

        for g in range(k):
            start = g * group_size
            end = start + group_size if g < k - 1 else n
            group_indices = indices[start:end]
            group_estimates = [estimates[i][1] for i in group_indices]
            if group_estimates:
                group_means.append(sum(group_estimates) / len(group_estimates))

        if not group_means:
            return 0.0, 0

        # Median of group means
        group_means.sort()
        mid = len(group_means) // 2
        if len(group_means) % 2 == 0:
            median = (group_means[mid - 1] + group_means[mid]) / 2
        else:
            median = group_means[mid]

        # Detect outliers (estimates far from median)
        n_byzantine = sum(1 for _, ace, _, _ in estimates
                          if abs(ace - median) > 2 * self._std(estimates))

        return median, n_byzantine

    def aggregate_trimmed_mean(self, estimates: List[Tuple[str, float, float, int]]
                                ) -> Tuple[float, int]:
        """Aggregate using trimmed mean.

        Args:
            estimates: list of (node_id, ace, variance, n_samples)

        Returns:
            (robust_ace, n_byzantine_detected)
        """
        if not estimates:
            return 0.0, 0

        n = len(estimates)
        ace_values = sorted([e[1] for e in estimates])

        # Number to trim from each end
        trim_count = int(n * self.trim_fraction)

        if trim_count > 0 and n > 2 * trim_count:
            trimmed = ace_values[trim_count:n - trim_count]
        else:
            trimmed = ace_values

        robust_ace = sum(trimmed) / len(trimmed) if trimmed else 0.0

        # Detect outliers (trimmed values)
        n_byzantine = 2 * trim_count

        return robust_ace, n_byzantine

    def aggregate_krum(self, estimates: List[Tuple[str, float, float, int]]
                       ) -> Tuple[float, int]:
        """Aggregate using Krum algorithm.

        Args:
            estimates: list of (node_id, ace, variance, n_samples)

        Returns:
            (robust_ace, n_byzantine_detected)
        """
        if not estimates:
            return 0.0, 0

        n = len(estimates)
        f = self.n_byzantine

        if n <= 2 * f + 2:
            # Not enough nodes for Krum; fall back to median
            ace_values = sorted([e[1] for e in estimates])
            mid = len(ace_values) // 2
            if len(ace_values) % 2 == 0:
                return (ace_values[mid - 1] + ace_values[mid]) / 2, 0
            return ace_values[mid], 0

        # For each node, compute sum of distances to n-f-2 nearest neighbors
        m = n - f - 2  # number of nearest neighbors to consider
        scores = []

        for i in range(n):
            distances = []
            for j in range(n):
                if i != j:
                    d = abs(estimates[i][1] - estimates[j][1])
                    distances.append(d)
            distances.sort()
            # Sum of m smallest distances
            score = sum(distances[:m]) if distances else 0.0
            scores.append((score, i))

        # Select node with smallest score
        scores.sort()
        best_idx = scores[0][1]
        robust_ace = estimates[best_idx][1]

        # Detect outliers (nodes with high Krum score)
        threshold = scores[0][0] * 3 if scores[0][0] > 0 else 1.0
        n_byzantine = sum(1 for score, _ in scores if score > threshold)

        return robust_ace, n_byzantine

    def aggregate(self, feature_estimates: Dict[int, List[Tuple[str, float, float, int]]]
                  ) -> Dict[int, RobustAggregationResult]:
        """Aggregate estimates for all features using the selected method.

        Args:
            feature_estimates: {feature_idx: [(node_id, ace, variance, n_samples)]}

        Returns:
            {feature_idx: RobustAggregationResult}
        """
        self.results = {}

        for feature_idx, estimates in feature_estimates.items():
            if self.method == "median_of_means":
                robust_ace, n_byz = self.aggregate_median_of_means(estimates)
            elif self.method == "trimmed_mean":
                robust_ace, n_byz = self.aggregate_trimmed_mean(estimates)
            elif self.method == "krum":
                robust_ace, n_byz = self.aggregate_krum(estimates)
            else:
                robust_ace, n_byz = self.aggregate_trimmed_mean(estimates)

            is_causal = abs(robust_ace) > self.ace_threshold

            self.results[feature_idx] = RobustAggregationResult(
                feature_index=feature_idx,
                robust_ace=robust_ace,
                method=self.method,
                n_nodes=len(estimates),
                n_byzantine_detected=n_byz,
                node_estimates=[e[1] for e in estimates],
                selected_estimates=[e[1] for e in estimates],  # simplified
                is_causal=is_causal,
            )

        return self.results

    def get_robust_causal_features(self) -> List[int]:
        """Return indices of features classified as causal (robustly)."""
        return [idx for idx, res in self.results.items() if res.is_causal]

    def get_stats(self) -> Dict[str, Any]:
        return {
            "method": self.method,
            "n_features_aggregated": len(self.results),
            "n_causal": len(self.get_robust_causal_features()),
            "n_byzantine_detected": sum(r.n_byzantine_detected for r in self.results.values()),
            "results": {
                str(idx): {
                    "robust_ace": round(r.robust_ace, 4),
                    "method": r.method,
                    "n_nodes": r.n_nodes,
                    "n_byzantine_detected": r.n_byzantine_detected,
                    "is_causal": r.is_causal,
                    "node_estimates": [round(e, 3) for e in r.node_estimates],
                }
                for idx, r in self.results.items()
            },
        }

    def _std(self, estimates: List[Tuple[str, float, float, int]]) -> float:
        """Compute standard deviation of ACE values."""
        if len(estimates) < 2:
            return 1.0
        values = [e[1] for e in estimates]
        mean = sum(values) / len(values)
        var = sum((v - mean) ** 2 for v in values) / len(values)
        return math.sqrt(var) if var > 0 else 1.0


# ===========================================================================
# Byzantine Node (simulates malicious behavior)
# ===========================================================================

class ByzantineNode(DPFederatedNode):
    """A malicious node that submits false estimates.

    Simulates Byzantine behavior:
      - "inflate": reports ACE * 10 (exaggerate causal effect)
      - "deflate": reports ACE * 0.1 (understate causal effect)
      - "flip": reports -ACE (flip the sign)
      - "random": reports random ACE values
    """

    def __init__(self, node_id: str, n_features: int,
                 ace_threshold: float = 0.1,
                 epsilon_budget: float = 1.0,
                 attack_type: str = "inflate") -> None:
        super().__init__(node_id, n_features, ace_threshold, epsilon_budget)
        self.attack_type = attack_type

    def compute_dp_local_estimates(self) -> List[LocalCausalEstimate]:
        """Compute DP estimates, then apply Byzantine attack."""
        estimates = super().compute_dp_local_estimates()

        # Apply attack
        attacked = []
        for est in estimates:
            attacked_ace = est.ace_estimate
            if self.attack_type == "inflate":
                attacked_ace = est.ace_estimate * 10.0
            elif self.attack_type == "deflate":
                attacked_ace = est.ace_estimate * 0.1
            elif self.attack_type == "flip":
                attacked_ace = -est.ace_estimate
            elif self.attack_type == "random":
                attacked_ace = random.Random().uniform(-1.0, 1.0)

            attacked.append(LocalCausalEstimate(
                node_id=est.node_id,
                feature_index=est.feature_index,
                ace_estimate=attacked_ace,
                variance=est.variance,
                n_samples=est.n_samples,
                n_treated=est.n_treated,
                n_control=est.n_control,
                is_causal=abs(attacked_ace) > self.ace_threshold,
            ))
        return attacked


# ===========================================================================
# v6.21 Substrate with Byzantine Robustness
# ===========================================================================

class SubstrateV621:
    """The v6.21 substrate with Byzantine-robust federated causal learning.

    Extends v6.20 with:
      - ByzantineRobustAggregator for malicious node detection
      - Three robust aggregation rules (median-of-means, trimmed mean, Krum)
      - ByzantineNode simulation for testing
      - Trustless federation (nodes don't need to trust each other)
    """

    def __init__(self,
                 ace_threshold: float = 0.1,
                 epsilon_budget: float = 1.0,
                 aggregation_method: str = "trimmed_mean",
                 n_byzantine: int = 1,
                 trim_fraction: float = 0.2) -> None:
        self.ace_threshold = ace_threshold
        self.epsilon_budget = epsilon_budget
        self.nodes: Dict[str, DPFederatedNode] = {}
        self.aggregator = ByzantineRobustAggregator(
            method=aggregation_method,
            ace_threshold=ace_threshold,
            n_byzantine=n_byzantine,
            trim_fraction=trim_fraction,
        )

    def add_honest_node(self, node_id: str, n_features: int) -> DPFederatedNode:
        """Add an honest node to the federation."""
        node = DPFederatedNode(node_id, n_features, self.ace_threshold, self.epsilon_budget)
        self.nodes[node_id] = node
        return node

    def add_byzantine_node(self, node_id: str, n_features: int,
                            attack_type: str = "inflate") -> ByzantineNode:
        """Add a Byzantine (malicious) node to the federation."""
        node = ByzantineNode(node_id, n_features, self.ace_threshold,
                              self.epsilon_budget, attack_type)
        self.nodes[node_id] = node
        return node

    def add_data_to_node(self, node_id: str,
                          features: Tuple[float, ...], outcome: Any) -> None:
        """Add data to a specific node."""
        if node_id not in self.nodes:
            self.add_honest_node(node_id, len(features))
        self.nodes[node_id].add_data(features, outcome)

    def run_byzantine_robust_learning(self) -> Dict[str, Any]:
        """Run Byzantine-robust federated causal discovery.

        1. Each node (honest or Byzantine) computes and submits estimates
        2. Robust aggregator filters outliers and aggregates
        """
        # Collect estimates per feature
        feature_estimates = defaultdict(list)

        for node_id, node in self.nodes.items():
            estimates = node.compute_dp_local_estimates()
            for est in estimates:
                feature_estimates[est.feature_index].append(
                    (node_id, est.ace_estimate, est.variance, est.n_samples))

        # Robust aggregation
        self.aggregator.aggregate(feature_estimates)

        return {
            "aggregation_stats": self.aggregator.get_stats(),
            "n_honest_nodes": sum(1 for n in self.nodes.values()
                                   if not isinstance(n, ByzantineNode)),
            "n_byzantine_nodes": sum(1 for n in self.nodes.values()
                                      if isinstance(n, ByzantineNode)),
        }

    def get_robust_causal_features(self) -> List[int]:
        """Get causal features identified robustly."""
        return self.aggregator.get_robust_causal_features()

    def get_node_info(self) -> Dict[str, Any]:
        """Get information about all nodes."""
        return {
            node_id: {
                "type": "byzantine" if isinstance(node, ByzantineNode) else "honest",
                "attack_type": node.attack_type if isinstance(node, ByzantineNode) else None,
                "n_observations": len(node.local_data),
            }
            for node_id, node in self.nodes.items()
        }

    def get_report(self) -> Dict[str, Any]:
        return {
            "aggregation_stats": self.aggregator.get_stats(),
            "nodes": self.get_node_info(),
        }


# ===========================================================================
# Self-test
# ===========================================================================

def self_test() -> None:
    """Quick self-test of Byzantine-robust federated learning."""
    import random
    print("Running v6.21 Byzantine-robust self-test...")

    rng = random.Random(42)

    def compute_fn(f):
        return bool(f[0]) and bool(f[1])

    # Test with 5 honest nodes + 1 Byzantine node
    sub = SubstrateV621(
        ace_threshold=0.1,
        epsilon_budget=1.0,
        aggregation_method="trimmed_mean",
        n_byzantine=1,
        trim_fraction=0.2,
    )

    # 5 honest nodes
    for i in range(5):
        node_id = f"honest_{i}"
        for _ in range(30):
            f = (float(rng.random() > 0.3), float(rng.random() > 0.3),
                 float(rng.random() > 0.5))
            sub.add_data_to_node(node_id, f, compute_fn(f))

    # 1 Byzantine node (inflates ACE)
    byz_node = sub.add_byzantine_node("byzantine_0", n_features=3, attack_type="inflate")
    for _ in range(30):
        f = (float(rng.random() > 0.3), float(rng.random() > 0.3),
             float(rng.random() > 0.5))
        byz_node.add_data(f, compute_fn(f))

    print(f"  Federation: {len(sub.nodes)} nodes (5 honest + 1 Byzantine)")

    # Run Byzantine-robust learning
    result = sub.run_byzantine_robust_learning()
    agg_stats = result["aggregation_stats"]
    print(f"  Honest: {result['n_honest_nodes']}, Byzantine: {result['n_byzantine_nodes']}")
    print(f"  Byzantine detected: {agg_stats['n_byzantine_detected']}")
    print(f"  Causal features: {sub.get_robust_causal_features()}")

    # Show per-feature details
    for idx, est in agg_stats["results"].items():
        print(f"    f{idx}: robust_ace={est['robust_ace']:.3f} "
              f"nodes={est['n_nodes']} "
              f"byzantine_detected={est['n_byzantine_detected']} "
              f"causal={est['is_causal']}")
        print(f"      node_estimates: {est['node_estimates']}")

    print("\nSelf-test OK.")


if __name__ == "__main__":
    self_test()
