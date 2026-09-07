"""Tests for Final Search for a Genuinely Different Computational Principle."""
from __future__ import annotations
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "scripts"))

from rce2_final_search import CANDIDATES, REDUCTION_PROOF


class TestCandidateSurvey:
    def test_10_candidates_surveyed(self):
        assert len(CANDIDATES) == 10

    def test_all_candidates_rejected(self):
        for name, cand in CANDIDATES.items():
            assert "REJECTED" in cand["verdict"], (
                f"{name} should be rejected: {cand['verdict']}")

    def test_each_candidate_has_required_fields(self):
        required = ["field", "principle", "how_computation_represented",
                     "why_different", "complexity", "expressiveness",
                     "verification", "economics", "limitations",
                     "reduces_to", "verdict", "tag"]
        for name, cand in CANDIDATES.items():
            for field_name in required:
                assert field_name in cand, f"{name} missing field: {field_name}"

    def test_each_candidate_has_tag(self):
        for name, cand in CANDIDATES.items():
            assert any(tag in cand["tag"] for tag in
                       ["[PROVEN]", "[DERIVED]", "[MEASURED]", "[HYPOTHESIZED]"]), (
                f"{name} missing tag: {cand['tag']}")

    def test_each_candidate_has_reduction(self):
        for name, cand in CANDIDATES.items():
            assert len(cand["reduces_to"]) > 10, (
                f"{name} has insufficient reduction: {cand['reduces_to']}")


class TestReductionProof:
    def test_proof_exists(self):
        assert len(REDUCTION_PROOF) > 200

    def test_proof_covers_all_candidates(self):
        # The proof references candidates by their short descriptions
        # (e.g., "reversible", "analog", "lambda", "CA", etc.)
        keywords = ["reversible", "analog", "geometric", "Petri",
                     "lambda", "CA", "category", "compressive",
                     "information geometry", "quantum"]
        proof_lower = REDUCTION_PROOF.lower()
        for kw in keywords:
            assert kw.lower() in proof_lower, (
                f"Keyword '{kw}' not found in proof")

    def test_proof_has_conclusion(self):
        assert "QED" in REDUCTION_PROOF
        assert "CONCLUSION" in REDUCTION_PROOF

    def test_proof_cites_kolmogorov(self):
        assert "Kolmogorov" in REDUCTION_PROOF

    def test_proof_cites_no_free_lunch(self):
        assert "No Free Lunch" in REDUCTION_PROOF


class TestReductions:
    def test_reversible_reduces_to_circuit(self):
        assert "circuit" in CANDIDATES["C1_reversible_computing"]["reduces_to"].lower()

    def test_analog_reduces_to_circuit(self):
        assert "digital" in CANDIDATES["C3_analog_computing"]["reduces_to"].lower() or \
               "circuit" in CANDIDATES["C3_analog_computing"]["reduces_to"].lower()

    def test_lambda_calculus_reduces_to_synthesis(self):
        assert "synthesis" in CANDIDATES["C5_lambda_calculus"]["reduces_to"].lower()

    def test_ca_reduces_to_synthesis(self):
        assert "synthesis" in CANDIDATES["C8_cellular_automata"]["reduces_to"].lower()

    def test_compressive_sensing_is_walsh(self):
        assert "Walsh" in CANDIDATES["C9_compressive_sensing"]["reduces_to"]

    def test_geometric_algebra_is_gf2(self):
        assert "GF(2)" in CANDIDATES["C4_geometric_algebra"]["reduces_to"]

    def test_information_geometry_violates_axiom(self):
        assert "A2" in CANDIDATES["C7_information_geometry"]["limitations"] or \
               "A2" in CANDIDATES["C7_information_geometry"]["verdict"]

    def test_quantum_doesnt_change_substrate(self):
        q = CANDIDATES["C2_quantum_computing"]
        assert "substrate" in q["verdict"].lower() or "abstraction" in q["verdict"].lower()
