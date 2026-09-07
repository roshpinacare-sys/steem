"""Tests for the enterprise runtime modules: identity, audit, policy, cost."""
from __future__ import annotations

import pytest


# ===========================================================================
# governance/identity.py
# ===========================================================================

def test_identity_provider_full_lifecycle():
    """Create tenant → create identity → issue key → authenticate → revoke."""
    from governance.identity import IdentityProvider, Role, Permission
    idp = IdentityProvider()
    idp.create_tenant("acme")
    idp.create_identity("agent-001", "acme", Role.AGENT, "Test Agent")
    key_id, plaintext = idp.issue_api_key("agent-001")
    ctx = idp.authenticate(plaintext)
    assert ctx is not None
    assert ctx.identity.identity_id == "agent-001"
    assert ctx.can(Permission.MUTATION_SUBMIT)
    assert not ctx.can(Permission.TENANT_MANAGE)
    # Revoke
    assert idp.revoke_api_key(key_id)
    assert idp.authenticate(plaintext) is None


def test_identity_rbac_permissions():
    """Each role has the correct permissions."""
    from governance.identity import Role, Permission, ROLE_PERMISSIONS
    assert Permission.MUTATION_SUBMIT in ROLE_PERMISSIONS[Role.AGENT]
    assert Permission.TENANT_MANAGE not in ROLE_PERMISSIONS[Role.AGENT]
    assert Permission.TENANT_MANAGE in ROLE_PERMISSIONS[Role.ADMIN]
    assert Permission.AUDIT_READ in ROLE_PERMISSIONS[Role.AUDITOR]
    assert Permission.MUTATION_APPROVE in ROLE_PERMISSIONS[Role.OPERATOR]


def test_identity_key_expiry():
    """API keys with TTL expire."""
    from governance.identity import IdentityProvider, Role
    idp = IdentityProvider()
    idp.create_tenant("acme")
    idp.create_identity("agent-001", "acme", Role.AGENT)
    _, plaintext = idp.issue_api_key("agent-001", ttl_seconds=0.01)
    # Immediately valid
    assert idp.authenticate(plaintext) is not None
    # After expiry
    import time; time.sleep(0.02)
    assert idp.authenticate(plaintext) is None


def test_identity_unknown_tenant_raises():
    """Creating an identity in an unknown tenant raises ValueError."""
    from governance.identity import IdentityProvider, Role
    idp = IdentityProvider()
    with pytest.raises(ValueError, match="Unknown tenant"):
        idp.create_identity("agent-001", "nonexistent", Role.AGENT)


# ===========================================================================
# governance/audit.py
# ===========================================================================

def test_audit_chain_append_and_verify():
    """Append events and verify chain integrity."""
    from governance.audit import AuditChain
    chain = AuditChain()
    chain.append("acme", "agent-001", "mutation:submit", "mut-001")
    chain.append("acme", "seg", "seg:admit", "mut-001")
    chain.append("acme", "agent-001", "memory:write", "rec-abc")
    assert len(chain.events) == 3
    assert chain.verify() is True


def test_audit_chain_tamper_detection():
    """Tampering with any event breaks the chain."""
    from governance.audit import AuditChain
    chain = AuditChain()
    chain.append("acme", "agent-001", "mutation:submit", "mut-001")
    chain.append("acme", "seg", "seg:admit", "mut-001")
    # Tamper
    chain.events[0].action = "tampered"
    assert chain.verify() is False


def test_audit_chain_query():
    """Query the audit trail by tenant, identity, action."""
    from governance.audit import AuditChain
    chain = AuditChain()
    chain.append("acme", "agent-001", "mutation:submit", "mut-001")
    chain.append("acme", "agent-002", "memory:write", "rec-abc")
    chain.append("other", "agent-001", "mutation:submit", "mut-002")
    assert len(chain.query(tenant_id="acme")) == 2
    assert len(chain.query(identity_id="agent-001")) == 2
    assert len(chain.query(action="mutation:submit")) == 2
    assert len(chain.query(resource="mut-001")) == 1


def test_audit_chain_export():
    """Export the full audit trail as dicts."""
    from governance.audit import AuditChain
    chain = AuditChain()
    chain.append("acme", "agent-001", "mutation:submit", "mut-001")
    exported = chain.export()
    assert len(exported) == 1
    assert exported[0]["action"] == "mutation:submit"
    assert "event_hash" in exported[0]


# ===========================================================================
# governance/policy.py
# ===========================================================================

def test_policy_tenant_isolation():
    """Cross-tenant access is denied."""
    from governance.policy import default_policy_set, Effect
    engine = default_policy_set()
    ctx = {"request_tenant": "acme", "resource_tenant": "other"}
    assert engine.evaluate(ctx) == Effect.DENY


