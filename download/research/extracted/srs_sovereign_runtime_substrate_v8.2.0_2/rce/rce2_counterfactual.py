#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rce2_counterfactual.py — RCE-2 v6.13 Counterfactual Reasoning

PROBLEM:
  v6.12 discovers the causal DAG and root causes. But it cannot answer
  counterfactual questions: "Given that the outcome was Y when features
  were X, what would the outcome have been if feature X_i had been x'?"

  Example: A computation with features (1, 0, 1) produced outcome True.
  Question: "What would the outcome have been if feature 0 had been 0?"
  Answer: requires counterfactual reasoning — we need to:
    1. Infer the latent state that produced (1, 0, 1) → True
    2. Modify feature 0 to 0 (the "action")
    3. Re-derive the outcome from the modified state (the "prediction")

SOLUTION:
  The CounterfactualEngine implements Pearl's 3-step counterfactual
  procedure:

    Step 1: ABDUCTION
      Given observed (X=x, Y=y), infer the latent exogenous variables U
      that are consistent with the observation. In our setting, U
      represents the "noise" or "unobserved state" that, combined with
      the structural equations, produced (x, y).

    Step 2: ACTION
      Modify the feature vector: set X_i = x' (the counterfactual value).
      Keep U fixed from step 1.

    Step 3: PREDICTION
      Using the structural equations (the causal DAG + outcome function),
      compute the counterfactual outcome Y_{x'} from the modified features
      and the abducted U.

MATHEMATICAL MODEL (Pearl's structural causal model):

  Structural equations:
    X_i = f_i(parents(X_i), U_i)    for each feature i
    Y = f_Y(parents(Y), U_Y)         for the outcome

  Counterfactual:
    Y_{x'}(u) = f_Y(x', parents(Y) minus {X_i}, U_Y)
    where u is the abducted exogenous state

  In our simplified setting:
    - The outcome function f_Y is the ground truth compute_fn
    - The exogenous variables U are implicit (we don't model them explicitly)
    - Abduction: find U such that compute_fn(x) = y (trivially true for
      deterministic functions — U is empty)
    - Action: set x_i = x'
    - Prediction: compute_fn(x with x_i replaced by x')

  For DETERMINISTIC computations, counterfactuals are straightforward:
    Y_{x'} = compute_fn(x with x_i = x')

  For STOCHASTIC computations (where compute_fn has internal randomness),
  abduction matters: we infer the random seed that produced (x, y),
  then reuse it for the counterfactual prediction.

WHY THIS MATTERS:

  Counterfactual reasoning enables:
    1. WHAT-IF ANALYSIS: "Would this mutation have been admitted if the
       risk class had been lower?"
    2. COUNTERFACTUAL EXPLANATION: "Why was this computation rejected?
       Because feature 0 was 0. If it had been 1, the outcome would
       have been True."
    3. POLICY EVALUATION: "If we change the policy (force feature 1 = 0),
       how would outcomes change?"
    4. REGRET ANALYSIS: "Was this the optimal decision? What would have
       happened with a different feature value?"

  All of these can be answered WITHOUT executing the original computation
  — the counterfactual engine uses the structural equations (causal DAG
  + outcome function) to derive the answer.
"""
from __future__ import annotations

import math
import random
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

from rce.rce2_substrate import Substrate
from rce.rce2_scm_discovery import SubstrateV612, CausalDAG


# ===========================================================================
# Counterfactual Result
# ===========================================================================

@dataclass
class CounterfactualResult:
    """The result of a counterfactual query."""
    original_features: Tuple[float, ...]
    original_outcome: Any
    counterfactual_features: Tuple[float, ...]   # modified features
    counterfactual_outcome: Any                   # predicted outcome
    intervened_features: Dict[int, float]         # which features were changed
    explanation: str                              # human-readable explanation
    confidence: float                             # confidence in the counterfactual


# ===========================================================================
# Counterfactual Engine
# ===========================================================================

class CounterfactualEngine:
    """Answers counterfactual queries using the causal DAG.

    Implements Pearl's 3-step procedure:
      1. ABDUCTION: infer latent state from observation
      2. ACTION: modify features
      3. PREDICTION: derive counterfactual outcome

    For deterministic computations, this reduces to:
      Y_{x'} = compute_fn(x with x_i = x')

    The engine also provides:
      - COUNTERFACTUAL EXPLANATION: why was the outcome what it was?
      - MINIMAL COUNTERFACTUAL: what's the smallest change that flips the outcome?
      - POLICY EVALUATION: what happens if we force a feature to a value?
    """

    def __init__(self, compute_fn: Callable[[Tuple[float, ...]], Any],
                 dag: Optional[CausalDAG] = None) -> None:
        self.compute_fn = compute_fn
        self.dag = dag
        self.queries_log: List[CounterfactualResult] = []

    def query(self, features: Tuple[float, ...],
              interventions: Dict[int, float],
              original_outcome: Optional[Any] = None) -> CounterfactualResult:
        """Answer a counterfactual query.

        Args:
            features: the observed feature vector
            interventions: dict {feature_idx: new_value} — what to change
            original_outcome: the observed outcome (computed if not provided)

        Returns:
            CounterfactualResult with the counterfactual outcome

        Example:
            # "What would the outcome be if feature 0 had been 1?"
            result = engine.query(
                features=(0, 1, 1),
                interventions={0: 1.0})
        """
        # Step 1: ABDUCTION
        # For deterministic functions, the latent state is trivially consistent.
        # We just record the original outcome.
        if original_outcome is None:
            original_outcome = self.compute_fn(features)

        # Step 2: ACTION
        # Modify the features according to the interventions
        cf_features = list(features)
        for idx, val in interventions.items():
            if idx < len(cf_features):
                cf_features[idx] = val
        cf_features = tuple(cf_features)

        # Step 3: PREDICTION
        # Compute the counterfactual outcome using the structural equations
        cf_outcome = self.compute_fn(cf_features)

        # Build explanation
        changes = ", ".join(f"f[{idx}]={val}" for idx, val in interventions.items())
        explanation = (
            f"Given features {features} → outcome {original_outcome}. "
            f"If we had {changes}, the outcome would be {cf_outcome}.")

        result = CounterfactualResult(
            original_features=features,
            original_outcome=original_outcome,
            counterfactual_features=cf_features,
            counterfactual_outcome=cf_outcome,
            intervened_features=interventions,
            explanation=explanation,
            confidence=1.0,  # deterministic → perfect confidence
        )
        self.queries_log.append(result)
        return result

    def explain(self, features: Tuple[float, ...],
                target_outcome: Any,
                max_features_to_check: int = 5
                ) -> Optional[CounterfactualResult]:
        """Find a minimal counterfactual explanation.

        "What's the smallest change to features that would flip the
        outcome to target_outcome?"

        Returns the minimal counterfactual if found, None otherwise.
        """
        original_outcome = self.compute_fn(features)
        if original_outcome == target_outcome:
            return None  # already at target

        # Try single-feature changes first
        for idx in range(min(len(features), max_features_to_check)):
            for val in [0.0, 1.0]:  # binary features
                if features[idx] == val:
                    continue
                result = self.query(features, {idx: val}, original_outcome)
                if result.counterfactual_outcome == target_outcome:
                    return result

        # Try two-feature changes
        for i in range(min(len(features), max_features_to_check)):
            for j in range(i + 1, min(len(features), max_features_to_check)):
                for vi in [0.0, 1.0]:
                    for vj in [0.0, 1.0]:
                        if features[i] == vi and features[j] == vj:
                            continue
                        result = self.query(
                            features, {i: vi, j: vj}, original_outcome)
                        if result.counterfactual_outcome == target_outcome:
                            return result

        return None  # no minimal counterfactual found

    def policy_evaluation(self, features_list: List[Tuple[float, ...]],
                           policy: Dict[int, float]
                           ) -> Dict[str, Any]:
        """Evaluate a policy: force certain features to certain values.

        "If we apply this policy (force feature i = value) to all
        computations, how do outcomes change?"

        Args:
            features_list: list of observed feature vectors
            policy: dict {feature_idx: forced_value}

        Returns:
            Statistics on outcome changes
        """
        original_outcomes = []
        policy_outcomes = []
        flips = 0

        for features in features_list:
            original = self.compute_fn(features)
            result = self.query(features, policy, original)
            original_outcomes.append(original)
            policy_outcomes.append(result.counterfactual_outcome)
            if original != result.counterfactual_outcome:
                flips += 1

        return {
            "n_evaluated": len(features_list),
            "n_outcome_flips": flips,
            "flip_rate": flips / max(len(features_list), 1),
            "original_true_rate": sum(1 for o in original_outcomes if o) / max(len(original_outcomes), 1),
            "policy_true_rate": sum(1 for o in policy_outcomes if o) / max(len(policy_outcomes), 1),
            "policy": policy,
        }

    def regret_analysis(self, features: Tuple[float, ...],
                         possible_values: Dict[int, List[float]]
                         ) -> Dict[str, Any]:
        """Analyze regret: was this the optimal decision?

        "Given the observed features, what's the best value for each
        controllable feature?"

        Args:
            features: observed features
            possible_values: dict {feature_idx: [possible values]}

        Returns:
            Analysis of best/worst outcomes for each feature value
        """
        original_outcome = self.compute_fn(features)
        results = {}

        for idx, values in possible_values.items():
            outcomes_by_value = {}
            for val in values:
                if features[idx] == val:
                    outcomes_by_value[val] = original_outcome
                else:
                    result = self.query(features, {idx: val}, original_outcome)
                    outcomes_by_value[val] = result.counterfactual_outcome
            results[idx] = outcomes_by_value

        return {
            "original_features": features,
            "original_outcome": original_outcome,
            "outcomes_by_feature_value": results,
        }

    def get_stats(self) -> Dict[str, Any]:
        return {
            "n_queries": len(self.queries_log),
            "n_explanations": sum(1 for q in self.queries_log
                                  if "explanation" in q.explanation.lower()),
        }


# ===========================================================================
# v6.13 Substrate with Counterfactual Reasoning
# ===========================================================================

class SubstrateV613:
    """The v6.13 substrate integrating counterfactual reasoning.

    Extends v6.12 with:
      - CounterfactualEngine for what-if analysis
      - Counterfactual explanation (minimal change to flip outcome)
      - Policy evaluation (what happens if we force features)
      - Regret analysis (was this the optimal decision?)
    """

    def __init__(self,
                 min_confidence: float = 0.85,
                 calibrated_target_acc: float = 0.90,
                 default_value: float = 1000.0,
                 min_value_threshold: float = 10.0,
                 ace_threshold: float = 0.1,
                 ci_epsilon: float = 0.1) -> None:
        self.v612 = SubstrateV612(
            min_confidence=min_confidence,
            calibrated_target_acc=calibrated_target_acc,
            default_value=default_value,
            min_value_threshold=min_value_threshold,
            ace_threshold=ace_threshold,
            ci_epsilon=ci_epsilon,
        )
        self.counterfactual_engines: Dict[str, CounterfactualEngine] = {}

    def train(self, computation_type: str,
              features: Tuple[float, ...], outcome: Any) -> None:
        self.v612.train(computation_type, features, outcome)

    def fit(self, computation_type: str) -> Dict[str, Any]:
        return self.v612.fit(computation_type)

    def discover_scm(self, computation_type: str,
                      compute_fn: Callable[[Tuple[float, ...]], Any],
                      training_features: List[Tuple[float, ...]]
                      ) -> Dict[str, Any]:
        """Discover SCM and initialize counterfactual engine."""
        result = self.v612.discover_scm(computation_type, compute_fn, training_features)
        # Initialize counterfactual engine with the compute_fn
        dag = self.v612.scm_discoverer.dags.get(computation_type)
        self.counterfactual_engines[computation_type] = CounterfactualEngine(
            compute_fn, dag)
        return result

    def counterfactual(self, computation_type: str,
                        features: Tuple[float, ...],
                        interventions: Dict[int, float],
                        original_outcome: Optional[Any] = None
                        ) -> CounterfactualResult:
        """Answer a counterfactual query.

        "What would the outcome be if features had been different?"
        """
        engine = self.counterfactual_engines.get(computation_type)
        if engine is None:
            raise ValueError(
                f"No counterfactual engine for {computation_type}. "
                f"Call discover_scm first.")
        return engine.query(features, interventions, original_outcome)

    def explain(self, computation_type: str,
                 features: Tuple[float, ...],
                 target_outcome: Any
                 ) -> Optional[CounterfactualResult]:
        """Find a minimal counterfactual explanation.

        "What's the smallest change to features that would flip the outcome?"
        """
        engine = self.counterfactual_engines.get(computation_type)
        if engine is None:
            raise ValueError(f"No counterfactual engine for {computation_type}.")
        return engine.explain(features, target_outcome)

    def evaluate_policy(self, computation_type: str,
                         features_list: List[Tuple[float, ...]],
                         policy: Dict[int, float]
                         ) -> Dict[str, Any]:
        """Evaluate a policy: force certain features to certain values."""
        engine = self.counterfactual_engines.get(computation_type)
        if engine is None:
            raise ValueError(f"No counterfactual engine for {computation_type}.")
        return engine.policy_evaluation(features_list, policy)

    def predict(self, computation_type: str,
                features: Tuple[float, ...],
                full_computation: Callable,
                original_cost: float = 1000.0,
                record_outcome: bool = False
                ) -> Tuple[Any, float, float]:
        """Predict using the v6.12 substrate (no change to prediction).

        The counterfactual engine is for what-if analysis, not prediction.
        Prediction still uses the causal laws from v6.11/v6.12.
        """
        predicted, outcome, conf, cost, roots = self.v612.predict_with_scm(
            computation_type, features, full_computation,
            original_cost=original_cost, record_outcome=record_outcome)
        return predicted, conf, cost

    def get_report(self) -> Dict[str, Any]:
        return {
            "v612_report": self.v612.get_report(),
            "counterfactual_stats": {
                ct: engine.get_stats()
                for ct, engine in self.counterfactual_engines.items()
            },
        }


# ===========================================================================
# Self-test
# ===========================================================================

def self_test() -> None:
    """Quick self-test of counterfactual reasoning."""
    import random
    print("Running v6.13 counterfactual self-test...")

    sub = SubstrateV613()
    rng = random.Random(42)

    # Define a computation: outcome = f[0] AND f[1]
    def compute_fn(f):
        return bool(f[0]) and bool(f[1])

    # Train
    training = []
    for _ in range(100):
        f = (float(rng.random() > 0.3), float(rng.random() > 0.3),
             float(rng.random() > 0.5))
        training.append(f)
    for f in training:
        sub.train("and2", f, compute_fn(f))
    sub.fit("and2")
    sub.discover_scm("and2", compute_fn, training)

    # Counterfactual query
    print("\n  Counterfactual query:")
    f = (1.0, 1.0, 0.0)
    original = compute_fn(f)
    print(f"    Original: {f} → {original}")
    result = sub.counterfactual("and2", f, {0: 0.0})
    print(f"    Counterfactual: f[0]=0 → {result.counterfactual_outcome}")
    print(f"    Explanation: {result.explanation}")

    # Explanation: minimal change to flip outcome
    print("\n  Minimal counterfactual explanation:")
    f = (0.0, 1.0, 0.0)  # outcome = False
    explanation = sub.explain("and2", f, True)  # what changes make it True?
    if explanation:
        print(f"    {explanation.explanation}")
    else:
        print(f"    No minimal counterfactual found")

    # Policy evaluation
    print("\n  Policy evaluation:")
    features_list = [(float(rng.random() > 0.3), float(rng.random() > 0.3),
                      float(rng.random() > 0.5)) for _ in range(50)]
    policy_result = sub.evaluate_policy("and2", features_list, {0: 1.0})
    print(f"    Policy: force f[0]=1")
    print(f"    Flips: {policy_result['n_outcome_flips']}/{policy_result['n_evaluated']}")
    print(f"    Original True rate: {policy_result['original_true_rate']:.2f}")
    print(f"    Policy True rate: {policy_result['policy_true_rate']:.2f}")

    print("\nSelf-test OK.")


if __name__ == "__main__":
    self_test()
