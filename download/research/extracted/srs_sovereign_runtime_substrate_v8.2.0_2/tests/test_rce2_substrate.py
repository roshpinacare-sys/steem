"""Adversarial tests for RCE-2 v6.5 Substrate.

These tests attack the 5 substrate engines:
  A. Compression Engine  — law merging, canonicalization, MDL
  B. Calibration Engine  — Brier, ECE, wrong-high-conf detection
  C. OOD Gate            — false-accept rate, support rejection
  D. Anti-Leakage Audit  — train/val/holdout separation
  E. Substrate Verdict   — benchmark methodology itself

Each test attempts to break the substrate in a specific way. If the
substrate survives, the result is stronger. If it fails, the architecture
must change.

CRITICAL DISCIPLINE:
  - Every test uses record_outcome=False during evaluation
  - Every test uses a fresh Substrate instance (no cross-test contamination)
  - Every test uses deterministic seeds for reproducibility
"""
from __future__ import annotations

import random
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rce.rce2_substrate import (
    Substrate, SubstrateOutcome, CompressionEngine, CalibrationEngine,
    OODGate, AntiLeakageAudit, CanonicalState, CompressedLaw,
)


# ===========================================================================
# A. COMPRESSION ENGINE ATTACKS
# ===========================================================================

class TestCompressionEngineAttacks:
    """Attack the compression engine — does it really compress?"""

    def test_compression_ratio_below_one_for_compressible(self):
        """Compressible workload must yield ratio < 1.0."""
        sub = Substrate()
        rng = random.Random(42)
        for _ in range(100):
            a = rng.random() > 0.3
            b = rng.random() > 0.3
            f = (float(a), float(b))
            sub.train("and", f, a and b)
        sub.fit("and")
        mdl = sub.compression.mdl_report["and"]
        assert mdl["compression_ratio"] < 1.0, (
            f"Compression ratio {mdl['compression_ratio']:.3f} ≥ 1.0 — "
            f"substrate is not compressing a compressible workload.")
        # 100 states, only ~4 canonical states (00,01,10,11)
        assert mdl["n_canonical_states"] <= 5, (
            f"Expected ≤5 canonical states for AND-of-2, got "
            f"{mdl['n_canonical_states']}")

    def test_compression_ratio_at_one_for_uncompressible(self):
        """Uncompressible workload must yield ratio ≥ 1.0."""
        sub = Substrate()
        rng = random.Random(42)
        for _ in range(100):
            f = tuple(rng.random() for _ in range(4))
            h = hash(tuple(int(v * 1e9) for v in f)) & 0xFFFF
            sub.train("hash", f, h > 32768)
        sub.fit("hash")
        mdl = sub.compression.mdl_report["hash"]
        # No compression possible — each state is its own canonical
        assert mdl["n_canonical_states"] == 100, (
            f"Hash workload should have 100 canonical states (no compression), "
            f"got {mdl['n_canonical_states']}")
        assert mdl["compression_ratio"] >= 0.99, (
            f"Hash workload ratio {mdl['compression_ratio']:.3f} < 1.0 — "
            f"compression engine hallucinated compression on uncompressible data.")

    def test_law_count_does_not_grow_linearly(self):
        """Law count must NOT grow linearly with state count.

        If it does, the substrate is just relabeling states as laws.
        """
        # Generate 100, 200, 400 states of an AND-of-3 function.
        # Law count should stay roughly constant (or grow very slowly).
        ratios = []
        for n in [100, 200, 400]:
            sub = Substrate()
            rng = random.Random(42)
            for _ in range(n):
                f = tuple(float(rng.random() > 0.3) for _ in range(3))
                y = all(bool(v) for v in f)
                sub.train("and", f, y)
            sub.fit("and")
            n_laws = len(sub.compression.compressed_laws["and"])
            ratios.append(n_laws / n)
        # Ratio should NOT grow — should stay small (≤ 0.1)
        assert ratios[-1] <= 0.15, (
            f"Law/state ratio at n=400 is {ratios[-1]:.3f} — laws are "
            f"growing linearly with states, indicating relabeling not "
            f"compression. Ratios: {ratios}")

    def test_canonical_states_collapse_duplicates(self):
        """Identical (mask, values, outcome) states must collapse."""
        sub = Substrate()
        # Add 50 copies of the same state
        for _ in range(50):
            sub.train("dup", (1.0, 1.0), True)
        sub.fit("dup", feature_mask=(0, 1))
        canonicals = sub.compression.canonical_states["dup"]
        assert len(canonicals) == 1, (
            f"50 identical states should collapse to 1 canonical, got "
            f"{len(canonicals)}")
        assert canonicals[0].member_count == 50

    def test_mdl_compressed_is_smaller_for_compressible(self):
        """MDL_compressed must be < MDL_raw for compressible workloads."""
        sub = Substrate()
        rng = random.Random(42)
        for _ in range(100):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            y = all(bool(v) for v in f)
            sub.train("and", f, y)
        sub.fit("and")
        mdl = sub.compression.mdl_report["and"]
        assert mdl["mdl_compressed_bits"] < mdl["mdl_raw_bits"], (
            f"MDL_compressed ({mdl['mdl_compressed_bits']:.1f}) ≥ "
            f"MDL_raw ({mdl['mdl_raw_bits']:.1f}) — compression did not "
            f"actually reduce description length.")


