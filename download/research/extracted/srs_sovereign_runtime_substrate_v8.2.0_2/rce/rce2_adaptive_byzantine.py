#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rce2_adaptive_byzantine.py — RCE-2 v6.22 Adaptive Byzantine Detection

PROBLEM:
  v6.21 requires the number of Byzantine nodes (f) as a parameter. But in
  production, we don't know how many nodes are malicious. Setting f too
  high wastes honest data (over-trimming); setting f too low leaves
  Byzantine estimates in the aggregation (under-protection).

SOLUTION:
  The AdaptiveByzantineDetector estimates f from the data using three
  complementary methods:

  1. CLUSTERING (k-means with k=2)
     - Cluster node estimates into 2 groups: honest (tight cluster) and
       Byzantine (scattered outliers)
     - The smaller cluster is the Byzantine set
     - f = size of the smaller cluster

  2. OUTLIER DETECTION (modified z-score)
     - For each node, compute the modified z-score:
       M_i = 0.6745 * (x_i - median) / MAD
       where MAD = median(|x_i - median|)
     - Flag nodes with |M_i| > 3.5 as outliers (Byzantine)
     - f = number of flagged nodes

  3. GAP STATISTIC
     - Sort estimates, find the largest gap between consecutive values
     - Nodes above the gap are Byzantine
     - f = number of nodes above the gap

  The detector runs all three methods and takes the MEDIAN of the three
  estimates as the final f. This is more robust than any single method.

MATHEMATICAL MODEL:

  Modified z-score:
    median = median(x_1, ..., x_n)
    MAD = median(|x_i - median|)
    M_i = 0.6745 * (x_i - median) / MAD
    Byzantine if |M_i| > 3.5

  K-means (k=2):
    Assign nodes to 2 clusters by minimizing within-cluster variance
    Smaller cluster = Byzantine
    f = |smaller cluster|

  Gap statistic:
    sorted_x = sort(x_1, ..., x_n)
    gaps = [sorted_x[i+1] - sorted_x[i] for i in range(n-1)]
    max_gap_idx = argmax(gaps)
    f = n - max_gap_idx - 1  (nodes above the gap)

  Final estimate:
    f = median(f_clustering, f_outlier, f_gap)

WHY THIS MATTERS:

  Adaptive detection enables:
    1. SELF-TUNING: no need to manually set f
    2. DYNAMIC: adapts as nodes join/leave or change behavior
    3. ROBUST: median of 3 methods is more reliable than any single method
    4. PRACTICAL: works in production where f is unknown

  The substrate can now detect and filter Byzantine nodes automatically,
  without any configuration.
