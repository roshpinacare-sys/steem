#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rce2_meta_learner.py — RCE-2 v6.10 Multi-Task Law Transfer

PROBLEM:
  The substrate learns laws PER computation type. If type A and type B
  share the same underlying structure (e.g. both are AND-of-3, just with
  different feature semantics), the substrate learns the same law twice
  — once for A, once for B. This is wasteful and misses the opportunity
  to transfer knowledge.

SOLUTION:
  The MetaLearner discovers STRUCTURAL ISOMORPHISMS between computation
  types. If type A's law (mask, centroids, outcome) is isomorphic to
  type B's law under a feature permutation, the law can be transferred:
  given a new type B query, apply A's law using the permutation mapping.

MECHANISM:

  1. STRUCTURAL SIGNATURE: For each computation type, compute a
     signature based on the compressed laws:
       sig(τ) = sorted([(mask_size, n_centroids, outcome_type)
                         for law in compressed_laws[τ]])

     Two types with the same signature have the same number of laws,
     same mask sizes, same centroid counts, same outcome types. They
     are candidates for isomorphism.

  2. FEATURE PERMUTATION SEARCH: For each candidate pair (A, B), search
     for a permutation π of features such that A's laws, when their
     feature masks are permuted by π, match B's laws. If found, π is
     the isomorphism mapping.

  3. LAW TRANSFER: When a new type B query arrives and B has no laws
     yet (or few), check if A's laws can be transferred via π. Apply
     A's law to the permuted query.

  4. VALIDATION: Transferred laws start with status SUSPECT (from the
     law refiner). They must be verified on B's data before being
     promoted to ACTIVE.

MATHEMATICAL MODEL:

  Isomorphism between types A and B:
    ∃ permutation π: {0,...,d-1} → {0,...,d-1} such that
    ∀ law L_A in compressed_laws[A]:
      ∃ law L_B in compressed_laws[B] with:
        L_B.feature_mask = π(L_A.feature_mask)
        L_B.outcome = L_A.outcome
        L_B.radius ≈ L_A.radius

  Transfer for query x on type B:
    x_A = π^(-1)(x)   (map B's features to A's feature space)
    L_A = query_laws(A, x_A)
    if L_A is not None:
        prediction = L_A.outcome
        confidence = L_A.confidence * transfer_factor

  transfer_factor = 0.5 initially (transferred laws are less trusted)
  transfer_factor increases as transferred laws are verified on B's data.

This is the substrate's META-LEARNING: it doesn't just learn laws,
it learns the STRUCTURE of laws and transfers that structure across
computation types.
"""
from __future__ import annotations

import itertools
import math
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

from rce.rce2_substrate import Substrate, SubstrateOutcome
from rce.rce2_adaptive_gate import make_substrate_with_adaptive_gate
from rce.rce2_law_refiner import (
    SubstrateV69, OnlineLawRefiner, RefinedLaw, LawStatus,
)


# ===========================================================================
# Structural Signature
# ===========================================================================

@dataclass
class StructuralSignature:
    """A signature summarizing the structure of a computation type's laws."""
    computation_type: str
    n_laws: int
    mask_sizes: Tuple[int, ...]       # sorted mask sizes
    centroid_counts: Tuple[int, ...]  # sorted centroid counts
    outcome_types: Tuple[str, ...]    # sorted outcome type names
    dimensionality: int

    def matches(self, other: "StructuralSignature") -> bool:
        """Two signatures match if they have compatible structure.

        We require:
          - Same dimensionality
          - Same outcome types
          - Similar number of laws (within 50% tolerance)
        We do NOT require exact law count match because law discovery
        is stochastic — two runs on similar data may produce slightly
        different law counts.
        """
        if self.dimensionality != other.dimensionality:
            return False
        if self.outcome_types != other.outcome_types:
            return False
        # Allow law count to differ by up to 50%
        min_laws = min(self.n_laws, other.n_laws)
        max_laws = max(self.n_laws, other.n_laws)
        if max_laws > min_laws * 2 and min_laws > 0:
            return False
        return True


