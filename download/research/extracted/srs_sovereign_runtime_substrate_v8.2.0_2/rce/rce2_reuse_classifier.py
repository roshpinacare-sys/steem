#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rce2_reuse_classifier.py — RCE-2 v6.8 Reuse Classification & Cost-Benefit

The v6.5 challenge asked two questions the substrate has not yet answered:

  Q1: Can it distinguish:
      - exact reuse (same input, same output)
      - structural reuse (same feature mask, same outcome)
      - law-based reuse (input falls in a learned law's region)
      - approximate reuse (input near a training point, consensus vote)
      - unsafe reuse (input near a law boundary, high uncertainty)

  Q2: Can it prove that some computations are not worth executing?
      i.e., when is the expected cost of execution > expected value of the result?

This module implements both:

  A. ReuseClassifier
     For each prediction, classifies the reuse type and records it.
     The 5 types form a hierarchy from safest (exact) to riskiest (unsafe):

       EXACT       — query matches a training point exactly (hash match)
       STRUCTURAL  — query matches a canonical state (same masked features)
       LAW         — query falls inside a compressed law's region
       APPROXIMATE — query predicted by k-NN consensus (no law covers it)
       UNSAFE      — query near a law boundary OR low confidence OR recent failures

     The classifier also produces a "reuse_score" in [0, 1] quantifying
     how safe the reuse is:
       exact       → 1.0
       structural  → 0.95
       law         → law.confidence
       approximate → consensus confidence
       unsafe      → < 0.5 (must escalate)

  B. CostBenefitAnalyzer
     For each prediction, computes:
       - expected_cost_execute  = original_cost (if we run the full computation)
       - expected_cost_predict  = substrate_cost + (1 - confidence) * original_cost
                                  (prediction cost + expected rework cost if wrong)
       - value_of_result        = estimated utility of having the answer
                                  (default: 1.0, or user-provided)
       - recommendation         = "execute" if cost_execute < cost_predict
                                  "predict" if cost_predict < cost_execute
                                  "skip"    if value_of_result < min(cost_execute, cost_predict)

     The analyzer PROVES a computation is not worth executing when:
       value_of_result < expected_cost_execute
     i.e., the utility of the answer is less than the cost of computing it.

     This is the substrate's "honest skip" — it refuses to execute
     computations whose value cannot justify their cost.
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
    StateUniverse, ComputationState, CompressionDiscovery,
)
from rce.rce2_adaptive_gate import AdaptiveDensityOODGate


# ===========================================================================
# A. Reuse Classifier
# ===========================================================================

class ReuseType(str, Enum):
    """The 5 kinds of reuse, from safest to riskiest."""
    EXACT = "exact"                 # query == training point (hash match)
    STRUCTURAL = "structural"       # query matches canonical state (masked features)
    LAW = "law"                     # query inside compressed law region
    APPROXIMATE = "approximate"     # k-NN consensus (no law covers)
    UNSAFE = "unsafe"               # near boundary / low conf / recent failure
    NONE = "none"                   # no reuse (escalated or rejected)


@dataclass
class ReuseClassification:
    """The result of classifying reuse for a single prediction."""
    reuse_type: ReuseType
    reuse_score: float              # [0, 1] — 1.0 = perfectly safe, 0.0 = unsafe
    matched_state_id: Optional[str] = None      # for EXACT
    matched_canonical_id: Optional[str] = None   # for STRUCTURAL
    matched_law_id: Optional[str] = None         # for LAW
    nearest_distance: float = float("inf")       # for APPROXIMATE
    reason: str = ""


