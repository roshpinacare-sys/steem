#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
antibody_maturation.py
======================

Antibody Repertoire and Affinity Maturation for the Fractal Self-Healing
framework.

Antibodies are short Digital DNA patterns that co-occur with defects.
The repertoire is seeded from known-defective patterns and matured
through an affinity-maturation process inspired by biological clonal
selection.  When a new artefact is committed, its DNA is scanned
against the repertoire; matches above a threshold trigger a diagnostic
trajectory that produces an ESR entry with risk_class='high'.

Adm linkage:
  - Antibody matches feed the heuristic validator in the SQA quorum
    (Chapter 4.2).
  - Match-triggered diagnostics produce ESR entries that may invoke
    the Verifiable Semantic Rollback (Chapter 12.3).
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

try:
    from digital_dna import DigitalDNA, DNARegistry, ArtefactKind
except ImportError:
    from self_healing.digital_dna import DigitalDNA, DNARegistry, ArtefactKind


# ---------------------------------------------------------------------------
# 1. Antibody model
# ---------------------------------------------------------------------------

@dataclass
class Antibody:
    """An antibody in the repertoire.

    An antibody is a short DNA pattern (a partial strand) that has been
    observed to co-occur with defects.  It carries:
      - affinity_threshold: minimum affinity for a match
      - maturity: 0.0 (naive) to 1.0 (fully matured)
      - true_positive_rate: empirical TP rate over the last K matches
      - false_positive_rate: empirical FP rate
    """
    antibody_id: str
    pattern: str               # partial DNA strand (hex prefix)
    affinity_threshold: float = 0.85
    maturity: float = 0.0
    true_positive_rate: float = 0.0
    false_positive_rate: float = 0.0
    match_count: int = 0
    defect_kind: str = "generic"
    diagnostic_playbook: Optional[str] = None  # ESR-id of the playbook


# ---------------------------------------------------------------------------
# 2. Antibody repertoire
# ---------------------------------------------------------------------------

class AntibodyRepertoire:
    """The repertoire of antibodies used for error detection.

    The repertoire is seeded from known-defective patterns and matured
    through affinity maturation: antibodies that match but whose
    trajectories later prove benign are demoted; antibodies that match
    and whose trajectories prove defective are promoted and spawn
    mutated variants for finer-grained matching.
    """

    def __init__(self, registry: DNARegistry) -> None:
        self.registry = registry
        self.antibodies: Dict[str, Antibody] = {}
        self.maturation_history: List[Dict[str, Any]] = []

    def seed(self, antibody_id: str, pattern: str,
             defect_kind: str = "generic",
             threshold: float = 0.85,
             playbook: Optional[str] = None) -> Antibody:
        """Seed a new antibody from a known-defective pattern."""
        ab = Antibody(
            antibody_id=antibody_id, pattern=pattern,
            affinity_threshold=threshold, defect_kind=defect_kind,
            diagnostic_playbook=playbook,
        )
        self.antibodies[antibody_id] = ab
        return ab

    def scan(self, dna: DigitalDNA) -> List[Tuple[Antibody, float]]:
        """Scan a DNA strand against the repertoire.

        Returns a list of (antibody, affinity) pairs for all antibodies
        whose affinity exceeds their threshold.
        """
        matches: List[Tuple[Antibody, float]] = []
        for ab in self.antibodies.values():
            # Compute affinity as the prefix-match fraction
            aff = self._prefix_affinity(dna.strand, ab.pattern)
            if aff >= ab.affinity_threshold:
                matches.append((ab, aff))
        return matches

    def _prefix_affinity(self, strand: str, pattern: str) -> float:
        """Compute affinity based on prefix match.

        The pattern is a hex prefix; affinity = (matched prefix length) /
        (pattern length).  Returns 1.0 if the strand starts with the pattern.
        """
        if len(pattern) == 0:
            return 0.0
        if strand.startswith(pattern):
            return 1.0
        # Partial prefix match
        match_len = 0
        for i in range(min(len(pattern), len(strand))):
            if strand[i] == pattern[i]:
                match_len += 1
            else:
                break
        return match_len / len(pattern)

    def record_match_outcome(self, antibody_id: str, true_positive: bool) -> None:
        """Record whether a match was a true positive or false positive.

        This drives the affinity-maturation loop.
        """
        ab = self.antibodies.get(antibody_id)
        if ab is None:
            return
        ab.match_count += 1
        alpha = 0.3  # EMA factor (faster convergence for the demo)
        if true_positive:
            ab.true_positive_rate = alpha * 1.0 + (1 - alpha) * ab.true_positive_rate
            ab.maturity = min(1.0, ab.maturity + 0.20)  # faster maturation
            # Promote: tighten the threshold
            ab.affinity_threshold = min(0.99, ab.affinity_threshold + 0.01)
        else:
            ab.false_positive_rate = alpha * 1.0 + (1 - alpha) * ab.false_positive_rate
            ab.maturity = max(0.0, ab.maturity - 0.05)
            # Demote: loosen the threshold
            ab.affinity_threshold = max(0.50, ab.affinity_threshold - 0.02)

        self.maturation_history.append({
            "antibody_id": antibody_id,
            "true_positive": true_positive,
            "new_threshold": ab.affinity_threshold,
            "new_maturity": ab.maturity,
        })

    def affinity_maturation(self) -> List[Antibody]:
        """Run one round of affinity maturation.

        For each antibody with maturity > 0.5 and true_positive_rate > 0.5,
        spawn a mutated variant with a slightly longer pattern (finer-grained
        matching).  Returns the list of newly spawned antibodies.
        """
        spawned: List[Antibody] = []
        for ab in list(self.antibodies.values()):
            if ab.maturity > 0.5 and ab.true_positive_rate > 0.5:
                # Spawn a mutated variant: extend the pattern by 1 hex char
                # derived from the most-recent true-positive strand.
                # Here we use a random extension for the stub.
                ext_char = format(random.randint(0, 15), "x")
                new_pattern = ab.pattern + ext_char
                new_id = f"{ab.antibody_id}-m{ab.match_count}"
                if new_id not in self.antibodies:
                    child = Antibody(
                        antibody_id=new_id, pattern=new_pattern,
                        affinity_threshold=min(0.99, ab.affinity_threshold + 0.02),
                        maturity=0.5,  # start half-matured
                        defect_kind=ab.defect_kind,
                        diagnostic_playbook=ab.diagnostic_playbook,
                    )
                    self.antibodies[new_id] = child
                    spawned.append(child)
                    self.maturation_history.append({
                        "action": "spawn", "parent": ab.antibody_id,
                        "child": new_id, "new_pattern": new_pattern,
                    })
        return spawned

    def stats(self) -> Dict[str, Any]:
        return {
            "total_antibodies": len(self.antibodies),
            "mature_antibodies": sum(1 for ab in self.antibodies.values() if ab.maturity > 0.5),
            "maturation_events": len(self.maturation_history),
            "antibodies": [
                {"id": ab.antibody_id, "maturity": ab.maturity,
                 "tp_rate": ab.true_positive_rate,
                 "fp_rate": ab.false_positive_rate,
                 "threshold": ab.affinity_threshold,
                 "matches": ab.match_count}
                for ab in self.antibodies.values()
            ],
        }