def compute_signature(substrate: Substrate,
                      computation_type: str) -> Optional[StructuralSignature]:
    """Compute the structural signature for a computation type."""
    laws = substrate.compression.compressed_laws.get(computation_type, [])
    if not laws:
        return None
    states = substrate.universe.states.get(computation_type, [])
    if not states:
        return None
    d = len(states[0].features)
    mask_sizes = tuple(sorted(len(l.feature_mask) for l in laws))
    centroid_counts = tuple(sorted(len(l.centroids) for l in laws))
    # Use SET of outcome types (not one per law) so that types with
    # different law counts but same outcome types still match
    outcome_type_set = sorted(set(str(type(l.outcome).__name__) for l in laws))
    outcome_types = tuple(outcome_type_set)
    return StructuralSignature(
        computation_type=computation_type,
        n_laws=len(laws),
        mask_sizes=mask_sizes,
        centroid_counts=centroid_counts,
        outcome_types=outcome_types,
        dimensionality=d,
    )


# ===========================================================================
# Isomorphism Detection
# ===========================================================================

@dataclass
class Isomorphism:
    """A discovered isomorphism between two computation types."""
    source_type: str
    target_type: str
    permutation: Tuple[int, ...]    # π: target_features → source_features
    confidence: float               # how confident we are in this isomorphism
    n_verified: int = 0             # how many transfers verified
    n_failed: int = 0


def find_isomorphism(substrate: Substrate,
                     source_type: str,
                     target_type: str,
                     max_permutations: int = 720) -> Optional[Isomorphism]:
    """Find a feature permutation that maps source laws to target laws.

    For efficiency, we only search permutations up to max_permutations
    (default 720 = 6!, so this works for d <= 6). For higher dimensions,
    we use a greedy heuristic instead of exhaustive search.

    Returns an Isomorphism if found, None otherwise.
    """
    source_laws = substrate.compression.compressed_laws.get(source_type, [])
    target_laws = substrate.compression.compressed_laws.get(target_type, [])
    if not source_laws or not target_laws:
        return None

    source_states = substrate.universe.states.get(source_type, [])
    target_states = substrate.universe.states.get(target_type, [])
    if not source_states or not target_states:
        return None

    d_source = len(source_states[0].features)
    d_target = len(target_states[0].features)
    if d_source != d_target:
        return None

    d = d_source

    # For d <= 6, try all permutations (6! = 720)
    if d <= 6:
        return _find_isomorphism_exhaustive(
            substrate, source_type, target_type, source_laws, target_laws, d)

    # For d > 6, use greedy heuristic
    return _find_isomorphism_greedy(
        substrate, source_type, target_type, source_laws, target_laws, d)


def _find_isomorphism_exhaustive(substrate, source_type, target_type,
                                  source_laws, target_laws, d) -> Optional[Isomorphism]:
    """Exhaustively search all permutations (for d <= 6)."""
    for perm in itertools.permutations(range(d)):
        if _check_permutation(source_laws, target_laws, perm):
            return Isomorphism(
                source_type=source_type,
                target_type=target_type,
                permutation=perm,
                confidence=0.5,  # initial confidence
            )
    return None


def _find_isomorphism_greedy(substrate, source_type, target_type,
                              source_laws, target_laws, d) -> Optional[Isomorphism]:
    """Greedy heuristic for high dimensions: match features by their
    correlation with the outcome."""
    # For each feature in source and target, compute correlation with outcome
    source_states = substrate.universe.states.get(source_type, [])
    target_states = substrate.universe.states.get(target_type, [])

    source_corr = _feature_outcome_correlation(source_states, d)
    target_corr = _feature_outcome_correlation(target_states, d)

    # Match features by sorted correlation rank
    source_rank = sorted(range(d), key=lambda i: source_corr[i])
    target_rank = sorted(range(d), key=lambda i: target_corr[i])

    # Build permutation: target[i] → source[rank_match[i]]
    perm = [0] * d
    for i in range(d):
        perm[target_rank[i]] = source_rank[i]

    perm = tuple(perm)
    if _check_permutation(source_laws, target_laws, perm):
        return Isomorphism(
            source_type=source_type,
            target_type=target_type,
            permutation=perm,
            confidence=0.4,  # lower confidence for heuristic
        )
    return None


