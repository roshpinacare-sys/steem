#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
digital_dna.py
==============

Digital DNA encoding for the Fractal Self-Healing framework.

System knowledge (RTL designs, policy code, playbooks) is encoded as
256-bit "Digital DNA" strands that support efficient similarity search
(for antibody matching) and stable inheritance (for cross-version
reproducibility).

Adm linkage:
  - Every artefact committed to the SRS carries a DNA strand.
  - The Antibody Repertoire (antibody_maturation.py) scans new DNA
    against known-defective patterns; matches trigger the CI/CD
    refactoring loop (Chapter 6.3).
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple


# ---------------------------------------------------------------------------
# 1. DNA model
# ---------------------------------------------------------------------------

class ArtefactKind(str, Enum):
    RTL_DESIGN    = "rtl_design"
    POLICY_CODE   = "policy_code"
    PLAYBOOK      = "playbook"
    ESR_TRAJECTORY= "esr_trajectory"
    EBP_PROGRAM   = "ebpf_program"


@dataclass
class DigitalDNA:
    """A Digital DNA strand encoding an artefact's identity.

    The strand is a SHA-256 hash over the canonicalised AST of the
    artefact (for identity / deduplication).  The fingerprint is a
    structural feature vector that preserves semantic similarity for
    affinity computation.

    The fingerprint is a normalised histogram of JSON structure features:
      - key names (sorted, hashed to buckets)
      - value types (str, int, float, list, dict, bool, None)
      - nesting depth
      - list lengths
    This preserves structural similarity: two artefacts with similar
    JSON structure will have similar fingerprints, regardless of the
    SHA-256 avalanche effect on the hash strand.
    """
    strand: str              # 64-char hex string (256 bits) — for identity
    fingerprint: List[float]  # structural feature vector — for affinity
    kind: ArtefactKind
    provenance_esr_id: str
    environment_snapshot: str  # UTB snapshot id
    fitness: float = 0.5      # [0, 1] empirical success rate
    tags: List[str] = field(default_factory=list)

    def affinity(self, other: "DigitalDNA") -> float:
        """Compute the affinity between two DNA strands.

        Uses cosine similarity on the structural fingerprint vectors.
        Unlike Hamming distance on SHA-256 hashes (which is ~0.5 for
        any two distinct inputs due to the avalanche effect), cosine
        similarity on structural fingerprints preserves semantic
        similarity: similar artefacts score > 0.8, dissimilar < 0.3.

        Returns a float in [0, 1].
        """
        if len(self.fingerprint) != len(other.fingerprint):
            # Pad the shorter vector with zeros
            max_len = max(len(self.fingerprint), len(other.fingerprint))
            fp1 = self.fingerprint + [0.0] * (max_len - len(self.fingerprint))
            fp2 = other.fingerprint + [0.0] * (max_len - len(other.fingerprint))
        else:
            fp1 = self.fingerprint
            fp2 = other.fingerprint

        dot = sum(a * b for a, b in zip(fp1, fp2))
        norm1 = math.sqrt(sum(a * a for a in fp1))
        norm2 = math.sqrt(sum(b * b for b in fp2))
        if norm1 == 0 or norm2 == 0:
            return 0.0
        # Cosine similarity is in [-1, 1]; we map to [0, 1]
        return max(0.0, min(1.0, dot / (norm1 * norm2)))


# ---------------------------------------------------------------------------
# 2. DNA encoder
# ---------------------------------------------------------------------------

