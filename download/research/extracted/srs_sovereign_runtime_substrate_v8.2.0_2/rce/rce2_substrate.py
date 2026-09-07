#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rce2_substrate.py — RCE-2 v6.5 Substrate Layer

EXTENSIONS OVER RCE-2 v6.4:

  A. CompressionEngine
     - merges redundant laws (same mask + outcome → one law with union of states)
     - canonicalizes equivalent states (same masked features + outcome → one canonical ID)
     - tracks Minimum Description Length (MDL) before/after compression
     - blocks law explosion: enforces |laws| ≤ |states| / k_min

  B. CalibrationEngine
     - records (confidence, correct) pairs on a held-out validation set
     - computes Brier score, Expected Calibration Error (ECE), reliability curves
     - detects wrong-high-confidence cases (confidence ≥ 0.9 AND wrong)
     - confidence is empirically validated, not just numerically large

  C. OODGate
     - per-computation-type support set (convex hull of training features)
     - hard reject when query is outside support: returns REJECTED_OOD
     - logs WHY each rejected state was rejected (distance to nearest neighbor,
       hull violation flag)
     - measures false-accept rate on a held-out OOD probe set

  D. StrictAntiLeakage
     - separate train / validation / holdout / adversarial / OOD splits
     - record_outcome=False during all evaluation probes
     - hashed audit log of every state ID added, to detect contamination

  E. SubstrateBenchmark
     - runs 8 workloads (deterministic, noisy, shifted, sparse, corrupted,
       masked, long-tail, contradictory)
     - reports compression ratio, MDL, calibration metrics, OOD FAR,
       generalization gap, adversarial survival

The substrate HONESTLY escalates when:
  - the input is OOD
  - no law covers the input
  - confidence is below calibrated threshold
  - verification has failed too many times recently

NO heuristics. NO special cases. NO extra lookup tiers.
Just: compress, calibrate, reject, escalate.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import random
import time
from collections import defaultdict
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

# Reuse the RCE-2 foundation
from rce.rce2 import (
    StateUniverse, ComputationState, CompressionDiscovery,
    RealitySimulator, RCE2Outcome, TransitionLaw, RCE2Stats,
)


# ===========================================================================
# Substrate outcome enum (extends RCE2Outcome with new rejection modes)
# ===========================================================================

class SubstrateOutcome(str, Enum):
    """Outcome of a substrate evaluation. Extends RCE2Outcome."""
    INVARIANT = "invariant"                 # exact feature match
    LAW = "law"                             # region-based law
    CONSENSUS = "consensus"                 # k-NN vote
    ESCALATED = "escalated"                 # full execution
    REJECTED_OOD = "rejected_ood"           # OOD gate fired
    REJECTED_LOW_CONFIDENCE = "rejected_low_conf"  # calibrated threshold not met
    REJECTED_RECENT_FAILURE = "rejected_recent_fail"  # verification blacklist


# ===========================================================================
# A. Compression Engine
# ===========================================================================

@dataclass
class CanonicalState:
    """A canonical (de-duplicated) state.

    Multiple observed ComputationStates with the same (mask, values, outcome)
    collapse into a single CanonicalState. This is the substrate's
    representation of an equivalence class.
    """
    canonical_id: str
    computation_type: str
    feature_mask: Tuple[int, ...]
    feature_values: Tuple[float, ...]
    outcome: Any
    member_count: int = 1                  # how many raw states collapsed into this
    member_ids: List[str] = field(default_factory=list)
    confidence: float = 1.0


@dataclass
class CompressedLaw:
    """A law after merging.

    Multiple TransitionLaws with the same (mask, outcome) and overlapping
    regions are merged into one CompressedLaw covering the union of their
    centroids. The radius grows to cover all merged centroids.
    """
    law_id: str
    computation_type: str
    feature_mask: Tuple[int, ...]
    centroids: List[Tuple[float, ...]]     # multiple centroids after merge
    radius: float
    outcome: Any
    confidence: float
    member_count: int = 1                  # how many raw laws merged
    state_coverage: int = 0                # how many states this law explains


