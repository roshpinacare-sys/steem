"""Tests for Resource-Theoretic Closure."""
from __future__ import annotations
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "scripts"))

from rce2_resource_closure import (
    RESOURCES, TAXONOMY, SPLIT_THEOREMS, CORE_ANSWER, FINAL_VERDICT,
)


class TestResources:
    def test_10_resources_defined(self):
        assert len(RESOURCES) == 10

    def test_storage_requires_compression(self):
        assert RESOURCES["storage"]["compression_necessary"] is True

    def test_time_does_not_require_compression(self):
        assert RESOURCES["time"]["compression_necessary"] is False

    def test_work_requires_compression(self):
        assert RESOURCES["work"]["compression_necessary"] is True

    def test_depth_does_not_require_compression(self):
        assert RESOURCES["depth"]["compression_necessary"] is False

    def test_communication_does_not_require_compression(self):
        assert RESOURCES["communication"]["compression_necessary"] is False

    def test_verification_does_not_require_compression(self):
        assert RESOURCES["verification_cost"]["compression_necessary"] is False

    def test_amortization_requires_compression(self):
        assert RESOURCES["amortization"]["compression_necessary"] is True

    def test_time_has_counterexample(self):
        assert RESOURCES["time"]["counterexample_without_compression"] is not None

    def test_storage_has_no_counterexample(self):
        assert RESOURCES["storage"]["counterexample_without_compression"] is None


class TestTaxonomy:
    def test_6_categories(self):
        assert len(TAXONOMY) == 6

    def test_storage_requires_compression(self):
        assert TAXONOMY["storage_advantage"]["compression_required"] is True

    def test_time_does_not_require_compression(self):
        assert TAXONOMY["time_advantage"]["compression_required"] is False

    def test_work_requires_compression(self):
        assert TAXONOMY["work_advantage"]["compression_required"] is True


class TestSplitTheorems:
    def test_6_theorems(self):
        assert len(SPLIT_THEOREMS) == 6

    def test_storage_theorem_requires_compression(self):
        assert SPLIT_THEOREMS["storage_theorem"]["compression_necessary"] is True

    def test_time_theorem_does_not_require_compression(self):
        assert SPLIT_THEOREMS["time_theorem"]["compression_necessary"] is False

    def test_all_tagged_proven(self):
        for name, thm in SPLIT_THEOREMS.items():
            assert "[PROVEN]" in thm["tag"]


class TestCoreAnswer:
    def test_answer_is_D(self):
        assert "D" in CORE_ANSWER["answer"]

    def test_mentions_parallelism(self):
        assert "parallel" in CORE_ANSWER["proof"].lower()

    def test_tagged(self):
        assert "[PROVEN" in CORE_ANSWER["tag"]


class TestFinalVerdict:
    def test_partially_incorrect(self):
        assert "PARTIALLY" in FINAL_VERDICT["verdict"].upper() or \
               "INCORRECT" in FINAL_VERDICT["verdict"].upper()

    def test_what_survives_not_empty(self):
        assert len(FINAL_VERDICT["what_survives"]) >= 4

    def test_what_fails_not_empty(self):
        assert len(FINAL_VERDICT["what_fails"]) >= 2

    def test_revised_mentions_6_theorems(self):
        revised = FINAL_VERDICT["revised_theorem"]
        for i in range(1, 7):
            assert f"{i}." in revised

    def test_revised_distinguishes_necessary_and_not(self):
        revised = FINAL_VERDICT["revised_theorem"]
        assert "Compression necessary" in revised
        assert "NOT necessary" in revised
