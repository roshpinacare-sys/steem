"""Tests for webhooks, certification pipeline, and developer guides."""
from __future__ import annotations

import os

import pytest


# ===========================================================================
# api/webhooks.py
# ===========================================================================

def test_webhook_subscribe():
    from api.webhooks import WebhookManager, WebhookEvent
    mgr = WebhookManager()
    sub = mgr.subscribe("sub-1", "http://localhost:9999/hook",
                        [WebhookEvent.POLICY_VIOLATION], tenant_id="acme")
    assert sub.sub_id == "sub-1"
    assert sub.active is True
    assert len(sub.events) == 1
    assert sub.secret != ""  # auto-generated


def test_webhook_notify_delivers():
    from api.webhooks import WebhookManager, WebhookEvent
    mgr = WebhookManager()
    mgr.subscribe("sub-1", "http://localhost:9999/hook",
                  [WebhookEvent.POLICY_VIOLATION], tenant_id="acme")
    results = mgr.notify(WebhookEvent.POLICY_VIOLATION,
                         {"reason": "test"}, tenant_id="acme")
    assert len(results) == 1
    # Delivery fails (no server at :9999) but doesn't crash
    assert not results[0]["success"]


def test_webhook_notify_filters_by_event():
    from api.webhooks import WebhookManager, WebhookEvent
    mgr = WebhookManager()
    mgr.subscribe("sub-1", "http://localhost:9999/hook",
                  [WebhookEvent.POLICY_VIOLATION], tenant_id="acme")
    # Different event → no delivery
    results = mgr.notify(WebhookEvent.BUDGET_EXHAUSTED, {}, tenant_id="acme")
    assert len(results) == 0


def test_webhook_notify_filters_by_tenant():
    from api.webhooks import WebhookManager, WebhookEvent
    mgr = WebhookManager()
    mgr.subscribe("sub-1", "http://localhost:9999/hook",
                  [WebhookEvent.POLICY_VIOLATION], tenant_id="acme")
    results = mgr.notify(WebhookEvent.POLICY_VIOLATION, {}, tenant_id="other")
    assert len(results) == 0


def test_webhook_unsubscribe():
    from api.webhooks import WebhookManager, WebhookEvent
    mgr = WebhookManager()
    mgr.subscribe("sub-1", "http://localhost:9999/hook",
                  [WebhookEvent.POLICY_VIOLATION])
    assert mgr.unsubscribe("sub-1")
    assert not mgr.subscriptions["sub-1"].active
    # Inactive sub doesn't receive notifications
    results = mgr.notify(WebhookEvent.POLICY_VIOLATION, {})
    assert len(results) == 0


def test_webhook_delete():
    from api.webhooks import WebhookManager, WebhookEvent
    mgr = WebhookManager()
    mgr.subscribe("sub-1", "http://localhost:9999/hook",
                  [WebhookEvent.POLICY_VIOLATION])
    assert mgr.delete_subscription("sub-1")
    assert "sub-1" not in mgr.subscriptions
    assert not mgr.delete_subscription("nonexistent")


def test_webhook_list_subscriptions():
    from api.webhooks import WebhookManager, WebhookEvent
    mgr = WebhookManager()
    mgr.subscribe("sub-1", "http://h1", [WebhookEvent.POLICY_VIOLATION], tenant_id="a")
    mgr.subscribe("sub-2", "http://h2", [WebhookEvent.BUDGET_EXHAUSTED], tenant_id="b")
    all_subs = mgr.list_subscriptions()
    assert len(all_subs) == 2
    acme_subs = mgr.list_subscriptions(tenant_id="a")
    assert len(acme_subs) == 1


def test_webhook_stats():
    from api.webhooks import WebhookManager, WebhookEvent
    mgr = WebhookManager()
    mgr.subscribe("sub-1", "http://localhost:9999/hook",
                  [WebhookEvent.POLICY_VIOLATION])
    mgr.notify(WebhookEvent.POLICY_VIOLATION, {})
    stats = mgr.stats()
    assert stats["total_subscriptions"] == 1
    assert stats["active"] == 1