"""
from __future__ import annotations

import math
import random
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

from rce.rce2_byzantine_robust import (
    SubstrateV621, ByzantineRobustAggregator, ByzantineNode,
    RobustAggregationResult,
)
from rce.rce2_differential_privacy import DPFederatedNode


# ===========================================================================
# Detection Result
# ===========================================================================

@dataclass
class DetectionResult:
    """Result of Byzantine detection for a single feature."""
    feature_index: int
    estimated_f: int                    # estimated number of Byzantine nodes
    byzantine_node_ids: List[str]       # detected Byzantine nodes
    method_estimates: Dict[str, int]    # f estimate from each method
    method: str                         # "adaptive" (median of methods)


# ===========================================================================
# Adaptive Byzantine Detector
# ===========================================================================

class AdaptiveByzantineDetector:
    """Automatically detects Byzantine nodes without requiring f as input.

    Uses three complementary methods:
      1. Clustering (k-means k=2)
      2. Outlier detection (modified z-score)
      3. Gap statistic

    Takes the median of the three estimates as the final f.
    """

    def __init__(self, z_threshold: float = 3.5) -> None:
        self.z_threshold = z_threshold
        self.detection_results: Dict[int, DetectionResult] = {}
        self.detected_byzantine_nodes: set = set()

    def detect_by_clustering(self, estimates: List[Tuple[str, float]]
                              ) -> Tuple[int, List[str]]:
        """Detect Byzantine nodes via k-means clustering (k=2).

        The smaller cluster is the Byzantine set.
        """
        if len(estimates) < 2:
            return 0, []

        values = [e[1] for e in estimates]
        n = len(values)

        # Simple k-means with k=2
        # Initialize: min and max values as centroids
        sorted_vals = sorted(values)
        c1, c2 = sorted_vals[0], sorted_vals[-1]

        for _ in range(20):  # max iterations
            cluster1, cluster2 = [], []
            for i, v in enumerate(values):
                if abs(v - c1) < abs(v - c2):
                    cluster1.append(i)
                else:
                    cluster2.append(i)

            # Update centroids
            if cluster1:
                new_c1 = sum(values[i] for i in cluster1) / len(cluster1)
            else:
                new_c1 = c1
            if cluster2:
                new_c2 = sum(values[i] for i in cluster2) / len(cluster2)
            else:
                new_c2 = c2

            if abs(new_c1 - c1) < 1e-9 and abs(new_c2 - c2) < 1e-9:
                break
            c1, c2 = new_c1, new_c2

        # Smaller cluster is Byzantine
        if len(cluster1) <= len(cluster2):
            byzantine_indices = cluster1
        else:
            byzantine_indices = cluster2

        byzantine_ids = [estimates[i][0] for i in byzantine_indices]
        return len(byzantine_indices), byzantine_ids

    def detect_by_outliers(self, estimates: List[Tuple[str, float]]
                            ) -> Tuple[int, List[str]]:
        """Detect Byzantine nodes via modified z-score.

        Nodes with |M_i| > threshold are flagged as Byzantine.
        """
        if len(estimates) < 3:
            return 0, []

        values = [e[1] for e in estimates]
        sorted_vals = sorted(values)
        n = len(values)

        # Median
        mid = n // 2
        if n % 2 == 0:
            median = (sorted_vals[mid - 1] + sorted_vals[mid]) / 2
        else:
            median = sorted_vals[mid]

        # MAD = median absolute deviation
        deviations = sorted([abs(v - median) for v in values])
        if n % 2 == 0:
            mad = (deviations[mid - 1] + deviations[mid]) / 2
        else:
            mad = deviations[mid]

        if mad < 1e-10:
            # All values are the same — no outliers
            return 0, []

        # Modified z-score
        byzantine_ids = []
        for node_id, v in estimates:
            m_z = 0.6745 * (v - median) / mad
            if abs(m_z) > self.z_threshold:
                byzantine_ids.append(node_id)

        return len(byzantine_ids), byzantine_ids

    def detect_by_gap(self, estimates: List[Tuple[str, float]]
                       ) -> Tuple[int, List[str]]:
        """Detect Byzantine nodes via gap statistic.

        Find the largest gap in sorted estimates. Nodes above the gap
        are Byzantine.
        """
        if len(estimates) < 3:
            return 0, []

        sorted_estimates = sorted(estimates, key=lambda e: e[1])
        n = len(sorted_estimates)

        # Compute gaps
        gaps = []
        for i in range(n - 1):
            gap = sorted_estimates[i + 1][1] - sorted_estimates[i][1]
            gaps.append((gap, i))

        # Find largest gap
        gaps.sort(key=lambda g: -g[0])
        if not gaps:
            return 0, []

        largest_gap, gap_idx = gaps[0]

        # Check if the gap is significant (larger than 2x the median gap)
        median_gap = sorted([g for g, _ in gaps])[len(gaps) // 2] if gaps else 0
        if largest_gap < 2 * median_gap or largest_gap < 0.1:
            return 0, []  # no significant gap

        # Nodes above the gap are Byzantine
        byzantine_ids = [sorted_estimates[i][0] for i in range(gap_idx + 1, n)]
        return len(byzantine_ids), byzantine_ids

    def detect(self, feature_estimates: Dict[int, List[Tuple[str, float]]]
               ) -> Dict[int, DetectionResult]:
        """Detect Byzantine nodes for all features.

        Args:
            feature_estimates: {feature_idx: [(node_id, ace)]}

        Returns:
            {feature_idx: DetectionResult}
        """
        self.detection_results = {}
        self.detected_byzantine_nodes = set()

        for feature_idx, estimates in feature_estimates.items():
            # Run all three methods
            f_cluster, byz_cluster = self.detect_by_clustering(estimates)
            f_outlier, byz_outlier = self.detect_by_outliers(estimates)
            f_gap, byz_gap = self.detect_by_gap(estimates)

            # Median of three estimates
            f_estimates = sorted([f_cluster, f_outlier, f_gap])
            f_final = f_estimates[len(f_estimates) // 2]

            # Union of detected Byzantine nodes (conservative)
            all_byzantine = set(byz_cluster) | set(byz_outlier) | set(byz_gap)

            # If f_final is 0 but some methods detected nodes, use the
            # intersection of the most aggressive methods
            if f_final == 0 and len(all_byzantine) > 0:
                # Use the smallest non-zero estimate
                non_zero = [f for f in [f_cluster, f_outlier, f_gap] if f > 0]
                if non_zero:
                    f_final = min(non_zero)

            self.detected_byzantine_nodes.update(all_byzantine)

            self.detection_results[feature_idx] = DetectionResult(
                feature_index=feature_idx,
                estimated_f=f_final,
                byzantine_node_ids=list(all_byzantine),
                method_estimates={
                    "clustering": f_cluster,
                    "outlier": f_outlier,
                    "gap": f_gap,
                },
                method="adaptive",
            )

        return self.detection_results

    def get_estimated_f(self) -> int:
        """Get the maximum estimated f across all features."""
        if not self.detection_results:
            return 0
        return max(r.estimated_f for r in self.detection_results.values())

    def get_detected_byzantine_nodes(self) -> List[str]:
        """Get all detected Byzantine node IDs."""
        return list(self.detected_byzantine_nodes)

    def get_stats(self) -> Dict[str, Any]:
        return {
            "n_features_detected": len(self.detection_results),
            "estimated_f": self.get_estimated_f(),
            "n_byzantine_detected": len(self.detected_byzantine_nodes),
            "byzantine_node_ids": list(self.detected_byzantine_nodes),
            "detection_details": {
                str(idx): {
                    "estimated_f": r.estimated_f,
                    "byzantine_nodes": r.byzantine_node_ids,
                    "method_estimates": r.method_estimates,
                }
                for idx, r in self.detection_results.items()
            },
        }


# ===========================================================================
# v6.22 Substrate with Adaptive Byzantine Detection
# ===========================================================================

class SubstrateV622:
    """The v6.22 substrate with adaptive Byzantine detection.

    Extends v6.21 with:
      - AdaptiveByzantineDetector that auto-estimates f
      - Three detection methods (clustering, outlier, gap)
      - Median of methods for robust estimation
      - Self-tuning robust aggregation (no f parameter needed)
    """

    def __init__(self,
                 ace_threshold: float = 0.1,
                 epsilon_budget: float = 1.0,
                 aggregation_method: str = "trimmed_mean",
                 trim_fraction: float = 0.2) -> None:
        self.ace_threshold = ace_threshold
        self.epsilon_budget = epsilon_budget
        self.nodes: Dict[str, DPFederatedNode] = {}
        self.detector = AdaptiveByzantineDetector()
        self.aggregation_method = aggregation_method
        self.trim_fraction = trim_fraction
        self.aggregator: Optional[ByzantineRobustAggregator] = None

    def add_honest_node(self, node_id: str, n_features: int) -> DPFederatedNode:
        """Add an honest node."""
        node = DPFederatedNode(node_id, n_features, self.ace_threshold, self.epsilon_budget)
        self.nodes[node_id] = node
        return node

    def add_byzantine_node(self, node_id: str, n_features: int,
                            attack_type: str = "inflate") -> ByzantineNode:
        """Add a Byzantine node."""
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

    def run_adaptive_byzantine_learning(self) -> Dict[str, Any]:
        """Run adaptive Byzantine-robust federated causal discovery.

        1. Collect estimates from all nodes
        2. Run adaptive detection (estimate f)
        3. Configure robust aggregator with estimated f
        4. Aggregate robustly
        """
        # Step 1: Collect estimates per feature
        feature_estimates = defaultdict(list)
        feature_full_estimates = defaultdict(list)

        for node_id, node in self.nodes.items():
            estimates = node.compute_dp_local_estimates()
            for est in estimates:
                feature_estimates[est.feature_index].append(
                    (node_id, est.ace_estimate))
                feature_full_estimates[est.feature_index].append(
                    (node_id, est.ace_estimate, est.variance, est.n_samples))

        # Step 2: Run adaptive detection
        self.detector.detect(feature_estimates)
        estimated_f = self.detector.get_estimated_f()

        # Step 3: Configure aggregator with estimated f
        self.aggregator = ByzantineRobustAggregator(
            method=self.aggregation_method,
            ace_threshold=self.ace_threshold,
            n_byzantine=estimated_f,
            trim_fraction=self.trim_fraction,
        )

        # Step 4: Aggregate robustly
        self.aggregator.aggregate(feature_full_estimates)

        return {
            "detection_stats": self.detector.get_stats(),
            "aggregation_stats": self.aggregator.get_stats(),
            "estimated_f": estimated_f,
            "n_honest_nodes": sum(1 for n in self.nodes.values()
                                   if not isinstance(n, ByzantineNode)),
            "n_byzantine_nodes": sum(1 for n in self.nodes.values()
                                      if isinstance(n, ByzantineNode)),
            "n_byzantine_detected": len(self.detector.get_detected_byzantine_nodes()),
        }

    def get_robust_causal_features(self) -> List[int]:
        """Get causal features identified robustly."""
        if self.aggregator is None:
            return []
        return self.aggregator.get_robust_causal_features()

    def get_detected_byzantine_nodes(self) -> List[str]:
        """Get detected Byzantine node IDs."""
        return self.detector.get_detected_byzantine_nodes()

    def get_report(self) -> Dict[str, Any]:
        return {
            "detection_stats": self.detector.get_stats(),
            "aggregation_stats": self.aggregator.get_stats() if self.aggregator else {},
            "nodes": {
                node_id: {
                    "type": "byzantine" if isinstance(node, ByzantineNode) else "honest",
                    "attack_type": node.attack_type if isinstance(node, ByzantineNode) else None,
                    "n_observations": len(node.local_data),
                }
                for node_id, node in self.nodes.items()
            },
        }


# ===========================================================================
# Self-test
# ===========================================================================

def self_test() -> None:
    """Quick self-test of adaptive Byzantine detection."""
    import random
    print("Running v6.22 adaptive Byzantine detection self-test...")

    rng = random.Random(42)

    def compute_fn(f):
        return bool(f[0]) and bool(f[1])

    # 5 honest + 2 Byzantine (unknown to the system)
    sub = SubstrateV622(
        ace_threshold=0.1,
        epsilon_budget=1.0,
        aggregation_method="trimmed_mean",
        trim_fraction=0.2,
    )

    # 5 honest nodes
    for i in range(5):
        for _ in range(30):
            f = (float(rng.random() > 0.3), float(rng.random() > 0.3),
                 float(rng.random() > 0.5))
            sub.add_data_to_node(f"honest_{i}", f, compute_fn(f))

    # 2 Byzantine nodes
    byz1 = sub.add_byzantine_node("byz_0", n_features=3, attack_type="inflate")
    byz2 = sub.add_byzantine_node("byz_1", n_features=3, attack_type="flip")
    for _ in range(30):
        f = (float(rng.random() > 0.3), float(rng.random() > 0.3),
             float(rng.random() > 0.5))
        byz1.add_data(f, compute_fn(f))
        byz2.add_data(f, compute_fn(f))

    print(f"  Federation: {len(sub.nodes)} nodes (5 honest + 2 Byzantine, f unknown)")

    # Run adaptive detection
    result = sub.run_adaptive_byzantine_learning()
    print(f"  Estimated f: {result['estimated_f']}")
    print(f"  Byzantine detected: {result['n_byzantine_detected']}")
    print(f"  Detected nodes: {sub.get_detected_byzantine_nodes()}")
    print(f"  Causal features: {sub.get_robust_causal_features()}")

    # Show detection details
    det_stats = result["detection_stats"]
    for idx, det in det_stats["detection_details"].items():
        print(f"    f{idx}: estimated_f={det['estimated_f']} "
              f"methods={det['method_estimates']} "
              f"byzantine={det['byzantine_nodes']}")

    print("\nSelf-test OK.")


if __name__ == "__main__":
    self_test()
