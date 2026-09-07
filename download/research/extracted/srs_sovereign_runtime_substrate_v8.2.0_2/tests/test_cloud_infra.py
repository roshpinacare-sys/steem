"""Tests for agent sandbox, distributed tracing, and SRS Cloud."""
from __future__ import annotations

import time

import pytest


# ===========================================================================
# api/sandbox.py
# ===========================================================================

def test_sandbox_execute_success():
    from api.sandbox import SandboxManager, SandboxConfig
    mgr = SandboxManager()
    config = SandboxConfig(sandbox_id="sb-1", agent_id="a1", tenant_id="t1")
    sb = mgr.create_sandbox(config)
    result = sb.execute(lambda x: x + 1, 41)
    assert result.success
    assert result.result == 42


def test_sandbox_mutation_quota():
    from api.sandbox import SandboxManager, SandboxConfig
    mgr = SandboxManager()
    config = SandboxConfig(sandbox_id="sb-2", agent_id="a1", tenant_id="t1",
                           max_mutations=2)
    sb = mgr.create_sandbox(config)
    assert sb.can_execute()
    sb.execute(lambda: None)
    sb.execute(lambda: None)
    assert not sb.can_execute()  # quota exhausted


def test_sandbox_cost_budget():
    from api.sandbox import SandboxManager, SandboxConfig
    mgr = SandboxManager()
    config = SandboxConfig(sandbox_id="sb-3", agent_id="a1", tenant_id="t1",
                           max_cost_micro=100)
    sb = mgr.create_sandbox(config)
    sb.record_cost(100)
    assert not sb.can_execute()  # budget exhausted


def test_sandbox_kill():
    from api.sandbox import SandboxManager, SandboxConfig
    mgr = SandboxManager()
    config = SandboxConfig(sandbox_id="sb-4", agent_id="a1", tenant_id="t1")
    sb = mgr.create_sandbox(config)
    assert sb.can_execute()
    sb.kill()
    assert not sb.can_execute()


def test_sandbox_exception_handling():
    from api.sandbox import SandboxManager, SandboxConfig
    mgr = SandboxManager()
    config = SandboxConfig(sandbox_id="sb-5", agent_id="a1", tenant_id="t1")
    sb = mgr.create_sandbox(config)
    result = sb.execute(lambda: 1 / 0)
    assert not result.success
    assert "ZeroDivisionError" in result.error


def test_sandbox_manager_stats():
    from api.sandbox import SandboxManager, SandboxConfig
    mgr = SandboxManager()
    mgr.create_sandbox(SandboxConfig(sandbox_id="sb-a", agent_id="a1", tenant_id="t1"))
    mgr.create_sandbox(SandboxConfig(sandbox_id="sb-b", agent_id="a2", tenant_id="t1"))
    stats = mgr.stats()
    assert stats["total_sandboxes"] == 2


def test_sandbox_list_by_tenant():
    from api.sandbox import SandboxManager, SandboxConfig
    mgr = SandboxManager()
    mgr.create_sandbox(SandboxConfig(sandbox_id="sb-1", agent_id="a1", tenant_id="acme"))
    mgr.create_sandbox(SandboxConfig(sandbox_id="sb-2", agent_id="a2", tenant_id="other"))
    acme = mgr.list_sandboxes(tenant_id="acme")
    assert len(acme) == 1
    assert acme[0]["tenant_id"] == "acme"


# ===========================================================================
# api/tracing.py
# ===========================================================================

def test_tracer_start_trace():
    from api.tracing import Tracer
    t = Tracer()
    span = t.start_trace("test:operation")
    assert span.operation == "test:operation"
    assert span.parent_span_id is None
    assert len(t.spans) == 1


def test_tracer_child_span():
    from api.tracing import Tracer
    t = Tracer()
    root = t.start_trace("root")
    child = t.start_span("child")
    assert child.parent_span_id == root.span_id
    assert child.trace_id == root.trace_id
    t.finish_span(child)
    t.finish_span(root)
    assert len(t.spans) == 2


def test_span_context_manager():
    from api.tracing import Tracer, SpanContext
    t = Tracer()
    tracer_backup = None
    # Use the global tracer
    from api.tracing import tracer as global_tracer
    global_tracer.spans.clear()
    global_tracer._current_trace_id = None

    root = global_tracer.start_trace("root_op")
    with SpanContext("child_op", key="value") as span:
        span.add_event("test_event")
    global_tracer.finish_span(root)

    trace = global_tracer.get_trace(root.trace_id)
    assert len(trace) == 2
    assert trace[1].attributes.get("key") == "value"


