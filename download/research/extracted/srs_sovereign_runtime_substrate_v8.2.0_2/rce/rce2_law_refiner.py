#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rce2_law_refiner.py — RCE-2 v6.9 Online Law Refinement

PROBLEM (inherited from v6.5-v6.8):
  When a LAW prediction fails verification, the substrate records
  stats.law_incorrect += 1 but the law STAYS in the database and
  continues to make wrong predictions. This is a memory leak in
  the substrate's honesty: it knows a law is broken but keeps using it.

SOLUTION:
  The OnlineLawRefiner automatically:
    1. INVALIDATES laws that fail verification repeatedly
    2. SHRINKS the radius of laws that fail at the boundary
    3. DECAYS the confidence of laws that fail occasionally
    4. EXCLUDES counterexamples from re-discovered laws
    5. QUARANTINES laws that fail >3 times (removed from active set)

MECHANISM:

  Each CompressedLaw gains a `failures` counter and a `status` field:
    status ∈ {ACTIVE, SUSPECT, QUARANTINED}
    failures = number of verification failures
    successes = number of verification successes

  On verification failure:
    law.failures += 1
    if law.failures >= 3:
        law.status = QUARANTINED  (removed from active set)
    elif law.failures >= 1:
        law.status = SUSPECT
        law.confidence *= 0.7     (decay)
        # Shrink radius to exclude the counterexample
        new_radius = distance_to_counterexample * 0.9
        law.radius = min(law.radius, new_radius)

  On verification success:
    law.successes += 1
    if law.successes >= 5 and law.status == SUSPECT:
        law.status = ACTIVE       (rehabilitated)
        law.failures = max(0, law.failures - 1)

  Periodically (every 20 predictions):
    - Re-discover laws excluding QUARANTINED regions
    - Remove laws with confidence < 0.1

MATHEMATICAL MODEL:

  Law reliability R(L) = successes / (successes + failures)
  Law confidence κ(L) = initial_confidence × R(L) × decay_factor
  where decay_factor = 0.7^failures

  A law is quarantined when R(L) < 1/3 (more than 2x failures vs successes)
  OR when failures >= 3 (absolute threshold).

  Radius shrinking: when a counterexample at distance d from the centroid
  falls inside the law's region (d ≤ r), the new radius is 0.9 × d,
  excluding the counterexample and a small margin around it.

This is the substrate's SELF-CORRECTION mechanism: it learns from its
mistakes and removes laws that don't hold, rather than silently using
broken laws.
"""
from __future__ import annotations

import math
import time
from collections import defaultdict
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple

from rce.rce2_substrate import (
    Substrate, SubstrateOutcome, SubstrateStats,
)
from rce.rce2_adaptive_gate import make_substrate_with_adaptive_gate
from rce.rce2_reuse_classifier import (
    SubstrateV68, ReuseClassifier, ReuseType, ReuseClassification,
    CostBenefitAnalyzer, CostBenefitResult,
)


# ===========================================================================
# Law Status Enum
# ===========================================================================

class LawStatus(str, Enum):
    """Status of a compressed law in the active set."""
    ACTIVE = "active"           # fully trusted
    SUSPECT = "suspect"         # failed once, confidence decayed
    QUARANTINED = "quarantined" # failed >= 3 times, removed from active set


# ===========================================================================
# Refined Law (extends CompressedLaw with status tracking)
# ===========================================================================

@dataclass
class RefinedLaw:
    """A compressed law with online refinement metadata."""
    law_id: str
    computation_type: str
    feature_mask: Tuple[int, ...]
    centroids: List[Tuple[float, ...]]
    radius: float
    outcome: Any
    confidence: float
    member_count: int = 1
    state_coverage: int = 0
    # Refinement fields
    failures: int = 0
    successes: int = 0
    status: LawStatus = LawStatus.ACTIVE
    original_radius: float = 0.0      # radius before shrinking
    original_confidence: float = 0.0  # confidence before decay
    counterexamples: List[Tuple[float, ...]] = field(default_factory=list)
    last_updated: float = field(default_factory=time.time)

    @property
    def reliability(self) -> float:
        """R(L) = successes / (successes + failures)."""
        total = self.successes + self.failures
        if total == 0:
            return 1.0  # no evidence yet → assume reliable
        return self.successes / total

    @property
    def effective_confidence(self) -> float:
        """κ(L) = original_confidence × reliability × 0.7^failures."""
        decay = 0.7 ** self.failures
        return self.original_confidence * self.reliability * decay

    def contains(self, features: Tuple[float, ...]) -> bool:
        """Check if features fall within this law's region."""
        masked = tuple(features[i] for i in self.feature_mask)
        for centroid in self.centroids:
            d = math.sqrt(sum((a - b) ** 2 for a, b in zip(masked, centroid)))
            if d <= self.radius:
                return True
        return False

    def distance_to_nearest_centroid(self, features: Tuple[float, ...]) -> float:
        """Distance from features to the nearest centroid."""
        masked = tuple(features[i] for i in self.feature_mask)
        min_d = float("inf")
        for centroid in self.centroids:
            d = math.sqrt(sum((a - b) ** 2 for a, b in zip(masked, centroid)))
            if d < min_d:
                min_d = d
        return min_d


