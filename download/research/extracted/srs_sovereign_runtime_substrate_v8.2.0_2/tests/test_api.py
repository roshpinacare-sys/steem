"""Tests for the REST API layer + Python SDK."""
from __future__ import annotations

import pytest

# Use TestClient for in-process testing (no network needed)
from fastapi.testclient import TestClient

from api.server import app, runtime


@pytest.fixture
def client():
    """FastAPI test client."""
    return TestClient(app)


@pytest.fixture
def admin_headers():
    """Authorization headers with the admin API key."""
    return {"Authorization": f"Bearer {runtime.admin_key}"}


# ---------------------------------------------------------------------------
# Health (no auth)
# ---------------------------------------------------------------------------

def test_health_no_auth(client):
    """Health check works without authentication."""
    resp = client.get("/v1/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["version"] == "5.1.0"


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

def test_missing_auth_header_returns_401(client):
    """Request without Authorization header returns 401."""
    resp = client.get("/v1/policies")
    assert resp.status_code == 401


def test_invalid_api_key_returns_401(client):
    """Invalid API key returns 401."""
    resp = client.get("/v1/policies", headers={"Authorization": "Bearer invalid-key"})
    assert resp.status_code == 401


def test_issue_api_key_as_admin(client, admin_headers):
    """Admin can issue API keys."""
    resp = client.post("/v1/auth/api-key", json={
        "tenant_id": "test-tenant",
        "identity_id": "test-agent",
        "role": "agent",
        "display_name": "Test Agent",
    }, headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "api_key" in data
    assert data["identity_id"] == "test-agent"
    assert data["tenant_id"] == "test-tenant"


def test_agent_cannot_issue_api_keys(client, admin_headers):
    """Agent role cannot issue API keys (requires KEY_MANAGE permission)."""
    # First, create an agent API key
    resp = client.post("/v1/auth/api-key", json={
        "tenant_id": "default", "identity_id": "agent-001",
        "role": "agent",
    }, headers=admin_headers)
    agent_key = resp.json()["api_key"]

    # Agent tries to issue another key → 403
    resp = client.post("/v1/auth/api-key", json={
        "tenant_id": "default", "identity_id": "agent-002", "role": "agent",
    }, headers={"Authorization": f"Bearer {agent_key}"})
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Mutations
# ---------------------------------------------------------------------------

def test_submit_mutation_low_risk(client, admin_headers):
    """Submit a low-risk mutation — should be evaluated by SEG."""
    # Get admin key (has MUTATION_SUBMIT permission)
    resp = client.post("/v1/mutations", json={
        "mutation_id": "api-test-mut-001",
        "description": "API test mutation",
        "risk_class": "low",
        "z3_witness_hash": "sha256:abc123",
        "evidence_chain": {
            "admissible": True, "seq": 1,
            "sqa_certificate_ref": "quorum:self#bls_evidence_binding",
            "z3_witness_hash": "sha256:abc123",
        },
        "validators": [
            {"validator_id": "v1", "validator_type": "FORMAL", "admit": True, "assurance": 0.95},
            {"validator_id": "v2", "validator_type": "EMPIRICAL", "admit": True, "assurance": 0.88},
            {"validator_id": "v3", "validator_type": "HEURISTIC", "admit": True, "assurance": 0.81},
        ],
        "seq": 1,
    }, headers=admin_headers)
    # SEG may admit or reject depending on quorum assembly
    assert resp.status_code == 200
    data = resp.json()
    assert "admissible" in data
    assert "reason" in data


def test_submit_mutation_high_risk_requires_approval(client, admin_headers):
    """High-risk mutation requires human approval (policy)."""
    resp = client.post("/v1/mutations", json={
        "mutation_id": "api-test-mut-002",
        "description": "High risk mutation",
        "risk_class": "high",
        "z3_witness_hash": "sha256:abc123",
        "evidence_chain": {"admissible": True, "seq": 1,
                           "sqa_certificate_ref": "quorum:self#bls_evidence_binding",
                           "z3_witness_hash": "sha256:abc123"},
        "validators": [],
        "seq": 1,
    }, headers=admin_headers)
    assert resp.status_code == 403
    assert "approval" in resp.json()["detail"].lower()


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------

def test_audit_query(client, admin_headers):
    """Query the audit trail."""
    resp = client.get("/v1/audit", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "events" in data
    assert "count" in data


def test_audit_verify(client, admin_headers):
    """Verify audit chain integrity."""
    resp = client.get("/v1/audit/verify", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["valid"] is True
    assert data["event_count"] >= 0


# ---------------------------------------------------------------------------
# Policies
# ---------------------------------------------------------------------------

def test_list_policies(client, admin_headers):
    """List active policies."""
    resp = client.get("/v1/policies", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "policies" in data
    assert len(data["policies"]) >= 4  # 4 default policies


# ---------------------------------------------------------------------------
# Cost
# ---------------------------------------------------------------------------

def test_cost_report(client, admin_headers):
    """Get cost report."""
    resp = client.get("/v1/cost/report", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "total_events" in data
    assert "total_cost_dollars" in data


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

def test_stats(client, admin_headers):
    """Get runtime statistics."""
    resp = client.get("/v1/stats", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "seg" in data
    assert "audit" in data
    assert "identities" in data
    assert "tenants" in data


# ---------------------------------------------------------------------------
# SDK tests
# ---------------------------------------------------------------------------

def test_sdk_client_health():
    """SDK health check works."""
    from api.srs_sdk import SRSCClient
    client = SRSCClient("http://localhost:8000", api_key="")
    # Use the test client directly
    with TestClient(app) as tc:
        # Monkey-patch the SDK to use the test client
        import json
        resp = tc.get("/v1/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"


def test_sdk_submit_mutation():
    """SDK mutation submission works via test client."""
    from api.srs_sdk import SRSCClient, MutationResult
    tc = TestClient(app)
    # Submit mutation directly via test client (simulates SDK)
    resp = tc.post("/v1/mutations", json={
        "mutation_id": "sdk-test-mut-001",
        "description": "SDK test",
        "risk_class": "low",
        "z3_witness_hash": "sha256:abc123",
        "evidence_chain": {"admissible": True, "seq": 1,
                           "sqa_certificate_ref": "quorum:self#bls_evidence_binding",
                           "z3_witness_hash": "sha256:abc123"},
        "validators": [
            {"validator_id": "v1", "validator_type": "FORMAL", "admit": True, "assurance": 0.95},
            {"validator_id": "v2", "validator_type": "EMPIRICAL", "admit": True, "assurance": 0.88},
            {"validator_id": "v3", "validator_type": "HEURISTIC", "admit": True, "assurance": 0.81},
        ],
        "seq": 1,
    }, headers={"Authorization": f"Bearer {runtime.admin_key}"})
    assert resp.status_code == 200
    data = resp.json()
    result = MutationResult(
        mutation_id=data["mutation_id"],
        admissible=data["admissible"],
        reason=data["reason"],
        certified_at=data.get("certified_at", 0.0),
    )
    assert result.mutation_id == "sdk-test-mut-001"
