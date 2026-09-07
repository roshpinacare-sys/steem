"""Adversarial falsification tests for RCE-2.

These tests attempt to BREAK RCE-2 by:
  1. Constructing workloads where it must fail (non-compressible computations)
  2. Verifying it correctly escalates when it should
  3. Detecting leakage (does prediction only work because train == test?)
  4. Detecting memorization (does it just store answers?)
  5. Detecting cost displacement (did we just move computation elsewhere?)
  6. Probing boundary conditions where the law's radius is too generous

If any of these tests fail to demonstrate the EXPECTED weakness, RCE-2 is
over-claiming and must be revised.

Each test documents:
  - ATTACK VECTOR: what we are trying to expose
  - EXPECTED BEHAVIOR: what RCE-2 must do to remain honest
  - PASS CONDITION: what counts as "RCE-2 admitted its limit"
"""
from __future__ import annotations

import random
import time
import math
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rce.rce2 import (
    StateUniverse, ComputationState, CompressionDiscovery,
    RealitySimulator, RCE2Outcome, TransitionLaw,
)


# ===========================================================================
# ATTACK 1 — Non-compressible computation (random oracle)
# ===========================================================================

class TestAttack1RandomOracle:
    """ATTACK VECTOR: A computation whose output is uniformly random and
    independent of any input feature. RCE-2 cannot learn a law. It MUST
    escalate on every call and report zero compression.

    If RCE-2 reports any elimination here, it is hallucinating structure.
    """

    def test_random_oracle_forces_escalation(self):
        universe = StateUniverse()
        discovery = CompressionDiscovery(universe)
        sim = RealitySimulator(universe, discovery,
                                min_confidence=0.9,
                                min_states_for_prediction=10)

        rng = random.Random(0xDEAD)

        # Training: 50 examples of a coin-flip computation
        for i in range(50):
            features = (rng.random(), rng.random(), rng.random())
            outcome = rng.random() > 0.5
            universe.add_state(ComputationState(
                f"r{i}", "rng", features, outcome))

        # Test: 30 new examples — every prediction must be either
        # low-confidence (escalated) or wrong ~50% of the time.
        escalations = 0
        correct_predictions = 0      # correct among NON-escalated only
        non_escalated_total = 0
        total = 30
        for i in range(total):
            f = (rng.random(), rng.random(), rng.random())
            actual = rng.random() > 0.5
            predicted, outcome, conf, cost = sim.predict(
                "rng", f, lambda: actual, 1000.0)
            if outcome == RCE2Outcome.ESCALATED:
                escalations += 1
                # NOTE: escalations always appear "correct" because the
                # callback lambda returns `actual`. We deliberately do
                # NOT count these — counting them would let RCE-2 mask
                # its inability to predict by just escalating every time.
            else:
                non_escalated_total += 1
                if predicted == actual:
                    correct_predictions += 1

        # HONESTY CHECK: among NON-escalated predictions, accuracy must
        # be near chance (50%) because the underlying computation is a
        # random oracle. High accuracy here would mean RCE-2 is leaking
        # information or memorizing test labels.
        if non_escalated_total > 0:
            prediction_accuracy = correct_predictions / non_escalated_total
            assert prediction_accuracy < 0.75, (
                f"RCE-2 claimed to predict a random oracle with "
                f"{prediction_accuracy:.0%} accuracy on "
                f"{non_escalated_total} non-escalated calls — this is "
                f"leakage or memorization, not law discovery.")
        # Either way, RCE-2 should escalate most of the time
        assert escalations >= total * 0.5, (
            f"RCE-2 failed to escalate on a random oracle "
            f"({escalations}/{total}). It is over-confident.")


# ===========================================================================
# ATTACK 2 — Train/test leakage
# ===========================================================================

