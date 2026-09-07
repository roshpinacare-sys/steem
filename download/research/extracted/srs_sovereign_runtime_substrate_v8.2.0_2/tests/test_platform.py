"""Tests for benchmark runner, community program, SLA, and feature flags."""
from __future__ import annotations

import os, time

import pytest


# ===========================================================================
# api/benchmark_runner.py
# ===========================================================================

def test_benchmark_runner_executes():
    """The benchmark runner executes and produces results."""
    from api.benchmark_runner import run_benchmarks
    results = run_benchmarks()
    assert "benchmarks" in results
    assert "summary" in results
    assert results["summary"]["total_benchmarks"] >= 7
    assert results["summary"]["successful"] >= 5  # most should succeed

def test_benchmark_runner_seg_admission():
    """SEG admission benchmark produces timing stats."""
    from api.benchmark_runner import run_benchmarks
    results = run_benchmarks()
    seg = results["benchmarks"].get("seg_admission", {})
    if "error" not in seg:
        assert seg["mean_us"] > 0
        assert seg["ops_per_sec"] > 0
        assert seg["iterations"] > 0

def test_benchmark_runner_main_writes_files():
    """The main() function writes benchmark result files."""
    import subprocess, sys
    result = subprocess.run(
        [sys.executable, "api/benchmark_runner.py"],
        capture_output=True, text=True, timeout=120,
        cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    )
    assert result.returncode == 0
    assert "Benchmark" in result.stdout
    # Check files were created
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    assert os.path.exists(os.path.join(base, "docs", "BENCHMARK_RESULTS_LIVE.md"))


# ===========================================================================
# api/community.py
# ===========================================================================

def test_community_register_contributor():
    from api.community import CommunityProgram
    prog = CommunityProgram()
    c = prog.register_contributor("c-001", "alice")
    assert c.username == "alice"
    assert c.reputation == 0

def test_community_post_bounty():
    from api.community import CommunityProgram, BountyCategory
    prog = CommunityProgram()
    b = prog.post_bounty("b-001", "Fix bug", "desc", BountyCategory.BUG, 500)
    assert b.reward_usd == 500
    assert b.status.value == "open"

def test_community_claim_and_complete():
    from api.community import CommunityProgram, BountyCategory, BountyStatus
    prog = CommunityProgram()
    prog.register_contributor("c-001", "alice")
    prog.post_bounty("b-001", "Fix", "d", BountyCategory.BUG, 500, "hard")
    assert prog.claim_bounty("b-001", "c-001")
    assert prog.complete_bounty("b-001")
    alice = prog.get_contributor("c-001")
    assert alice.total_earned_usd == 500
    assert alice.reputation == 50  # hard = 50
    assert "first-bounty" in alice.badges

def test_community_leaderboard():
    from api.community import CommunityProgram, BountyCategory
    prog = CommunityProgram()
    prog.register_contributor("c-001", "alice")
    prog.register_contributor("c-002", "bob")
    prog.post_bounty("b-001", "A", "d", BountyCategory.BUG, 100, "easy")
    prog.post_bounty("b-002", "B", "d", BountyCategory.FEATURE, 2000, "expert")
    prog.claim_bounty("b-001", "c-001")
    prog.complete_bounty("b-001")
    prog.claim_bounty("b-002", "c-002")
    prog.complete_bounty("b-002")
    lb = prog.leaderboard()
    assert lb[0]["username"] == "bob"  # expert = 100 rep > easy = 10

def test_community_stats():
    from api.community import CommunityProgram, BountyCategory
    prog = CommunityProgram()
    prog.register_contributor("c-001", "alice")
    prog.post_bounty("b-001", "A", "d", BountyCategory.BUG, 500)
    stats = prog.stats()
    assert stats["total_bounties"] == 1
    assert stats["open_bounties"] == 1

def test_community_badges():
    from api.community import CommunityProgram, BountyCategory
    prog = CommunityProgram()
    prog.register_contributor("c-001", "alice")
    for i in range(10):
        prog.post_bounty(f"b-{i:03d}", "A", "d", BountyCategory.BUG, 100, "easy")
        prog.claim_bounty(f"b-{i:03d}", "c-001")
        prog.complete_bounty(f"b-{i:03d}")
    alice = prog.get_contributor("c-001")
    assert "veteran" in alice.badges  # 10 bounties
    assert "thousand-club" in alice.badges  # $1000 earned


# ===========================================================================
# api/sla.py
# ===========================================================================