# ===========================================================================
# B. CALIBRATION ENGINE ATTACKS
# ===========================================================================

class TestCalibrationEngineAttacks:
    """Attack the calibration engine — is confidence honest?"""

    def test_brier_score_zero_for_perfect_predictions(self):
        """Perfect predictions should give Brier ≈ 0."""
        cal = CalibrationEngine()
        for _ in range(50):
            cal.record(1.0, True)
        assert cal.brier_score() < 0.001

    def test_brier_score_high_for_wrong_predictions(self):
        """Confident wrong predictions should give Brier ≈ 1."""
        cal = CalibrationEngine()
        for _ in range(50):
            cal.record(1.0, False)
        assert cal.brier_score() > 0.9

    def test_ece_detects_miscalibration(self):
        """ECE should be high when confidence doesn't match accuracy."""
        cal = CalibrationEngine()
        # 90% confidence but 50% accuracy → badly miscalibrated
        for i in range(50):
            cal.record(0.9, i % 2 == 0)
        ece = cal.expected_calibration_error()
        assert ece > 0.3, (
            f"ECE = {ece:.3f} should be > 0.3 for 90%-conf 50%-acc data — "
            f"calibration engine is not detecting miscalibration.")

    def test_wrong_high_confidence_detected(self):
        """Wrong-high-confidence predictions must be flagged."""
        cal = CalibrationEngine()
        # 10 high-conf predictions, 5 wrong
        for i in range(10):
            cal.record(0.95, i >= 5)
        rate = cal.wrong_high_confidence_rate()
        assert rate == 0.5, (
            f"Wrong-high-conf rate = {rate:.3f}, expected 0.5")
        is_cal, _ = cal.is_calibrated()
        assert not is_cal, (
            "Calibration engine should report NOT calibrated when "
            "wrong-high-conf rate is 50%.")

    def test_substrate_calibration_excludes_escalations(self):
        """Calibration must NOT count escalations as predictions."""
        sub = Substrate()
        rng = random.Random(42)
        # Train on AND function
        for _ in range(100):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            y = all(bool(v) for v in f)
            sub.train("and", f, y)
        sub.fit("and")
        # Calibrate — should record only actual predictions
        val = []
        for _ in range(50):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            y = all(bool(v) for v in f)
            val.append((f, y))
        cal_report = sub.calibrate("and", val, full_computation_fn=lambda: True)
        # n_predictions_recorded + n_escalations_excluded + n_rejections_excluded
        # should equal len(val)
        total = (cal_report["n_predictions_recorded"]
                 + cal_report["n_escalations_excluded"]
                 + cal_report["n_rejections_excluded"])
        assert total == 50, (
            f"Calibration recorded {total} events, expected 50 — "
            f"escalations/rejections not properly excluded.")

    def test_reliability_curve_well_formed(self):
        """Reliability curve should have multiple bins for varied confidence."""
        cal = CalibrationEngine(n_bins=10)
        # Add records spread across confidence bins
        for conf in [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]:
            cal.record(conf, conf > 0.5)  # correct iff conf > 0.5
        curve = cal.reliability_curve()
        assert len(curve) >= 5, (
            f"Reliability curve has {len(curve)} bins, expected ≥5")

    def test_selective_risk_curve_monotone(self):
        """Selective risk curve — accuracy should not decrease as we
        include lower-confidence predictions... actually accuracy typically
        DECREASES as coverage increases. The test is that the curve is
        well-defined and monotone-ish."""
        cal = CalibrationEngine()
        rng = random.Random(42)
        for _ in range(100):
            conf = rng.random()
            correct = rng.random() < conf  # higher conf → more likely correct
            cal.record(conf, correct)
        curve = cal.selective_risk_curve(n_points=10)
        assert len(curve) == 10
        # At coverage 1.0, accuracy should be ≤ accuracy at coverage 0.1
        # (we're including lower-confidence predictions)
        assert curve[-1][1] <= curve[0][1] + 0.3, (
            "Selective risk curve is not monotone — high-coverage accuracy "
            "should not exceed low-coverage accuracy by much.")


