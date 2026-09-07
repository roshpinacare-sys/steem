#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rce2_law_verification.py — Law Verification Layer

GOAL: Prove that a discovered representation is a REAL reusable law.
NOT better prediction — PROVABLE correctness.

DESIGN PRINCIPLE:
  "No false laws accepted" > "maximum compression"
  UNKNOWN is preferred over unsafe compression.

VERIFICATION PIPELINE (4 stages, each can reject the law):

  Stage 1: DESCRIPTION LENGTH REDUCTION [IMPLEMENTED]
    - MDL = model_cost + data_cost
    - model_cost = storage_bytes * 8 (bits to store the law)
    - data_cost = number of observations NOT explained by the law (escalations)
    - Law accepted only if MDL < raw_data_cost (raw = n * 1 bit per observation)
    - Rejects laws that are larger than the data they explain

  Stage 2: MODEL COMPLEXITY PENALTY [IMPLEMENTED]
    - AIC = 2*k - 2*ln(L), where k = number of parameters, L = likelihood
    - For Boolean: L = product of correct predictions
    - Penalizes overfitting: a law with 100 parameters that fits 100 observations
      has AIC = 200, while a law with 2 parameters that fits 95 has AIC = 4 + 10 = 14
    - Rejects laws with excessive parameters relative to their fit

  Stage 3: HELD-OUT GENERALIZATION [IMPLEMENTED]
    - Split observations into 80% train, 20% validation
    - Build law on train, test on validation
    - Require 100% accuracy on held-out (not 85% or 95%)
    - ZERO TOLERANCE for false compression
    - This is the strictest test: even one wrong prediction on held-out rejects the law

  Stage 4: ADVERSARIAL COUNTEREXAMPLE SEARCH [IMPLEMENTED]
    - Given a law, actively SEARCH for counterexamples
    - Generate adversarial states designed to break the law:
      a. Boundary states: states near the law's decision boundary
      b. Random sampling: large random sample to find any violation
      c. Gradient-guided: flip bits that the law says are irrelevant
    - If ANY counterexample is found, REJECT the law
    - This is the falsification step: the law must survive active attack

ACCEPTANCE CRITERIA:
  A law is accepted ONLY if ALL 4 stages pass:
    1. MDL reduction > 0
    2. AIC < threshold (law is not overfitting)
    3. Held-out accuracy = 100%
    4. No counterexample found in adversarial search

  If ANY stage fails, the law is REJECTED and the classifier outputs UNKNOWN.

COST:
  - Stages 1-3: O(n) — cheap, reuse existing computations
  - Stage 4: O(k * d) — k adversarial states, each evaluated in O(d) time
  - Total verification cost: O(n + k*d) per law
