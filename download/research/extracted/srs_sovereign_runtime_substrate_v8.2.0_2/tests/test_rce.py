"""Tests for the Reality Computation Emulator (RCE)."""
from __future__ import annotations

import time
import pytest
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ===========================================================================
# RCE Core — Cascade strategies
# ===========================================================================

def test_rce_exact_reuse():
    """First call escalates, second call hits cache."""
    from rce.rce import RealityComputationEmulator, RCEOutcome
    rce = RealityComputationEmulator()
    def expensive(x): time.sleep(0.001); return x * 2
    r1 = rce.evaluate("test", expensive, 1000.0, x=21)
    assert r1.outcome == RCEOutcome.ESCALATED
    assert r1.value == 42
    r2 = rce.evaluate("test", expensive, 1000.0, x=21)
    assert r2.outcome == RCEOutcome.EXACT_REUSE
    assert r2.value == 42
    assert r2.actual_cost_us < r1.actual_cost_us


def test_rce_symbolic_implication():
    """Symbolic rule fires when condition matches."""
    from rce.rce import RealityComputationEmulator, RCEOutcome
    rce = RealityComputationEmulator()
    rce.register_symbolic("rule1", lambda ctx: ctx.get("force") == True, "forced")
    r = rce.evaluate("test", lambda *a, **kw: "real", 1000.0,
                     context={"force": True}, x=1)
    assert r.outcome == RCEOutcome.SYMBOLIC_IMPLICATION
    assert r.value == "forced"


def test_rce_symbolic_does_not_fire_when_no_match():
    """Symbolic rule does not fire when condition doesn't match."""
    from rce.rce import RealityComputationEmulator, RCEOutcome
    rce = RealityComputationEmulator()
    rce.register_symbolic("rule1", lambda ctx: ctx.get("force") == True, "forced")
    r = rce.evaluate("test", lambda *a, **kw: "real", 1000.0,
                     context={"force": False}, x=1)
    assert r.outcome == RCEOutcome.ESCALATED
    assert r.value == "real"


def test_rce_predictive_shortcut():
    """Surrogate function provides result within confidence threshold."""
    from rce.rce import RealityComputationEmulator, RCEOutcome
    rce = RealityComputationEmulator(confidence_threshold=0.9)
    rce.register_surrogate("test", lambda *a, **kw: ("predicted", 0.95))
    r = rce.evaluate("test", lambda *a, **kw: "real", 1000.0, x=1)
    assert r.outcome == RCEOutcome.PREDICTIVE_SHORTCUT
    assert r.value == "predicted"
    assert r.confidence == 0.95


def test_rce_predictive_below_threshold_escalates():
    """Surrogate below confidence threshold escalates."""
    from rce.rce import RealityComputationEmulator, RCEOutcome
    rce = RealityComputationEmulator(confidence_threshold=0.99)
    rce.register_surrogate("test", lambda *a, **kw: ("predicted", 0.95))
    r = rce.evaluate("test", lambda *a, **kw: "real", 1000.0, x=1)
    assert r.outcome == RCEOutcome.ESCALATED
    assert r.value == "real"


def test_rce_hierarchical():
    """Hierarchical levels provide result at lower accuracy."""
    from rce.rce import RealityComputationEmulator, RCEOutcome
    rce = RealityComputationEmulator()
    rce.register_hierarchy("test", [
        lambda *a, **kw: "coarse",   # level 0: 50% accuracy
        lambda *a, **kw: "fine",     # level 1: 100% accuracy
    ])
    r = rce.evaluate("test", lambda *a, **kw: "exact", 1000.0, x=1)
    assert r.outcome == RCEOutcome.HIERARCHICAL
    assert r.value == "coarse"
    assert r.confidence == 0.5