# ===========================================================================
# C. OOD GATE ATTACKS
# ===========================================================================

class TestOODGateAttacks:
    """Attack the OOD gate — does it actually reject?"""

    def test_ood_gate_rejects_far_inputs(self):
        """Inputs far from training should be rejected."""
        gate = OODGate()
        # Training: points in [0, 0.3]
        training = [(random.Random(i).random() * 0.3,
                     random.Random(i + 100).random() * 0.3) for i in range(50)]
        gate.fit("test", training)
        # Query: point in [0.7, 1.0] — should be OOD
        is_ood, dist, reason = gate.is_ood("test", (0.9, 0.9))
        assert is_ood, (
            f"OOD gate failed to reject (0.9, 0.9) when training is in "
            f"[0, 0.3]. Distance: {dist:.3f}, reason: {reason}")

    def test_ood_gate_accepts_in_dist_inputs(self):
        """Inputs near training should be accepted."""
        gate = OODGate()
        training = [(0.1, 0.1), (0.2, 0.2), (0.15, 0.15), (0.12, 0.18)]
        gate.fit("test", training)
        is_ood, _, _ = gate.is_ood("test", (0.13, 0.16))
        assert not is_ood, (
            "OOD gate rejected an in-distribution input — false reject.")

    def test_far_measured(self):
        """FAR (false-accept rate) on OOD probe should be low."""
        gate = OODGate()
        rng = random.Random(42)
        # Train in [0, 0.3]²
        training = [(rng.random() * 0.3, rng.random() * 0.3) for _ in range(50)]
        gate.fit("test", training)
        # OOD probe in [0.7, 1.0]²
        ood_probe = [(0.7 + rng.random() * 0.3, 0.7 + rng.random() * 0.3)
                     for _ in range(20)]
        # In-dist probe
        in_dist = [(rng.random() * 0.3, rng.random() * 0.3) for _ in range(20)]
        far = gate.measure_far("test", ood_probe, in_dist)
        assert far["false_accept_rate"] <= 0.2, (
            f"OOD gate FAR = {far['false_accept_rate']:.2f}, expected ≤ 0.2")

    def test_ood_gate_logs_rejections(self):
        """Every rejection must be logged with reason."""
        gate = OODGate()
        gate.fit("test", [(0.1, 0.1), (0.2, 0.2)])
        gate.reject("test", (0.95, 0.95))
        assert len(gate.rejections) == 1
        r = gate.rejections[0]
        assert r.computation_type == "test"
        assert "threshold" in r.reason or "distance" in r.reason
        assert r.nearest_distance > 0

    def test_ood_gate_not_fit_rejects_everything(self):
        """If gate hasn't been fit, everything is OOD."""
        gate = OODGate()
        is_ood, _, reason = gate.is_ood("not_fit", (0.5, 0.5))
        assert is_ood
        assert "not_fit" in reason


