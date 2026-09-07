#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rce2_density_gate.py — RCE-2 v6.6 Density-Based OOD Gate

The v6.5 nearest-neighbor OOD gate has a known limitation: on long-tail
distributions, it cannot distinguish "rare in-distribution" from
"out-of-distribution". This module adds a Kernel Density Estimation (KDE)
based gate that estimates the local density of training points and
rejects queries in low-density regions.

MATHEMATICAL MODEL:

  Kernel density estimate at query x:
    p̂(x) = (1 / (n · h^d)) · Σ_i K((x - x_i) / h)

  where:
    n = number of training points
    h = bandwidth (Gaussian kernel)
    d = dimensionality
    K(u) = (2π)^(-d/2) · exp(-||u||² / 2)

  We use a simplified Gaussian kernel:
    p̂(x) ∝ Σ_i exp(-||x - x_i||² / (2h²))

  The OOD threshold is the 5th percentile of p̂(x_i) over training points.
  A query with p̂(x) < threshold is rejected as OOD.

WHY THIS WORKS FOR LONG-TAIL:

  In a long-tail distribution, 95% of training points are in the head
  [0, 0.3]² and 5% are in the tail [0.7, 1.0]². The NN-distance gate
  sets the threshold based on the 95th percentile of NN distances —
  which is dominated by head-to-head distances (~0.05). Tail points
  have NN distances of ~0.5, so they are rejected. But OOD queries
  in [0.7, 1.0]² are also at distance ~0.5 from training, so they
  are accepted.

  The KDE gate, by contrast, computes the DENSITY at the query. Tail
  points have low density (5% of training) but non-zero. A query at
  [0.95, 0.95] (far from any tail training point) has near-zero
  density and is rejected. A query at [0.85, 0.85] (near a tail
  training point) has density similar to tail training points and
  is accepted.

  This is the fundamental advantage of density-based OOD detection
  over distance-based: it captures the local structure of the
  distribution, not just the distance to the nearest neighbor.
