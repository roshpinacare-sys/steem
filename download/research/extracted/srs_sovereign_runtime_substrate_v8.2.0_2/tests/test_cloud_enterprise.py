"""Tests for connection pool, streaming replication, and partner program."""
from __future__ import annotations

import time

import pytest


# ===========================================================================
# api/connection_pool.py
# ===========================================================================

def test_connection_pool_acquire_release():
    from api.connection_pool import ConnectionPool, PoolConfig
    pool = ConnectionPool(PoolConfig(max_connections=5))
    conn = pool.acquire()
    assert conn is not None
    assert conn.in_use
    pool.release(conn)
    assert not conn.in_use


def test_connection_pool_reuses_released():
    from api.connection_pool import ConnectionPool
    pool = ConnectionPool()
    conn1 = pool.acquire()
    pool.release(conn1)
    conn2 = pool.acquire()
    assert conn1.conn_id == conn2.conn_id


def test_connection_pool_exhaustion():
    from api.connection_pool import ConnectionPool, PoolConfig
    pool = ConnectionPool(PoolConfig(max_connections=2))
    c1 = pool.acquire()
    c2 = pool.acquire()
    c3 = pool.acquire()
    assert c3 is None  # pool exhausted


def test_connection_pool_stats():
    from api.connection_pool import ConnectionPool
    pool = ConnectionPool()
    pool.acquire()
    stats = pool.stats()
    assert stats["pool_size"] == 1
    assert stats["in_use"] == 1
    assert stats["created"] == 1


def test_streaming_replication_config():
    from api.connection_pool import StreamingReplicationConfig
    rc = StreamingReplicationConfig(
        primary_host="primary.db.local",
        replica_hosts=["r1.db.local", "r2.db.local"],
    )
    conf = rc.to_postgresql_conf()
    assert "wal_level" in conf
    assert "max_wal_senders" in conf
    recovery = rc.to_recovery_conf("r1.db.local")
    assert "primary_conninfo" in recovery


def test_failover_handler():
    from api.connection_pool import StreamingReplicationConfig, FailoverHandler
    rc = StreamingReplicationConfig(
        primary_host="primary.local",
        replica_hosts=["replica1.local", "replica2.local"],
    )
    fh = FailoverHandler(rc, failover_timeout_s=0.1)
    assert not fh.check_failover()
    fh._last_heartbeat = time.time() - 1.0
    assert fh.check_failover()
    new_primary = fh.execute_failover()
    assert new_primary == "replica1.local"
    assert fh.current_primary == "replica1.local"
    assert fh.stats()["failover_count"] == 1


# ===========================================================================
# api/partner_program.py
# ===========================================================================

def test_partner_register():
    from api.partner_program import PartnerProgram, PartnerTier
    prog = PartnerProgram()
    p = prog.register("p-001", "Acme", "info@acme.com", "https://acme.com", "NA")
    assert p.tier == PartnerTier.REGISTERED
    assert p.active is True


def test_partner_upgrade():
    from api.partner_program import PartnerProgram, PartnerTier
    prog = PartnerProgram()
    prog.register("p-001", "Acme")
    assert prog.upgrade("p-001", PartnerTier.GOLD)
    assert prog.get_partner("p-001").tier == PartnerTier.GOLD


def test_partner_revenue_share():
    from api.partner_program import PartnerProgram, PartnerTier
    prog = PartnerProgram()
    prog.register("p-001", "Acme")
    prog.upgrade("p-001", PartnerTier.GOLD)  # 20% share
    prog.record_deployment("p-001", revenue=100_000)
    assert prog.total_revenue_share() == 20_000


def test_partner_list_by_tier():
    from api.partner_program import PartnerProgram, PartnerTier
    prog = PartnerProgram()
    prog.register("p-001", "A")
    prog.register("p-002", "B")
    prog.upgrade("p-002", PartnerTier.SILVER)
    all_p = prog.list_partners()
    assert len(all_p) == 2
    silver = prog.list_partners(tier=PartnerTier.SILVER)
    assert len(silver) == 1


def test_partner_stats():
    from api.partner_program import PartnerProgram, PartnerTier
    prog = PartnerProgram()
    prog.register("p-001", "A")
    prog.register("p-002", "B")
    prog.upgrade("p-002", PartnerTier.PLATINUM)
    prog.record_deployment("p-001")
    prog.record_deployment("p-002")
    stats = prog.stats()
    assert stats["total_partners"] == 2
    assert stats["by_tier"]["platinum"] == 1
    assert stats["total_deployments"] == 2


def test_partner_list_tiers():
    from api.partner_program import PartnerProgram
    prog = PartnerProgram()
    tiers = prog.list_tiers()
    assert len(tiers) == 4
    names = [t["name"] for t in tiers]
    assert "Registered Partner" in names
    assert "Platinum Partner" in names


def test_partner_benefits():
    from api.partner_program import PARTNER_BENEFITS, PartnerTier
    assert PARTNER_BENEFITS[PartnerTier.PLATINUM]["revenue_share_pct"] == 30
    assert PARTNER_BENEFITS[PartnerTier.REGISTERED]["revenue_share_pct"] == 0
    assert PARTNER_BENEFITS[PartnerTier.GOLD]["priority_support"] is True


# ===========================================================================
# Cloud deployment guide exists
# ===========================================================================

def test_cloud_deployment_guide_exists():
    import os
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "CLOUD_DEPLOYMENT.md")
    assert os.path.exists(path)
    content = open(path).read()
    assert "AWS" in content
    assert "GCP" in content
    assert "Multi-Region" in content or "multi-region" in content.lower()
    assert "SRS Cloud" in content


# ===========================================================================
# Self-tests
# ===========================================================================

def test_connection_pool_self_test(capsys):
    from api.connection_pool import self_test
    self_test()
    assert "PASSED" in capsys.readouterr().out

def test_partner_program_self_test(capsys):
    from api.partner_program import self_test
    self_test()
    assert "PASSED" in capsys.readouterr().out