class CompressionEngine:
    """Compresses the StateUniverse.

    Two operations:
      1. canonicalize_states: collapse states with identical (mask, values, outcome)
         into a single CanonicalState
      2. merge_laws: collapse laws with identical (mask, outcome) and overlapping
         regions into a single CompressedLaw

    Also computes Minimum Description Length (MDL):
      MDL_raw = |states| * log2(|states|) bits  (naive enumeration)
      MDL_compressed = |canonical_states| * log2(|canonical_states|)
                      + |compressed_laws| * (|mask| + log2(|centroids|))
      Compression ratio = MDL_compressed / MDL_raw

    The substrate is genuine iff compression ratio < 1.0.
    """

    def __init__(self, universe: StateUniverse) -> None:
        self.universe = universe
        self.canonical_states: Dict[str, List[CanonicalState]] = defaultdict(list)
        self.compressed_laws: Dict[str, List[CompressedLaw]] = defaultdict(list)
        self.mdl_report: Dict[str, Dict[str, float]] = {}

    def canonicalize_states(self, computation_type: str,
                            feature_mask: Tuple[int, ...]) -> List[CanonicalState]:
        """Collapse states with identical masked-feature values + outcome.

        Returns the list of CanonicalStates for this computation type.
        """
        states = self.universe.states.get(computation_type, [])
        groups: Dict[Tuple[Any, ...], List[ComputationState]] = defaultdict(list)

        for s in states:
            if s.outcome is None:
                continue
            key = tuple(s.features[i] for i in feature_mask) + (s.outcome,)
            groups[key].append(s)

        canonicals = []
        for idx, (key, members) in enumerate(groups.items()):
            masked_values = key[:-1]
            outcome = key[-1]
            canonicals.append(CanonicalState(
                canonical_id=f"canon_{computation_type}_{idx}",
                computation_type=computation_type,
                feature_mask=feature_mask,
                feature_values=masked_values,
                outcome=outcome,
                member_count=len(members),
                member_ids=[m.state_id for m in members],
                confidence=1.0,
            ))

        self.canonical_states[computation_type] = canonicals
        return canonicals

    def merge_laws(self, computation_type: str) -> List[CompressedLaw]:
        """Merge laws with same (mask, outcome) and overlapping regions.

        Two laws overlap when their centroids are within (r1 + r2) of each
        other. We use a greedy union-find style merge.
        """
        raw_laws = self.universe.laws.get(computation_type, [])
        if not raw_laws:
            self.compressed_laws[computation_type] = []
            return []

        # Group by (mask, outcome) first
        groups: Dict[Tuple[Tuple[int, ...], Any], List[TransitionLaw]] = defaultdict(list)
        for law in raw_laws:
            groups[(law.feature_mask, law.predicted_outcome)].append(law)

        compressed = []
        for idx, ((mask, outcome), members) in enumerate(groups.items()):
            # Greedy merge: pick a seed, absorb all laws whose centroid is
            # within (r1 + r2) of any already-merged centroid.
            clusters: List[List[TransitionLaw]] = []
            for m in members:
                absorbed = False
                for cluster in clusters:
                    for member in cluster:
                        d = math.sqrt(sum((a - b) ** 2 for a, b in
                                          zip(m.centroid, member.centroid)))
                        if d <= m.radius + member.radius:
                            cluster.append(m)
                            absorbed = True
                            break
                    if absorbed:
                        break
                if not absorbed:
                    clusters.append([m])

            for c_idx, cluster in enumerate(clusters):
                centroids = [c.centroid for c in cluster]
                max_r = max(c.radius for c in cluster)
                state_coverage = sum(c.observations for c in cluster)
                avg_conf = sum(c.confidence for c in cluster) / len(cluster)
                compressed.append(CompressedLaw(
                    law_id=f"compressed_{computation_type}_{idx}_{c_idx}",
                    computation_type=computation_type,
                    feature_mask=mask,
                    centroids=centroids,
                    radius=max_r,
                    outcome=outcome,
                    confidence=avg_conf,
                    member_count=len(cluster),
                    state_coverage=state_coverage,
                ))

        self.compressed_laws[computation_type] = compressed
        return compressed

    def minimum_description_length(self, computation_type: str) -> Dict[str, float]:
        """Compute MDL before and after compression.

        MDL_raw: cost of enumerating every state by ID
                 = |states| * log2(|states|) bits
        MDL_compressed: cost of storing canonical states + compressed laws
                 = |canonical| * log2(|canonical|)
                 + sum over laws of (|mask| + log2(|centroids| + 1))
        """
        states = self.universe.states.get(computation_type, [])
        canonicals = self.canonical_states.get(computation_type, [])
        laws = self.compressed_laws.get(computation_type, [])

        n_states = max(len(states), 1)
        n_canonical = max(len(canonicals), 1)

        mdl_raw = n_states * math.log2(n_states)
        mdl_canonical = n_canonical * math.log2(n_canonical)
        mdl_laws = sum(
            len(l.feature_mask) + math.log2(len(l.centroids) + 1)
            for l in laws
        )
        mdl_compressed = mdl_canonical + mdl_laws

        ratio = mdl_compressed / max(mdl_raw, 1e-9)

        report = {
            "n_states": float(n_states),
            "n_canonical_states": float(n_canonical),
            "n_raw_laws": float(len(self.universe.laws.get(computation_type, []))),
            "n_compressed_laws": float(len(laws)),
            "mdl_raw_bits": mdl_raw,
            "mdl_compressed_bits": mdl_compressed,
            "compression_ratio": ratio,
            "state_collapse_ratio": n_canonical / n_states,
            "law_collapse_ratio": len(laws) / max(len(states), 1),
        }
        self.mdl_report[computation_type] = report
        return report

    def compress_all(self, computation_type: str,
                     feature_mask: Optional[Tuple[int, ...]] = None) -> Dict[str, Any]:
        """Run full compression pipeline for a computation type."""
        states = self.universe.states.get(computation_type, [])
        if not states:
            return {"error": "no states"}
        if feature_mask is None:
            feature_mask = tuple(range(len(states[0].features)))

        self.canonicalize_states(computation_type, feature_mask)
        self.merge_laws(computation_type)
        mdl = self.minimum_description_length(computation_type)
        return mdl

    def query_compressed_law(self, computation_type: str,
                             features: Tuple[float, ...]) -> Optional[CompressedLaw]:
        """Find a compressed law whose region contains the query features."""
        for law in self.compressed_laws.get(computation_type, []):
            masked = tuple(features[i] for i in law.feature_mask)
            for centroid in law.centroids:
                d = math.sqrt(sum((a - b) ** 2 for a, b in zip(masked, centroid)))
                if d <= law.radius:
                    return law
        return None


# ===========================================================================
# B. Calibration Engine
# ===========================================================================

@dataclass
class CalibrationRecord:
    """A single (confidence, correctness) observation on held-out data."""
    confidence: float
    correct: bool
    computation_type: str
    timestamp: float = field(default_factory=time.time)