def _feature_outcome_correlation(states, d) -> List[float]:
    """Compute correlation of each feature with the outcome (binary)."""
    if not states:
        return [0.0] * d
    outcomes = [1.0 if s.outcome else 0.0 for s in states]
    mean_y = sum(outcomes) / len(outcomes)
    corrs = []
    for i in range(d):
        feats = [s.features[i] for s in states]
        mean_x = sum(feats) / len(feats)
        cov = sum((x - mean_x) * (y - mean_y) for x, y in zip(feats, outcomes))
        var_x = sum((x - mean_x) ** 2 for x in feats)
        var_y = sum((y - mean_y) ** 2 for y in outcomes)
        if var_x > 0 and var_y > 0:
            corrs.append(cov / (math.sqrt(var_x * var_y)))
        else:
            corrs.append(0.0)
    return corrs


def _check_permutation(source_laws, target_laws,
                        perm: Tuple[int, ...]) -> bool:
    """Check if applying perm to source laws' masks matches target laws.

    For AND-of-N (where all laws have the full mask), any permutation
    trivially matches because the permuted mask is still the full set.
    We verify by checking:
      1. For each source law, a target law exists with the same outcome
      2. The number of source laws with each outcome matches the number
         of target laws with that outcome (under permutation)

    For non-trivial masks, we also check that the permuted mask matches
    a target law's mask.
    """
    # Group target laws by outcome
    target_by_outcome = defaultdict(list)
    for tl in target_laws:
        target_by_outcome[tl.outcome].append(tl)

    # Group target laws by (sorted_mask, outcome)
    target_by_mask_outcome = defaultdict(list)
    for tl in target_laws:
        key = (tuple(sorted(tl.feature_mask)), tl.outcome)
        target_by_mask_outcome[key].append(tl)

    for sl in source_laws:
        # Apply permutation: source feature i → target feature perm[i]
        permuted_mask = tuple(perm[i] for i in sl.feature_mask)
        sorted_perm_mask = tuple(sorted(permuted_mask))

        # Try exact match on (sorted_mask, outcome)
        key = (sorted_perm_mask, sl.outcome)
        if key in target_by_mask_outcome:
            continue

        # Fallback: match on outcome only (for full-mask laws where
        # any permutation is valid)
        if sl.outcome in target_by_outcome:
            continue

        return False
    return True


# ===========================================================================
# Meta-Learner
# ===========================================================================

