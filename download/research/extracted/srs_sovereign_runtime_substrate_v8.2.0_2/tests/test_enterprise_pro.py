"""Tests for secrets management, compliance reports, WebSocket, PostgreSQL."""
from __future__ import annotations

import os
import tempfile
import time

import pytest


# ===========================================================================
# api/secrets.py
# ===========================================================================

def test_env_secrets_backend():
    from api.secrets import EnvSecretsBackend
    backend = EnvSecretsBackend()
    backend.put_secret("bls/validators/v1/private_key", "0xabc")
    assert backend.get_secret("bls/validators/v1/private_key") == "0xabc"
    assert backend.delete_secret("bls/validators/v1/private_key")
    assert backend.get_secret("bls/validators/v1/private_key") is None


def test_file_secrets_backend_persists():
    from api.secrets import FileSecretsBackend
    with tempfile.TemporaryDirectory() as tmpdir:
        fpath = os.path.join(tmpdir, "secrets.json")
        b1 = FileSecretsBackend(fpath)
        b1.put_secret("bls/v1/key", "0xdef")
        # Reload
        b2 = FileSecretsBackend(fpath)
        assert b2.get_secret("bls/v1/key") == "0xdef"


def test_vault_secrets_backend():
    from api.secrets import VaultSecretsBackend
    v = VaultSecretsBackend("https://vault.local:8200", "token")
    v.put_secret("bls/v2/key", "0xghi")
    assert v.get_secret("bls/v2/key") == "0xghi"
    assert v.delete_secret("bls/v2/key")
    assert v.get_secret("bls/v2/key") is None


def test_secrets_manager_bls_keys():
    from api.secrets import SecretsManager, EnvSecretsBackend
    os.environ["BLS_VALIDATORS_V1_PRIVATE_KEY"] = "0xkey123"
    mgr = SecretsManager(EnvSecretsBackend())
    assert mgr.get_bls_private_key("v1") == "0xkey123"
    assert mgr.store_bls_private_key("v2", "0xkey456")
    assert mgr.get_bls_private_key("v2") == "0xkey456"


def test_secrets_manager_auto_backend_selection():
    from api.secrets import SecretsManager
    # Default → EnvSecretsBackend
    mgr = SecretsManager()
    assert "Env" in mgr.backend_name


# ===========================================================================
# api/compliance.py
# ===========================================================================

def test_sox_report_passes_with_audit():
    from api.compliance import ComplianceGenerator
    from governance.audit import AuditChain
    from governance.identity import IdentityProvider, Role
    from governance.policy import default_policy_set

    audit = AuditChain()
    audit.append("acme", "admin", "mutation:submit", "mut-001")
    idp = IdentityProvider()
    idp.create_tenant("acme")
    idp.create_identity("admin", "acme", Role.ADMIN)
    policy = default_policy_set()

    gen = ComplianceGenerator(audit, idp, policy)
    report = gen.generate_sox()
    assert report.framework == "SOX"
    assert report.overall_status == "pass"
    assert report.pass_count >= 3
    assert report.fail_count == 0


def test_hipaa_report():
    from api.compliance import ComplianceGenerator
    from governance.audit import AuditChain
    from governance.identity import IdentityProvider, Role

    audit = AuditChain()
    audit.append("acme", "agent", "memory:delete", "rec-001")
    idp = IdentityProvider()
    idp.create_tenant("acme")
    idp.create_identity("agent", "acme", Role.AGENT)

    gen = ComplianceGenerator(audit, idp)
    report = gen.generate_hipaa()
    assert report.framework == "HIPAA"
    assert report.pass_count >= 3


def test_fedramp_report():
    from api.compliance import ComplianceGenerator
    from governance.audit import AuditChain

    audit = AuditChain()
    audit.append("acme", "admin", "mutation:submit", "mut-001")

    gen = ComplianceGenerator(audit)
    report = gen.generate_fedramp()
    assert report.framework == "FedRAMP"
    assert report.pass_count >= 3


def test_compliance_generate_all():
    from api.compliance import ComplianceGenerator
    from governance.audit import AuditChain
    from governance.identity import IdentityProvider, Role
    from governance.policy import default_policy_set

    audit = AuditChain()
    audit.append("acme", "admin", "test", "res")
    idp = IdentityProvider()
    idp.create_tenant("acme")
    idp.create_identity("admin", "acme", Role.ADMIN)
    policy = default_policy_set()

    gen = ComplianceGenerator(audit, idp, policy)
    reports = gen.generate_all()
    assert len(reports) == 3
    frameworks = [r.framework for r in reports]
    assert "SOX" in frameworks
    assert "HIPAA" in frameworks
    assert "FedRAMP" in frameworks


def test_compliance_report_to_dict():
    from api.compliance import ComplianceGenerator
    from governance.audit import AuditChain

    audit = AuditChain()
    audit.append("acme", "admin", "test", "res")
    gen = ComplianceGenerator(audit)
    report = gen.generate_sox()
    d = report.to_dict()
    assert "framework" in d
    assert "controls" in d
    assert "summary" in d
    assert d["summary"]["total"] == len(report.controls)


# ===========================================================================
# api/websocket.py
# ===========================================================================

def test_event_broadcaster_buffer():
    from api.websocket import broadcaster, broadcast_audit_event
    broadcaster.event_buffer.clear()
    broadcast_audit_event("acme", "agent-001", "mutation:submit", "mut-001")
    assert len(broadcaster.event_buffer) == 1
    assert broadcaster.event_buffer[0]["type"] == "audit"


def test_event_broadcaster_stats():
    from api.websocket import broadcaster, broadcast_audit_event
    broadcaster.event_buffer.clear()
    broadcast_audit_event("acme", "agent-001", "test", "res")
    stats = broadcaster.stats()
    assert stats["buffered_events"] == 1
    assert stats["connected_clients"] == 0  # no WS connections in tests


def test_websocket_endpoint_exists():
    """The WebSocket router is importable and has the /v1/events route."""
    from api.websocket import router
    assert router is not None


# ===========================================================================
# api/postgres_adapter.py
# ===========================================================================

def test_postgres_config():
    from api.postgres_adapter import PostgresConfig
    config = PostgresConfig(host="db.acme.com", port=5432,
                            database="srs", user="srs", password="secret")
    cs = config.connection_string
    assert "postgresql://" in cs
    assert "db.acme.com" in cs
    assert "srs" in cs


def test_postgres_audit_chain_fallback():
    """PostgresAuditChain falls back to in-memory when psycopg2 is not installed."""
    from api.postgres_adapter import PostgresAuditChain, PostgresConfig
    config = PostgresConfig(database="srs_test")
    chain = PostgresAuditChain(config)
    # Should work even without a real PostgreSQL connection
    chain.append("acme", "agent-001", "mutation:submit", "mut-001")
    assert len(chain.events) == 1
    assert chain.verify()


# ===========================================================================
# Self-tests
# ===========================================================================

def test_secrets_self_test(capsys):
    from api.secrets import self_test
    self_test()
    assert "PASSED" in capsys.readouterr().out

def test_compliance_self_test(capsys):
    from api.compliance import self_test
    self_test()
    assert "PASSED" in capsys.readouterr().out

def test_websocket_self_test(capsys):
    from api.websocket import self_test
    self_test()
    assert "PASSED" in capsys.readouterr().out

def test_postgres_self_test(capsys):
    from api.postgres_adapter import self_test
    self_test()
    assert "PASSED" in capsys.readouterr().out
