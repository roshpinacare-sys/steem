"""Tests for gRPC API, rate limiter, OIDC, and replication."""
from __future__ import annotations

import time

import pytest


# ===========================================================================
# api/grpc_api.py
# ===========================================================================

def test_grpc_health_no_auth():
    """gRPC Health works without auth."""
    from api.grpc_api import SRSGrpcService
    from api.server import runtime
    runtime.initialize()
    svc = SRSGrpcService(runtime)
    result = svc.Health({})
    assert result["status"] == "ok"


def test_grpc_submit_mutation_requires_auth():
    """gRPC SubmitMutation without auth returns permission denied."""
    from api.grpc_api import SRSGrpcService
    from api.server import runtime
    runtime.initialize()
    svc = SRSGrpcService(runtime)
    result = svc.SubmitMutation({
        "mutation_id": "x", "description": "x", "risk_class": "low",
        "z3_witness_hash": "h", "evidence_chain": {}, "validators": [],
    })
    assert "error" in result


def test_grpc_query_audit_requires_auth():
    """gRPC QueryAudit without auth returns permission denied."""
    from api.grpc_api import SRSGrpcService
    from api.server import runtime
    runtime.initialize()
    svc = SRSGrpcService(runtime)
    result = svc.QueryAudit({})
    assert "error" in result


# ===========================================================================
# api/rate_limiter.py
# ===========================================================================

def test_rate_limiter_allows_under_limit():
    """Requests under the limit are allowed."""
    from api.rate_limiter import RateLimiter
    rl = RateLimiter(per_identity_rpm=100, per_tenant_rpm=1000)
    allowed, _ = rl.check("agent-001", "acme")
    assert allowed


def test_rate_limiter_denies_over_limit():
    """Requests over the identity limit (including burst) are denied."""
    from api.rate_limiter import RateLimiter
    # rpm=5, burst=1.5x → capacity=7.5 → 7 requests allowed, 8th denied
    rl = RateLimiter(per_identity_rpm=5, per_tenant_rpm=10000)
    for i in range(7):
        allowed, _ = rl.check("agent-001", "acme")
        assert allowed, f"Request {i} should be allowed"
    # 8th should fail (exceeded burst capacity)
    allowed, reason = rl.check("agent-001", "acme")
    assert not allowed
    assert "rate limit" in reason.lower()


def test_rate_limiter_tenant_limit():
    """Tenant-level limit is independent of identity limit."""
    from api.rate_limiter import RateLimiter
    # tenant rpm=5, burst=1.5x → capacity=7.5 → 7 requests, 8th denied
    rl = RateLimiter(per_identity_rpm=10000, per_tenant_rpm=5)
    for i in range(7):
        allowed, _ = rl.check(f"agent-{i:03d}", "acme")
        assert allowed, f"Request {i} should be allowed"
    # 8th should fail at tenant level (different agent, same tenant)
    allowed, reason = rl.check("agent-999", "acme")
    assert not allowed
    assert "tenant" in reason.lower()


def test_rate_limiter_stats():
    """Rate limiter stats return correct counts."""
    from api.rate_limiter import RateLimiter
    rl = RateLimiter(per_identity_rpm=100, per_tenant_rpm=1000)
    rl.check("agent-001", "acme")
    rl.check("agent-002", "acme")
    stats = rl.stats()
    assert stats["identity_buckets"] == 2
    assert stats["tenant_buckets"] == 1


# ===========================================================================
# api/oidc.py
# ===========================================================================

def test_oidc_verify_valid_token():
    """A valid JWT token is verified."""
    from api.oidc import OIDCVerifier, OIDCConfig, create_test_jwt
    config = OIDCConfig(issuer="https://acme.okta.com", client_id="srs")
    verifier = OIDCVerifier(config)
    token = create_test_jwt({
        "sub": "user-123", "email": "agent@acme.com", "name": "Agent",
        "iss": "https://acme.okta.com", "exp": time.time() + 3600,
    })
    identity = verifier.verify_token(token)
    assert identity is not None
    assert identity.external_id == "user-123"
    assert identity.provider == "okta"


def test_oidc_rejects_expired_token():
    """An expired JWT is rejected."""
    from api.oidc import OIDCVerifier, OIDCConfig, create_test_jwt
    config = OIDCConfig(issuer="https://acme.okta.com", client_id="srs")
    verifier = OIDCVerifier(config)
    token = create_test_jwt({
        "sub": "expired", "iss": "https://acme.okta.com",
        "exp": time.time() - 3600,
    })
    assert verifier.verify_token(token) is None


def test_oidc_rejects_wrong_issuer():
    """A token from the wrong issuer is rejected."""
    from api.oidc import OIDCVerifier, OIDCConfig, create_test_jwt
    config = OIDCConfig(issuer="https://acme.okta.com", client_id="srs")
    verifier = OIDCVerifier(config)
    token = create_test_jwt({
        "sub": "user", "iss": "https://wrong.idp.com",
        "exp": time.time() + 3600,
    })
    assert verifier.verify_token(token) is None