"""
from __future__ import annotations

import math
import random
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from rce.rce2_substrate import OODGate, OODRejection


class DensityOODGate(OODGate):
    """OOD gate using Kernel Density Estimation with relative density.

    Extends the v6.5 OODGate with a density-based rejection mechanism.
    The gate inherits all v6.5 behavior (NN-distance fallback, rejection
    logging, FAR measurement) and adds a density check that fires BEFORE
    the NN-distance check.

    RELATIVE DENSITY (the key innovation):

      The naive density threshold (5th percentile of training densities)
      fails on long-tail distributions because tail training points have
      naturally low density — they get rejected as OOD.

      Instead, we compute the RELATIVE density:
        r(x) = p̂(x) / mean(p̂(x_i) for x_i in k nearest neighbors of x)

      A query is OOD iff r(x) < relative_threshold (default 0.1), i.e.
      its density is less than 10% of the average density of its nearest
      training neighbors.

      This works because:
        - In-distribution queries (head or tail) have density similar to
          their nearest neighbors → r(x) ≈ 1.0
        - OOD queries (in low-density gaps) have density much lower than
          their nearest neighbors (which are by definition far away) →
          r(x) << 1.0

    The combined gate rejects if EITHER:
      - relative density r(x) < relative_threshold, OR
      - NN distance > nn_threshold (far from any training point)
    """

    def __init__(self, bandwidth: float = 0.15,
                 density_percentile: float = 5.0,
                 relative_threshold: float = 0.1,
                 k_neighbors: int = 5) -> None:
        super().__init__()
        self.bandwidth = bandwidth
        self.density_percentile = density_percentile
        self.relative_threshold = relative_threshold
        self.k_neighbors = k_neighbors
        self.density_thresholds: Dict[str, float] = {}
        self._training_arrays: Dict[str, List[Tuple[float, ...]]] = defaultdict(list)

    def fit(self, computation_type: str,
            training_features: List[Tuple[float, ...]]) -> float:
        """Fit both the NN threshold (inherited) and the density threshold.

        Returns the NN threshold (for backward compatibility with v6.5).
        """
        # Fit NN threshold via parent
        nn_threshold = super().fit(computation_type, training_features)
        self._training_arrays[computation_type] = list(training_features)

        # Compute density at each training point
        if len(training_features) < 2:
            self.density_thresholds[computation_type] = 0.0
            return nn_threshold

        # Sample training points for density evaluation (cap at 100 for speed)
        sample = training_features
        if len(training_features) > 100:
            rng = random.Random(42)
            sample = rng.sample(training_features, 100)

        densities = [self._density(computation_type, f) for f in sample]
        densities.sort()
        # density_percentile-th percentile (kept for backward compat / fallback)
        idx = int(self.density_percentile / 100.0 * len(densities))
        idx = min(idx, len(densities) - 1)
        threshold = max(densities[idx], 1e-10)
        self.density_thresholds[computation_type] = threshold
        return nn_threshold

    def _density(self, computation_type: str,
                 features: Tuple[float, ...]) -> float:
        """Compute Gaussian KDE density at the query point.

        p̂(x) ∝ Σ_i exp(-||x - x_i||² / (2h²))

        Returns the unnormalized density (proportional to true density).
        """
        training = self._training_arrays.get(computation_type, [])
        if not training:
            return 0.0
        h2 = self.bandwidth ** 2
        total = 0.0
        for t in training:
            d2 = sum((a - b) ** 2 for a, b in zip(features, t))
            total += math.exp(-d2 / (2 * h2))
        return total

    def _k_nearest_densities(self, computation_type: str,
                              features: Tuple[float, ...],
                              k: int) -> List[float]:
        """Return densities at the k nearest training points to the query."""
        training = self._training_arrays.get(computation_type, [])
        if not training:
            return []
        # Compute distances and sort
        dists = []
        for i, t in enumerate(training):
            d = math.sqrt(sum((a - b) ** 2 for a, b in zip(features, t)))
            dists.append((d, i))
        dists.sort()
        k = min(k, len(dists))
        return [self._density(computation_type, training[dists[i][1]])
                for i in range(k)]

    def _relative_density(self, computation_type: str,
                          features: Tuple[float, ...]) -> float:
        """Compute relative density: query density / mean neighbor density.

        r(x) = p̂(x) / mean(p̂(x_i) for x_i in k nearest neighbors)

        Returns 0.0 if no training data; returns 1.0+ for in-distribution
        queries (density similar to or higher than neighbors); returns
        values << 1.0 for OOD queries (density much lower than neighbors).
        """
        training = self._training_arrays.get(computation_type, [])
        if not training:
            return 0.0
        q_density = self._density(computation_type, features)
        neighbor_densities = self._k_nearest_densities(
            computation_type, features, self.k_neighbors)
        if not neighbor_densities:
            return 0.0
        mean_neighbor = sum(neighbor_densities) / len(neighbor_densities)
        if mean_neighbor < 1e-10:
            return 0.0
        return q_density / mean_neighbor

    def is_ood(self, computation_type: str,
               features: Tuple[float, ...]) -> Tuple[bool, float, str]:
        """Combined OOD check: relative density first, then NN distance.

        Returns (is_ood, score, reason).

        ORDER OF CHECKS (deliberate):
          1. Relative density — primary signal. Captures whether the query
             is in a region of similar density to its neighbors. Handles
             long-tail distributions correctly.
          2. NN distance — secondary signal, ONLY fires if the query is
             more than 3x the NN threshold away. This catches isolated
             outliers that the density check might miss, without
             rejecting legitimate tail-region queries that happen to be
             slightly farther than the (head-dominated) NN threshold.

        The 3x multiplier is critical: without it, the NN check fires on
        every tail query (because the NN threshold is dominated by head
        distances). With it, the NN check only fires for genuinely
        isolated points.
        """
        # Check relative density first (handles long-tail correctly)
        training = self._training_arrays.get(computation_type, [])
        if training:
            r = self._relative_density(computation_type, features)
            if r < self.relative_threshold:
                return True, r, (
                    f"relative density {r:.3f} < threshold "
                    f"{self.relative_threshold:.3f} "
                    f"(query density much lower than neighbors, likely OOD)")

        # NN distance check — but with a 3x multiplier to avoid rejecting
        # legitimate tail-region queries. The inherited is_ood uses the
        # raw threshold; we override it here.
        nn_threshold = self.thresholds.get(computation_type)
        if nn_threshold is None:
            return True, float("inf"), "gate_not_fit"

        training_feats = self.training_features.get(computation_type, [])
        if not training_feats:
            return True, float("inf"), "no_training_data"

        min_d = float("inf")
        for t in training_feats:
            d = math.sqrt(sum((a - b) ** 2 for a, b in zip(features, t)))
            if d < min_d:
                min_d = d

        # 3x multiplier: only reject if distance is more than 3x the
        # NN threshold. This prevents the NN check from firing on
        # legitimate tail-region queries.
        if min_d > 3 * nn_threshold:
            return True, min_d, (
                f"distance {min_d:.3f} > 3·threshold {3*nn_threshold:.3f} "
                f"(isolated outlier, likely OOD)")
        return False, min_d, "within_support"

    def get_density(self, computation_type: str,
                    features: Tuple[float, ...]) -> float:
        """Public accessor for density."""
        return self._density(computation_type, features)

    def get_relative_density(self, computation_type: str,
                              features: Tuple[float, ...]) -> float:
        """Public accessor for relative density."""
        return self._relative_density(computation_type, features)

    def measure_far(self, computation_type: str,
                    ood_probe: List[Tuple[float, ...]],
                    in_dist_probe: List[Tuple[float, ...]]) -> Dict[str, float]:
        """Measure FAR/FRR with the combined gate."""
        false_accepts = 0
        true_rejects = 0
        for f in ood_probe:
            is_ood, _, _ = self.is_ood(computation_type, f)
            if is_ood:
                self.true_rejects += 1
                true_rejects += 1
            else:
                self.false_accepts += 1
                false_accepts += 1

        false_rejects = 0
        true_accepts = 0
        for f in in_dist_probe:
            is_ood, _, _ = self.is_ood(computation_type, f)
            if is_ood:
                self.false_rejects += 1
                false_rejects += 1
            else:
                self.true_accepts += 1
                true_accepts += 1

        far = false_accepts / max(len(ood_probe), 1)
        frr = false_rejects / max(len(in_dist_probe), 1)
        return {
            "false_accept_rate": far,
            "false_reject_rate": frr,
            "true_accept_rate": true_accepts / max(len(in_dist_probe), 1),
            "true_reject_rate": true_rejects / max(len(ood_probe), 1),
            "n_ood_probe": len(ood_probe),
            "n_in_dist_probe": len(in_dist_probe),
            "nn_threshold": self.thresholds.get(computation_type, 0.0),
            "density_threshold": self.density_thresholds.get(computation_type, 0.0),
            "relative_threshold": self.relative_threshold,
            "gate_type": "density+relative_kde",
        }


# ===========================================================================
# Helper: build a Substrate that uses the density gate instead of NN gate
# ===========================================================================

def make_substrate_with_density_gate(min_confidence: float = 0.85,
                                      calibrated_target_acc: float = 0.90,
                                      bandwidth: float = 0.15,
                                      relative_threshold: float = 0.1,
                                      k_neighbors: int = 5):
    """Construct a Substrate instance with the DensityOODGate installed.

    This is a factory function that monkey-patches the substrate's OOD
    gate with the density-based version. We use this approach (rather
    than subclassing Substrate) to minimize changes to the v6.5 codebase
    and enable a clean ablation comparison.
    """
    from rce.rce2_substrate import Substrate
    sub = Substrate(min_confidence=min_confidence,
                    calibrated_target_acc=calibrated_target_acc)
    # Replace the OOD gate with the density version
    sub.ood_gate = DensityOODGate(
        bandwidth=bandwidth,
        relative_threshold=relative_threshold,
        k_neighbors=k_neighbors,
    )
    return sub