def test_tracer_error_span():
    from api.tracing import Tracer, SpanContext
    from api.tracing import tracer as global_tracer
    global_tracer.spans.clear()
    global_tracer._current_trace_id = None

    root = global_tracer.start_trace("error_test")
    try:
        with SpanContext("failing_op"):
            raise ValueError("test error")
    except ValueError:
        pass
    global_tracer.finish_span(root)

    error_spans = [s for s in global_tracer.spans if s.status == "error"]
    assert len(error_spans) == 1


def test_tracer_stats():
    from api.tracing import Tracer
    t = Tracer()
    s = t.start_trace("op1")
    t.finish_span(s)
    stats = t.stats()
    assert stats["total_spans"] == 1
    assert stats["total_traces"] == 1
    assert stats["error_count"] == 0


# ===========================================================================
# api/cloud.py
# ===========================================================================

def test_cloud_tier_limits():
    from api.cloud import TIER_LIMITS, CloudTier
    assert TIER_LIMITS[CloudTier.FREE]["price_monthly"] == 0
    assert TIER_LIMITS[CloudTier.PRO]["price_monthly"] == 499
    assert TIER_LIMITS[CloudTier.ENTERPRISE]["price_monthly"] == 4999
    assert TIER_LIMITS[CloudTier.ENTERPRISE]["max_agents"] == -1  # unlimited


def test_cloud_create_tenant():
    from api.cloud import CloudManager, CloudTier
    mgr = CloudManager()
    t = mgr.create_tenant("acme", CloudTier.PRO, "billing@acme.com")
    assert t.tier == CloudTier.PRO
    assert t.monthly_cost() == 499


def test_cloud_mutation_limit_free():
    from api.cloud import CloudManager, CloudTier
    mgr = CloudManager()
    t = mgr.create_tenant("startup", CloudTier.FREE)
    for _ in range(100):
        assert t.can_submit_mutation()
        t.record_mutation()
    assert not t.can_submit_mutation()


def test_cloud_mutation_unlimited_enterprise():
    from api.cloud import CloudManager, CloudTier
    mgr = CloudManager()
    t = mgr.create_tenant("enterprise", CloudTier.ENTERPRISE)
    for _ in range(10000):
        t.record_mutation()
    assert t.can_submit_mutation()  # unlimited


def test_cloud_upgrade():
    from api.cloud import CloudManager, CloudTier
    mgr = CloudManager()
    mgr.create_tenant("co", CloudTier.FREE)
    assert mgr.upgrade_tenant("co", CloudTier.ENTERPRISE)
    assert mgr.get_tenant("co").tier == CloudTier.ENTERPRISE


def test_cloud_revenue():
    from api.cloud import CloudManager, CloudTier
    mgr = CloudManager()
    mgr.create_tenant("f", CloudTier.FREE)
    mgr.create_tenant("p", CloudTier.PRO)
    mgr.create_tenant("e", CloudTier.ENTERPRISE)
    assert mgr.monthly_revenue() == 0 + 499 + 4999


def test_cloud_list_tiers():
    from api.cloud import CloudManager
    mgr = CloudManager()
    tiers = mgr.list_tiers()
    assert len(tiers) == 3
    names = [t["name"] for t in tiers]
    assert "Free" in names
    assert "Professional" in names
    assert "Enterprise" in names


def test_cloud_stats():
    from api.cloud import CloudManager, CloudTier
    mgr = CloudManager()
    mgr.create_tenant("a", CloudTier.FREE)
    mgr.create_tenant("b", CloudTier.PRO)
    mgr.create_tenant("c", CloudTier.ENTERPRISE)
    stats = mgr.stats()
    assert stats["total_tenants"] == 3
    assert stats["by_tier"]["free"] == 1
    assert stats["by_tier"]["pro"] == 1
    assert stats["by_tier"]["enterprise"] == 1


# ===========================================================================
# Self-tests
# ===========================================================================

def test_sandbox_self_test(capsys):
    from api.sandbox import self_test
    self_test()
    assert "PASSED" in capsys.readouterr().out

def test_tracing_self_test(capsys):
    from api.tracing import self_test
    self_test()
    assert "PASSED" in capsys.readouterr().out

def test_cloud_self_test(capsys):
    from api.cloud import self_test
    self_test()
    assert "PASSED" in capsys.readouterr().out