class ReuseClassifier:
    """Classifies each prediction into one of 5 reuse types.

    The classifier is called AFTER the substrate's predict() cascade
    determines the outcome. It examines the prediction context to
    determine what KIND of reuse occurred.

    CLASSIFICATION LOGIC:

      1. EXACT: Check if the query features exactly match any training
         state's features (within tolerance 1e-9). If yes → EXACT.

      2. STRUCTURAL: Check if the query matches any canonical state's
         masked feature values. If yes → STRUCTURAL.

      3. LAW: If the substrate predicted via a compressed law → LAW.
         The law_id is recorded.

      4. APPROXIMATE: If the substrate predicted via consensus (no law
         covered) → APPROXIMATE. The nearest_distance is recorded.

      5. UNSAFE: If ANY of:
         - prediction confidence < 0.5
         - query is near a law boundary (distance to law edge < 0.1 * radius)
         - recent verification failures for this computation type (≥ 3)
         - OOD gate rejected
         → UNSAFE (must escalate)

      6. NONE: Escalated or rejected with no reuse.
    """

    def __init__(self, substrate: Substrate) -> None:
        self.substrate = substrate
        self.classification_counts: Dict[str, Dict[ReuseType, int]] = defaultdict(
            lambda: {rt: 0 for rt in ReuseType})
        self.reuse_scores: Dict[str, List[float]] = defaultdict(list)

    def classify(self, computation_type: str,
                 features: Tuple[float, ...],
                 outcome: SubstrateOutcome,
                 confidence: float,
                 predicted: Any,
                 matched_law_id: Optional[str] = None) -> ReuseClassification:
        """Classify the reuse type for a prediction that has already been made.

        Args:
            computation_type: the type of computation
            features: the query features
            outcome: the substrate's outcome (INVARIANT, LAW, etc.)
            confidence: the substrate's reported confidence
            predicted: the predicted value
            matched_law_id: if outcome is LAW, the law that matched

        Returns:
            ReuseClassification with reuse_type, reuse_score, and metadata
        """
        # Check UNSAFE conditions first — these override everything
        recent_fails = self.substrate._recent_failures.get(computation_type, 0)
        if (confidence < 0.5
            or outcome in (SubstrateOutcome.REJECTED_OOD,
                           SubstrateOutcome.REJECTED_LOW_CONFIDENCE,
                           SubstrateOutcome.REJECTED_RECENT_FAILURE)
            or recent_fails >= 3):
            cls = ReuseClassification(
                reuse_type=ReuseType.UNSAFE,
                reuse_score=min(confidence, 0.3),
                reason=f"unsafe: conf={confidence:.2f}, recent_fails={recent_fails}, outcome={outcome.value}",
            )
            self._record(computation_type, cls)
            return cls

        # Check EXACT: hash match with any training state
        exact_match = self._find_exact_match(computation_type, features)
        if exact_match is not None and outcome in (
                SubstrateOutcome.INVARIANT, SubstrateOutcome.LAW,
                SubstrateOutcome.CONSENSUS):
            cls = ReuseClassification(
                reuse_type=ReuseType.EXACT,
                reuse_score=1.0,
                matched_state_id=exact_match,
                reason="exact feature match with training state",
            )
            self._record(computation_type, cls)
            return cls

        # Check STRUCTURAL: matches a canonical state's masked features
        canonical_match = self._find_canonical_match(computation_type, features)
        if canonical_match is not None and outcome in (
                SubstrateOutcome.INVARIANT, SubstrateOutcome.LAW,
                SubstrateOutcome.CONSENSUS):
            cls = ReuseClassification(
                reuse_type=ReuseType.STRUCTURAL,
                reuse_score=0.95,
                matched_canonical_id=canonical_match,
                reason="matches canonical state (masked features)",
            )
            self._record(computation_type, cls)
            return cls

        # Check LAW: substrate predicted via a compressed law
        if outcome == SubstrateOutcome.LAW and matched_law_id is not None:
            # Check if near law boundary
            law = self._find_law_by_id(computation_type, matched_law_id)
            if law is not None:
                dist_to_edge = self._distance_to_law_edge(features, law)
                if dist_to_edge < 0.1 * law.radius:
                    # Near boundary — downgrade to UNSAFE
                    cls = ReuseClassification(
                        reuse_type=ReuseType.UNSAFE,
                        reuse_score=confidence * 0.5,
                        matched_law_id=matched_law_id,
                        reason=f"near law boundary (dist_to_edge={dist_to_edge:.3f} < {0.1*law.radius:.3f})",
                    )
                    self._record(computation_type, cls)
                    return cls
            cls = ReuseClassification(
                reuse_type=ReuseType.LAW,
                reuse_score=confidence,
                matched_law_id=matched_law_id,
                reason="inside compressed law region",
            )
            self._record(computation_type, cls)
            return cls

        # Check APPROXIMATE: consensus prediction
        if outcome == SubstrateOutcome.CONSENSUS:
            nn_dist = self._nearest_distance(computation_type, features)
            cls = ReuseClassification(
                reuse_type=ReuseType.APPROXIMATE,
                reuse_score=confidence,
                nearest_distance=nn_dist,
                reason=f"consensus (nn_dist={nn_dist:.3f})",
            )
            self._record(computation_type, cls)
            return cls

        # INVARIANT (exact feature match) but not found in training —
        # treat as STRUCTURAL (the invariant IS the structural match)
        if outcome == SubstrateOutcome.INVARIANT:
            cls = ReuseClassification(
                reuse_type=ReuseType.STRUCTURAL,
                reuse_score=1.0,
                reason="invariant match (feature values determine outcome)",
            )
            self._record(computation_type, cls)
            return cls

        # ESCALATED or other — no reuse
        cls = ReuseClassification(
            reuse_type=ReuseType.NONE,
            reuse_score=0.0,
            reason=f"no reuse (outcome={outcome.value})",
        )
        self._record(computation_type, cls)
        return cls

    def _find_exact_match(self, computation_type: str,
                          features: Tuple[float, ...]) -> Optional[str]:
        """Find a training state with exactly matching features."""
        TOL = 1e-9
        for s in self.substrate.universe.states.get(computation_type, []):
            if len(s.features) != len(features):
                continue
            if all(abs(a - b) < TOL for a, b in zip(s.features, features)):
                return s.state_id
        return None

    def _find_canonical_match(self, computation_type: str,
                               features: Tuple[float, ...]) -> Optional[str]:
        """Find a canonical state whose masked features match."""
        TOL = 1e-9
        for canon in self.substrate.compression.canonical_states.get(computation_type, []):
            match = True
            for i, idx in enumerate(canon.feature_mask):
                if idx >= len(features):
                    match = False
                    break
                if abs(features[idx] - canon.feature_values[i]) > TOL:
                    match = False
                    break
            if match:
                return canon.canonical_id
        return None

    def _find_law_by_id(self, computation_type: str,
                         law_id: str):
        """Find a compressed law by ID."""
        for law in self.substrate.compression.compressed_laws.get(computation_type, []):
            if law.law_id == law_id:
                return law
        return None

    def _distance_to_law_edge(self, features: Tuple[float, ...], law) -> float:
        """Compute distance from query to the nearest law boundary.

        For a law with multiple centroids, the boundary is at radius r
        from each centroid. The distance to the edge is:
          radius - min_distance_to_any_centroid
        """
        masked = tuple(features[i] for i in law.feature_mask)
        min_dist = float("inf")
        for centroid in law.centroids:
            d = math.sqrt(sum((a - b) ** 2 for a, b in zip(masked, centroid)))
            if d < min_dist:
                min_dist = d
        return max(law.radius - min_dist, 0.0)

    def _nearest_distance(self, computation_type: str,
                           features: Tuple[float, ...]) -> float:
        """Distance to nearest training state."""
        min_d = float("inf")
        for s in self.substrate.universe.states.get(computation_type, []):
            d = math.sqrt(sum((a - b) ** 2 for a, b in zip(features, s.features)))
            if d < min_d:
                min_d = d
        return min_d

    def _record(self, computation_type: str, cls: ReuseClassification) -> None:
        self.classification_counts[computation_type][cls.reuse_type] += 1
        self.reuse_scores[computation_type].append(cls.reuse_score)

    def get_stats(self, computation_type: Optional[str] = None) -> Dict[str, Any]:
        """Return classification statistics."""
        if computation_type:
            counts = self.classification_counts.get(computation_type, {})
            scores = self.reuse_scores.get(computation_type, [])
        else:
            counts = defaultdict(int)
            for ct, c in self.classification_counts.items():
                for rt, n in c.items():
                    counts[rt] += n
            scores = []
            for s in self.reuse_scores.values():
                scores.extend(s)
        avg_score = sum(scores) / len(scores) if scores else 0.0
        return {
            "counts": {rt.value: n for rt, n in counts.items()},
            "avg_reuse_score": round(avg_score, 3),
            "total_classifications": sum(counts.values()),
        }