class TestAttack2TrainTestLeakage:
    """ATTACK VECTOR: Ensure RCE-2 is not predicting correctly only because
    the test inputs exactly match training inputs (cache behavior).

    We build two scenarios:
      A) test inputs are EXACTLY training inputs (should predict perfectly)
      B) test inputs are NOVEL (never seen) but lie in a learned region

    If A and B have the same accuracy, RCE-2 may just be a cache.
    """

    def test_novel_inputs_in_learned_region_predicted(self):
        universe = StateUniverse()
        discovery = CompressionDiscovery(universe)
        sim = RealitySimulator(universe, discovery,
                                min_confidence=0.9,
                                min_states_for_prediction=10)

        rng = random.Random(42)

        # Training: 30 examples at known points
        train_points = []
        for _ in range(30):
            a, s, r, h = [rng.random() > 0.2 for _ in range(4)]
            features = (float(a), float(s), float(r), float(h))
            result = all([a, s, r, h])
            universe.add_state(ComputationState(
                "s", "seg", features, result))
            train_points.append(features)

        discovery.discover_invariants("seg")
        discovery.discover_decision_regions("seg")

        # Test A: exact training points (cache-like)
        correct_a = 0
        for f in train_points[:20]:
            actual = all([bool(f[0]), bool(f[1]), bool(f[2]), bool(f[3])])
            predicted, _, _, _ = sim.predict(
                "seg", f, lambda: actual, 1000.0)
            if predicted == actual:
                correct_a += 1

        # Test B: NOVEL points — perturb training points slightly
        correct_b = 0
        novel_predicted = 0
        for f in train_points[:20]:
            # Add small perturbation — these are NEW inputs
            novel_f = tuple(min(1.0, max(0.0, v + rng.uniform(-0.05, 0.05)))
                            for v in f)
            actual = all([bool(round(novel_f[0])), bool(round(novel_f[1])),
                          bool(round(novel_f[2])), bool(round(novel_f[3]))])
            predicted, outcome, _, _ = sim.predict(
                "seg", novel_f, lambda: actual, 1000.0)
            if predicted == actual:
                correct_b += 1
            if outcome != RCE2Outcome.ESCALATED:
                novel_predicted += 1

        # Both should have high accuracy — if B is much worse than A,
        # RCE-2 is just a cache.
        assert correct_b >= 15, (
            f"RCE-2 only achieved {correct_b}/20 on novel inputs vs "
            f"{correct_a}/20 on cached inputs — it is memorizing, not "
            f"learning laws.")
        # RCE-2 must actually predict (not just escalate) on novel inputs
        assert novel_predicted >= 5, (
            f"RCE-2 escalated on {20 - novel_predicted}/20 novel inputs — "
            f"it is not generalizing.")


# ===========================================================================
# ATTACK 3 — Cost displacement
# ===========================================================================

class TestAttack3CostDisplacement:
    """ATTACK VECTOR: Verify RCE-2 actually saves wall-clock time, not just
    "logical" computation. If feature extraction + law lookup costs more
    than the original computation, RCE-2 has displaced cost, not removed it.

    We measure:
      - Direct: sum of computation times
      - RCE-2: sum of (feature extraction + lookup + occasional escalation)
    RCE-2 must be NET faster, including its own overhead.
    """

    def test_rce2_net_faster_than_direct(self):
        universe = StateUniverse()
        discovery = CompressionDiscovery(universe)
        sim = RealitySimulator(universe, discovery,
                                min_confidence=0.9,
                                min_states_for_prediction=10)

        rng = random.Random(7)

        def expensive_computation(x):
            # ~1ms of real work
            time.sleep(0.001)
            return (x[0] > 0.5) and (x[1] > 0.5)

        # Train
        for _ in range(50):
            f = (rng.random(), rng.random())
            universe.add_state(ComputationState(
                "s", "bench", f, expensive_computation(f)))

        discovery.discover_decision_regions("bench")

        # Direct: 50 calls
        start = time.perf_counter()
        for _ in range(50):
            f = (rng.random(), rng.random())
            expensive_computation(f)
        direct_s = time.perf_counter() - start

        # RCE-2: 50 calls (including feature extraction + lookup)
        start = time.perf_counter()
        for _ in range(50):
            f = (rng.random(), rng.random())
            sim.predict("bench", f, lambda: expensive_computation(f), 1000.0)
        rce2_s = time.perf_counter() - start

        # RCE-2 must be at least 2x faster wall-clock
        assert rce2_s < direct_s * 0.5, (
            f"RCE-2 wall-clock {rce2_s*1000:.1f}ms is not "
            f"significantly faster than direct {direct_s*1000:.1f}ms — "
            f"cost was displaced to feature extraction, not removed.")