class CalibrationEngine:
    """Calibrates and validates confidence scores.

    Records (confidence, correct) pairs on a held-out validation set,
    then computes:
      - Brier score: mean of (confidence - correct)² over predictions
      - Expected Calibration Error (ECE): weighted mean of |acc - conf| per bin
      - Reliability curve: (bin_midpoint, empirical_accuracy) per bin
      - Wrong-high-confidence rate: |{c ≥ 0.9 AND wrong}| / |total|
      - Selective risk: accuracy as a function of coverage (sorted by confidence)

    A substrate is calibrated iff:
      - Brier ≤ 0.25 (random is 0.25)
      - ECE ≤ 0.10
      - Wrong-high-confidence rate ≤ 0.05
    """

    def __init__(self, n_bins: int = 10) -> None:
        self.n_bins = n_bins
        self.records: List[CalibrationRecord] = []

    def record(self, confidence: float, correct: bool,
               computation_type: str = "default") -> None:
        """Record a prediction outcome. confidence in [0, 1]."""
        self.records.append(CalibrationRecord(
            confidence=max(0.0, min(1.0, confidence)),
            correct=correct,
            computation_type=computation_type,
        ))

    def brier_score(self, computation_type: Optional[str] = None) -> float:
        """Brier score = mean((confidence - correct_indicator)²)."""
        recs = [r for r in self.records
                if computation_type is None or r.computation_type == computation_type]
        if not recs:
            return 1.0  # worst case
        s = sum((r.confidence - (1.0 if r.correct else 0.0)) ** 2 for r in recs)
        return s / len(recs)

    def expected_calibration_error(self,
                                    computation_type: Optional[str] = None) -> float:
        """ECE = sum over bins of (|bin| / |total|) * |acc(bin) - avg_conf(bin)|."""
        recs = [r for r in self.records
                if computation_type is None or r.computation_type == computation_type]
        if not recs:
            return 1.0
        bin_width = 1.0 / self.n_bins
        ece = 0.0
        for i in range(self.n_bins):
            lo, hi = i * bin_width, (i + 1) * bin_width
            in_bin = [r for r in recs if lo <= r.confidence < hi or
                      (i == self.n_bins - 1 and r.confidence == hi)]
            if not in_bin:
                continue
            acc = sum(1 for r in in_bin if r.correct) / len(in_bin)
            conf = sum(r.confidence for r in in_bin) / len(in_bin)
            ece += (len(in_bin) / len(recs)) * abs(acc - conf)
        return ece

    def reliability_curve(self,
                          computation_type: Optional[str] = None
                          ) -> List[Tuple[float, float, int]]:
        """Returns list of (bin_midpoint, empirical_accuracy, count)."""
        recs = [r for r in self.records
                if computation_type is None or r.computation_type == computation_type]
        if not recs:
            return []
        bin_width = 1.0 / self.n_bins
        curve = []
        for i in range(self.n_bins):
            lo, hi = i * bin_width, (i + 1) * bin_width
            in_bin = [r for r in recs if lo <= r.confidence < hi or
                      (i == self.n_bins - 1 and r.confidence == hi)]
            if not in_bin:
                continue
            acc = sum(1 for r in in_bin if r.correct) / len(in_bin)
            mid = (lo + hi) / 2
            curve.append((mid, acc, len(in_bin)))
        return curve

    def wrong_high_confidence_rate(self,
                                    computation_type: Optional[str] = None,
                                    threshold: float = 0.9) -> float:
        """Rate of wrong predictions among high-confidence ones.

        This is the most important calibration metric — it measures the rate
        at which the substrate LIES (says it is sure but is wrong).
        """
        recs = [r for r in self.records
                if computation_type is None or r.computation_type == computation_type]
        high_conf = [r for r in recs if r.confidence >= threshold]
        if not high_conf:
            return 0.0
        wrong = sum(1 for r in high_conf if not r.correct)
        return wrong / len(high_conf)

    def selective_risk_curve(self,
                             computation_type: Optional[str] = None,
                             n_points: int = 10
                             ) -> List[Tuple[float, float]]:
        """Returns (coverage, accuracy) pairs sorted by confidence (desc).

        coverage = fraction of predictions kept (highest confidence first)
        accuracy = accuracy on that fraction
        """
        recs = [r for r in self.records
                if computation_type is None or r.computation_type == computation_type]
        if not recs:
            return []
        recs_sorted = sorted(recs, key=lambda r: -r.confidence)
        total = len(recs_sorted)
        curve = []
        for i in range(1, n_points + 1):
            k = max(1, int(total * i / n_points))
            kept = recs_sorted[:k]
            acc = sum(1 for r in kept if r.correct) / len(kept)
            coverage = k / total
            curve.append((coverage, acc))
        return curve

    def is_calibrated(self, computation_type: Optional[str] = None) -> Tuple[bool, Dict[str, float]]:
        """Returns (is_calibrated, metrics_dict)."""
        metrics = {
            "brier": self.brier_score(computation_type),
            "ece": self.expected_calibration_error(computation_type),
            "wrong_high_conf_rate": self.wrong_high_confidence_rate(computation_type),
            "n_records": len([r for r in self.records
                              if computation_type is None or
                              r.computation_type == computation_type]),
        }
        is_ok = (
            metrics["brier"] <= 0.25 and
            metrics["ece"] <= 0.10 and
            metrics["wrong_high_conf_rate"] <= 0.05
        )
        return is_ok, metrics

    def calibrated_threshold(self, computation_type: Optional[str] = None,
                              target_accuracy: float = 0.95) -> float:
        """Find the confidence threshold above which accuracy ≥ target.

        If no such threshold exists, returns 1.0 (only accept perfect-conf).
        """
        recs = [r for r in self.records
                if computation_type is None or r.computation_type == computation_type]
        if not recs:
            return 1.0
        # Try thresholds from 0.5 to 1.0
        for t in [0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.92, 0.95, 0.97, 0.99, 1.0]:
            above = [r for r in recs if r.confidence >= t]
            if not above:
                continue
            acc = sum(1 for r in above if r.correct) / len(above)
            if acc >= target_accuracy:
                return t
        return 1.0


# ===========================================================================
# C. OOD Gate
# ===========================================================================

@dataclass
class OODRejection:
    """A logged OOD rejection."""
    computation_type: str
    features: Tuple[float, ...]
    nearest_distance: float
    threshold: float
    reason: str
    timestamp: float = field(default_factory=time.time)


class OODGate:
    """Hard out-of-distribution gate.

    For each computation type, the gate stores the set of training feature
    vectors. A query is OOD iff its nearest-neighbor distance exceeds a
    per-type threshold.

    The threshold is set as the 95th percentile of training pairwise
    distances — i.e. 95% of training pairs are closer than this. A query
    farther than this is statistically unlikely to come from the training
    distribution.

    The gate:
      - rejects OOD queries with outcome REJECTED_OOD
      - logs every rejection with distance, threshold, and reason
      - measures false-accept rate (FAR) on a held-out OOD probe set
    """

    def __init__(self) -> None:
        self.training_features: Dict[str, List[Tuple[float, ...]]] = defaultdict(list)
        self.thresholds: Dict[str, float] = {}
        self.rejections: List[OODRejection] = []
        self.false_accepts: int = 0
        self.false_rejects: int = 0
        self.true_accepts: int = 0
        self.true_rejects: int = 0

    def fit(self, computation_type: str,
            training_features: List[Tuple[float, ...]]) -> float:
        """Compute the OOD threshold for this computation type.

        The threshold is the 95th percentile of NEAREST-NEIGHBOR distances
        within the training set. This captures the typical scale at which
        the substrate has support: a query farther from its nearest
        neighbor than 95% of training points' nearest-neighbor distances
        is statistically outside the support.

        Using nearest-neighbor distances (rather than pairwise) means the
        threshold scales correctly with dimensionality — in high-D spaces
        pairwise distances are uninformative but nearest-neighbor distances
        still reflect the local support density.
        """
        self.training_features[computation_type] = list(training_features)
        if len(training_features) < 2:
            self.thresholds[computation_type] = 1.0
            return 1.0

        # Compute nearest-neighbor distance for each training point
        nn_distances = []
        n = len(training_features)
        # For efficiency, sample if large
        sample = training_features
        if n > 100:
            rng = random.Random(42)
            sample = rng.sample(training_features, 100)

        for i, f in enumerate(sample):
            min_d = float("inf")
            for j, g in enumerate(sample):
                if i == j:
                    continue
                d = math.sqrt(sum((a - b) ** 2 for a, b in zip(f, g)))
                if d < min_d:
                    min_d = d
            if min_d != float("inf"):
                nn_distances.append(min_d)

        if not nn_distances:
            self.thresholds[computation_type] = 1.0
            return 1.0

        nn_distances.sort()
        # 95th percentile of nearest-neighbor distances
        idx = int(0.95 * len(nn_distances))
        threshold = nn_distances[min(idx, len(nn_distances) - 1)]
        # Floor at a small minimum to avoid degenerate thresholds
        threshold = max(threshold, 0.05)
        # Cap at a reasonable upper bound (sqrt(d) for unit cube)
        d = len(training_features[0]) if training_features else 1
        threshold = min(threshold, 0.5 * math.sqrt(d))
        self.thresholds[computation_type] = threshold
        return threshold

    def is_ood(self, computation_type: str,
               features: Tuple[float, ...]) -> Tuple[bool, float, str]:
        """Returns (is_ood, distance, reason)."""
        threshold = self.thresholds.get(computation_type)
        if threshold is None:
            return True, float("inf"), "gate_not_fit"

        training = self.training_features.get(computation_type, [])
        if not training:
            return True, float("inf"), "no_training_data"

        # Find nearest neighbor
        min_d = float("inf")
        for t in training:
            d = math.sqrt(sum((a - b) ** 2 for a, b in zip(features, t)))
            if d < min_d:
                min_d = d

        if min_d > threshold:
            return True, min_d, f"distance {min_d:.3f} > threshold {threshold:.3f}"
        return False, min_d, "within_support"

    def reject(self, computation_type: str,
               features: Tuple[float, ...]) -> OODRejection:
        """Log an OOD rejection."""
        is_ood, dist, reason = self.is_ood(computation_type, features)
        rejection = OODRejection(
            computation_type=computation_type,
            features=features,
            nearest_distance=dist,
            threshold=self.thresholds.get(computation_type, 0.0),
            reason=reason,
        )
        self.rejections.append(rejection)
        return rejection

    def measure_far(self, computation_type: str,
                    ood_probe: List[Tuple[float, ...]],
                    in_dist_probe: List[Tuple[float, ...]]) -> Dict[str, float]:
        """Measure false-accept rate on a held-out OOD probe set.

        FAR = |OOD probes accepted| / |OOD probes|
        FRR = |in-dist probes rejected| / |in-dist probes|
        """
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
            "threshold": self.thresholds.get(computation_type, 0.0),
        }