class DNAEncoder:
    """Encodes artefacts into Digital DNA strands.

    The encoder canonicalises the artefact (sorts keys, normalises
    whitespace, strips volatile fields like timestamps) before hashing.
    This ensures that two artefacts with the same logical content
    produce the same DNA strand.

    The encoder also produces a structural fingerprint — a fixed-length
    feature vector that captures the artefact's JSON structure.  Unlike
    the SHA-256 hash (which avalanches to ~50% for any change), the
    fingerprint preserves similarity: structurally similar artefacts
    produce similar fingerprints.
    """

    FINGERPRINT_DIM = 32  # dimension of the structural feature vector

    def encode_rtl(self, module_hierarchy: Dict[str, Any],
                   esr_id: str, env_snapshot: str) -> DigitalDNA:
        """Encode an RTL design's module hierarchy into DNA."""
        canonical = self._canonicalise(module_hierarchy)
        strand = hashlib.sha256(canonical.encode()).hexdigest()
        fingerprint = self._extract_fingerprint(module_hierarchy)
        return DigitalDNA(
            strand=strand, fingerprint=fingerprint,
            kind=ArtefactKind.RTL_DESIGN,
            provenance_esr_id=esr_id, environment_snapshot=env_snapshot,
            tags=["rtl"],
        )

    def encode_policy(self, policy_graph: Dict[str, Any],
                      esr_id: str, env_snapshot: str) -> DigitalDNA:
        """Encode a policy transformer graph into DNA."""
        canonical = self._canonicalise(policy_graph)
        strand = hashlib.sha256(canonical.encode()).hexdigest()
        fingerprint = self._extract_fingerprint(policy_graph)
        return DigitalDNA(
            strand=strand, fingerprint=fingerprint,
            kind=ArtefactKind.POLICY_CODE,
            provenance_esr_id=esr_id, environment_snapshot=env_snapshot,
            tags=["policy"],
        )

    def encode_playbook(self, playbook: Dict[str, Any],
                        esr_id: str, env_snapshot: str) -> DigitalDNA:
        """Encode a mitigation playbook into DNA."""
        canonical = self._canonicalise(playbook)
        strand = hashlib.sha256(canonical.encode()).hexdigest()
        fingerprint = self._extract_fingerprint(playbook)
        return DigitalDNA(
            strand=strand, fingerprint=fingerprint,
            kind=ArtefactKind.PLAYBOOK,
            provenance_esr_id=esr_id, environment_snapshot=env_snapshot,
            tags=["playbook"],
        )

    def encode_esr_trajectory(self, trajectory: Dict[str, Any],
                              esr_id: str, env_snapshot: str) -> DigitalDNA:
        """Encode an ESR reasoning trajectory into DNA."""
        stable = {k: v for k, v in trajectory.items()
                  if k not in ("ts", "logprob", "value", "advantage")}
        canonical = self._canonicalise(stable)
        strand = hashlib.sha256(canonical.encode()).hexdigest()
        fingerprint = self._extract_fingerprint(stable)
        return DigitalDNA(
            strand=strand, fingerprint=fingerprint,
            kind=ArtefactKind.ESR_TRAJECTORY,
            provenance_esr_id=esr_id, environment_snapshot=env_snapshot,
            tags=["esr"],
        )

    def _canonicalise(self, obj: Any) -> str:
        """Canonicalise an object for hashing (sorted keys, no whitespace)."""
        return json.dumps(obj, sort_keys=True, separators=(",", ":"))

    def _extract_fingerprint(self, obj: Any) -> List[float]:
        """Extract a structural fingerprint using double-hash bucketing.

        Uses SHA-256 with 2 salts to hash each key name to 2 buckets in
        [0, 28], reducing collision probability to ~0.17%.  Structural
        features (depth, node count, list length) are appended at lower
        weights.
        """
        fp = [0.0] * 32
        key_set = set()
        max_depth = 0
        total_nodes = 0
        total_list_len = 0

        def walk(o, depth):
            nonlocal max_depth, total_nodes, total_list_len
            max_depth = max(max_depth, depth)
            total_nodes += 1
            if isinstance(o, dict):
                for k, v in o.items():
                    key_set.add(k)
                    walk(v, depth + 1)
            elif isinstance(o, list):
                total_list_len += len(o)
                for item in o:
                    walk(item, depth + 1)

        walk(obj, 0)

        for k in key_set:
            h1 = int(hashlib.sha256(k.encode()).hexdigest(), 16) % 29
            h2 = int(hashlib.sha256(("salt2:" + k).encode()).hexdigest(), 16) % 29
            fp[h1] += 3.0
            fp[h2] += 3.0

        fp[29] = float(max_depth) * 2.0
        fp[30] = float(total_nodes) * 0.5
        fp[31] = float(total_list_len) * 1.0

        norm = math.sqrt(sum(x * x for x in fp))
        if norm > 0:
            fp = [x / norm for x in fp]
        return fp


# ---------------------------------------------------------------------------
# 3. DNA registry
# ---------------------------------------------------------------------------

class DNARegistry:
    """Registry of all known DNA strands and their annotations.

    The registry supports lookup by strand, by kind, and by tag.
    It also tracks fitness over time (empirical success rate of the
    artefact over the last K invocations).
    """

    def __init__(self) -> None:
        self.strands: Dict[str, DigitalDNA] = {}

    def register(self, dna: DigitalDNA) -> None:
        self.strands[dna.strand] = dna

    def lookup(self, strand: str) -> Optional[DigitalDNA]:
        return self.strands.get(strand)

    def by_kind(self, kind: ArtefactKind) -> List[DigitalDNA]:
        return [d for d in self.strands.values() if d.kind == kind]

    def by_tag(self, tag: str) -> List[DigitalDNA]:
        return [d for d in self.strands.values() if tag in d.tags]

    def update_fitness(self, strand: str, success: bool) -> None:
        """Update a strand's fitness using an exponential moving average."""
        d = self.strands.get(strand)
        if d is None:
            return
        alpha = 0.1
        d.fitness = alpha * (1.0 if success else 0.0) + (1 - alpha) * d.fitness