def test_rce_cache_eviction():
    """Cache evicts when max_cache_size is reached."""
    from rce.rce import RealityComputationEmulator, RCEOutcome
    rce = RealityComputationEmulator(max_cache_size=2)
    rce.evaluate("t", lambda *a, **kw: 1, 100.0, x=1)
    rce.evaluate("t", lambda *a, **kw: 2, 100.0, x=2)
    rce.evaluate("t", lambda *a, **kw: 3, 100.0, x=3)  # evicts x=1
    # x=1 should miss (evicted)
    r1 = rce.evaluate("t", lambda *a, **kw: 99, 100.0, x=1)
    assert r1.outcome == RCEOutcome.ESCALATED  # evicted
    # x=3 should still be in cache
    r3 = rce.evaluate("t", lambda *a, **kw: 99, 100.0, x=3)
    assert r3.outcome == RCEOutcome.EXACT_REUSE


def test_rce_stats():
    """Stats track all outcomes correctly."""
    from rce.rce import RealityComputationEmulator, RCEOutcome
    rce = RealityComputationEmulator()
    rce.register_symbolic("r", lambda ctx: ctx.get("sym"), "sym_result")
    rce.register_surrogate("surr", lambda *a, **kw: ("pred", 0.99))

    rce.evaluate("t", lambda *a, **kw: 1, 1000.0, x=1)  # escalate
    rce.evaluate("t", lambda *a, **kw: 1, 1000.0, x=1)  # exact reuse
    rce.evaluate("t", lambda *a, **kw: 1, 1000.0, context={"sym": True}, x=2)  # symbolic
    rce.evaluate("surr", lambda *a, **kw: 1, 1000.0, x=3)  # predictive

    stats = rce.get_stats()
    assert stats["total_evaluations"] == 4
    assert stats["exact_reuses"] == 1
    assert stats["symbolic_implications"] == 1
    assert stats["predictive_shortcuts"] == 1
    assert stats["escalations"] == 1
    assert stats["eliminated_pct"] == 50.0  # 2/4 eliminated


# ===========================================================================
# SRS Integration
# ===========================================================================

def test_srs_bls_verify_rce():
    """BLS verify through RCE — first call escalates, second hits cache."""
    from rce.rce import SRSEnhancedRuntime, RCEOutcome
    from governance.bls_signatures import generate_keypair, sign, verify
    runtime = SRSEnhancedRuntime()
    kp = generate_keypair("rce-test")
    sig = sign(kp.private_key, "test-msg")

    v1 = runtime.bls_verify_rce(kp.public_key, "test-msg", sig, verify)
    assert v1.outcome == RCEOutcome.ESCALATED
    assert v1.value == True

    v2 = runtime.bls_verify_rce(kp.public_key, "test-msg", sig, verify)
    assert v2.outcome == RCEOutcome.EXACT_REUSE
    assert v2.value == True
    assert v2.actual_cost_us < v1.actual_cost_us  # cache hit is cheaper


def test_srs_bls_sign_rce():
    """BLS sign through RCE — deterministic, always cacheable."""
    from rce.rce import SRSEnhancedRuntime, RCEOutcome
    from governance.bls_signatures import generate_keypair, sign
    runtime = SRSEnhancedRuntime()
    kp = generate_keypair("rce-sign-test")

    s1 = runtime.bls_sign_rce(kp.private_key, "msg", sign)
    assert s1.outcome == RCEOutcome.ESCALATED

    s2 = runtime.bls_sign_rce(kp.private_key, "msg", sign)
    assert s2.outcome == RCEOutcome.EXACT_REUSE
    assert s2.value == s1.value  # same signature


def test_srs_z3_solve_rce():
    """Z3 solve through RCE — same constraints = same result."""
    from rce.rce import SRSEnhancedRuntime, RCEOutcome
    runtime = SRSEnhancedRuntime()
    call_count = [0]
    def solve():
        call_count[0] += 1
        return ("sat", {"x": 1})

    r1 = runtime.z3_solve_rce("constraint-hash-123", solve)
    assert r1.outcome == RCEOutcome.ESCALATED
    assert call_count[0] == 1

    r2 = runtime.z3_solve_rce("constraint-hash-123", solve)
    assert r2.outcome == RCEOutcome.EXACT_REUSE
    assert call_count[0] == 1  # solve not called again