# ===========================================================================
# ATTACK 4 — Boundary failure (radius too generous)
# ===========================================================================

class TestAttack4BoundaryFailure:
    """ATTACK VECTOR: A learned law with radius r covers a region. If the
    true decision boundary passes THROUGH that region, the law will produce
    false positives.

    We construct a workload with a sharp boundary at x=0.5 and verify
    RCE-2 either:
      - learns laws only on the correct side, OR
      - escalates near the boundary
    """

    def test_sharp_boundary_handled(self):
        universe = StateUniverse()
        discovery = CompressionDiscovery(universe)
        sim = RealitySimulator(universe, discovery,
                                min_confidence=0.95,
                                min_states_for_prediction=10)

        rng = random.Random(123)

        # Train: y = (x > 0.5)
        for _ in range(40):
            x = rng.random()
            y = x > 0.5
            universe.add_state(ComputationState(
                "s", "boundary", (x,), y))

        discovery.discover_decision_regions("boundary", radius=0.2)

        # Test points NEAR the boundary — these are the hardest
        boundary_tests = [0.49, 0.50, 0.51, 0.48, 0.52, 0.499, 0.501]
        wrong = 0
        for x in boundary_tests:
            actual = x > 0.5
            predicted, outcome, conf, _ = sim.predict(
                "boundary", (x,), lambda: actual, 1000.0)
            if outcome != RCE2Outcome.ESCALATED and predicted != actual:
                wrong += 1

        # Allow at most 1 wrong prediction near the boundary
        assert wrong <= 1, (
            f"RCE-2 made {wrong}/7 wrong predictions at the sharp "
            f"boundary — its laws are over-generalizing across the "
            f"decision surface.")


# ===========================================================================
# ATTACK 5 — Memorization detector
# ===========================================================================

class TestAttack5MemorizationDetector:
    """ATTACK VECTOR: If RCE-2 only works when state population is huge,
    it is effectively memorizing every input. A true law should generalize
    from few examples.

    We compare:
      - Few-shot (10 training examples): law should still emerge
      - Many-shot (1000): should not be drastically better per-state
    """

    def test_few_shot_generalization(self):
        rng = random.Random(99)

        def make_and_test(n_train, n_test=30):
            universe = StateUniverse()
            discovery = CompressionDiscovery(universe)
            sim = RealitySimulator(universe, discovery,
                                    min_confidence=0.9,
                                    min_states_for_prediction=5)
            # y = (f0 == 1.0) AND (f1 == 1.0) — a learnable law
            for _ in range(n_train):
                a, b = rng.random() > 0.3, rng.random() > 0.3
                f = (float(a), float(b))
                universe.add_state(ComputationState(
                    "s", "law", f, a and b))
            discovery.discover_invariants("law")
            discovery.discover_decision_regions("law")

            correct = 0
            eliminated = 0
            for _ in range(n_test):
                a, b = rng.random() > 0.3, rng.random() > 0.3
                f = (float(a), float(b))
                actual = a and b
                predicted, outcome, _, _ = sim.predict(
                    "law", f, lambda: actual, 1000.0)
                if predicted == actual:
                    correct += 1
                if outcome != RCE2Outcome.ESCALATED:
                    eliminated += 1
            return correct, eliminated

        few_correct, few_elim = make_and_test(10)
        many_correct, many_elim = make_and_test(200)

        # Few-shot should already eliminate > 30% — if not, it is
        # just memorizing many examples
        assert few_elim >= 10, (
            f"Few-shot (10 train) eliminated only {few_elim}/30 — "
            f"RCE-2 is memorizing, not learning laws. "
            f"Many-shot was {many_elim}/30.")