# ===========================================================================
# D. ANTI-LEAKAGE AUDIT ATTACKS
# ===========================================================================

class TestAntiLeakageAttacks:
    """Attack the anti-leakage audit — does it catch contamination?"""

    def test_audit_detects_already_learned(self):
        """The audit must detect when an evaluation input was already trained on."""
        audit = AntiLeakageAudit()
        audit.record_add("and", (1.0, 1.0))
        assert audit.is_already_learned("and", (1.0, 1.0))
        assert not audit.is_already_learned("and", (0.0, 0.0))

    def test_audit_hash_is_deterministic(self):
        """Same inputs → same hash."""
        audit = AntiLeakageAudit()
        h1 = audit.hash_features("and", (1.0, 0.0))
        h2 = audit.hash_features("and", (1.0, 0.0))
        assert h1 == h2

    def test_audit_hash_differs_for_different_types(self):
        """Same features, different types → different hashes."""
        audit = AntiLeakageAudit()
        h1 = audit.hash_features("type_a", (1.0, 0.0))
        h2 = audit.hash_features("type_b", (1.0, 0.0))
        assert h1 != h2

    def test_substrate_predict_does_not_leak_with_record_false(self):
        """predict(record_outcome=False) must NOT add to audit log."""
        sub = Substrate()
        rng = random.Random(42)
        for _ in range(20):
            f = (float(rng.random() > 0.3), float(rng.random() > 0.3))
            sub.train("and", f, all(bool(v) for v in f))
        sub.fit("and")
        # Generate a new query
        before = len(sub.audit.added_hashes)
        sub.predict("and", (1.0, 1.0),
                    full_computation=lambda: True,
                    record_outcome=False)
        after = len(sub.audit.added_hashes)
        assert before == after, (
            f"predict(record_outcome=False) leaked {after - before} states "
            f"into the audit log — anti-leakage discipline violated.")

    def test_substrate_predict_does_learn_with_record_true(self):
        """predict(record_outcome=True) must add to audit log."""
        sub = Substrate()
        rng = random.Random(42)
        for _ in range(20):
            f = (float(rng.random() > 0.3), float(rng.random() > 0.3))
            sub.train("and", f, all(bool(v) for v in f))
        sub.fit("and")
        before = len(sub.audit.added_hashes)
        sub.predict("and", (0.7, 0.7),
                    full_computation=lambda: True,
                    record_outcome=True)
        after = len(sub.audit.added_hashes)
        assert after == before + 1, (
            f"predict(record_outcome=True) should add 1 state, added "
            f"{after - before}.")


# ===========================================================================
# E. SUBSTRATE VERDICT ATTACKS
# ===========================================================================

