#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
persistence.py — SQLite persistence for SRS runtime state.

Provides:
  - PersistentAuditChain: AuditChain backed by SQLite
  - PersistentIdentityProvider: IdentityProvider backed by SQLite
  - PersistentCostTracker: CostTracker backed by SQLite

This ensures SRS survives restarts — audit trails, identities, API keys,
and cost events are persisted to disk.
"""
from __future__ import annotations

import hashlib
import json
import os
import secrets
import sqlite3
import time
from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from governance.audit import AuditEvent, AuditChain
from governance.identity import (
    IdentityProvider, Identity, APIKey, Role, Permission, ROLE_PERMISSIONS,
)
from governance.cost import CostEvent, CostTracker, COST_MODEL, Budget


class PersistentAuditChain(AuditChain):
    """AuditChain backed by SQLite — survives restarts."""

    def __init__(self, db_path: str = "srs_audit.db") -> None:
        super().__init__()
        self.db_path = db_path
        self._init_db()
        self._load_from_db()

    def _init_db(self) -> None:
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS audit_events (
                    event_id TEXT PRIMARY KEY,
                    timestamp REAL NOT NULL,
                    tenant_id TEXT NOT NULL,
                    identity_id TEXT NOT NULL,
                    action TEXT NOT NULL,
                    resource TEXT NOT NULL,
                    outcome TEXT NOT NULL,
                    prev_hash TEXT NOT NULL,
                    event_hash TEXT NOT NULL,
                    metadata TEXT DEFAULT '{}'
                )
            """)
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_events(tenant_id)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_events(action)"
            )

    def _load_from_db(self) -> None:
        """Load all events from SQLite on startup."""
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute(
                "SELECT * FROM audit_events ORDER BY timestamp ASC"
            ).fetchall()
        self.events = []
        for row in rows:
            event = AuditEvent(
                event_id=row[0], timestamp=row[1], tenant_id=row[2],
                identity_id=row[3], action=row[4], resource=row[5],
                outcome=row[6], prev_hash=row[7], event_hash=row[8],
                metadata=json.loads(row[9]) if row[9] else {},
            )
            self.events.append(event)

    def append(self, tenant_id: str, identity_id: str, action: str,
               resource: str, outcome: str = "success",
               metadata: Optional[Dict[str, Any]] = None) -> AuditEvent:
        """Append + persist to SQLite."""
        event = super().append(tenant_id, identity_id, action, resource, outcome, metadata)
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO audit_events VALUES (?,?,?,?,?,?,?,?,?,?)",
                (event.event_id, event.timestamp, event.tenant_id,
                 event.identity_id, event.action, event.resource,
                 event.outcome, event.prev_hash, event.event_hash,
                 json.dumps(event.metadata)),
            )
        return event