def test_policy_high_risk_requires_approval():
    """High-risk mutations require human approval."""
    from governance.policy import default_policy_set, Effect
    engine = default_policy_set()
    ctx = {"request_tenant": "acme", "resource_tenant": "acme",
           "risk_class": "high"}
    assert engine.evaluate(ctx) == Effect.REQUIRE_APPROVAL


def test_policy_rate_limit():
    """Rate limit denies after 100 mutations per minute."""
    from governance.policy import default_policy_set, Effect
    engine = default_policy_set()
    ctx = {"request_tenant": "acme", "resource_tenant": "acme",
           "mutations_last_minute": 100}
    assert engine.evaluate(ctx) == Effect.DENY


def test_policy_delete_requires_quorum():
    """Memory DELETE without SQA quorum is denied."""
    from governance.policy import default_policy_set, Effect
    engine = default_policy_set()
    ctx = {"request_tenant": "acme", "resource_tenant": "acme",
           "action": "memory:delete", "sqa_certified": False}
    assert engine.evaluate(ctx) == Effect.DENY

    # With quorum → ALLOW (no other policy matches)
    ctx["sqa_certified"] = True
    assert engine.evaluate(ctx) == Effect.ALLOW


def test_policy_default_allow():
    """Low-risk same-tenant operations are allowed by default."""
    from governance.policy import default_policy_set, Effect
    engine = default_policy_set()
    ctx = {"request_tenant": "acme", "resource_tenant": "acme",
           "action": "mutation:submit", "risk_class": "low"}
    assert engine.evaluate(ctx) == Effect.ALLOW


def test_policy_add_remove():
    """Policies can be added and removed."""
    from governance.policy import PolicyEngine, Policy, Effect
    engine = PolicyEngine()
    p = Policy(policy_id="test", name="test", description="test",
               effect=Effect.DENY, condition=lambda ctx: True)
    engine.add_policy(p)
    assert len(engine.policies) == 1
    assert engine.evaluate({}) == Effect.DENY
    assert engine.remove_policy("test") is True
    assert len(engine.policies) == 0
    assert engine.evaluate({}) == Effect.ALLOW  # default


# ===========================================================================
# governance/cost.py
# ===========================================================================

def test_cost_record_and_report():
    """Record costs and generate a report."""
    from governance.cost import CostTracker
    tracker = CostTracker()
    tracker.record("acme", "agent-001", "z3_solve")
    tracker.record("acme", "agent-001", "bls_sign")
    report = tracker.report(tenant_id="acme")
    assert report["total_events"] == 2
    assert report["total_cost_dollars"] > 0
    assert "z3_solve" in report["by_operation"]
    assert "bls_sign" in report["by_operation"]


def test_cost_budget_enforcement():
    """Budget enforcement denies operations when exhausted."""
    from governance.cost import CostTracker
    tracker = CostTracker()
    tracker.set_budget("acme-budget", "acme", limit_micro=100)  # $0.0001
    # Record operations until budget exhausted
    for _ in range(200):
        tracker.record("acme", "agent-001", "qiskit_execute")  # 50 micro each
    assert not tracker.can_spend("acme", "agent-001", "qiskit_execute")


def test_cost_budget_not_exhausted():
    """Budget not exhausted allows spending."""
    from governance.cost import CostTracker
    tracker = CostTracker()
    tracker.set_budget("acme-budget", "acme", limit_micro=1_000_000)  # $1
    tracker.record("acme", "agent-001", "z3_solve")
    assert tracker.can_spend("acme", "agent-001", "z3_solve")


def test_cost_report_filters():
    """Report can filter by tenant and agent."""
    from governance.cost import CostTracker
    tracker = CostTracker()
    tracker.record("acme", "agent-001", "z3_solve")
    tracker.record("acme", "agent-002", "bls_sign")
    tracker.record("other", "agent-001", "z3_solve")
    assert tracker.report(tenant_id="acme")["total_events"] == 2
    assert tracker.report(agent_id="agent-001")["total_events"] == 2
    assert tracker.report(tenant_id="other")["total_events"] == 1


# ===========================================================================
# Enterprise self_test() functions
# ===========================================================================

def test_identity_self_test(capsys):
    from governance.identity import self_test
    self_test()
    captured = capsys.readouterr()
    assert "PASSED" in captured.out


def test_audit_self_test(capsys):
    from governance.audit import self_test
    self_test()
    captured = capsys.readouterr()
    assert "PASSED" in captured.out


def test_policy_self_test(capsys):
    from governance.policy import self_test
    self_test()
    captured = capsys.readouterr()
    assert "PASSED" in captured.out


def test_cost_self_test(capsys):
    from governance.cost import self_test
    self_test()
    captured = capsys.readouterr()
    assert "PASSED" in captured.out