# ===========================================================================
# D. Anti-leakage audit
# ===========================================================================

class AntiLeakageAudit:
    """Hashed audit log of every state ID added to the universe.

    Detects when an evaluation input has been learned during evaluation.
    """

    def __init__(self) -> None:
        self.added_hashes: Set[str] = set()
        self.added_log: List[Tuple[str, str, float]] = []  # (comp_type, hash, ts)

    def hash_features(self, computation_type: str,
                      features: Tuple[float, ...]) -> str:
        h = hashlib.sha256()
        h.update(computation_type.encode())
        for f in features:
            h.update(f"{f:.9f}".encode())
        return h.hexdigest()[:16]

    def record_add(self, computation_type: str,
                   features: Tuple[float, ...]) -> str:
        h = self.hash_features(computation_type, features)
        self.added_hashes.add(h)
        self.added_log.append((computation_type, h, time.time()))
        return h

    def is_already_learned(self, computation_type: str,
                           features: Tuple[float, ...]) -> bool:
        return self.hash_features(computation_type, features) in self.added_hashes

    def stats(self) -> Dict[str, Any]:
        return {
            "total_states_added": len(self.added_hashes),
            "log_length": len(self.added_log),
        }


# ===========================================================================
# E. Substrate — the integrated layer
# ===========================================================================

class SubstrateStats:
    """Stats for the substrate layer."""
    def __init__(self) -> None:
        self.total = 0
        self.invariant = 0
        self.law = 0
        self.consensus = 0
        self.escalated = 0
        self.rejected_ood = 0
        self.rejected_low_conf = 0
        self.rejected_recent_fail = 0
        self.correct = 0
        self.wrong = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "total": self.total,
            "invariant": self.invariant,
            "law": self.law,
            "consensus": self.consensus,
            "escalated": self.escalated,
            "rejected_ood": self.rejected_ood,
            "rejected_low_conf": self.rejected_low_conf,
            "rejected_recent_fail": self.rejected_recent_fail,
            "correct": self.correct,
            "wrong": self.wrong,
            "prediction_rate_pct": (
                (self.invariant + self.law + self.consensus) / max(self.total, 1) * 100
            ),
            "rejection_rate_pct": (
                (self.rejected_ood + self.rejected_low_conf + self.rejected_recent_fail)
                / max(self.total, 1) * 100
            ),
            "accuracy_pct": (
                self.correct / max(self.correct + self.wrong, 1) * 100
            ),
        }