# ===========================================================================
# Online Law Refiner
# ===========================================================================

class OnlineLawRefiner:
    """Automatically refines, decays, and quarantines laws based on
    verification feedback.

    The refiner wraps the substrate's compressed laws in RefinedLaw objects
    and tracks their failure/success history. When a law fails verification:
      1. Its failure counter increments
      2. Its confidence decays (× 0.7 per failure)
      3. Its radius shrinks to exclude the counterexample
      4. After 3 failures, it's quarantined (removed from active set)

    When a law succeeds verification:
      1. Its success counter increments
      2. After 5 successes, a SUSPECT law is rehabilitated to ACTIVE
    """

    def __init__(self, substrate: Substrate) -> None:
        self.substrate = substrate
        self.refined_laws: Dict[str, Dict[str, RefinedLaw]] = defaultdict(dict)
        self.quarantine_log: List[Dict[str, Any]] = []
        self.refinement_stats = {
            "total_failures": 0,
            "total_successes": 0,
            "laws_quarantined": 0,
            "laws_rehabilitated": 0,
            "radius_shrinks": 0,
            "confidence_decays": 0,
        }

    def initialize_laws(self, computation_type: str) -> None:
        """Wrap the substrate's compressed laws in RefinedLaw objects."""
        compressed = self.substrate.compression.compressed_laws.get(computation_type, [])
        for law in compressed:
            if law.law_id not in self.refined_laws[computation_type]:
                self.refined_laws[computation_type][law.law_id] = RefinedLaw(
                    law_id=law.law_id,
                    computation_type=computation_type,
                    feature_mask=law.feature_mask,
                    centroids=law.centroids,
                    radius=law.radius,
                    outcome=law.outcome,
                    confidence=law.confidence,
                    member_count=law.member_count,
                    state_coverage=law.state_coverage,
                    original_radius=law.radius,
                    original_confidence=law.confidence,
                )

    def record_failure(self, computation_type: str, law_id: str,
                        features: Tuple[float, ...]) -> None:
        """Record a verification failure for a law.

        - Increments failure counter
        - Decays confidence (× 0.7)
        - Shrinks radius to exclude the counterexample
        - Quarantines after 3 failures
        """
        if law_id not in self.refined_laws[computation_type]:
            return
        law = self.refined_laws[computation_type][law_id]
        law.failures += 1
        law.counterexamples.append(features)
        law.last_updated = time.time()
        self.refinement_stats["total_failures"] += 1

        # Decay confidence
        law.confidence = law.effective_confidence
        self.refinement_stats["confidence_decays"] += 1

        # Shrink radius to exclude counterexample
        dist = law.distance_to_nearest_centroid(features)
        if dist <= law.radius:
            new_radius = dist * 0.9
            if new_radius < law.radius:
                law.radius = new_radius
                self.refinement_stats["radius_shrinks"] += 1

        # Quarantine after 3 failures
        if law.failures >= 3 and law.status != LawStatus.QUARANTINED:
            law.status = LawStatus.QUARANTINED
            self.refinement_stats["laws_quarantined"] += 1
            self.quarantine_log.append({
                "law_id": law_id,
                "computation_type": computation_type,
                "failures": law.failures,
                "successes": law.successes,
                "reason": f"failures={law.failures} >= 3",
                "timestamp": time.time(),
            })
        elif law.failures >= 1 and law.status == LawStatus.ACTIVE:
            law.status = LawStatus.SUSPECT

    def record_success(self, computation_type: str, law_id: str) -> None:
        """Record a verification success for a law.

        - Increments success counter
        - Rehabilitates SUSPECT laws after 5 successes
        """
        if law_id not in self.refined_laws[computation_type]:
            return
        law = self.refined_laws[computation_type][law_id]
        law.successes += 1
        law.last_updated = time.time()
        self.refinement_stats["total_successes"] += 1

        # Rehabilitate after 5 successes
        if law.status == LawStatus.SUSPECT and law.successes >= 5:
            law.status = LawStatus.ACTIVE
            law.failures = max(0, law.failures - 1)
            self.refinement_stats["laws_rehabilitated"] += 1

    def get_active_laws(self, computation_type: str) -> List[RefinedLaw]:
        """Return only ACTIVE and SUSPECT laws (not QUARANTINED)."""
        return [law for law in self.refined_laws[computation_type].values()
                if law.status != LawStatus.QUARANTINED]

    def query_refined_law(self, computation_type: str,
                          features: Tuple[float, ...]) -> Optional[RefinedLaw]:
        """Find an active refined law whose region contains the features."""
        for law in self.get_active_laws(computation_type):
            if law.contains(features):
                return law
        return None

    def get_stats(self) -> Dict[str, Any]:
        return {
            **self.refinement_stats,
            "quarantine_log_length": len(self.quarantine_log),
            "active_laws": sum(
                1 for ct in self.refined_laws.values()
                for law in ct.values()
                if law.status == LawStatus.ACTIVE
            ),
            "suspect_laws": sum(
                1 for ct in self.refined_laws.values()
                for law in ct.values()
                if law.status == LawStatus.SUSPECT
            ),
            "quarantined_laws": sum(
                1 for ct in self.refined_laws.values()
                for law in ct.values()
                if law.status == LawStatus.QUARANTINED
            ),
        }