# ---------------------------------------------------------------------------
# 3. Self-test
# ---------------------------------------------------------------------------

def self_test() -> None:
    print("=" * 78)
    print("Antibody Maturation — Fractal Self-Healing self-test")
    print("=" * 78)

    reg = DNARegistry()
    rep = AntibodyRepertoire(reg)

    # Seed known-defective patterns
    rep.seed("ab-ecr-cascade", "a1b2c3d4e5f6",
             defect_kind="ecr_cascade", threshold=0.80)
    rep.seed("ab-thermal-surge", "f7e6d5c4b3a2",
             defect_kind="thermal_surge", threshold=0.80)
    rep.seed("ab-photonic-sat", "998877665544",
             defect_kind="photonic_saturation", threshold=0.85)
    print(f"  Seeded {len(rep.antibodies)} antibodies")

    # Create a DNA strand that matches the ECR-cascade antibody
    try:
        from digital_dna import DNAEncoder
    except ImportError:
        from self_healing.digital_dna import DNAEncoder
    enc = DNAEncoder()
    # Build a strand that starts with "a1b2c3d4e5f6"
    matching_strand = "a1b2c3d4e5f6" + "0" * (64 - 12)
    # Provide a fingerprint (the antibody uses prefix matching on strand, not fingerprint)
    dummy_fp = [1.0] * 32
    dna_match = DigitalDNA(
        strand=matching_strand, fingerprint=dummy_fp,
        kind=ArtefactKind.ESR_TRAJECTORY,
        provenance_esr_id="esr-test", environment_snapshot="snap-test",
    )
    matches = rep.scan(dna_match)
    print(f"  Scan matching strand: {len(matches)} matches")
    assert len(matches) >= 1
    assert matches[0][0].antibody_id == "ab-ecr-cascade"

    # Record a true-positive outcome
    rep.record_match_outcome("ab-ecr-cascade", true_positive=True)
    rep.record_match_outcome("ab-ecr-cascade", true_positive=True)
    rep.record_match_outcome("ab-ecr-cascade", true_positive=True)
    print(f"  After 3 TP: maturity={rep.antibodies['ab-ecr-cascade'].maturity:.3f}, "
          f"tp_rate={rep.antibodies['ab-ecr-cascade'].true_positive_rate:.3f}")

    # Run affinity maturation (should spawn a child for the mature antibody)
    spawned = rep.affinity_maturation()
    print(f"  Affinity maturation spawned {len(spawned)} children")

    # Record a false-positive on another antibody
    rep.record_match_outcome("ab-thermal-surge", true_positive=False)
    print(f"  After 1 FP: thermal-surge threshold={rep.antibodies['ab-thermal-surge'].affinity_threshold:.3f}")

    stats = rep.stats()
    print(f"\n  Repertoire stats: {stats['total_antibodies']} total, "
          f"{stats['mature_antibodies']} mature, "
          f"{stats['maturation_events']} maturation events")

    print("=" * 78)
    print("Antibody Maturation self-test PASSED.")
    print("=" * 78)


if __name__ == "__main__":
    self_test()  # pragma: no cover