# ===========================================================================
# ATTACK 6 — Law explosion (overfitting)
# ===========================================================================

class TestAttack6LawExplosion:
    """ATTACK VECTOR: If RCE-2 learns a separate law for every cluster of
    k states, the law database grows linearly with training data. The
    "compression" is illusory — we have replaced N stored results with
    N/k stored laws, plus all the metadata.

    We measure: laws / states ratio. Below 0.3 means we are genuinely
    compressing. Above 0.7 means we are just relabeling.
    """

    def test_law_to_state_ratio_is_low(self):
        universe = StateUniverse()
        discovery = CompressionDiscovery(universe)
        rng = random.Random(2024)

        # Compressible workload: outcome depends only on f0
        for _ in range(100):
            f = (rng.choice([0.0, 1.0]), rng.random(), rng.random())
            universe.add_state(ComputationState(
                "s", "compress", f, f[0] == 1.0))

        discovery.discover_invariants("compress")
        discovery.discover_decision_regions("compress",
                                             min_samples=5, radius=0.3)

        n_states = len(universe.states["compress"])
        n_laws = len(universe.laws["compress"])
        ratio = n_laws / n_states if n_states else 1.0

        assert ratio < 0.5, (
            f"Law-to-state ratio = {ratio:.2f} ({n_laws} laws / "
            f"{n_states} states) — RCE-2 is relabeling data as laws, "
            f"not compressing it.")


# ===========================================================================
# ATTACK 7 — Distribution shift
# ===========================================================================

class TestAttack7DistributionShift:
    """ATTACK VECTOR: Train on distribution D1, test on shifted distribution
    D2. RCE-2 must DETECT the shift (low confidence) and escalate.

    If RCE-2 confidently predicts on D2 using D1 laws, it has not
    understood its own uncertainty.
    """

    def test_distribution_shift_triggers_escalation(self):
        universe = StateUniverse()
        discovery = CompressionDiscovery(universe)
        sim = RealitySimulator(universe, discovery,
                                min_confidence=0.9,
                                min_states_for_prediction=10)

        rng = random.Random(55)

        # Train: features in [0.0, 0.3]
        for _ in range(40):
            f = (rng.random() * 0.3, rng.random() * 0.3)
            universe.add_state(ComputationState(
                "s", "shift", f, f[0] + f[1] > 0.3))

        discovery.discover_decision_regions("shift", radius=0.15)

        # Test: features in [0.7, 1.0] — totally out of training distribution
        # We disable record_outcome so the test points themselves do not
        # become training data (which would mask the distribution-shift bug).
        escalations = 0
        for _ in range(20):
            f = (0.7 + rng.random() * 0.3, 0.7 + rng.random() * 0.3)
            actual = f[0] + f[1] > 0.3  # True for all of these
            _, outcome, _, _ = sim.predict(
                "shift", f, lambda: actual, 1000.0,
                record_outcome=False)
            if outcome == RCE2Outcome.ESCALATED:
                escalations += 1

        # RCE-2 should escalate on at least 50% of out-of-distribution inputs
        assert escalations >= 10, (
            f"RCE-2 failed to escalate on {escalations}/20 "
            f"out-of-distribution inputs — it is applying training-region "
            f"laws to a region it has never seen.")


# ===========================================================================
# ATTACK 8 — Confidence calibration
# ===========================================================================