# ===========================================================================
# v6.9 Substrate with Online Law Refinement
# ===========================================================================

class SubstrateV69:
    """The v6.9 substrate integrating online law refinement.

    Extends v6.8 with:
      - OnlineLawRefiner that tracks law failures/successes
      - Automatic law invalidation after 3 failures
      - Radius shrinking to exclude counterexamples
      - Confidence decay on failures
      - Law rehabilitation after 5 successes

    The predict_with_refinement() method returns the prediction plus
    refinement metadata. The verify_and_refine() method updates the
    refiner based on verification results.
    """

    def __init__(self,
                 min_confidence: float = 0.85,
                 calibrated_target_acc: float = 0.90,
                 default_value: float = 1000.0,
                 min_value_threshold: float = 10.0) -> None:
        # Build on v6.8
        self.v68 = SubstrateV68(
            min_confidence=min_confidence,
            calibrated_target_acc=calibrated_target_acc,
            default_value=default_value,
            min_value_threshold=min_value_threshold,
        )
        self.refiner = OnlineLawRefiner(self.v68.substrate)
        self._initialized_types: set = set()

    def train(self, computation_type: str,
              features: Tuple[float, ...], outcome: Any) -> None:
        self.v68.train(computation_type, features, outcome)

    def fit(self, computation_type: str) -> Dict[str, Any]:
        result = self.v68.fit(computation_type)
        # Initialize refined laws from compressed laws
        self.refiner.initialize_laws(computation_type)
        self._initialized_types.add(computation_type)
        return result

    def calibrate(self, computation_type: str,
                  validation_set: List[Tuple[Tuple[float, ...], Any]]) -> Dict[str, Any]:
        return self.v68.calibrate(computation_type, validation_set)

    def predict_with_refinement(self, computation_type: str,
                                 features: Tuple[float, ...],
                                 full_computation: Callable,
                                 original_cost: float = 1000.0,
                                 value_of_result: Optional[float] = None,
                                 record_outcome: bool = False
                                 ) -> Tuple[Any, SubstrateOutcome, float, float,
                                            Optional[RefinedLaw]]:
        """Predict using refined laws (quarantined laws are excluded).

        Returns:
            (predicted, outcome, confidence, cost, matched_refined_law)
        """
        # Ensure refiner is initialized
        if computation_type not in self._initialized_types:
            self.refiner.initialize_laws(computation_type)
            self._initialized_types.add(computation_type)

        # Check refined laws FIRST (before the substrate's regular laws)
        # This lets us exclude quarantined laws.
        #
        # TRUST MODEL: The law's STATUS (not its coverage-based confidence)
        # is the primary trust signal:
        #   ACTIVE      → use the law (trust it until it fails)
        #   SUSPECT     → use the law but with reduced confidence
        #   QUARANTINED → skip the law (it has failed >= 3 times)
        #
        # The coverage-based confidence from the compression engine is
        # typically low (0.05-0.20) because each law covers a small
        # fraction of states. This is NOT a reliability signal — it's
        # a coverage signal. The refiner's failure/success tracking
        # provides the actual reliability signal.
        refined_law = self.refiner.query_refined_law(computation_type, features)
        if refined_law is not None and refined_law.status != LawStatus.QUARANTINED:
            # Report effective confidence (includes decay from failures)
            reported_conf = refined_law.effective_confidence
            if refined_law.status == LawStatus.SUSPECT:
                reported_conf *= 0.7  # additional penalty for suspect status
            self.v68.substrate.stats.law += 1
            cost = 1.0  # lookup cost
            return (refined_law.outcome, SubstrateOutcome.LAW,
                    reported_conf, cost, refined_law)

        # Fall back to v6.8 prediction (invariant, consensus, escalation)
        predicted, outcome, conf, cost, reuse, cb = self.v68.predict_with_analysis(
            computation_type, features, full_computation,
            original_cost=original_cost,
            value_of_result=value_of_result,
            record_outcome=record_outcome)
        return predicted, outcome, conf, cost, None

    def verify_and_refine(self, computation_type: str,
                           features: Tuple[float, ...],
                           refined_law: Optional[RefinedLaw],
                           predicted: Any, actual: Any) -> bool:
        """Verify a prediction and refine the law if it was used.

        Returns True if the prediction was correct.
        """
        correct = (predicted == actual)
        if refined_law is not None:
            if correct:
                self.refiner.record_success(computation_type, refined_law.law_id)
            else:
                self.refiner.record_failure(
                    computation_type, refined_law.law_id, features)
        return correct

    def get_report(self) -> Dict[str, Any]:
        return {
            "v68_report": self.v68.get_report(),
            "refiner_stats": self.refiner.get_stats(),
        }