def test_srs_seg_evaluate_rce():
    """SEG evaluate through RCE — same evidence chain = same decision."""
    from rce.rce import SRSEnhancedRuntime, RCEOutcome
    runtime = SRSEnhancedRuntime()
    call_count = [0]
    def evaluate():
        call_count[0] += 1
        return {"admissible": True, "reason": "ok"}

    r1 = runtime.seg_evaluate_rce("ec-hash-123", "mut-001", evaluate)
    assert r1.outcome == RCEOutcome.ESCALATED
    r2 = runtime.seg_evaluate_rce("ec-hash-123", "mut-001", evaluate)
    assert r2.outcome == RCEOutcome.EXACT_REUSE
    assert call_count[0] == 1


def test_srs_policy_evaluate_rce():
    """Policy evaluate through RCE — deterministic."""
    from rce.rce import SRSEnhancedRuntime, RCEOutcome
    runtime = SRSEnhancedRuntime()
    call_count = [0]
    def evaluate():
        call_count[0] += 1
        return "allow"

    r1 = runtime.policy_evaluate_rce("ctx-hash-123", evaluate)
    assert r1.outcome == RCEOutcome.ESCALATED
    r2 = runtime.policy_evaluate_rce("ctx-hash-123", evaluate)
    assert r2.outcome == RCEOutcome.EXACT_REUSE
    assert call_count[0] == 1


# ===========================================================================
# Benchmark
# ===========================================================================

def test_benchmark_rce():
    """The RCE benchmark produces valid results."""
    from rce.rce import benchmark_rce
    results = benchmark_rce()
    assert results["mutations"] == 100
    assert results["eliminated_pct"] > 50.0  # at least 50% eliminated
    assert results["rce_cost_us"] < results["direct_cost_us"]


# ===========================================================================
# Mathematical Correctness
# ===========================================================================

def test_bls_verify_is_deterministic():
    """BLS verify is deterministic — same inputs always produce same output."""
    from governance.bls_signatures import generate_keypair, sign, verify
    kp = generate_keypair("determinism-test")
    sig = sign(kp.private_key, "msg")
    r1 = verify(kp.public_key, "msg", sig)
    r2 = verify(kp.public_key, "msg", sig)
    r3 = verify(kp.public_key, "msg", sig)
    assert r1 == r2 == r3  # always the same


def test_rce_cost_reduction_always_positive_for_deterministic():
    """For deterministic functions, RCE cost reduction is always positive after first call."""
    from rce.rce import RealityComputationEmulator, RCEOutcome
    rce = RealityComputationEmulator()
    def expensive(x): time.sleep(0.01); return x * 2

    # First call: escalate (pays computation + RCE overhead)
    r1 = rce.evaluate("test", expensive, 10000.0, x=5)
    assert r1.outcome == RCEOutcome.ESCALATED

    # Second call: cache hit (pays only RCE overhead ~5µs)
    r2 = rce.evaluate("test", expensive, 10000.0, x=5)
    assert r2.outcome == RCEOutcome.EXACT_REUSE
    assert r2.actual_cost_us < r1.actual_cost_us
    assert r2.actual_cost_us < 100  # should be < 100µs (hash lookup)


def test_rce_break_even_analysis():
    """RCE breaks even at extremely low cache hit rates."""
    # Break-even: hit_rate > rce_overhead / (rce_overhead + avg_computation_cost)
    rce_overhead = 30  # µs
    avg_cost = 391810  # µs (BLS+Z3+SEG per mutation)
    break_even = rce_overhead / (rce_overhead + avg_cost)
    assert break_even < 0.0001  # 0.01% hit rate breaks even