# ===========================================================================
# B. Cost-Benefit Analyzer
# ===========================================================================

@dataclass
class CostBenefitResult:
    """Result of a cost-benefit analysis."""
    recommendation: str            # "execute", "predict", or "skip"
    expected_cost_execute: float   # cost if we run the full computation
    expected_cost_predict: float   # cost if we predict (incl. rework if wrong)
    value_of_result: float         # estimated utility of the answer
    confidence: float              # substrate's confidence in its prediction
    reasoning: str


class CostBenefitAnalyzer:
    """Decides whether to execute, predict, or skip a computation.

    MATHEMATICAL MODEL:

      expected_cost_execute = C_execute
        (the full cost of running the original computation)

      expected_cost_predict = C_predict + (1 - confidence) * C_execute
        (prediction cost + expected rework cost if the prediction is wrong)

      value_of_result = V
        (the utility of having the answer; default 1.0, or user-provided)

      Decision rules:
        if V < min(C_execute, C_predict):
            → SKIP (the computation is not worth executing)
        elif C_predict < C_execute:
            → PREDICT (use the substrate's prediction)
        else:
            → EXECUTE (run the full computation)

    The "honest skip" (SKIP) is the key innovation: the substrate
    refuses to execute computations whose value cannot justify their
    cost. This is the substrate proving that some computations are
    not worth executing.
    """

    def __init__(self, default_value: float = 1000.0,
                 min_value_threshold: float = 10.0) -> None:
        """Cost-benefit analyzer.

        DEFAULT_VALUE = 1000.0 (same scale as original_cost = 1000us).
        This means: by default, the value of having an answer is equal
        to the cost of computing it — a neutral prior. Callers should
        override value_of_result for domain-specific utility.

        MIN_VALUE_THRESHOLD = 10.0 (1% of default cost).
        Below this, the computation is definitely not worth executing.
        """
        self.default_value = default_value
        self.min_value_threshold = min_value_threshold
        self.decisions: List[CostBenefitResult] = []

    def analyze(self,
                confidence: float,
                substrate_cost: float,
                original_cost: float,
                value_of_result: Optional[float] = None) -> CostBenefitResult:
        """Analyze whether to execute, predict, or skip.

        Args:
            confidence: substrate's confidence in its prediction [0, 1]
            substrate_cost: cost of using the substrate (lookup + escalation)
            original_cost: cost of running the full computation
            value_of_result: utility of having the answer (default: self.default_value)

        Returns:
            CostBenefitResult with recommendation and reasoning
        """
        V = value_of_result if value_of_result is not None else self.default_value
        C_execute = original_cost
        C_predict = substrate_cost + (1.0 - confidence) * original_cost

        if V < self.min_value_threshold:
            rec = "skip"
            reasoning = (f"value {V:.3f} < min_threshold {self.min_value_threshold:.3f} "
                         f"— not worth executing")
        elif V < min(C_execute, C_predict):
            rec = "skip"
            reasoning = (f"value {V:.3f} < min(cost_execute={C_execute:.1f}, "
                         f"cost_predict={C_predict:.1f}) — not worth executing")
        elif C_predict < C_execute:
            rec = "predict"
            reasoning = (f"cost_predict {C_predict:.1f} < cost_execute {C_execute:.1f} "
                         f"(conf={confidence:.2f}, substrate_cost={substrate_cost:.1f})")
        else:
            rec = "execute"
            reasoning = (f"cost_execute {C_execute:.1f} ≤ cost_predict {C_predict:.1f} "
                         f"(substrate too uncertain or expensive)")

        result = CostBenefitResult(
            recommendation=rec,
            expected_cost_execute=C_execute,
            expected_cost_predict=C_predict,
            value_of_result=V,
            confidence=confidence,
            reasoning=reasoning,
        )
        self.decisions.append(result)
        return result

    def get_stats(self) -> Dict[str, Any]:
        """Return decision statistics."""
        counts = defaultdict(int)
        for d in self.decisions:
            counts[d.recommendation] += 1
        total = len(self.decisions)
        return {
            "total_decisions": total,
            "execute": counts["execute"],
            "predict": counts["predict"],
            "skip": counts["skip"],
            "skip_rate": counts["skip"] / max(total, 1),
        }