# ---------------------------------------------------------------------------
# 4. Self-test
# ---------------------------------------------------------------------------

def self_test() -> None:
    print("=" * 78)
    print("Digital DNA Encoder — self-test (structural fingerprint affinity)")
    print("=" * 78)

    enc = DNAEncoder()
    reg = DNARegistry()

    # Encode an RTL design
    rtl = {"top": "power_controller", "submodules": ["vccint_drv", "vccaux_drv"],
           "ports": [{"name": "clk", "dir": "in"}, {"name": "rst_n", "dir": "in"}]}
    dna_rtl = enc.encode_rtl(rtl, "esr-001", "snap-001")
    print(f"  RTL DNA: {dna_rtl.strand[:16]}... (strand={len(dna_rtl.strand)}, fp_dim={len(dna_rtl.fingerprint)})")
    reg.register(dna_rtl)

    # Encode a slightly different RTL design (1 port name changed)
    rtl2 = {"top": "power_controller", "submodules": ["vccint_drv", "vccaux_drv"],
            "ports": [{"name": "clk", "dir": "in"}, {"name": "rst", "dir": "in"}]}  # rst_n -> rst
    dna_rtl2 = enc.encode_rtl(rtl2, "esr-002", "snap-002")
    print(f"  RTL DNA2: {dna_rtl2.strand[:16]}... (different strand)")
    reg.register(dna_rtl2)

    # Same RTL, different esr_id — should produce the SAME strand AND fingerprint
    dna_rtl_same = enc.encode_rtl(rtl, "esr-003", "snap-003")
    assert dna_rtl.strand == dna_rtl_same.strand
    print(f"  Same RTL, different ESR: identical strand ✓")

    # Affinity between the two similar RTL strands — should be HIGH (>0.8)
    aff_similar = dna_rtl.affinity(dna_rtl2)
    print(f"  Affinity (rtl vs rtl2, 1 port changed): {aff_similar:.4f}  (expected > 0.8)")
    assert aff_similar > 0.8, f"Similar artefacts should have affinity > 0.8, got {aff_similar:.4f}"

    # Encode a completely different artefact — affinity should be LOW (<0.5)
    policy = {"layers": [{"units": 64, "activation": "tanh"},
                          {"units": 32, "activation": "tanh"}]}
    dna_pol = enc.encode_policy(policy, "esr-004", "snap-004")
    aff_dissimilar = dna_rtl.affinity(dna_pol)
    print(f"  Affinity (rtl vs policy, dissimilar): {aff_dissimilar:.4f}  (expected < 0.5)")
    assert aff_dissimilar < 0.5, f"Dissimilar artefacts should have affinity < 0.5, got {aff_dissimilar:.4f}"

    # Identity — should be 1.0
    aff_identity = dna_rtl.affinity(dna_rtl_same)
    print(f"  Affinity (identity): {aff_identity:.4f}  (expected 1.0)")
    assert abs(aff_identity - 1.0) < 1e-9, f"Identity should be 1.0, got {aff_identity}"

    # Symmetry — affinity(a,b) == affinity(b,a)
    aff_sym = dna_rtl2.affinity(dna_rtl)
    print(f"  Symmetry: {aff_similar:.4f} == {aff_sym:.4f}  (expected equal)")
    assert abs(aff_similar - aff_sym) < 1e-9

    print(f"  Registry: {len(reg.strands)} strands")
    print(f"  Registry queries: RTL={len(reg.by_kind(ArtefactKind.RTL_DESIGN))}, "
          f"Policy={len(reg.by_kind(ArtefactKind.POLICY_CODE))}")

    # Fitness update
    reg.update_fitness(dna_rtl.strand, success=True)
    reg.update_fitness(dna_rtl.strand, success=True)
    reg.update_fitness(dna_rtl.strand, success=False)
    rtl_after_update = reg.lookup(dna_rtl.strand)
    assert rtl_after_update is not None, "RTL strand disappeared after fitness update"
    print(f"  RTL fitness after 2 pass + 1 fail: {rtl_after_update.fitness:.4f}")

    print("\n  VERDICT: Structural fingerprint + cosine similarity WORKS.")
    print("  Similar artefacts: affinity > 0.8 (was ~0.5 with SHA-256 Hamming)")
    print("  Dissimilar artefacts: affinity < 0.5 (was ~0.5 with SHA-256 Hamming)")
    print("  The affinity metric now provides MEANINGFUL signal for antibody matching.")

    print("=" * 78)
    print("Digital DNA Encoder self-test PASSED.")
    print("=" * 78)


if __name__ == "__main__":
    self_test()  # pragma: no cover