def test_oidc_detects_providers():
    """The verifier detects the OIDC provider from the issuer URL."""
    from api.oidc import OIDCVerifier, OIDCConfig, create_test_jwt
    for issuer, expected in [
        ("https://acme.okta.com", "okta"),
        ("https://tenant.auth0.com", "auth0"),
        ("https://keycloak.acme.com", "keycloak"),
        ("https://login.microsoft.com", "azure"),
    ]:
        config = OIDCConfig(issuer=issuer, client_id="srs")
        verifier = OIDCVerifier(config)
        token = create_test_jwt({
            "sub": "user", "iss": issuer, "exp": time.time() + 3600,
        })
        identity = verifier.verify_token(token)
        assert identity is not None
        assert identity.provider == expected


def test_oidc_converts_to_srs_identity():
    """External identity converts to an SRS Identity."""
    from api.oidc import OIDCVerifier, OIDCConfig, create_test_jwt
    config = OIDCConfig(issuer="https://acme.okta.com", client_id="srs",
                        default_tenant="acme")
    verifier = OIDCVerifier(config)
    token = create_test_jwt({
        "sub": "user-123", "email": "agent@acme.com", "name": "Agent",
        "iss": "https://acme.okta.com", "exp": time.time() + 3600,
    })
    identity = verifier.verify_token(token)
    srs_ident = identity.to_identity()
    assert srs_ident.identity_id == "okta:user-123"
    assert srs_ident.tenant_id == "acme"


# ===========================================================================
# api/replication.py
# ===========================================================================

def test_replication_primary_append():
    """Primary can append to the replication log."""
    from api.replication import ReplicationConfig, ReplicationManager, NodeRole
    config = ReplicationConfig(node_id="p1", region="us-east", role=NodeRole.PRIMARY)
    mgr = ReplicationManager(config)
    entry = mgr.append("mutation:submit", {"id": "mut-001"})
    assert entry.entry_id == 1
    assert entry.operation == "mutation:submit"


def test_replication_replica_cannot_append():
    """Replica cannot append to the log."""
    from api.replication import ReplicationConfig, ReplicationManager, NodeRole
    config = ReplicationConfig(node_id="r1", region="eu-west", role=NodeRole.REPLICA)
    mgr = ReplicationManager(config)
    with pytest.raises(RuntimeError, match="Only the primary"):
        mgr.append("test", {})


def test_replication_sync():
    """Replica syncs entries from primary."""
    from api.replication import ReplicationConfig, ReplicationManager, NodeRole
    primary = ReplicationManager(ReplicationConfig(
        node_id="p1", region="us-east", role=NodeRole.PRIMARY))
    replica = ReplicationManager(ReplicationConfig(
        node_id="r1", region="eu-west", role=NodeRole.REPLICA))

    primary.append("mutation:submit", {"id": "mut-001"})
    primary.append("audit:append", {"event": "test"})

    entries = primary.get_entries_since(0)
    for e in entries:
        replica.apply_entry(e)

    assert len(replica.log) == 2
    assert replica.log[0].operation == "mutation:submit"


def test_replication_failover():
    """Replica promotes to primary after heartbeat timeout."""
    from api.replication import ReplicationConfig, ReplicationManager, NodeRole
    replica = ReplicationManager(ReplicationConfig(
        node_id="r1", region="eu-west", role=NodeRole.REPLICA,
        failover_timeout=0.1))

    # No failover initially
    assert not replica.check_failover()

    # Simulate heartbeat timeout
    replica._last_heartbeat = time.time() - 1.0
    assert replica.check_failover()

    # Promote
    assert replica.promote_to_primary()
    assert replica.is_primary


def test_replication_stats():
    """Replication stats return correct info."""
    from api.replication import ReplicationConfig, ReplicationManager, NodeRole
    mgr = ReplicationManager(ReplicationConfig(
        node_id="p1", region="us-east", role=NodeRole.PRIMARY,
        peers=["r1:8000", "r2:8000"]))
    mgr.append("test", {})
    stats = mgr.stats()
    assert stats["role"] == "primary"
    assert stats["log_entries"] == 1
    assert stats["peers"] == 2


# ===========================================================================
# Self-tests
# ===========================================================================

def test_grpc_self_test(capsys):
    from api.grpc_api import self_test
    self_test()
    assert "PASSED" in capsys.readouterr().out

def test_rate_limiter_self_test(capsys):
    from api.rate_limiter import self_test
    self_test()
    assert "PASSED" in capsys.readouterr().out

def test_oidc_self_test(capsys):
    from api.oidc import self_test
    self_test()
    assert "PASSED" in capsys.readouterr().out

def test_replication_self_test(capsys):
    from api.replication import self_test
    self_test()
    assert "PASSED" in capsys.readouterr().out