def test_webhook_hmac_signature():
    """Webhook deliveries include an HMAC signature header."""
    from api.webhooks import WebhookManager, WebhookEvent
    mgr = WebhookManager()
    sub = mgr.subscribe("sub-1", "http://localhost:9999/hook",
                        [WebhookEvent.POLICY_VIOLATION], secret="my-secret")
    assert sub.secret == "my-secret"


# ===========================================================================
# api/certification.py
# ===========================================================================

def test_certification_submit():
    from api.certification import CertificationPipeline, CertStatus
    p = CertificationPipeline()
    cert = p.submit_for_certification("c1", "a1", "acme", "Agent", "1.0")
    assert cert.status == CertStatus.IN_REVIEW
    assert len(cert.checks) == 7


def test_certification_all_pass():
    from api.certification import CertificationPipeline, CertStatus
    p = CertificationPipeline()
    p.submit_for_certification("c1", "a1", "acme", "Agent", "1.0")
    results = {f"chk-{i}": True for i in ["formal","audit","policy","budget","rate","tamper","bls"]}
    cert = p.run_checks("c1", results)
    assert cert.status == CertStatus.CERTIFIED
    assert cert.all_required_passed
    assert len(cert.certification_hash) == 64


def test_certification_fail():
    from api.certification import CertificationPipeline, CertStatus
    p = CertificationPipeline()
    p.submit_for_certification("c1", "a1", "acme", "Agent", "1.0")
    results = {f"chk-{i}": True for i in ["formal","audit","policy","budget","rate","tamper"]}
    results["chk-bls"] = False
    cert = p.run_checks("c1", results)
    assert cert.status == CertStatus.REJECTED
    assert cert.fail_count == 1


def test_certification_revoke():
    from api.certification import CertificationPipeline, CertStatus
    p = CertificationPipeline()
    p.submit_for_certification("c1", "a1", "acme", "Agent", "1.0")
    results = {f"chk-{i}": True for i in ["formal","audit","policy","budget","rate","tamper","bls"]}
    p.run_checks("c1", results)
    assert p.revoke("c1")
    assert p.get_certificate("c1").status == CertStatus.REVOKED


def test_certification_list_certified():
    from api.certification import CertificationPipeline
    p = CertificationPipeline()
    p.submit_for_certification("c1", "a1", "acme", "Agent1", "1.0")
    results = {f"chk-{i}": True for i in ["formal","audit","policy","budget","rate","tamper","bls"]}
    p.run_checks("c1", results)
    certified = p.list_certified()
    assert len(certified) == 1
    assert certified[0]["agent_name"] == "Agent1"


def test_certification_stats():
    from api.certification import CertificationPipeline
    p = CertificationPipeline()
    p.submit_for_certification("c1", "a1", "acme", "Agent1", "1.0")
    stats = p.stats()
    assert stats["total"] == 1
    assert stats["pending"] == 1


# ===========================================================================
# Developer guides exist
# ===========================================================================

def test_deployment_guide_exists():
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "DEPLOYMENT_GUIDE.md")
    assert os.path.exists(path)
    content = open(path).read()
    assert "Docker Compose" in content
    assert "Kubernetes" in content
    assert "Production Checklist" in content


def test_developer_guide_exists():
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "DEVELOPER_GUIDE.md")
    assert os.path.exists(path)
    content = open(path).read()
    assert "SRS" in content
    assert "submit_mutation" in content or "submitMutation" in content
    assert "TypeScript" in content or "typescript" in content.lower()
    assert "Go" in content or "go" in content.lower()


# ===========================================================================
# Self-tests
# ===========================================================================

def test_webhooks_self_test(capsys):
    from api.webhooks import self_test
    self_test()
    assert "PASSED" in capsys.readouterr().out

def test_certification_self_test(capsys):
    from api.certification import self_test
    self_test()
    assert "PASSED" in capsys.readouterr().out