def test_sla_monitor_uptime():
    from api.sla import SLAMonitor, SLAConfig
    mon = SLAMonitor(SLAConfig(uptime_target_pct=99.0))
    for _ in range(99):
        mon.record_check(True, 50)
    mon.record_check(False, 500)
    assert mon.uptime_pct == 99.0
    assert mon.sla_compliant()

def test_sla_monitor_p95():
    from api.sla import SLAMonitor
    mon = SLAMonitor()
    for i in range(100):
        mon.record_check(True, float(i))
    p95 = mon.p95_response_ms
    assert 90 <= p95 <= 100

def test_sla_report():
    from api.sla import SLAMonitor
    mon = SLAMonitor()
    mon.record_check(True, 50)
    r = mon.report()
    assert "uptime_pct" in r
    assert "p95_response_ms" in r
    assert r["total_checks"] == 1

def test_incident_lifecycle():
    from api.sla import IncidentManager, IncidentSeverity, IncidentStatus
    im = IncidentManager()
    inc = im.create("inc-001", "API down", IncidentSeverity.CRITICAL, ["acme"])
    assert inc.status == IncidentStatus.OPEN
    im.update_status("inc-001", IncidentStatus.INVESTIGATING)
    im.update_status("inc-001", IncidentStatus.IDENTIFIED, "DB pool exhausted")
    im.update_status("inc-001", IncidentStatus.RESOLVED, "Increased pool")
    assert im.incidents["inc-001"].status == IncidentStatus.RESOLVED
    assert im.incidents["inc-001"].duration_s > 0
    assert im.incidents["inc-001"].root_cause == "DB pool exhausted"

def test_incident_stats():
    from api.sla import IncidentManager, IncidentSeverity
    im = IncidentManager()
    im.create("i1", "A", IncidentSeverity.LOW)
    im.create("i2", "B", IncidentSeverity.CRITICAL)
    stats = im.stats()
    assert stats["total_incidents"] == 2
    assert stats["critical"] == 1


# ===========================================================================
# api/feature_flags.py
# ===========================================================================

def test_feature_flag_enabled():
    from api.feature_flags import FeatureFlagManager
    mgr = FeatureFlagManager()
    mgr.register("test-flag", "Test", "desc", enabled=True)
    assert mgr.is_enabled("test-flag")

def test_feature_flag_disabled():
    from api.feature_flags import FeatureFlagManager
    mgr = FeatureFlagManager()
    mgr.register("test-flag", "Test", "desc", enabled=False)
    assert not mgr.is_enabled("test-flag")

def test_feature_flag_tenant_override():
    from api.feature_flags import FeatureFlagManager
    mgr = FeatureFlagManager()
    mgr.register("test-flag", "Test", "desc", enabled=False)
    mgr.override_tenant("test-flag", "acme", True)
    assert mgr.is_enabled("test-flag", tenant_id="acme")
    assert not mgr.is_enabled("test-flag", tenant_id="other")

def test_feature_flag_rollout():
    from api.feature_flags import FeatureFlagManager
    mgr = FeatureFlagManager()
    mgr.register("test-flag", "Test", "desc", enabled=False, rollout_pct=100.0)
    assert mgr.is_enabled("test-flag", tenant_id="anyone")

def test_feature_flag_environment():
    from api.feature_flags import FeatureFlagManager
    mgr = FeatureFlagManager()
    mgr.register("dev-only", "Dev", "desc", enabled=True, environment="dev")
    assert mgr.is_enabled("dev-only", environment="dev")
    assert not mgr.is_enabled("dev-only", environment="prod")

def test_feature_flag_default_set():
    from api.feature_flags import default_flags
    mgr = default_flags()
    assert mgr.is_enabled("grpc-api")
    assert mgr.is_enabled("marketplace")

def test_feature_flag_stats():
    from api.feature_flags import FeatureFlagManager
    mgr = FeatureFlagManager()
    mgr.register("a", "A", "d", enabled=True)
    mgr.register("b", "B", "d", enabled=False, rollout_pct=50)
    stats = mgr.stats()
    assert stats["total_flags"] == 2
    assert stats["enabled"] == 1
    assert stats["with_rollout"] == 1


# Self-tests
def test_community_self_test(capsys):
    from api.community import self_test
    self_test()
    assert "PASSED" in capsys.readouterr().out

def test_sla_self_test(capsys):
    from api.sla import self_test
    self_test()
    assert "PASSED" in capsys.readouterr().out

def test_feature_flags_self_test(capsys):
    from api.feature_flags import self_test
    self_test()
    assert "PASSED" in capsys.readouterr().out