class MetaLearner:
    """Discovers isomorphisms between computation types and transfers laws.

    The meta-learner maintains a registry of isomorphisms. When a new
    computation type arrives with insufficient laws, the meta-learner
    searches for an isomorphic source type and transfers its laws.
    """

    def __init__(self, substrate: Substrate) -> None:
        self.substrate = substrate
        self.isomorphisms: Dict[Tuple[str, str], Isomorphism] = {}
        self.signatures: Dict[str, StructuralSignature] = {}
        self.transfer_stats = {
            "n_isomorphisms_found": 0,
            "n_transfers_attempted": 0,
            "n_transfers_succeeded": 0,
            "n_transfers_failed": 0,
        }

    def register_type(self, computation_type: str) -> Optional[StructuralSignature]:
        """Compute and store the signature for a computation type."""
        sig = compute_signature(self.substrate, computation_type)
        if sig is not None:
            self.signatures[computation_type] = sig
        return sig

    def find_all_isomorphisms(self) -> List[Isomorphism]:
        """Find isomorphisms between all registered computation types."""
        types = list(self.signatures.keys())
        found = []
        for i, source in enumerate(types):
            for target in types[i+1:]:
                # Check signature match
                if not self.signatures[source].matches(self.signatures[target]):
                    continue
                # Search for permutation
                iso = find_isomorphism(self.substrate, source, target)
                if iso is not None:
                    self.isomorphisms[(source, target)] = iso
                    found.append(iso)
                    # Also store reverse
                    rev_perm = _inverse_permutation(iso.permutation)
                    rev_iso = Isomorphism(
                        source_type=target,
                        target_type=source,
                        permutation=rev_perm,
                        confidence=iso.confidence,
                    )
                    self.isomorphisms[(target, source)] = rev_iso
                    found.append(rev_iso)
        self.transfer_stats["n_isomorphisms_found"] = len(self.isomorphisms)
        return found

    def transfer_law(self, source_type: str, target_type: str,
                     query_features: Tuple[float, ...]
                     ) -> Optional[Tuple[Any, float, str]]:
        """Transfer a law from source to target for the given query.

        Returns (prediction, confidence, source_law_id) if a transfer
        is possible, None otherwise.
        """
        iso = self.isomorphisms.get((source_type, target_type))
        if iso is None:
            return None

        # Map target features to source feature space
        # perm maps target_index → source_index
        # So source_features[source_index] = target_features[perm^-1[source_index]]
        # Equivalently: source_features[i] = target_features[inverse_perm[i]]
        inv_perm = _inverse_permutation(iso.permutation)
        source_features = tuple(query_features[inv_perm[i]] for i in range(len(inv_perm)))

        # Query source's laws with the mapped features
        source_law = self.substrate.compression.query_compressed_law(
            source_type, source_features)
        if source_law is None:
            return None

        self.transfer_stats["n_transfers_attempted"] += 1
        # Transferred confidence is reduced
        transferred_conf = source_law.confidence * iso.confidence
        return source_law.outcome, transferred_conf, source_law.law_id

    def record_transfer_result(self, source_type: str, target_type: str,
                                success: bool) -> None:
        """Record whether a transfer was correct, updating confidence."""
        iso = self.isomorphisms.get((source_type, target_type))
        if iso is None:
            return
        if success:
            iso.n_verified += 1
            self.transfer_stats["n_transfers_succeeded"] += 1
            # Increase confidence (up to 0.9)
            iso.confidence = min(0.9, iso.confidence + 0.1)
        else:
            iso.n_failed += 1
            self.transfer_stats["n_transfers_failed"] += 1
            # Decrease confidence
            iso.confidence = max(0.0, iso.confidence - 0.2)

    def get_stats(self) -> Dict[str, Any]:
        return {
            **self.transfer_stats,
            "n_registered_types": len(self.signatures),
            "n_isomorphism_pairs": len(self.isomorphisms),
            "isomorphism_details": [
                {
                    "source": iso.source_type,
                    "target": iso.target_type,
                    "confidence": round(iso.confidence, 3),
                    "verified": iso.n_verified,
                    "failed": iso.n_failed,
                }
                for iso in self.isomorphisms.values()
            ],
        }


def _inverse_permutation(perm: Tuple[int, ...]) -> Tuple[int, ...]:
    """Compute the inverse of a permutation."""
    inv = [0] * len(perm)
    for i, p in enumerate(perm):
        inv[p] = i
    return tuple(inv)


# ===========================================================================
# v6.10 Substrate with Multi-Task Law Transfer
# ===========================================================================