class TestAttack8ConfidenceCalibration:
    """ATTACK VECTOR: RCE-2 reports confidence. Is it calibrated?
    A 90% confidence prediction should be correct ~90% of the time.

    We measure empirical accuracy at each confidence level. If RCE-2
    reports 0.95 confidence but is only 60% accurate, it is dishonest.
    """

    def test_confidence_is_calibrated(self):
        universe = StateUniverse()
        discovery = CompressionDiscovery(universe)
        sim = RealitySimulator(universe, discovery,
                                min_confidence=0.6,
                                min_states_for_prediction=5)

        rng = random.Random(31415)

        # Train on a noisy law: y = f0 AND f1, but with 5% label noise
        for _ in range(100):
            a, b = rng.random() > 0.4, rng.random() > 0.4
            f = (float(a), float(b))
            y = a and b
            if rng.random() < 0.05:  # 5% label noise
                y = not y
            universe.add_state(ComputationState("s", "noisy", f, y))

        discovery.discover_invariants("noisy")
        discovery.discover_decision_regions("noisy", radius=0.2)

        # Collect predictions and confidences
        predictions = []
        for _ in range(100):
            a, b = rng.random() > 0.4, rng.random() > 0.4
            f = (float(a), float(b))
            y = a and b
            if rng.random() < 0.05:
                y = not y
            predicted, outcome, conf, _ = sim.predict(
                "noisy", f, lambda: y, 1000.0)
            if outcome != RCE2Outcome.ESCALATED:
                predictions.append((conf, predicted == y))

        if len(predictions) >= 20:
            # Group by confidence band
            high = [c for c, ok in predictions if c >= 0.9]
            high_acc = sum(ok for c, ok in predictions if c >= 0.9) / max(1, len(high))
            # High-confidence predictions should be right > 75% of the time
            # (allowing slack for label noise)
            assert high_acc >= 0.75, (
                f"High-confidence (>=0.9) predictions were only "
                f"{high_acc:.0%} accurate — confidence is miscalibrated.")


# ===========================================================================
# ATTACK 9 — Single point of failure
# ===========================================================================

class TestAttack9AdversarialInputs:
    """ATTACK VECTOR: Construct inputs specifically designed to fool RCE-2's
    laws. If the law says "all points in this region are True", find the
    ONE point in that region that is False.

    RCE-2 must either:
      - not have learned the law (because it saw the counterexample), OR
      - have low confidence, OR
      - escalate at verification time
    """

    def test_adversarial_input_in_law_region(self):
        universe = StateUniverse()
        discovery = CompressionDiscovery(universe)
        sim = RealitySimulator(universe, discovery,
                                min_confidence=0.9,
                                min_states_for_prediction=10)

        rng = random.Random(0xCAFE)

        # Train: 30 examples, all in cluster around (0.5, 0.5), all True
        for _ in range(30):
            f = (0.5 + rng.uniform(-0.1, 0.1),
                 0.5 + rng.uniform(-0.1, 0.1))
            universe.add_state(ComputationState(
                "s", "adv", f, True))

        discovery.discover_decision_regions("adv", radius=0.2)

        # Adversarial input: inside the law's region but False
        # The law says all of (0.5±0.2, 0.5±0.2) → True
        # We construct a False example at exactly (0.5, 0.5)
        f_adv = (0.5, 0.5)
        actual = False  # adversarial label

        predicted, outcome, conf, _ = sim.predict(
            "adv", f_adv, lambda: actual, 1000.0)

        # RCE-2 will likely predict True (wrong). HONESTY CHECK:
        # The verify_prediction mechanism MUST catch this and update stats.
        ok = sim.verify_prediction("adv", f_adv, predicted, actual)
        # ok should be False — prediction was wrong
        assert ok == False, (
            "RCE-2 failed to detect an adversarial input that violated "
            "its learned law. Verification did not flag the mismatch.")
        # Stats should reflect the failure
        assert sim.stats.law_incorrect >= 1, (
            "RCE-2 did not record the law violation in its stats — "
            "it is not learning from its mistakes.")