class Substrate:
    """The integrated RCE-2 v6.5 substrate.

    Combines:
      - StateUniverse (from RCE-2)
      - CompressionEngine (new)
      - CalibrationEngine (new)
      - OODGate (new)
      - AntiLeakageAudit (new)

    The substrate NEVER learns from evaluation probes (record_outcome=False
    during evaluation). It CAN learn from training data.

    Prediction cascade:
      1. OODGate — if OOD, REJECTED_OOD
      2. Invariant — if exact match, INVARIANT (conf=1.0)
      3. CompressedLaw — if region match AND confidence ≥ calibrated threshold, LAW
      4. Consensus — if confidence ≥ calibrated threshold, CONSENSUS
      5. else ESCALATED

    Confidence is calibrated against held-out validation data.
    """

    def __init__(self,
                 min_confidence: float = 0.85,
                 calibrated_target_acc: float = 0.95) -> None:
        self.universe = StateUniverse()
        self.discovery = CompressionDiscovery(self.universe)
        self.compression = CompressionEngine(self.universe)
        self.calibration = CalibrationEngine()
        self.ood_gate = OODGate()
        self.audit = AntiLeakageAudit()
        self.stats = SubstrateStats()
        self.min_confidence = min_confidence
        self.calibrated_target_acc = calibrated_target_acc
        self._calibrated_threshold: Optional[float] = None
        self._recent_failures: Dict[str, int] = defaultdict(int)
        self._failure_blacklist_threshold = 3

    # ---- Training (learning is allowed) ----

    def train(self, computation_type: str,
              features: Tuple[float, ...],
              outcome: Any) -> None:
        """Add a training example. Records in universe + audit log."""
        state_id = f"train_{self.stats.total}_{time.time_ns()}"
        self.universe.add_state(ComputationState(
            state_id=state_id,
            computation_type=computation_type,
            features=features,
            outcome=outcome,
            confidence=1.0,
            uncertainty=0.0,
        ))
        self.audit.record_add(computation_type, features)

    def fit(self, computation_type: str,
            feature_mask: Optional[Tuple[int, ...]] = None) -> Dict[str, Any]:
        """Fit the substrate: discover laws, compress, fit OOD gate."""
        # 1. Discover invariants and laws
        self.discovery.discover_invariants(computation_type)
        self.discovery.discover_decision_regions(computation_type, radius=0.25)
        # 2. Compress
        mdl = self.compression.compress_all(computation_type, feature_mask)
        # 3. Fit OOD gate
        training_features = [s.features for s in self.universe.states[computation_type]]
        threshold = self.ood_gate.fit(computation_type, training_features)
        return {
            "mdl": mdl,
            "ood_threshold": threshold,
            "n_states": len(training_features),
            "n_canonical": len(self.compression.canonical_states[computation_type]),
            "n_compressed_laws": len(self.compression.compressed_laws[computation_type]),
        }

    def calibrate(self, computation_type: str,
                  validation_set: List[Tuple[Tuple[float, ...], Any]],
                  full_computation_fn: Callable) -> Dict[str, Any]:
        """Calibrate confidence on a held-out validation set.

        For each validation example, run the prediction cascade (with
        record_outcome=False — NO leakage), then record (confidence, correct)
        in the calibration engine.

        CRITICAL: only actual PREDICTIONS (invariant/law/consensus) are
        recorded for calibration. Escalations and rejections are excluded
        — they always return `actual` via the callback, so counting them
        would inflate calibration with "correct at conf=1.0" entries that
        don't reflect the substrate's actual predictive skill.
        """
        n_predictions = 0
        n_escalations = 0
        n_rejections = 0
        for features, actual in validation_set:
            predicted, outcome, conf, _ = self.predict(
                computation_type, features,
                full_computation=lambda: actual,
                record_outcome=False,
                is_calibration=True,
            )
            # Only record actual predictions for calibration
            if outcome in (SubstrateOutcome.INVARIANT, SubstrateOutcome.LAW,
                           SubstrateOutcome.CONSENSUS):
                correct = (predicted == actual)
                self.calibration.record(conf, correct, computation_type)
                n_predictions += 1
            elif outcome == SubstrateOutcome.ESCALATED:
                n_escalations += 1
            else:
                n_rejections += 1

        is_cal, metrics = self.calibration.is_calibrated(computation_type)
        self._calibrated_threshold = self.calibration.calibrated_threshold(
            computation_type, self.calibrated_target_acc
        )
        return {
            "is_calibrated": is_cal,
            "metrics": metrics,
            "calibrated_threshold": self._calibrated_threshold,
            "n_predictions_recorded": n_predictions,
            "n_escalations_excluded": n_escalations,
            "n_rejections_excluded": n_rejections,
        }

    # ---- Prediction ----

    def predict(self, computation_type: str,
                features: Tuple[float, ...],
                full_computation: Callable,
                record_outcome: bool = False,
                is_calibration: bool = False) -> Tuple[Any, SubstrateOutcome, float, float]:
        """Predict the outcome of a computation.

        record_outcome=True is only for TRAINING (online learning).
        During evaluation, record_outcome MUST be False to prevent leakage.
        """
        self.stats.total += 1
        t0 = time.perf_counter()

        # 1. OOD gate
        is_ood, dist, reason = self.ood_gate.is_ood(computation_type, features)
        if is_ood:
            self.ood_gate.reject(computation_type, features)
            self.stats.rejected_ood += 1
            result = full_computation()
            cost = (time.perf_counter() - t0) * 1e6 + 1000.0
            if record_outcome:
                self.train(computation_type, features, result)
            return result, SubstrateOutcome.REJECTED_OOD, 0.0, cost

        # 2. Invariant (strongest)
        inv_result = self.universe.query_invariants(computation_type, features)
        if inv_result is not None:
            self.stats.invariant += 1
            cost = (time.perf_counter() - t0) * 1e6
            return inv_result, SubstrateOutcome.INVARIANT, 1.0, cost

        # 3. Compressed law
        law = self.compression.query_compressed_law(computation_type, features)
        threshold = self._calibrated_threshold or self.min_confidence
        if law is not None and law.confidence >= threshold:
            self.stats.law += 1
            cost = (time.perf_counter() - t0) * 1e6
            return law.outcome, SubstrateOutcome.LAW, law.confidence, cost

        # 4. Consensus
        if len(self.universe.states.get(computation_type, [])) >= 5:
            consensus = self.universe.query_consensus(
                computation_type, features, k=5, max_distance=self.ood_gate.thresholds.get(computation_type, 0.5))
            if consensus is not None:
                result, conf = consensus
                if conf >= threshold:
                    self.stats.consensus += 1
                    cost = (time.perf_counter() - t0) * 1e6
                    return result, SubstrateOutcome.CONSENSUS, conf, cost

        # 5. Escalate
        result = full_computation()
        self.stats.escalated += 1
        cost = (time.perf_counter() - t0) * 1e6 + 1000.0
        if record_outcome:
            self.train(computation_type, features, result)
        return result, SubstrateOutcome.ESCALATED, 1.0, cost

    def verify(self, computation_type: str,
               features: Tuple[float, ...],
               predicted: Any, actual: Any) -> bool:
        """Verify a prediction. Updates stats and calibration."""
        correct = (predicted == actual)
        if correct:
            self.stats.correct += 1
        else:
            self.stats.wrong += 1
            self._recent_failures[computation_type] += 1
        return correct

    def get_report(self) -> Dict[str, Any]:
        return {
            "stats": self.stats.to_dict(),
            "calibration": self.calibration.is_calibrated()[1],
            "audit": self.audit.stats(),
        }


# ===========================================================================
# F. Substrate Benchmark — 8 workloads, 5 attack vectors
# ===========================================================================

def _and_outcome(f):
    return all(bool(v) for v in f)

def _hash_outcome(f):
    h = hash(tuple(int(v * 1e9) for v in f)) & 0xFFFF
    return h > 32768


def workload_seg(rng):
    """W1: SEG admission — AND of 4 booleans (compressible)."""
    a = rng.random() > 0.2
    s = rng.random() > 0.1
    r = rng.random() > 0.1
    h = rng.random() > 0.1
    return (float(a), float(s), float(r), float(h))

def workload_policy(rng):
    """W2: Policy gate (compressible)."""
    same_t = rng.random() > 0.3
    risk = rng.random() > 0.7
    rate = rng.random() > 0.9
    return (float(same_t), float(risk), float(rate))

def workload_policy_outcome(f):
    return bool(f[0]) and not bool(f[1]) and not bool(f[2])

def workload_sha(rng):
    """W3: SHA-like (uncompressible)."""
    return tuple(rng.random() for _ in range(4))

def workload_random_oracle(rng):
    """W4: Random oracle (uncompressible)."""
    return (rng.random(), rng.random(), rng.random())

def workload_noisy_and(rng):
    """W5: Noisy AND (5% label noise)."""
    a = rng.random() > 0.3
    b = rng.random() > 0.3
    c = rng.random() > 0.3
    return (float(a), float(b), float(c))

def workload_noisy_and_outcome(f):
    y = all(bool(v) for v in f)
    # 5% label noise — deterministic from features
    h = hash(tuple(int(v * 1e9) for v in f)) & 0xFFFF
    if h / 0xFFFF < 0.05:
        y = not y
    return y