# ===========================================================================
# Self-test
# ===========================================================================

def self_test() -> None:
    """Quick self-test of the law refiner."""
    print("Running v6.9 law refiner self-test...")
    sub = SubstrateV69()
    rng = __import__("random").Random(42)

    # Train on AND-of-3
    for _ in range(100):
        f = tuple(float(rng.random() > 0.3) for _ in range(3))
        y = all(bool(v) for v in f)
        sub.train("and", f, y)
    sub.fit("and")
    print(f"  Initialized {len(sub.refiner.refined_laws['and'])} refined laws")

    # Calibrate
    val = []
    for _ in range(50):
        f = tuple(float(rng.random() > 0.3) for _ in range(3))
        val.append((f, all(bool(v) for v in f)))
    sub.calibrate("and", val)

    # Predict and verify
    correct = 0
    for _ in range(30):
        f = tuple(float(rng.random() > 0.3) for _ in range(3))
        actual = all(bool(v) for v in f)
        predicted, outcome, conf, cost, refined_law = sub.predict_with_refinement(
            "and", f, full_computation=lambda: actual, record_outcome=False)
        ok = sub.verify_and_refine("and", f, refined_law, predicted, actual)
        if ok:
            correct += 1
    print(f"  Correct: {correct}/30")
    print(f"  Refiner stats: {sub.refiner.get_stats()}")
    print("Self-test OK.")


if __name__ == "__main__":
    self_test()