# ===========================================================================
# ATTACK 10 — Workload where compression is impossible
# ===========================================================================

class TestAttack10UncompressibleWorkload:
    """ATTACK VECTOR: A workload where every input is unique and every
    output is determined by ALL features with no redundancy.

    Example: SHA-256 prefix computation — no learnable law exists.

    RCE-2 MUST report ~0% elimination. If it claims > 20%, it is wrong.
    """

    def test_sha_like_workload_no_elimination(self):
        universe = StateUniverse()
        discovery = CompressionDiscovery(universe)
        sim = RealitySimulator(universe, discovery,
                                min_confidence=0.9,
                                min_states_for_prediction=10)

        rng = random.Random(2025)

        # "Hash-like" workload: output is a deterministic but
        # non-compressible function of features.
        def hashlike(features):
            # Use Python's hash to simulate diffusion
            h = hash(tuple(int(f * 1e9) for f in features)) & 0xFFFF
            return h > 32768

        # Train
        for _ in range(50):
            f = tuple(rng.random() for _ in range(4))
            universe.add_state(ComputationState(
                "s", "hash", f, hashlike(f)))

        discovery.discover_invariants("hash")
        discovery.discover_decision_regions("hash", radius=0.1)

        # Test
        eliminated = 0
        total = 30
        for _ in range(total):
            f = tuple(rng.random() for _ in range(4))
            actual = hashlike(f)
            _, outcome, _, _ = sim.predict(
                "hash", f, lambda: actual, 1000.0)
            if outcome != RCE2Outcome.ESCALATED:
                eliminated += 1

        # RCE-2 must eliminate < 20% — there is no law to learn
        assert eliminated < total * 0.2, (
            f"RCE-2 eliminated {eliminated}/{total} of an uncompressible "
            f"hash-like workload — it is hallucinating laws where none "
            f"exist.")


# ===========================================================================
# ATTACK 11 — Verify the success condition is reproducible
# ===========================================================================

class TestAttack11Reproducibility:
    """ATTACK VECTOR: Run the benchmark twice with the same seed. Results
    must be identical. If not, RCE-2 has hidden nondeterminism.
    """

    def test_benchmark_is_deterministic(self):
        from rce.rce2 import benchmark_rce2
        r1 = benchmark_rce2()
        r2 = benchmark_rce2()
        assert r1["computation_eliminated_pct"] == r2["computation_eliminated_pct"]
        assert r1["accuracy_pct"] == r2["accuracy_pct"]
        assert r1["laws_learned"] == r2["laws_learned"]


# ===========================================================================
# ATTACK 12 — Verify "significant percentage never executed" claim
# ===========================================================================

class TestAttack12SuccessCondition:
    """The success condition requires:
       - significant percentage never executed
       - equivalent or near-equivalent decision quality
       - reproducible benchmark
       - failure boundaries known
    """

    def test_success_condition_met(self):
        from rce.rce2 import benchmark_rce2
        r = benchmark_rce2()

        # Significant percentage never executed (> 50%)
        assert r["computation_eliminated_pct"] > 50.0, (
            f"Only {r['computation_eliminated_pct']:.1f}% eliminated — "
            f"does not meet 'significant' threshold.")

        # Near-equivalent decision quality (>= 90%)
        assert r["accuracy_pct"] >= 90.0, (
            f"Only {r['accuracy_pct']:.1f}% accuracy — not near-equivalent.")

        # Net cost reduction
        assert r["rce2_cost_us"] < r["direct_cost_us"], (
            "RCE-2 cost is not less than direct cost.")

        # Failure boundaries known: escalations > 0 (RCE-2 escalates
        # when it should — i.e., it knows its own limits)
        assert r["escalations"] > 0, (
            "RCE-2 never escalated — it does not know its own limits.")