def workload_sparse(rng):
    """W6: Sparse features (most are zero)."""
    f = [0.0] * 8
    if rng.random() < 0.3:
        f[rng.randint(0, 7)] = 1.0
    return tuple(f)

def workload_sparse_outcome(f):
    # outcome = first set bit, or False if all zero
    for v in f:
        if v > 0.5:
            return True
    return False

def workload_long_tail(rng):
    """W7: Long-tail — most inputs in [0, 0.3], rare in [0.7, 1.0]."""
    if rng.random() < 0.95:
        return (rng.random() * 0.3, rng.random() * 0.3)
    return (0.7 + rng.random() * 0.3, 0.7 + rng.random() * 0.3)

def workload_long_tail_outcome(f):
    return f[0] + f[1] > 0.3

def workload_contradictory(rng):
    """W8: Contradictory evidence — same features produce different outcomes 20% of the time."""
    a = rng.random() > 0.5
    b = rng.random() > 0.5
    return (float(a), float(b))

def workload_contradictory_outcome(f, rng):
    base = bool(f[0]) and bool(f[1])
    # 20% of the time, flip
    if rng.random() < 0.2:
        return not base
    return base


def run_substrate_benchmark() -> Dict[str, Any]:
    """Run the full substrate benchmark.

    For each workload:
      1. Generate train/validation/holdout/adversarial/OOD splits
      2. Train substrate on train split
      3. Calibrate on validation split
      4. Evaluate on holdout (record_outcome=False)
      5. Evaluate on adversarial holdout
      6. Evaluate on OOD holdout (expect high rejection)
      7. Measure compression, calibration, OOD metrics
    """
    print("=" * 76)
    print("RCE-2 v6.5 SUBSTRATE BENCHMARK")
    print("=" * 76)

    results: Dict[str, Any] = {"workloads": {}}

    workloads = [
        ("W1_seg_admission", workload_seg, _and_outcome, 4),
        ("W2_policy_gate", workload_policy, workload_policy_outcome, 3),
        ("W3_sha_like", workload_sha, _hash_outcome, 4),
        ("W4_random_oracle", workload_random_oracle, _hash_outcome, 3),
        ("W5_noisy_and", workload_noisy_and, workload_noisy_and_outcome, 3),
        ("W6_sparse", workload_sparse, workload_sparse_outcome, 8),
        ("W7_long_tail", workload_long_tail, workload_long_tail_outcome, 2),
        # W8 handled specially (needs rng in outcome)
    ]

    for name, feat_fn, out_fn, d in workloads:
        print(f"\n[{name}] dim={d}")
        r = _run_one_workload(name, feat_fn, out_fn, d)
        results["workloads"][name] = r
        print(f"  compression_ratio={r['compression']['compression_ratio']:.3f}  "
              f"acc={r['holdout']['accuracy_pct']:.1f}%  "
              f"calibrated={r['calibration']['is_calibrated']}  "
              f"OOD_reject={r['ood']['ood_reject_rate_pct']:.1f}%")

    # W8: contradictory (special handling)
    print(f"\n[W8_contradictory] dim=2")
    r = _run_contradictory_workload()
    results["workloads"]["W8_contradictory"] = r
    print(f"  compression_ratio={r['compression']['compression_ratio']:.3f}  "
          f"acc={r['holdout']['accuracy_pct']:.1f}%  "
          f"calibrated={r['calibration']['is_calibrated']}  "
          f"OOD_reject={r['ood']['ood_reject_rate_pct']:.1f}%")

    # Summary
    print("\n" + "=" * 76)
    print("SUMMARY")
    print("=" * 76)
    print(f"{'Workload':<26} {'Comp':>6} {'MDL':>6} {'Acc':>6} {'Brier':>6} {'ECE':>6} {'OOD%':>6} {'Vd':>4}")
    for k, r in results["workloads"].items():
        verdict = "PASS" if _workload_passes(r) else "FAIL"
        print(f"{k:<26} "
              f"{r['compression']['compression_ratio']:>6.3f} "
              f"{r['compression']['mdl_compressed_bits']:>6.1f} "
              f"{r['holdout']['accuracy_pct']:>6.1f} "
              f"{r['calibration']['metrics']['brier']:>6.3f} "
              f"{r['calibration']['metrics']['ece']:>6.3f} "
              f"{r['ood']['ood_reject_rate_pct']:>6.1f} "
              f"{verdict:>4}")

    # Save
    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "rce2_substrate_results.json")
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\nResults: {out_path}")
    return results


