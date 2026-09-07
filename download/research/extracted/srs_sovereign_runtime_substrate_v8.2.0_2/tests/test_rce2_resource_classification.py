"""Tests for Resource-Theoretic Classification."""
from __future__ import annotations
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "scripts"))

from rce2_resource_classification import (
    AXES, THEOREMS, CORE_ANSWERS, META_THEOREM,
)


class TestAxes:
    def test_10_axes(self):
        assert len(AXES) == 10

    def test_storage_requires_compression(self):
        assert AXES["S_storage"]["compression_necessary"] is True

    def test_work_requires_compression(self):
        assert AXES["W_work"]["compression_necessary"] is True

    def test_time_does_not_require_compression(self):
        assert AXES["T_time"]["compression_necessary"] is False

    def test_depth_does_not_require_compression(self):
        assert AXES["D_depth"]["compression_necessary"] is False

    def test_communication_does_not_require_compression(self):
        assert AXES["Comm_communication"]["compression_necessary"] is False

    def test_verification_does_not_require_compression(self):
        assert AXES["V_verification"]["compression_necessary"] is False

    def test_amortization_requires_compression(self):
        assert AXES["A_amortization"]["compression_necessary"] is True


class TestTheorems:
    def test_7_theorems(self):
        assert len(THEOREMS) == 7

    def test_storage_and_work_require_compression(self):
        assert THEOREMS["T_storage"]["compression_necessary"] is True
        assert THEOREMS["T_work"]["compression_necessary"] is True

    def test_time_does_not_require_compression(self):
        assert THEOREMS["T_time"]["compression_necessary"] is False

    def test_all_proven(self):
        for name, thm in THEOREMS.items():
            assert "[PROVEN]" in thm["tag"]


class TestCoreAnswers:
    def test_4_questions_answered(self):
        assert len(CORE_ANSWERS) == 4
        for key in ["A", "B", "C", "D"]:
            assert key in CORE_ANSWERS

    def test_A_mentions_storage_and_work(self):
        text = CORE_ANSWERS["A"]["answer"]
        assert "Storage" in text or "storage" in text
        assert "Work" in text or "work" in text

    def test_D_identifies_7_axes_not_bounded_by_K(self):
        text = CORE_ANSWERS["D"]["answer"]
        assert "7" in text or "seven" in text.lower()


class TestMetaTheorem:
    def test_exists(self):
        assert len(META_THEOREM["statement"]) > 50

    def test_governs_3_axes(self):
        assert "Storage" in META_THEOREM["what_governs"]
        assert "Work" in META_THEOREM["what_governs"]
        assert "Amortization" in META_THEOREM["what_governs"]

    def test_does_not_govern_7_axes(self):
        not_gov = META_THEOREM["what_does_not_govern"]
        assert "Time" in not_gov
        assert "Depth" in not_gov
        assert "Communication" in not_gov
        assert "Verification" in not_gov

    def test_tagged_proven(self):
        assert "[PROVEN]" in META_THEOREM["tag"]

    def test_formal_has_Kf_bounds(self):
        formal = META_THEOREM["formal"]
        assert "K(f)" in formal
        assert "S(r)" in formal
        assert "W(r)" in formal
        assert "T(r" in formal
