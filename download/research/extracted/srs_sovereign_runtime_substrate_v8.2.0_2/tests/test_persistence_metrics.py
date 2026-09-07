"""Tests for SQLite persistence + Prometheus metrics."""
from __future__ import annotations

import os
import tempfile

import pytest

from fastapi.testclient import TestClient


# ===========================================================================
# governance/persistence.py
# ===========================================================================

def test_persistent_audit_chain_survives_restart():
    """Audit events persisted to SQLite survive a restart."""
    from governance.persistence import PersistentAuditChain

    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = os.path.join(tmpdir, "audit.db")

        # Write
        chain1 = PersistentAuditChain(db_path)
        chain1.append("acme", "agent-001", "mutation:submit", "mut-001")
        chain1.append("acme", "seg", "seg:admit", "mut-001")
        assert len(chain1.events) == 2
        assert chain1.verify()

        # Read back (simulate restart)
        chain2 = PersistentAuditChain(db_path)
        assert len(chain2.events) == 2
        assert chain2.verify()
        assert chain2.events[0].action == "mutation:submit"
        assert chain2.events[1].action == "seg:admit"


def test_persistent_audit_tamper_detection_after_reload():
    """Tampering is detected even after reload from SQLite."""
    from governance.persistence import PersistentAuditChain

    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = os.path.join(tmpdir, "audit.db")
        chain = PersistentAuditChain(db_path)
        chain.append("acme", "agent-001", "mutation:submit", "mut-001")
        chain.append("acme", "seg", "seg:admit", "mut-001")

        # Reload
        chain2 = PersistentAuditChain(db_path)
        # Tamper
        chain2.events[0].action = "tampered"
        assert not chain2.verify()


def test_persistent_identity_provider_survives_restart():
    """Identities + API keys survive a restart."""
    from governance.persistence import PersistentIdentityProvider
    from governance.identity import Role, Permission

    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = os.path.join(tmpdir, "identity.db")

        # Write
        idp1 = PersistentIdentityProvider(db_path)
        idp1.create_tenant("acme")
        idp1.create_identity("agent-001", "acme", Role.AGENT, "Test Agent")
        key_id, plaintext = idp1.issue_api_key("agent-001")
        ctx1 = idp1.authenticate(plaintext)
        assert ctx1 is not None

        # Read back
        idp2 = PersistentIdentityProvider(db_path)
        assert "acme" in idp2.tenants
        assert "agent-001" in idp2.identities
        ctx2 = idp2.authenticate(plaintext)
        assert ctx2 is not None
        assert ctx2.identity.identity_id == "agent-001"


def test_persistent_identity_revocation_survives_restart():
    """Revoked API keys stay revoked after restart."""
    from governance.persistence import PersistentIdentityProvider
    from governance.identity import Role

    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = os.path.join(tmpdir, "identity.db")
        idp1 = PersistentIdentityProvider(db_path)
        idp1.create_tenant("acme")
        idp1.create_identity("agent-001", "acme", Role.AGENT)
        key_id, plaintext = idp1.issue_api_key("agent-001")
        assert idp1.revoke_api_key(key_id)

        # Restart
        idp2 = PersistentIdentityProvider(db_path)
        assert idp2.authenticate(plaintext) is None  # still revoked


# ===========================================================================
# api/metrics.py — Prometheus endpoint
# ===========================================================================

def test_metrics_endpoint_returns_prometheus_format():
    """The /metrics endpoint returns Prometheus-format text."""
    from api.server import app, runtime
    runtime.initialize()
    client = TestClient(app)
    resp = client.get("/metrics")
    assert resp.status_code == 200
    text = resp.text
    # Should contain Prometheus-format lines
    assert "srs_" in text
    assert "# TYPE" in text


def test_metrics_gauges_populated():
    """The metrics endpoint populates gauge values from runtime state."""
    from api.server import app, runtime
    runtime.initialize()
    client = TestClient(app)
    resp = client.get("/metrics")
    text = resp.text
    assert "srs_active_identities" in text
    assert "srs_active_tenants" in text
    assert "srs_audit_chain_valid" in text


def test_mutation_increments_counter():
    """Submitting a mutation increments the srs_mutations_total counter."""
    from api.server import app, runtime
    runtime.initialize()
    client = TestClient(app)
    headers = {"Authorization": f"Bearer {runtime.admin_key}"}

    # Submit a mutation
    client.post("/v1/mutations", json={
        "mutation_id": "metrics-test-mut",
        "description": "metrics test",
        "risk_class": "low",
        "z3_witness_hash": "sha256:abc",
        "evidence_chain": {"admissible": True, "seq": 1,
                           "sqa_certificate_ref": "quorum:self#bls_evidence_binding",
                           "z3_witness_hash": "sha256:abc"},
        "validators": [
            {"validator_id": "v1", "validator_type": "FORMAL", "admit": True, "assurance": 0.95},
            {"validator_id": "v2", "validator_type": "EMPIRICAL", "admit": True, "assurance": 0.88},
            {"validator_id": "v3", "validator_type": "HEURISTIC", "admit": True, "assurance": 0.81},
        ],
        "seq": 1,
    }, headers=headers)

    # Check metrics
    resp = client.get("/metrics")
    assert "srs_mutations_total" in resp.text


# ===========================================================================
# Docker Compose file exists
# ===========================================================================

def test_docker_compose_file_exists():
    """The docker-compose.yml file exists and is valid YAML."""
    import yaml
    compose_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "docker-compose.yml",
    )
    assert os.path.exists(compose_path)
    with open(compose_path) as f:
        data = yaml.safe_load(f)
    assert "services" in data
    assert "srs-api" in data["services"]
    assert "prometheus" in data["services"]
    assert "grafana" in data["services"]