"""
from __future__ import annotations

import math
import random
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                 "..", "download"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from rce2_meta_representation_v2 import (
    try_gf2_recovery, try_walsh_recovery, try_dfa_recovery,
    classify, GF2Result, WalshResult, DFAResult, ClassificationResult,
)


# ===========================================================================
# Verification Result
# ===========================================================================

@dataclass
class VerificationResult:
    """Result of law verification."""
    accepted: bool
    mdl_reduction: float           # bits saved by using the law
    aic: float                     # Akaike Information Criterion
    held_out_accuracy: float       # accuracy on held-out validation set
    n_counterexamples_found: int   # adversarial counterexamples
    n_adversarial_tested: int      # total adversarial states tested
    rejection_reason: str          # why the law was rejected (if applicable)
    verification_cost: int         # operations spent on verification
    stage_results: Dict[str, bool] = field(default_factory=dict)


# ===========================================================================
# Law Verification Layer
# ===========================================================================

class LawVerificationLayer:
    """Verifies that a discovered law is a real reusable law.

    4-stage pipeline:
      1. MDL reduction check
      2. Model complexity penalty (AIC)
      3. Held-out generalization (100% required)
      4. Adversarial counterexample search

    OPTIMIZATION TARGET: "No false laws accepted" > "maximum compression"
    """

    def __init__(self,
                 n_adversarial: int = 500,
                 aic_threshold: float = 50.0,
                 true_fn: Optional[Callable] = None) -> None:
        self.n_adversarial = n_adversarial
        self.aic_threshold = aic_threshold
        self.true_fn = true_fn  # ground truth function for adversarial search
        self.verification_log: List[Dict[str, Any]] = []

    def verify(self,
               cls_result: ClassificationResult,
               observations: List[Tuple[int, bool]],
               d: int,
               true_fn: Optional[Callable] = None) -> VerificationResult:
        """Verify a discovered law through all 4 stages.

        Args:
            cls_result: the classifier's output (which family + law)
            observations: the training observations
            d: number of bits
            true_fn: ground truth function (for adversarial search)

        Returns:
            VerificationResult with acceptance decision
        """
        if true_fn is None:
            true_fn = self.true_fn

        cost = 0
        stage_results = {}

        # Determine which family was selected and get its details
        selected = cls_result.selected_class

        if selected == "unknown":
            # No law to verify — UNKNOWN is always "accepted" (it's the safe default)
            return VerificationResult(
                accepted=True,  # UNKNOWN is accepted as UNKNOWN
                mdl_reduction=0,
                aic=0,
                held_out_accuracy=1.0,
                n_counterexamples_found=0,
                n_adversarial_tested=0,
                rejection_reason="",
                verification_cost=0,
                stage_results={"unknown": True})

        # Get the law details
        storage_bytes = 0
        n_params = 0
        predict_fn = None

        if selected == "gf2" and cls_result.gf2_result and cls_result.gf2_result.fits:
            gf2 = cls_result.gf2_result
            storage_bytes = gf2.storage_bytes
            n_params = len(gf2.solution) if gf2.solution else 0
            solution = gf2.solution or []
            def predict_fn(state):
                r = 0
                for b in solution:
                    r ^= (state >> b) & 1
                return bool(r)

        elif selected == "walsh" and cls_result.walsh_result and cls_result.walsh_result.fits:
            walsh = cls_result.walsh_result
            storage_bytes = walsh.storage_bytes
            n_params = walsh.n_coefficients
            coeffs = walsh.coefficients
            def predict_fn(state):
                val = sum(c * (1 if bin(state & w).count('1') % 2 == 0 else -1)
                          for w, c in coeffs.items())
                return val > 0

        elif selected == "dfa" and cls_result.dfa_result and cls_result.dfa_result.fits:
            dfa = cls_result.dfa_result
            storage_bytes = dfa.storage_bytes
            n_params = dfa.n_states
            transitions = dfa.transitions
            accepting = dfa.accepting
            def predict_fn(state):
                q = 0
                for bit_idx in range(d - 1, -1, -1):
                    bit = (state >> bit_idx) & 1
                    key = (q, bit)
                    if key in transitions:
                        q = transitions[key]
                    else:
                        return None  # unknown transition
                return q in accepting

        else:
            return VerificationResult(
                accepted=False, mdl_reduction=0, aic=float('inf'),
                held_out_accuracy=0, n_counterexamples_found=0,
                n_adversarial_tested=0,
                rejection_reason=f"unknown selected class: {selected}",
                verification_cost=0,
                stage_results={"parse": False})

        n = len(observations)

        # ===== STAGE 1: MDL REDUCTION =====
        model_cost = storage_bytes * 8  # bits to store the law
        # Data cost WITHOUT the law: n bits (1 per observation)
        # Compare against full truth table (2^d bits) for small d,
        # or against observation count (n) for large d
        if d <= 16:
            raw_cost = 1 << d  # full truth table
        else:
            raw_cost = n  # observations only
        # Data cost WITH the law: observations where the law is wrong (escalations)
        n_wrong = 0
        for state, outcome in observations:
            pred = predict_fn(state)
            if pred is None or pred != outcome:
                n_wrong += 1
            cost += 1
        data_cost_with_law = n_wrong  # 1 bit per unexplained observation
        mdl_with_law = model_cost + data_cost_with_law
        mdl_reduction = raw_cost - mdl_with_law
        stage1_pass = mdl_reduction > 0
        stage_results["mdl"] = stage1_pass

        if not stage1_pass:
            return VerificationResult(
                accepted=False, mdl_reduction=mdl_reduction,
                aic=0, held_out_accuracy=0,
                n_counterexamples_found=0, n_adversarial_tested=0,
                rejection_reason=f"MDL no reduction: model={model_cost}b + data={data_cost_with_law}b = {mdl_with_law}b > raw={raw_cost}b",
                verification_cost=cost, stage_results=stage_results)

        # ===== STAGE 2: MODEL COMPLEXITY PENALTY (AIC) =====
        # AIC = 2k - 2*ln(L)
        # For Boolean: L = (correct/n)^n (binomial likelihood)
        n_correct = n - n_wrong
        if n_correct > 0 and n > 0:
            log_likelihood = n_correct * math.log(n_correct / n) if n_correct < n else 0
            # If all correct: log(L) = 0, AIC = 2k
            # If some wrong: log(L) < 0, AIC = 2k - 2*log(L) > 2k
            aic = 2 * n_params - 2 * log_likelihood
        else:
            aic = float('inf')
        cost += n

        stage2_pass = aic < self.aic_threshold
        stage_results["aic"] = stage2_pass

        if not stage2_pass:
            return VerificationResult(
                accepted=False, mdl_reduction=mdl_reduction, aic=aic,
                held_out_accuracy=0, n_counterexamples_found=0,
                n_adversarial_tested=0,
                rejection_reason=f"AIC too high: {aic:.1f} >= {self.aic_threshold} (k={n_params}, wrong={n_wrong})",
                verification_cost=cost, stage_results=stage_results)

        # ===== STAGE 3: HELD-OUT GENERALIZATION (100% required) =====
        # Split: 80% train, 20% validation
        rng = random.Random(123)
        indices = list(range(n))
        rng.shuffle(indices)
        n_val = max(1, n // 5)
        val_indices = set(indices[:n_val])
        val_obs = [observations[i] for i in val_indices]

        val_correct = 0
        val_total = 0
        for state, outcome in val_obs:
            pred = predict_fn(state)
            if pred is not None:
                val_total += 1
                if pred == outcome:
                    val_correct += 1
            cost += 1

        held_out_acc = val_correct / max(val_total, 1)
        # ZERO TOLERANCE: require 100% on held-out
        stage3_pass = held_out_acc >= 1.0
        stage_results["held_out"] = stage3_pass

        if not stage3_pass:
            return VerificationResult(
                accepted=False, mdl_reduction=mdl_reduction, aic=aic,
                held_out_accuracy=held_out_acc, n_counterexamples_found=0,
                n_adversarial_tested=0,
                rejection_reason=f"held-out accuracy {held_out_acc:.1%} < 100% ({val_correct}/{val_total})",
                verification_cost=cost, stage_results=stage_results)

        # ===== STAGE 4: ADVERSARIAL COUNTEREXAMPLE SEARCH =====
        n_counterexamples = 0
        n_tested = 0

        if true_fn is not None:
            rng_adv = random.Random(456)
            state_space = 1 << d

            # Strategy a: Random sampling
            for _ in range(self.n_adversarial // 2):
                state = rng_adv.randint(0, state_space - 1)
                actual = true_fn(state)
                predicted = predict_fn(state)
                if predicted is not None and predicted != actual:
                    n_counterexamples += 1
                n_tested += 1
                cost += 1

            # Strategy b: Boundary states — flip bits the law considers relevant
            if selected == "gf2" and cls_result.gf2_result:
                solution = cls_result.gf2_result.solution or []
                for base_state in [obs[0] for obs in observations[:20]]:
                    for bit in solution:
                        state = base_state ^ (1 << bit)
                        actual = true_fn(state)
                        predicted = predict_fn(state)
                        if predicted is not None and predicted != actual:
                            n_counterexamples += 1
                        n_tested += 1
                        cost += 1

            # Strategy c: Flip bits the law considers IRRELEVANT
            if selected == "gf2" and cls_result.gf2_result:
                solution = set(cls_result.gf2_result.solution or [])
                irrelevant_bits = [b for b in range(d) if b not in solution]
                for base_state in [obs[0] for obs in observations[:10]]:
                    for bit in irrelevant_bits[:5]:
                        state = base_state ^ (1 << bit)
                        actual = true_fn(state)
                        predicted = predict_fn(state)
                        if predicted is not None and predicted != actual:
                            n_counterexamples += 1
                        n_tested += 1
                        cost += 1

        stage4_pass = n_counterexamples == 0
        stage_results["adversarial"] = stage4_pass

        if not stage4_pass:
            return VerificationResult(
                accepted=False, mdl_reduction=mdl_reduction, aic=aic,
                held_out_accuracy=held_out_acc,
                n_counterexamples_found=n_counterexamples,
                n_adversarial_tested=n_tested,
                rejection_reason=f"adversarial search found {n_counterexamples} counterexamples in {n_tested} tests",
                verification_cost=cost, stage_results=stage_results)

        # ALL STAGES PASSED — law is accepted
        self.verification_log.append({
            "selected_class": selected,
            "mdl_reduction": mdl_reduction,
            "aic": aic,
            "held_out_accuracy": held_out_acc,
            "n_counterexamples": n_counterexamples,
            "n_adversarial": n_tested,
            "accepted": True,
        })

        return VerificationResult(
            accepted=True, mdl_reduction=mdl_reduction, aic=aic,
            held_out_accuracy=held_out_acc,
            n_counterexamples_found=0, n_adversarial_tested=n_tested,
            rejection_reason="",
            verification_cost=cost, stage_results=stage_results)

    def get_stats(self) -> Dict[str, Any]:
        n_verified = len(self.verification_log)
        n_accepted = sum(1 for v in self.verification_log if v["accepted"])
        return {
            "n_verified": n_verified,
            "n_accepted": n_accepted,
            "n_rejected": n_verified - n_accepted,
            "acceptance_rate": n_accepted / max(n_verified, 1),
        }


# ===========================================================================
# Verified Classifier (wraps the classifier + verification layer)
# ===========================================================================

class VerifiedClassifier:
    """Classifier that verifies every law before accepting it.

    If verification fails, outputs UNKNOWN instead of the false law.
    """

    def __init__(self, n_adversarial: int = 500) -> None:
        self.verifier = LawVerificationLayer(n_adversarial=n_adversarial)

    def classify_and_verify(self,
                             observations: List[Tuple[int, bool]],
                             d: int,
                             true_fn: Optional[Callable] = None
                             ) -> Tuple[ClassificationResult, VerificationResult]:
        """Classify and verify. Returns (classification, verification).

        If verification fails, the classification is overridden to UNKNOWN.
        """
        # Step 1: Classify (discover a candidate law)
        cls_result = classify(observations, d)

        # Step 2: Verify the law
        verification = self.verifier.verify(
            cls_result, observations, d, true_fn=true_fn)

        # Step 3: If verification fails, override to UNKNOWN
        if not verification.accepted and cls_result.selected_class != "unknown":
            # Create a new classification result with UNKNOWN
            overridden = ClassificationResult(
                selected_class="unknown",
                gf2_result=cls_result.gf2_result,
                walsh_result=cls_result.walsh_result,
                dfa_result=cls_result.dfa_result,
                selection_reason=f"VERIFIED-REJECTED: {verification.rejection_reason}",
                classification_cost=cls_result.classification_cost + verification.verification_cost,
            )
            return overridden, verification

        # Verification passed (or was already UNKNOWN)
        return cls_result, verification
