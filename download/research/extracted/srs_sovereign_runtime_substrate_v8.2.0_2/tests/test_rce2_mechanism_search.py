"""Tests for Mechanism Search."""
from __future__ import annotations
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "scripts"))

from rce2_mechanism_search import M1, M2, M3, M4, M5, SUMMARY_TABLE


class TestM1Dynamics:
    def test_reduces(self):
        assert "REDUCES" in M1["verdict"]
    def test_vector_field_is_representation(self):
        assert "representation" in M1["reduction_attempt"].lower()


class TestM2Interactive:
    def test_survives(self):
        assert "SURVIVES" in M2["verdict"]
    def test_has_reduction_attempt(self):
        assert len(M2["reduction_attempt"]) > 100
    def test_reduction_fails(self):
        assert "FAILS" in M2["counterexample_to_reduction"]
    def test_advantage_not_compression(self):
        assert "compression" in M2["counterexample_to_reduction"].lower()
    def test_advantage_not_parallelism(self):
        text = M2["counterexample_to_reduction"].lower()
        assert "parallel" in text
    def test_tagged_proven(self):
        assert "[PROVEN]" in M2["tag"]


class TestM3SelfModifying:
    def test_reduces(self):
        assert "REDUCES" in M3["verdict"]
    def test_mentions_conditional(self):
        assert "conditional" in M3["reduction_attempt"].lower()


class TestM4Causal:
    def test_reduces(self):
        assert "REDUCES" in M4["verdict"]
    def test_mentions_feature_selection(self):
        assert "feature" in M4["reduction_attempt"].lower()


class TestM5ResourceSemantics:
    def test_reduces(self):
        assert "REDUCES" in M5["verdict"]
    def test_violates_A2(self):
        assert "A2" in M5["reduction_attempt"]


class TestSummaryTable:
    def test_5_candidates(self):
        assert len(SUMMARY_TABLE) == 5

    def test_only_M2_survives(self):
        survivors = [k for k, v in SUMMARY_TABLE.items() if v["survives"] == "SURVIVES"]
        assert survivors == ["M2_interactive"]

    def test_4_reduce(self):
        reducers = [k for k, v in SUMMARY_TABLE.items() if v["survives"] == "REDUCES"]
        assert len(reducers) == 4

    def test_all_tagged(self):
        for name, row in SUMMARY_TABLE.items():
            assert "[PROVEN" in row["tag"]