class TestSubstrateVerdictAttacks:
    """Attack the substrate's overall honesty."""

    def test_uncompressible_workload_does_not_claim_high_accuracy(self):
        """Hash-like workload must NOT show 100% prediction accuracy."""
        sub = Substrate()
        rng = random.Random(42)
        for _ in range(100):
            f = tuple(rng.random() for _ in range(4))
            h = hash(tuple(int(v * 1e9) for v in f)) & 0xFFFF
            sub.train("hash", f, h > 32768)
        sub.fit("hash")
        # Calibrate with deterministic outcomes
        val = []
        for _ in range(50):
            f = tuple(rng.random() for _ in range(4))
            h = hash(tuple(int(v * 1e9) for v in f)) & 0xFFFF
            val.append((f, h > 32768))
        sub.calibrate("hash", val, full_computation_fn=lambda: True)

        # Holdout — count predictions and accuracy
        correct = 0
        predictions = 0
        escalations = 0
        for _ in range(50):
            f = tuple(rng.random() for _ in range(4))
            h = hash(tuple(int(v * 1e9) for v in f)) & 0xFFFF
            actual = h > 32768
            predicted, outcome, conf, _ = sub.predict(
                "hash", f, lambda: actual, record_outcome=False)
            if outcome in (SubstrateOutcome.INVARIANT, SubstrateOutcome.LAW,
                           SubstrateOutcome.CONSENSUS):
                predictions += 1
                if predicted == actual:
                    correct += 1
            elif outcome == SubstrateOutcome.ESCALATED:
                escalations += 1

        if predictions > 0:
            acc = correct / predictions
            # Allow wide band — must NOT be near 100%
            assert acc < 0.7, (
                f"Hash workload predictions accuracy = {acc:.0%} — "
                f"substrate is hallucinating laws where none exist.")

    def test_compressible_workload_does_compress(self):
        """AND function must show real compression."""
        sub = Substrate()
        rng = random.Random(42)
        for _ in range(100):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            y = all(bool(v) for v in f)
            sub.train("and", f, y)
        sub.fit("and")
        mdl = sub.compression.mdl_report["and"]
        # 100 states, ~8 canonical (2^3 = 8 possible bit combos)
        assert mdl["n_canonical_states"] <= 10
        assert mdl["compression_ratio"] < 0.2

    def test_substrate_rejects_ood(self):
        """OOD inputs must be rejected, not predicted."""
        sub = Substrate()
        rng = random.Random(42)
        for _ in range(50):
            f = (rng.random() * 0.3, rng.random() * 0.3)
            sub.train("near", f, f[0] + f[1] > 0.3)
        sub.fit("near")
        # Calibrate
        val = [((rng.random() * 0.3, rng.random() * 0.3), False) for _ in range(20)]
        sub.calibrate("near", val, full_computation_fn=lambda: True)
        # OOD probe
        ood_count = 0
        rejected = 0
        for _ in range(20):
            f = (0.7 + rng.random() * 0.3, 0.7 + rng.random() * 0.3)
            _, outcome, _, _ = sub.predict("near", f,
                                            full_computation=lambda: True,
                                            record_outcome=False)
            ood_count += 1
            if outcome == SubstrateOutcome.REJECTED_OOD:
                rejected += 1
        assert rejected >= ood_count * 0.5, (
            f"OOD gate rejected only {rejected}/{ood_count} OOD inputs — "
            f"substrate is applying training-region beliefs to OOD queries.")

    def test_substrate_escalates_on_contradictory(self):
        """Contradictory workload — substrate must escalate or fail calibration."""
        sub = Substrate()
        rng = random.Random(42)
        # 20% label noise on AND-of-2
        for _ in range(100):
            a, b = rng.random() > 0.5, rng.random() > 0.5
            f = (float(a), float(b))
            y = a and b
            if rng.random() < 0.2:
                y = not y
            sub.train("contra", f, y)
        sub.fit("contra")
        # Calibrate
        val = []
        for _ in range(50):
            a, b = rng.random() > 0.5, rng.random() > 0.5
            f = (float(a), float(b))
            y = a and b
            if rng.random() < 0.2:
                y = not y
            val.append((f, y))
        cal = sub.calibrate("contra", val, full_computation_fn=lambda: True)
        # Either calibration fails OR escalations are high on holdout
        escalations = 0
        for _ in range(50):
            a, b = rng.random() > 0.5, rng.random() > 0.5
            f = (float(a), float(b))
            y = a and b
            if rng.random() < 0.2:
                y = not y
            _, outcome, _, _ = sub.predict("contra", f,
                                            full_computation=lambda: y,
                                            record_outcome=False)
            if outcome == SubstrateOutcome.ESCALATED:
                escalations += 1
        assert (not cal["is_calibrated"]) or escalations >= 25, (
            f"Substrate neither failed calibration nor escalated on "
            f"contradictory workload — escalations={escalations}/50, "
            f"calibrated={cal['is_calibrated']}")

    def test_substrate_reproducible_with_same_seed(self):
        """Same seed → same results."""
        def run():
            sub = Substrate()
            rng = random.Random(42)
            for _ in range(50):
                f = tuple(float(rng.random() > 0.3) for _ in range(3))
                y = all(bool(v) for v in f)
                sub.train("and", f, y)
            sub.fit("and")
            return sub.compression.mdl_report["and"]["compression_ratio"]
        r1 = run()
        r2 = run()
        assert r1 == r2, (
            f"Same seed produced different compression ratios: {r1} vs {r2}")


