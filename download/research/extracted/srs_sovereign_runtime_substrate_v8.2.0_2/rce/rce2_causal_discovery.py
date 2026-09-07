#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rce2_causal_discovery.py — RCE-2 v6.11 Causal Law Discovery

PROBLEM:
  All prior versions learn CORRELATIONAL laws: "features X co-occur with
  outcome Y". But correlation ≠ causation. A feature may correlate with
  the outcome without causing it — it may be a CONFOUNDER (causes both),
  a MEDIATOR (caused by the real cause), or a COLLIDER (caused by both
  the feature and the outcome).

  Example: in a SEG admission system, "has_z3_witness" may correlate with
  "admissible" but not CAUSE it — both are caused by "evidence_chain_complete".
  A correlational law would say "has_z3_witness → admissible", but
  intervening on has_z3_witness (setting it True without the evidence chain)
  would NOT make the computation admissible.

SOLUTION:
  The CausalDiscoveryEngine performs INTERVENTIONAL queries to distinguish
  causal features from confounders. For each feature, it asks:

    "If I FORCE this feature to a specific value (do(feature=value)),
     does the outcome change?"

  If yes → the feature is CAUSAL (intervening on it changes the outcome)
  If no  → the feature is CORRELATIONAL (co-occurs but doesn't cause)

MECHANISM:

  1. OBSERVATIONAL PASS: Collect (features, outcome) pairs from normal
     computation. Compute correlation of each feature with outcome.

  2. INTERVENTIONAL PASS: For each feature i and value v:
       - Generate intervened features: same as observed but feature[i] = v
       - Execute the computation on the intervened features
       - Record (intervened_features, intervened_outcome)
     This is the "do-operator" from Pearl's causal calculus.

  3. CAUSAL EFFECT: For feature i, the Average Causal Effect (ACE) is:
       ACE(i) = E[outcome | do(feature_i = 1)] - E[outcome | do(feature_i = 0)]

     If |ACE(i)| > threshold → feature i is CAUSAL
     If |ACE(i)| ≤ threshold → feature i is CORRELATIONAL (confounder/mediator/collider)

  4. CAUSAL LAW: A causal law uses ONLY causal features in its mask.
     This is stronger than a correlational law: it predicts what happens
     under INTERVENTION, not just observation.

MATHEMATICAL MODEL (Pearl's do-calculus):

  Observational: P(Y | X=x) — probability of Y given we OBSERVE X=x
  Interventional: P(Y | do(X=x)) — probability of Y given we FORCE X=x

  ACE(X→Y) = P(Y=1 | do(X=1)) - P(Y=1 | do(X=0))

  A feature is causal iff |ACE| > ε (default ε = 0.1).

  Causal law: L_causal = (mask=causal_features, region, outcome, confidence)
  This law correctly predicts outcomes under intervention, not just
  observation. It is robust to confounders because confounders have
  ACE ≈ 0 (intervening on them doesn't change the outcome — the real
  cause is unaffected).

This is the substrate's CAUSAL layer: it doesn't just learn what
co-occurs, it learns what CAUSES the outcome, enabling predictions
that hold under intervention (the gold standard for causal inference).
"""
from __future__ import annotations

import math
import random
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

from rce.rce2_substrate import Substrate, SubstrateOutcome
from rce.rce2_meta_learner import SubstrateV610


# ===========================================================================
# Causal Feature Classification
# ===========================================================================

@dataclass
class CausalFeature:
    """A feature classified by its causal role."""
    feature_index: int
    ace: float                    # Average Causal Effect
    is_causal: bool               # |ACE| > threshold
    role: str                     # "causal", "confounder", "mediator", "collider", "irrelevant"
    n_interventions: int = 0      # how many interventional queries were run


@dataclass
class CausalLaw:
    """A law that uses only causal features.

    Stronger than a correlational law: it predicts outcomes under
    intervention, not just observation.
    """
    law_id: str
    computation_type: str
    causal_features: Tuple[int, ...]     # only causal features
    feature_values: Tuple[float, ...]    # values that cause the outcome
    outcome: Any
    ace: float                            # combined ACE of the causal features
    confidence: float
    n_interventions: int                  # how many interventions verified this


# ===========================================================================
# Causal Discovery Engine
# ===========================================================================

class CausalDiscoveryEngine:
    """Discovers causal features via interventional queries.

    The engine wraps a substrate and a computation function. For each
    feature, it runs interventional queries (do(feature=value)) and
    measures the Average Causal Effect (ACE).

    REQUIRES: the caller provides a `compute_fn` that takes features
    and returns the outcome. This is the GROUND TRUTH computation —
    the engine uses it to run interventions. In production, this would
    be the actual computation the substrate is trying to avoid; the
    causal discovery is an offline training cost.
    """

    def __init__(self, substrate: Substrate,
                 ace_threshold: float = 0.1,
                 n_interventions_per_feature: int = 20) -> None:
        self.substrate = substrate
        self.ace_threshold = ace_threshold
        self.n_interventions = n_interventions_per_feature
        self.causal_features: Dict[str, List[CausalFeature]] = defaultdict(list)
        self.causal_laws: Dict[str, List[CausalLaw]] = defaultdict(list)
        self.intervention_log: List[Dict[str, Any]] = []

    def discover_causal_features(self, computation_type: str,
                                  compute_fn: Callable[[Tuple[float, ...]], Any],
                                  training_features: List[Tuple[float, ...]]
                                  ) -> List[CausalFeature]:
        """Discover which features are causal via interventional queries.

        For each feature i, run n_interventions queries where feature i
        is forced to 0 or 1 (for binary) or to its min/max (for continuous).
        Measure ACE = E[Y|do(X=1)] - E[Y|do(X=0)].

        Args:
            computation_type: the type of computation
            compute_fn: ground truth function (features → outcome)
            training_features: sample of features to use as intervention base

        Returns:
            List of CausalFeature classifications
        """
        if not training_features:
            return []

        d = len(training_features[0])
        results = []

        for i in range(d):
            ace, n = self._compute_ace(
                computation_type, compute_fn, training_features, i)
            is_causal = abs(ace) > self.ace_threshold
            role = self._classify_role(ace, is_causal)
            cf = CausalFeature(
                feature_index=i,
                ace=ace,
                is_causal=is_causal,
                role=role,
                n_interventions=n,
            )
            results.append(cf)

        self.causal_features[computation_type] = results
        return results

    def _compute_ace(self, computation_type: str,
                      compute_fn: Callable,
                      training_features: List[Tuple[float, ...]],
                      feature_idx: int) -> Tuple[float, int]:
        """Compute Average Causal Effect for a single feature.

        ACE = E[Y | do(X=1)] - E[Y | do(X=0)]

        For binary features, we force X to 0 and 1.
        For continuous features, we force X to its min and max observed values.
        """
        rng = random.Random(42)
        sample = training_features
        if len(sample) > self.n_interventions:
            sample = rng.sample(training_features, self.n_interventions)

        # Determine if binary or continuous
        values = [f[feature_idx] for f in training_features]
        unique_vals = set(values)
        is_binary = unique_vals <= {0.0, 1.0}

        if is_binary:
            val_low, val_high = 0.0, 1.0
        else:
            val_low, val_high = min(unique_vals), max(unique_vals)

        outcomes_high = []
        outcomes_low = []
        n = 0

        for base_features in sample:
            # do(X = val_high)
            intervened_high = list(base_features)
            intervened_high[feature_idx] = val_high
            y_high = compute_fn(tuple(intervened_high))
            outcomes_high.append(1.0 if y_high else 0.0)

            # do(X = val_low)
            intervened_low = list(base_features)
            intervened_low[feature_idx] = val_low
            y_low = compute_fn(tuple(intervened_low))
            outcomes_low.append(1.0 if y_low else 0.0)

            n += 1
            self.intervention_log.append({
                "computation_type": computation_type,
                "feature_idx": feature_idx,
                "base_features": base_features,
                "intervened_high": tuple(intervened_high),
                "intervened_low": tuple(intervened_low),
                "outcome_high": y_high,
                "outcome_low": y_low,
            })

        if not outcomes_high:
            return 0.0, 0

        e_high = sum(outcomes_high) / len(outcomes_high)
        e_low = sum(outcomes_low) / len(outcomes_low)
        ace = e_high - e_low
        return ace, n

    def _classify_role(self, ace: float, is_causal: bool) -> str:
        """Classify the causal role of a feature based on ACE."""
        if is_causal:
            return "causal"
        if abs(ace) < 0.01:
            return "irrelevant"
        # Non-causal but some effect → could be confounder, mediator, or collider
        # Without more analysis, we label as "correlational"
        return "correlational"

    def extract_causal_laws(self, computation_type: str,
                             compute_fn: Callable[[Tuple[float, ...]], Any],
                             training_features: List[Tuple[float, ...]]
                             ) -> List[CausalLaw]:
        """Extract laws using ONLY causal features.

        For each combination of causal feature values, check if it
        deterministically causes a specific outcome via intervention.
        """
        causal_feats = [cf for cf in self.causal_features.get(computation_type, [])
                        if cf.is_causal]
        if not causal_feats:
            return []

        indices = tuple(cf.feature_index for cf in causal_feats)

        # Group training features by causal feature values
        groups = defaultdict(list)
        for f in training_features:
            key = tuple(f[i] for i in indices)
            groups[key].append(f)

        laws = []
        for idx, (key, members) in enumerate(groups.items()):
            if len(members) < 3:
                continue
            # Check if all members have the same outcome
            outcomes = [compute_fn(f) for f in members]
            unique_outcomes = set(outcomes)
            if len(unique_outcomes) == 1:
                outcome = outcomes[0]
                # Verify via intervention: force causal features to key values
                verified = self._verify_causal_law(
                    computation_type, compute_fn, training_features,
                    indices, key, outcome)
                if verified:
                    combined_ace = sum(
                        cf.ace for cf in causal_feats
                        if abs(key[cf.feature_index] - 1.0) < 0.01
                    )
                    law = CausalLaw(
                        law_id=f"causal_{computation_type}_{idx}",
                        computation_type=computation_type,
                        causal_features=indices,
                        feature_values=key,
                        outcome=outcome,
                        ace=combined_ace,
                        confidence=1.0,  # verified via intervention
                        n_interventions=len(members),
                    )
                    laws.append(law)

        self.causal_laws[computation_type] = laws
        return laws

    def _verify_causal_law(self, computation_type: str,
                            compute_fn: Callable,
                            training_features: List[Tuple[float, ...]],
                            causal_indices: Tuple[int, ...],
                            causal_values: Tuple[float, ...],
                            expected_outcome: Any) -> bool:
        """Verify a causal law via interventional queries.

        Force the causal features to the specified values on random base
        features, and check if the outcome is always the expected one.
        """
        rng = random.Random(42)
        sample = training_features
        if len(sample) > 10:
            sample = rng.sample(training_features, 10)

        for base in sample:
            intervened = list(base)
            for i, idx in enumerate(causal_indices):
                intervened[idx] = causal_values[i]
            outcome = compute_fn(tuple(intervened))
            if outcome != expected_outcome:
                return False
        return True

    def query_causal_law(self, computation_type: str,
                          features: Tuple[float, ...]) -> Optional[CausalLaw]:
        """Find a causal law matching the query's causal feature values."""
        for law in self.causal_laws.get(computation_type, []):
            key = tuple(features[i] for i in law.causal_features)
            if key == law.feature_values:
                return law
        return None

    def get_stats(self, computation_type: Optional[str] = None) -> Dict[str, Any]:
        """Return causal discovery statistics."""
        if computation_type:
            cfs = self.causal_features.get(computation_type, [])
            laws = self.causal_laws.get(computation_type, [])
        else:
            cfs = [cf for cfs_list in self.causal_features.values() for cf in cfs_list]
            laws = [law for laws_list in self.causal_laws.values() for law in laws_list]
        return {
            "n_features_analyzed": len(cfs),
            "n_causal_features": sum(1 for cf in cfs if cf.is_causal),
            "n_correlational_features": sum(1 for cf in cfs if not cf.is_causal and cf.role != "irrelevant"),
            "n_irrelevant_features": sum(1 for cf in cfs if cf.role == "irrelevant"),
            "n_causal_laws": len(laws),
            "n_interventions_total": len(self.intervention_log),
            "feature_roles": {cf.feature_index: cf.role for cf in cfs},
        }


# ===========================================================================
# v6.11 Substrate with Causal Discovery
# ===========================================================================

class SubstrateV611:
    """The v6.11 substrate integrating causal law discovery.

    Extends v6.10 with:
      - CausalDiscoveryEngine that distinguishes causal from correlational features
      - Causal laws that use only causal features (robust to confounders)
      - Interventional verification (laws are tested under do-operator)
    """

    def __init__(self,
                 min_confidence: float = 0.85,
                 calibrated_target_acc: float = 0.90,
                 default_value: float = 1000.0,
                 min_value_threshold: float = 10.0,
                 ace_threshold: float = 0.1) -> None:
        self.v610 = SubstrateV610(
            min_confidence=min_confidence,
            calibrated_target_acc=calibrated_target_acc,
            default_value=default_value,
            min_value_threshold=min_value_threshold,
        )
        self.causal_engine = CausalDiscoveryEngine(
            self.v610.v69.v68.substrate,
            ace_threshold=ace_threshold,
        )
        self._causal_initialized: set = set()

    def train(self, computation_type: str,
              features: Tuple[float, ...], outcome: Any) -> None:
        self.v610.train(computation_type, features, outcome)

    def fit(self, computation_type: str) -> Dict[str, Any]:
        return self.v610.fit(computation_type)

    def discover_causal_laws(self, computation_type: str,
                              compute_fn: Callable[[Tuple[float, ...]], Any],
                              training_features: List[Tuple[float, ...]]
                              ) -> Dict[str, Any]:
        """Discover causal features and extract causal laws.

        This is the offline causal discovery pass. It requires the ground
        truth compute_fn to run interventional queries.

        Args:
            computation_type: the type of computation
            compute_fn: ground truth function (features → outcome)
            training_features: sample of features to use as intervention base

        Returns:
            Dictionary with causal features and laws discovered
        """
        # Step 1: Discover causal features
        causal_feats = self.causal_engine.discover_causal_features(
            computation_type, compute_fn, training_features)

        # Step 2: Extract causal laws
        causal_laws = self.causal_engine.extract_causal_laws(
            computation_type, compute_fn, training_features)

        self._causal_initialized.add(computation_type)

        return {
            "n_causal_features": sum(1 for cf in causal_feats if cf.is_causal),
            "n_correlational_features": sum(1 for cf in causal_feats if not cf.is_causal and cf.role != "irrelevant"),
            "n_causal_laws": len(causal_laws),
            "n_interventions": len(self.causal_engine.intervention_log),
            "feature_roles": {cf.feature_index: cf.role for cf in causal_feats},
        }

    def predict_with_causal(self, computation_type: str,
                             features: Tuple[float, ...],
                             full_computation: Callable,
                             original_cost: float = 1000.0,
                             record_outcome: bool = False
                             ) -> Tuple[Any, SubstrateOutcome, float, float,
                                        Optional[CausalLaw]]:
        """Predict using causal laws first (strongest), then fall back to v6.10.

        Returns:
            (predicted, outcome, confidence, cost, causal_law_used)
        """
        # Check causal laws first (they're the strongest — verified via intervention)
        if computation_type in self._causal_initialized:
            causal_law = self.causal_engine.query_causal_law(
                computation_type, features)
            if causal_law is not None:
                self.v610.v69.v68.substrate.stats.law += 1
                cost = 1.0  # lookup cost
                return (causal_law.outcome, SubstrateOutcome.LAW,
                        causal_law.confidence, cost, causal_law)

        # Fall back to v6.10 prediction (refined laws, transfer, consensus, escalation)
        predicted, outcome, conf, cost, iso_used, source_law = self.v610.predict_with_transfer(
            computation_type, features, full_computation,
            original_cost=original_cost, record_outcome=record_outcome)
        return predicted, outcome, conf, cost, None

    def get_report(self) -> Dict[str, Any]:
        return {
            "v610_report": self.v610.get_report(),
            "causal_stats": self.causal_engine.get_stats(),
        }


# ===========================================================================
# Self-test
# ===========================================================================

def self_test() -> None:
    """Quick self-test of causal discovery."""
    import random
    print("Running v6.11 causal discovery self-test...")

    sub = SubstrateV611()
    rng = random.Random(42)

    # Define a computation with a CONFOUNDER:
    #   feature 0 (evidence_chain) CAUSES both feature 1 (has_witness) and outcome
    #   feature 1 (has_witness) CORRELATES with outcome but doesn't CAUSE it
    #   feature 2 (risk_class) is IRRELEVANT
    def compute_fn(f):
        # outcome = evidence_chain (f[0])
        # has_witness = evidence_chain (f[1] is determined by f[0] in training)
        # But intervening on f[1] alone doesn't change outcome
        return bool(f[0])

    # Generate training data where f[1] is confounded (correlated with f[0])
    training = []
    for _ in range(100):
        f0 = rng.random() > 0.3
        f1 = f0  # confounded: f1 = f0 (so they correlate perfectly)
        f2 = rng.random() > 0.5  # irrelevant
        training.append((float(f0), float(f1), float(f2)))

    # Train the substrate (correlational)
    for f in training:
        sub.train("confounded", f, compute_fn(f))
    sub.fit("confounded")

    # Discover causal features
    result = sub.discover_causal_laws("confounded", compute_fn, training)
    print(f"  Causal discovery: {result}")

    # Test: intervening on f[1] (has_witness) should NOT change outcome
    # ACE(f1) should be ~0 (confounder, not causal)
    # ACE(f0) should be ~1 (causal)
    # ACE(f2) should be ~0 (irrelevant)
    for cf in sub.causal_engine.causal_features["confounded"]:
        print(f"  Feature {cf.feature_index}: ACE={cf.ace:.3f} role={cf.role}")

    # Test prediction
    f = (1.0, 1.0, 0.0)  # evidence_chain=1, has_witness=1, risk=0
    predicted, outcome, conf, cost, causal_law = sub.predict_with_causal(
        "confounded", f, full_computation=lambda: True, record_outcome=False)
    actual = compute_fn(f)
    print(f"  Predict {f}: predicted={predicted} actual={actual} outcome={outcome.value}")
    if causal_law:
        print(f"    Causal law used: features={causal_law.causal_features} values={causal_law.feature_values}")

    print("Self-test OK.")


if __name__ == "__main__":
    self_test()