# ===========================================================================
# C. Integrated Substrate with Reuse Classification + Cost-Benefit
# ===========================================================================

class SubstrateV68:
    """The v6.8 substrate integrating reuse classification and cost-benefit.

    This is a thin wrapper around the v6.7 Substrate that adds:
      - ReuseClassifier (classifies every prediction)
      - CostBenefitAnalyzer (decides execute/predict/skip)

    The predict_with_analysis() method returns both the prediction
    and the analysis, enabling the caller to make informed decisions.
    """

    def __init__(self,
                 min_confidence: float = 0.85,
                 calibrated_target_acc: float = 0.90,
                 default_value: float = 1000.0,
                 min_value_threshold: float = 10.0) -> None:
        # Build substrate with adaptive gate (v6.7 default)
        from rce.rce2_adaptive_gate import make_substrate_with_adaptive_gate
        self.substrate = make_substrate_with_adaptive_gate(
            min_confidence=min_confidence,
            calibrated_target_acc=calibrated_target_acc,
            strategy="silverman",
        )
        self.reuse_classifier = ReuseClassifier(self.substrate)
        self.cost_benefit = CostBenefitAnalyzer(
            default_value=default_value,
            min_value_threshold=min_value_threshold,
        )

    def train(self, computation_type: str,
              features: Tuple[float, ...], outcome: Any) -> None:
        self.substrate.train(computation_type, features, outcome)

    def fit(self, computation_type: str) -> Dict[str, Any]:
        return self.substrate.fit(computation_type)

    def calibrate(self, computation_type: str,
                  validation_set: List[Tuple[Tuple[float, ...], Any]]) -> Dict[str, Any]:
        return self.substrate.calibrate(
            computation_type, validation_set,
            full_computation_fn=lambda: True)

    def predict_with_analysis(self, computation_type: str,
                               features: Tuple[float, ...],
                               full_computation: Callable,
                               original_cost: float = 1000.0,
                               value_of_result: Optional[float] = None,
                               record_outcome: bool = False
                               ) -> Tuple[Any, SubstrateOutcome, float, float,
                                          ReuseClassification, CostBenefitResult]:
        """Predict with full reuse classification and cost-benefit analysis.

        Returns:
            (predicted, outcome, confidence, substrate_cost,
             reuse_classification, cost_benefit_result)
        """
        predicted, outcome, conf, sub_cost = self.substrate.predict(
            computation_type, features, full_computation, record_outcome=record_outcome)

        # Classify reuse
        reuse_cls = self.reuse_classifier.classify(
            computation_type, features, outcome, conf, predicted)

        # Cost-benefit analysis
        cb = self.cost_benefit.analyze(
            confidence=conf,
            substrate_cost=sub_cost,
            original_cost=original_cost,
            value_of_result=value_of_result)

        return predicted, outcome, conf, sub_cost, reuse_cls, cb

    def get_report(self) -> Dict[str, Any]:
        return {
            "substrate_stats": self.substrate.stats.to_dict(),
            "reuse_stats": self.reuse_classifier.get_stats(),
            "cost_benefit_stats": self.cost_benefit.get_stats(),
        }