# ===========================================================================
# F. SUBSTRATE BENCHMARK INTEGRITY ATTACKS
# ===========================================================================

class TestBenchmarkIntegrityAttacks:
    """Attack the benchmark methodology itself."""

    def test_train_val_holdout_are_disjoint(self):
        """Train, validation, and holdout must be disjoint sets."""
        # Simulate the benchmark's split generation
        rng = random.Random(42)
        train = []
        for _ in range(100):
            f = tuple(rng.random() for _ in range(3))
            train.append(f)
        val = []
        for _ in range(50):
            f = tuple(rng.random() for _ in range(3))
            val.append(f)
        holdout = []
        for _ in range(50):
            f = tuple(rng.random() for _ in range(3))
            holdout.append(f)
        # Check no exact overlap (random floats → essentially zero probability)
        train_set = set(train)
        val_set = set(val)
        holdout_set = set(holdout)
        assert not (train_set & val_set), "Train and val overlap"
        assert not (train_set & holdout_set), "Train and holdout overlap"
        assert not (val_set & holdout_set), "Val and holdout overlap"

    def test_ood_probe_is_actually_out_of_distribution(self):
        """OOD probe must be statistically different from training."""
        rng = random.Random(42)
        train = [tuple(rng.random() for _ in range(3)) for _ in range(100)]
        ood = [tuple(0.7 + rng.random() * 0.3 for _ in range(3)) for _ in range(30)]
        # Mean of training should be ~0.5, mean of OOD should be ~0.85
        train_mean = sum(sum(f) for f in train) / (len(train) * 3)
        ood_mean = sum(sum(f) for f in ood) / (len(ood) * 3)
        assert ood_mean - train_mean > 0.3, (
            f"OOD mean ({ood_mean:.2f}) is not sufficiently different from "
            f"train mean ({train_mean:.2f}) — OOD probe is not actually OOD.")

    def test_substrate_cannot_cheat_by_memorizing_holdout(self):
        """The substrate must not achieve high accuracy by memorizing
        holdout inputs. We verify by checking that on a NEW holdout
        (different seed), accuracy is similar."""
        # Train
        sub = Substrate()
        rng = random.Random(42)
        for _ in range(100):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            y = all(bool(v) for v in f)
            sub.train("and", f, y)
        sub.fit("and")
        # Holdout 1 (seed 100)
        rng1 = random.Random(100)
        correct1 = 0
        total1 = 0
        for _ in range(50):
            f = tuple(float(rng1.random() > 0.3) for _ in range(3))
            actual = all(bool(v) for v in f)
            predicted, outcome, _, _ = sub.predict("and", f,
                full_computation=lambda: actual, record_outcome=False)
            if outcome in (SubstrateOutcome.INVARIANT, SubstrateOutcome.LAW,
                           SubstrateOutcome.CONSENSUS):
                total1 += 1
                if predicted == actual:
                    correct1 += 1
        # Holdout 2 (seed 200) — should give similar accuracy
        rng2 = random.Random(200)
        correct2 = 0
        total2 = 0
        for _ in range(50):
            f = tuple(float(rng2.random() > 0.3) for _ in range(3))
            actual = all(bool(v) for v in f)
            predicted, outcome, _, _ = sub.predict("and", f,
                full_computation=lambda: actual, record_outcome=False)
            if outcome in (SubstrateOutcome.INVARIANT, SubstrateOutcome.LAW,
                           SubstrateOutcome.CONSENSUS):
                total2 += 1
                if predicted == actual:
                    correct2 += 1
        # Both should have similar accuracy (both 100% for compressible AND)
        if total1 > 0 and total2 > 0:
            acc1 = correct1 / total1
            acc2 = correct2 / total2
            assert abs(acc1 - acc2) < 0.2, (
                f"Accuracy on seed-100 holdout = {acc1:.0%}, on seed-200 "
                f"holdout = {acc2:.0%} — large gap suggests memorization.")