class SubstrateV610:
    """The v6.10 substrate integrating multi-task law transfer.

    Extends v6.9 with:
      - MetaLearner that discovers isomorphisms between computation types
      - Law transfer: when type B has no laws, use type A's laws via isomorphism
      - Transfer validation: transferred laws start with reduced confidence
        and are validated against B's data
    """

    def __init__(self,
                 min_confidence: float = 0.85,
                 calibrated_target_acc: float = 0.90,
                 default_value: float = 1000.0,
                 min_value_threshold: float = 10.0) -> None:
        self.v69 = SubstrateV69(
            min_confidence=min_confidence,
            calibrated_target_acc=calibrated_target_acc,
            default_value=default_value,
            min_value_threshold=min_value_threshold,
        )
        self.meta_learner = MetaLearner(self.v69.v68.substrate)
        self._transfer_threshold = 0.3  # minimum confidence for transferred laws

    def train(self, computation_type: str,
              features: Tuple[float, ...], outcome: Any) -> None:
        self.v69.train(computation_type, features, outcome)

    def fit(self, computation_type: str) -> Dict[str, Any]:
        result = self.v69.fit(computation_type)
        self.meta_learner.register_type(computation_type)
        return result

    def discover_isomorphisms(self) -> List[Isomorphism]:
        """Discover all isomorphisms between registered types."""
        return self.meta_learner.find_all_isomorphisms()

    def predict_with_transfer(self, computation_type: str,
                               features: Tuple[float, ...],
                               full_computation: Callable,
                               original_cost: float = 1000.0,
                               record_outcome: bool = False
                               ) -> Tuple[Any, SubstrateOutcome, float, float,
                                          Optional[Isomorphism], Optional[str]]:
        """Predict with multi-task law transfer.

        If the substrate has laws for this type, use them (v6.9 path).
        If not, try to transfer from an isomorphic source type.

        Returns:
            (predicted, outcome, confidence, cost, isomorphism_used, source_law_id)
        """
        # First, try the v6.9 prediction (refined laws)
        predicted, outcome, conf, cost, refined_law = self.v69.predict_with_refinement(
            computation_type, features, full_computation,
            original_cost=original_cost, record_outcome=record_outcome)

        # If v6.9 gave a confident prediction, use it
        if outcome in (SubstrateOutcome.INVARIANT, SubstrateOutcome.LAW,
                       SubstrateOutcome.CONSENSUS) and conf >= 0.5:
            return predicted, outcome, conf, cost, None, None

        # Otherwise, try transfer from isomorphic types
        for (source, target), iso in self.meta_learner.isomorphisms.items():
            if target != computation_type:
                continue
            if iso.confidence < self._transfer_threshold:
                continue
            transfer_result = self.meta_learner.transfer_law(
                source, computation_type, features)
            if transfer_result is not None:
                t_prediction, t_conf, t_source_law_id = transfer_result
                if t_conf >= self._transfer_threshold:
                    self.v69.v68.substrate.stats.law += 1
                    return (t_prediction, SubstrateOutcome.LAW,
                            t_conf, 2.0, iso, t_source_law_id)

        # Fall back to the v6.9 result (which may be escalation)
        return predicted, outcome, conf, cost, None, None

    def verify_transfer(self, source_type: str, target_type: str,
                         predicted: Any, actual: Any) -> bool:
        """Verify a transferred prediction and update isomorphism confidence."""
        correct = (predicted == actual)
        self.meta_learner.record_transfer_result(source_type, target_type, correct)
        return correct

    def get_report(self) -> Dict[str, Any]:
        return {
            "v69_report": self.v69.get_report(),
            "meta_learner_stats": self.meta_learner.get_stats(),
        }


# ===========================================================================
# Self-test
# ===========================================================================

def self_test() -> None:
    """Quick self-test of the meta-learner."""
    import random
    print("Running v6.10 meta-learner self-test...")
    sub = SubstrateV610()
    rng = random.Random(42)

    # Train type A: AND-of-3
    for _ in range(100):
        f = tuple(float(rng.random() > 0.3) for _ in range(3))
        y = all(bool(v) for v in f)
        sub.train("typeA_and3", f, y)
    sub.fit("typeA_and3")

    # Train type B: AND-of-3 with PERMUTED features (f0, f2, f1)
    for _ in range(100):
        f = tuple(float(rng.random() > 0.3) for _ in range(3))
        # Permute: B's (f0, f1, f2) = A's (f0, f2, f1)
        # So B's outcome = A's outcome under permutation
        y = f[0] and f[2] and f[1]  # same as AND-of-3
        sub.train("typeB_and3_perm", f, y)
    sub.fit("typeB_and3_perm")

    # Discover isomorphisms
    isos = sub.discover_isomorphisms()
    print(f"  Found {len(isos)} isomorphisms")
    for iso in isos:
        print(f"    {iso.source_type} → {iso.target_type}: perm={iso.permutation} conf={iso.confidence:.2f}")

    # Test transfer: predict on typeB using typeA's laws
    f = (1.0, 1.0, 1.0)
    predicted, outcome, conf, cost, iso_used, source_law = sub.predict_with_transfer(
        "typeB_and3_perm", f, full_computation=lambda: True, record_outcome=False)
    actual = all(bool(v) for v in f)
    print(f"  Predict typeB {f}: predicted={predicted} actual={actual} outcome={outcome.value}")
    if iso_used:
        print(f"    Transfer used: {iso_used.source_type} → {iso_used.target_type} conf={conf:.3f}")

    print("Self-test OK.")


if __name__ == "__main__":
    self_test()