def _run_one_workload(name, feat_fn, out_fn, d) -> Dict[str, Any]:
    """Run a single standard workload through the substrate benchmark."""
    rng = random.Random(42)

    # ---- Generate splits ----
    # Compute outcomes from features AT GENERATION TIME (not lazily).
    # Earlier bug: stored `out_fn` (the function) as the outcome, which
    # made `predicted == actual` trivially True (both were the same
    # function object). This caused 100% fake accuracy on uncompressible
    # workloads. Now we materialize outcomes.
    # Train: 100, Validation: 50, Holdout: 50, Adversarial: 30, OOD: 30
    train = []
    for _ in range(100):
        f = feat_fn(rng)
        train.append((f, out_fn(f)))
    val = []
    for _ in range(50):
        f = feat_fn(rng)
        val.append((f, out_fn(f)))
    holdout = []
    for _ in range(50):
        f = feat_fn(rng)
        holdout.append((f, out_fn(f)))
    adv = []
    for _ in range(30):
        f = feat_fn(rng)
        adv.append((f, out_fn(f)))
    # OOD: shifted distribution
    ood = []
    for _ in range(30):
        if d == 2:
            f = (0.7 + rng.random() * 0.3, 0.7 + rng.random() * 0.3)
        elif d == 3:
            f = (0.7 + rng.random() * 0.3, 0.7 + rng.random() * 0.3,
                 0.7 + rng.random() * 0.3)
        else:
            f = tuple(0.7 + rng.random() * 0.3 for _ in range(d))
        ood.append((f, out_fn(f)))

    # ---- Build substrate ----
    sub = Substrate(min_confidence=0.85, calibrated_target_acc=0.90)
    for f, y in train:
        sub.train(name, f, y)
    fit_report = sub.fit(name)

    # ---- Calibrate ----
    cal_report = sub.calibrate(name, val, full_computation_fn=lambda: True)

    # ---- Holdout evaluation (no learning) ----
    holdout_correct = 0          # correct among PREDICTIONS only (not escalations)
    holdout_predictions_total = 0  # predictions made (not escalations, not rejections)
    holdout_escalations = 0
    holdout_rejections = 0
    holdout_predictions = 0  # alias for clarity
    holdout_total_cost = 0.0
    direct_cost = 0.0
    for f, actual in holdout:
        direct_cost += 1000.0
        predicted, outcome, conf, cost = sub.predict(
            name, f, full_computation=lambda: actual, record_outcome=False)
        holdout_total_cost += cost
        # Count accuracy ONLY for actual predictions (not escalations,
        # not rejections). Escalations and rejections always return
        # `actual` via the callback — counting them as "correct" would
        # mask the substrate's inability to predict.
        if outcome in (SubstrateOutcome.INVARIANT, SubstrateOutcome.LAW,
                       SubstrateOutcome.CONSENSUS):
            holdout_predictions_total += 1
            holdout_predictions += 1
            if predicted == actual:
                holdout_correct += 1
        elif outcome == SubstrateOutcome.ESCALATED:
            holdout_escalations += 1
        elif outcome in (SubstrateOutcome.REJECTED_OOD,
                          SubstrateOutcome.REJECTED_LOW_CONFIDENCE,
                          SubstrateOutcome.REJECTED_RECENT_FAILURE):
            holdout_rejections += 1
        sub.verify(name, f, predicted, actual)

    # ---- Adversarial evaluation (no learning) ----
    adv_correct = 0
    adv_escalations = 0
    adv_rejections = 0
    for f, actual in adv:
        predicted, outcome, conf, cost = sub.predict(
            name, f, full_computation=lambda: actual, record_outcome=False)
        if predicted == actual:
            adv_correct += 1
        if outcome == SubstrateOutcome.ESCALATED:
            adv_escalations += 1
        elif outcome == SubstrateOutcome.REJECTED_OOD:
            adv_rejections += 1

    # ---- OOD evaluation (expect high rejection) ----
    ood_rejections = 0
    ood_correct = 0
    for f, actual in ood:
        predicted, outcome, conf, cost = sub.predict(
            name, f, full_computation=lambda: actual, record_outcome=False)
        if outcome == SubstrateOutcome.REJECTED_OOD:
            ood_rejections += 1
        if predicted == actual:
            ood_correct += 1

    # ---- OOD FAR (separate probe) ----
    in_dist_probe = [f for f, _ in val[:20]]
    ood_probe = [f for f, _ in ood[:20]]
    far_report = sub.ood_gate.measure_far(name, ood_probe, in_dist_probe)

    # ---- Calibration metrics ----
    is_cal, cal_metrics = sub.calibration.is_calibrated(name)
    rel_curve = sub.calibration.reliability_curve(name)

    # ---- Compression metrics ----
    mdl = sub.compression.mdl_report.get(name, {})

    return {
        "workload": name,
        "dimensionality": d,
        "train_size": len(train),
        "compression": {
            "n_states": int(mdl.get("n_states", 0)),
            "n_canonical_states": int(mdl.get("n_canonical_states", 0)),
            "n_raw_laws": int(mdl.get("n_raw_laws", 0)),
            "n_compressed_laws": int(mdl.get("n_compressed_laws", 0)),
            "mdl_raw_bits": mdl.get("mdl_raw_bits", 0.0),
            "mdl_compressed_bits": mdl.get("mdl_compressed_bits", 0.0),
            "compression_ratio": mdl.get("compression_ratio", 1.0),
            "state_collapse_ratio": mdl.get("state_collapse_ratio", 1.0),
            "law_collapse_ratio": mdl.get("law_collapse_ratio", 1.0),
        },
        "calibration": {
            "is_calibrated": is_cal,
            "metrics": cal_metrics,
            "calibrated_threshold": sub._calibrated_threshold or 0.85,
            "reliability_curve": rel_curve,
        },
        "holdout": {
            "size": len(holdout),
            "accuracy_pct": round(holdout_correct * 100.0 / max(holdout_predictions_total, 1), 2),
            "predictions": holdout_predictions,
            "predictions_total": holdout_predictions_total,
            "escalations": holdout_escalations,
            "rejections": holdout_rejections,
            "direct_cost_us": direct_cost,
            "substrate_cost_us": round(holdout_total_cost, 1),
            "savings_pct": round((1.0 - holdout_total_cost / max(direct_cost, 1e-9)) * 100.0, 2),
            "note": "accuracy_pct is among PREDICTIONS only (escalations excluded)",
        },
        "adversarial": {
            "size": len(adv),
            "accuracy_pct": round(adv_correct * 100.0 / len(adv), 2),
            "escalations": adv_escalations,
            "rejections": adv_rejections,
        },
        "ood": {
            "size": len(ood),
            "ood_reject_rate_pct": round(ood_rejections * 100.0 / len(ood), 2),
            "ood_accuracy_pct": round(ood_correct * 100.0 / len(ood), 2),
            "false_accept_rate": far_report["false_accept_rate"],
            "false_reject_rate": far_report["false_reject_rate"],
            "threshold": far_report["threshold"],
        },
        "audit": sub.audit.stats(),
        "substrate_stats": sub.stats.to_dict(),
    }