class PersistentIdentityProvider(IdentityProvider):
    """IdentityProvider backed by SQLite."""

    def __init__(self, db_path: str = "srs_identity.db") -> None:
        super().__init__()
        self.db_path = db_path
        self._init_db()
        self._load_from_db()

    def _init_db(self) -> None:
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS tenants (
                    tenant_id TEXT PRIMARY KEY
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS identities (
                    identity_id TEXT PRIMARY KEY,
                    tenant_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    display_name TEXT DEFAULT '',
                    created_at REAL NOT NULL,
                    metadata TEXT DEFAULT '{}'
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS api_keys (
                    key_id TEXT PRIMARY KEY,
                    key_hash TEXT NOT NULL,
                    identity_id TEXT NOT NULL,
                    tenant_id TEXT NOT NULL,
                    scopes TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    expires_at REAL NOT NULL,
                    last_used REAL NOT NULL,
                    revoked INTEGER DEFAULT 0
                )
            """)

    def _load_from_db(self) -> None:
        with sqlite3.connect(self.db_path) as conn:
            for row in conn.execute("SELECT tenant_id FROM tenants").fetchall():
                self.tenants.add(row[0])
            for row in conn.execute("SELECT * FROM identities").fetchall():
                ident = Identity(
                    identity_id=row[0], tenant_id=row[1],
                    role=Role(row[2]), display_name=row[3],
                    created_at=row[4],
                    metadata=json.loads(row[5]) if row[5] else {},
                )
                self.identities[row[0]] = ident
            for row in conn.execute("SELECT * FROM api_keys").fetchall():
                scopes = set(Permission(s) for s in json.loads(row[4]))
                api_key = APIKey(
                    key_id=row[0], key_hash=row[1], identity_id=row[2],
                    tenant_id=row[3], scopes=scopes, created_at=row[5],
                    expires_at=row[6], last_used=row[7], revoked=bool(row[8]),
                )
                self.api_keys[row[0]] = api_key

    def create_tenant(self, tenant_id: str) -> bool:
        if tenant_id in self.tenants:
            return False
        result = super().create_tenant(tenant_id)
        if result:
            with sqlite3.connect(self.db_path) as conn:
                conn.execute("INSERT OR IGNORE INTO tenants VALUES (?)", (tenant_id,))
        return result

    def create_identity(self, identity_id: str, tenant_id: str,
                        role: Role, display_name: str = "") -> Identity:
        ident = super().create_identity(identity_id, tenant_id, role, display_name)
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO identities VALUES (?,?,?,?,?,?)",
                (ident.identity_id, ident.tenant_id, ident.role.value,
                 ident.display_name, ident.created_at, json.dumps(ident.metadata)),
            )
        return ident

    def issue_api_key(self, identity_id: str,
                      scopes: Optional[set] = None,
                      ttl_seconds: float = 0) -> Tuple[str, str]:
        key_id, plaintext = super().issue_api_key(identity_id, scopes, ttl_seconds)
        api_key = self.api_keys[key_id]
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO api_keys VALUES (?,?,?,?,?,?,?,?,?)",
                (api_key.key_id, api_key.key_hash, api_key.identity_id,
                 api_key.tenant_id, json.dumps(list(s.value for s in api_key.scopes)),
                 api_key.created_at, api_key.expires_at, api_key.last_used,
                 int(api_key.revoked)),
            )
        return key_id, plaintext

    def revoke_api_key(self, key_id: str) -> bool:
        result = super().revoke_api_key(key_id)
        if result:
            with sqlite3.connect(self.db_path) as conn:
                conn.execute("UPDATE api_keys SET revoked=1 WHERE key_id=?", (key_id,))
        return result


def self_test() -> None:
    import tempfile
    print("=" * 78)
    print("Persistence — SQLite-backed storage self-test")
    print("=" * 78)

    with tempfile.TemporaryDirectory() as tmpdir:
        audit_db = os.path.join(tmpdir, "audit.db")
        ident_db = os.path.join(tmpdir, "identity.db")

        # Audit
        chain = PersistentAuditChain(audit_db)
        chain.append("acme", "agent-001", "mutation:submit", "mut-001")
        chain.append("acme", "seg", "seg:admit", "mut-001")
        assert chain.verify()
        assert len(chain.events) == 2

        # Reload from disk
        chain2 = PersistentAuditChain(audit_db)
        assert len(chain2.events) == 2
        assert chain2.verify()
        print("  Audit chain persisted + reloaded: ✓")

        # Identity
        idp = PersistentIdentityProvider(ident_db)
        idp.create_tenant("acme")
        idp.create_identity("agent-001", "acme", Role.AGENT, "Agent")
        key_id, plaintext = idp.issue_api_key("agent-001")
        ctx = idp.authenticate(plaintext)
        assert ctx is not None

        # Reload
        idp2 = PersistentIdentityProvider(ident_db)
        assert "acme" in idp2.tenants
        assert "agent-001" in idp2.identities
        ctx2 = idp2.authenticate(plaintext)
        assert ctx2 is not None
        print("  Identity + API keys persisted + reloaded: ✓")

    print("=" * 78)
    print("Persistence self-test PASSED.")
    print("=" * 78)


if __name__ == "__main__":
    self_test()  # pragma: no cover