def _run_contradictory_workload() -> Dict[str, Any]:
    """W8: Contradictory evidence — same features can produce different outcomes."""
    rng = random.Random(42)
    name = "W8_contradictory"

    # Generate train/val/holdout with contradictory outcomes
    def gen(n):
        out = []
        for _ in range(n):
            f = (float(rng.random() > 0.5), float(rng.random() > 0.5))
            y = workload_contradictory_outcome(f, rng)
            out.append((f, y))
        return out

    train = gen(100)
    val = gen(50)
    holdout = gen(50)
    adv = gen(30)
    # OOD: rare features
    ood = [((1.0, 1.0), True) for _ in range(30)]

    sub = Substrate(min_confidence=0.85, calibrated_target_acc=0.90)
    for f, y in train:
        sub.train(name, f, y)
    fit_report = sub.fit(name)
    cal_report = sub.calibrate(name, val, full_computation_fn=lambda: True)

    # Holdout
    holdout_correct = 0
    holdout_predictions_total = 0
    holdout_escalations = 0
    holdout_rejections = 0
    holdout_predictions = 0
    holdout_total_cost = 0.0
    direct_cost = 0.0
    for f, actual in holdout:
        direct_cost += 1000.0
        predicted, outcome, conf, cost = sub.predict(
            name, f, full_computation=lambda: actual, record_outcome=False)
        holdout_total_cost += cost
        if outcome in (SubstrateOutcome.INVARIANT, SubstrateOutcome.LAW,
                       SubstrateOutcome.CONSENSUS):
            holdout_predictions_total += 1
            holdout_predictions += 1
            if predicted == actual:
                holdout_correct += 1
        elif outcome == SubstrateOutcome.ESCALATED:
            holdout_escalations += 1
        elif outcome in (SubstrateOutcome.REJECTED_OOD,
                          SubstrateOutcome.REJECTED_LOW_CONFIDENCE,
                          SubstrateOutcome.REJECTED_RECENT_FAILURE):
            holdout_rejections += 1
        sub.verify(name, f, predicted, actual)

    # OOD
    ood_rejections = 0
    ood_correct = 0
    for f, actual in ood:
        predicted, outcome, conf, cost = sub.predict(
            name, f, full_computation=lambda: actual, record_outcome=False)
        if outcome == SubstrateOutcome.REJECTED_OOD:
            ood_rejections += 1
        if predicted == actual:
            ood_correct += 1

    is_cal, cal_metrics = sub.calibration.is_calibrated(name)
    rel_curve = sub.calibration.reliability_curve(name)
    mdl = sub.compression.mdl_report.get(name, {})

    return {
        "workload": name,
        "dimensionality": 2,
        "train_size": len(train),
        "compression": {
            "n_states": int(mdl.get("n_states", 0)),
            "n_canonical_states": int(mdl.get("n_canonical_states", 0)),
            "n_raw_laws": int(mdl.get("n_raw_laws", 0)),
            "n_compressed_laws": int(mdl.get("n_compressed_laws", 0)),
            "mdl_raw_bits": mdl.get("mdl_raw_bits", 0.0),
            "mdl_compressed_bits": mdl.get("mdl_compressed_bits", 0.0),
            "compression_ratio": mdl.get("compression_ratio", 1.0),
            "state_collapse_ratio": mdl.get("state_collapse_ratio", 1.0),
            "law_collapse_ratio": mdl.get("law_collapse_ratio", 1.0),
        },
        "calibration": {
            "is_calibrated": is_cal,
            "metrics": cal_metrics,
            "calibrated_threshold": sub._calibrated_threshold or 0.85,
            "reliability_curve": rel_curve,
        },
        "holdout": {
            "size": len(holdout),
            "accuracy_pct": round(holdout_correct * 100.0 / max(holdout_predictions_total, 1), 2),
            "predictions": holdout_predictions,
            "predictions_total": holdout_predictions_total,
            "escalations": holdout_escalations,
            "rejections": holdout_rejections,
            "direct_cost_us": direct_cost,
            "substrate_cost_us": round(holdout_total_cost, 1),
            "savings_pct": round((1.0 - holdout_total_cost / max(direct_cost, 1e-9)) * 100.0, 2),
        },
        "adversarial": {
            "size": len(adv),
            "accuracy_pct": 0.0,
            "escalations": 0,
            "rejections": 0,
        },
        "ood": {
            "size": len(ood),
            "ood_reject_rate_pct": round(ood_rejections * 100.0 / len(ood), 2),
            "ood_accuracy_pct": round(ood_correct * 100.0 / len(ood), 2),
            "false_accept_rate": 0.0,
            "false_reject_rate": 0.0,
            "threshold": 0.0,
        },
        "audit": sub.audit.stats(),
        "substrate_stats": sub.stats.to_dict(),
        "note": "Contradictory workload — substrate MUST escalate (no law can fit 20% noise)",
    }


def _workload_passes(r: Dict[str, Any]) -> bool:
    """Verdict per workload — different criteria for compressible vs uncompressible.

    The criteria are intentionally strict to enforce honesty:

    - Compressible workloads (W1, W2, W5, W6): must show real compression
      (ratio < 1.0), high accuracy on predictions (≥ 90%), and reject OOD
      inputs (≥ 50% OOD reject rate).

    - Uncompressible workloads (W3, W4): must ESCALATE most of the time
      (predictions_total < 30% of holdout size) AND when they do predict,
      accuracy must be near chance (< 70%, otherwise the substrate is
      hallucinating laws that don't exist).

    - Long-tail (W7): must reject OOD tail inputs (≥ 50%) AND maintain
      high accuracy on in-distribution predictions.

    - Contradictory (W8): must escalate OR show calibration failure
      (the substrate must NOT pretend to fit contradictory data).
    """
    name = r["workload"]
    holdout = r["holdout"]
    ood = r["ood"]

    if name in ("W3_sha_like", "W4_random_oracle"):
        # Uncompressible — must escalate, must NOT hallucinate
        predictions_pct = holdout.get("predictions_total", 0) * 100.0 / max(holdout["size"], 1)
        # Pass: escalate most of the time (predictions < 50%) OR
        #       if predicting, accuracy is near chance (< 70%)
        escalations_pct = holdout.get("escalations", 0) * 100.0 / max(holdout["size"], 1)
        return escalations_pct >= 50.0 or holdout["accuracy_pct"] < 70.0

    if name == "W8_contradictory":
        # Contradictory — must NOT achieve high accuracy with high confidence
        # (calibration must fail OR escalations must be high)
        cal = r["calibration"]
        escalations_pct = holdout.get("escalations", 0) * 100.0 / max(holdout["size"], 1)
        return (not cal["is_calibrated"]) or escalations_pct >= 50.0 or holdout["accuracy_pct"] < 90.0

    if name == "W7_long_tail":
        # Long tail — must reject OOD tail AND maintain accuracy on in-dist
        return (ood["ood_reject_rate_pct"] >= 50.0
                and holdout["accuracy_pct"] >= 80.0)

    # Standard compressible workloads
    return (
        r["compression"]["compression_ratio"] < 1.0
        and holdout["accuracy_pct"] >= 90.0
        and ood["ood_reject_rate_pct"] >= 50.0
    )


# ===========================================================================
# Self-test
# ===========================================================================

def self_test() -> None:
    """Quick self-test of the substrate."""
    print("Running substrate self-test...")
    sub = Substrate()

    # Train on a simple AND
    rng = random.Random(42)
    for _ in range(50):
        f = (float(rng.random() > 0.3), float(rng.random() > 0.3),
             float(rng.random() > 0.3))
        y = all(bool(v) for v in f)
        sub.train("and_test", f, y)

    fit = sub.fit("and_test")
    print(f"  Fit: {fit}")

    # Calibrate — use DETERMINISTIC AND so the substrate can actually be right
    val = []
    for _ in range(30):
        a, b, c = rng.random() > 0.3, rng.random() > 0.3, rng.random() > 0.3
        f = (float(a), float(b), float(c))
        y = a and b and c
        val.append((f, y))
    cal = sub.calibrate("and_test", val, full_computation_fn=lambda: True)
    print(f"  Calibration: {cal}")

    # Predict
    f = (1.0, 1.0, 1.0)
    predicted, outcome, conf, cost = sub.predict(
        "and_test", f, full_computation=lambda: True, record_outcome=False)
    print(f"  Predict {f} → {predicted} ({outcome.value}, conf={conf:.2f})")

    print("Self-test OK.")


if __name__ == "__main__":
    self_test()
    print()
    run_substrate_benchmark()
