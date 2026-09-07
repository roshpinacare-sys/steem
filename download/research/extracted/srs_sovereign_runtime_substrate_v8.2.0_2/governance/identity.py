#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
identity.py — Enterprise identity, authentication, and authorization.

Provides:
  - APIKey: scoped API key with expiry and permissions
  - Identity: agent or human identity with role + tenant
  - AuthContext: authenticated request context
  - RBAC: role-based access control (agent, operator, auditor, admin)
  - TokenValidator: validates Bearer tokens / API keys

This is the enterprise identity layer that gates every SRS operation.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Set, Tuple


class Role(str, Enum):
    """Roles in the SRS RBAC system."""
    AGENT = "agent"           # AI agent — can submit mutations, read memory
    OPERATOR = "operator"     # Human operator — can approve mutations, manage agents
    AUDITOR = "auditor"       # Read-only access to audit trails + ESR logs
    ADMIN = "admin"           # Full access — manage tenants, keys, policies


class Permission(str, Enum):
    """Granular permissions for SRS operations."""
    MUTATION_SUBMIT = "mutation:submit"
    MUTATION_APPROVE = "mutation:approve"
    MUTATION_REJECT = "mutation:reject"
    MEMORY_READ = "memory:read"
    MEMORY_WRITE = "memory:write"
    MEMORY_DELETE = "memory:delete"
    AUDIT_READ = "audit:read"
    POLICY_MANAGE = "policy:manage"
    TENANT_MANAGE = "tenant:manage"
    KEY_MANAGE = "key:manage"


# Role → Permissions mapping
ROLE_PERMISSIONS: Dict[Role, Set[Permission]] = {
    Role.AGENT: {
        Permission.MUTATION_SUBMIT, Permission.MEMORY_READ,
        Permission.MEMORY_WRITE,
    },
    Role.OPERATOR: {
        Permission.MUTATION_SUBMIT, Permission.MUTATION_APPROVE,
        Permission.MUTATION_REJECT, Permission.MEMORY_READ,
        Permission.MEMORY_WRITE, Permission.MEMORY_DELETE,
        Permission.AUDIT_READ,
    },
    Role.AUDITOR: {
        Permission.AUDIT_READ, Permission.MEMORY_READ,
    },
    Role.ADMIN: set(Permission),  # all permissions
}


@dataclass
class Identity:
    """An authenticated identity (agent or human)."""
    identity_id: str
    tenant_id: str
    role: Role
    display_name: str = ""
    created_at: float = field(default_factory=time.time)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def has_permission(self, perm: Permission) -> bool:
        return perm in ROLE_PERMISSIONS.get(self.role, set())


@dataclass
class APIKey:
    """A scoped API key with expiry."""
    key_id: str
    key_hash: str  # SHA-256 of the actual key (never store plaintext)
    identity_id: str
    tenant_id: str
    scopes: Set[Permission]
    created_at: float = field(default_factory=time.time)
    expires_at: float = 0.0  # 0 = no expiry
    last_used: float = 0.0
    revoked: bool = False

    def is_expired(self) -> bool:
        return self.expires_at > 0 and time.time() > self.expires_at

    def is_valid(self) -> bool:
        return not self.revoked and not self.is_expired()


@dataclass
class AuthContext:
    """Authenticated request context — passed through every SRS operation."""
    identity: Identity
    api_key_id: str
    permissions: Set[Permission]
    request_id: str = field(default_factory=lambda: secrets.token_hex(8))
    timestamp: float = field(default_factory=time.time)

    def can(self, perm: Permission) -> bool:
        return perm in self.permissions


class IdentityProvider:
    """Manages identities, API keys, and authentication.

    In production, this would be backed by a database + JWT/OAuth2.
    Here we provide an in-memory reference implementation.
    """

    def __init__(self) -> None:
        self.identities: Dict[str, Identity] = {}
        self.api_keys: Dict[str, APIKey] = {}  # key_id -> APIKey
        self.tenants: Set[str] = set()

    def create_tenant(self, tenant_id: str) -> bool:
        if tenant_id in self.tenants:
            return False
        self.tenants.add(tenant_id)
        return True

    def create_identity(self, identity_id: str, tenant_id: str,
                        role: Role, display_name: str = "") -> Identity:
        if tenant_id not in self.tenants:
            raise ValueError(f"Unknown tenant: {tenant_id}")
        ident = Identity(
            identity_id=identity_id, tenant_id=tenant_id,
            role=role, display_name=display_name,
        )
        self.identities[identity_id] = ident
        return ident

    def issue_api_key(self, identity_id: str,
                      scopes: Optional[Set[Permission]] = None,
                      ttl_seconds: float = 0) -> Tuple[str, str]:
        """Issue a new API key. Returns (key_id, plaintext_key).

        The plaintext key is returned ONCE; only the hash is stored.
        """
        ident = self.identities.get(identity_id)
        if ident is None:
            raise ValueError(f"Unknown identity: {identity_id}")

        key_id = secrets.token_hex(8)
        plaintext = secrets.token_urlsafe(32)
        key_hash = hashlib.sha256(plaintext.encode()).hexdigest()

        scopes = scopes or ROLE_PERMISSIONS.get(ident.role, set())
        expires_at = time.time() + ttl_seconds if ttl_seconds > 0 else 0

        api_key = APIKey(
            key_id=key_id, key_hash=key_hash,
            identity_id=identity_id, tenant_id=ident.tenant_id,
            scopes=scopes, expires_at=expires_at,
        )
        self.api_keys[key_id] = api_key
        return key_id, plaintext

    def authenticate(self, plaintext_key: str) -> Optional[AuthContext]:
        """Authenticate a request. Returns AuthContext or None."""
        key_hash = hashlib.sha256(plaintext_key.encode()).hexdigest()

        # Find the API key by hash
        for key_id, api_key in self.api_keys.items():
            if hmac.compare_digest(api_key.key_hash, key_hash):
                if not api_key.is_valid():
                    return None
                ident = self.identities.get(api_key.identity_id)
                if ident is None:
                    return None  # pragma: no cover
                api_key.last_used = time.time()
                return AuthContext(
                    identity=ident,
                    api_key_id=key_id,
                    permissions=api_key.scopes,
                )
        return None

    def revoke_api_key(self, key_id: str) -> bool:
        api_key = self.api_keys.get(key_id)
        if api_key is None:
            return False
        api_key.revoked = True
        return True


def self_test() -> None:
    print("=" * 78)
    print("Identity Provider — Enterprise auth self-test")
    print("=" * 78)

    idp = IdentityProvider()
    idp.create_tenant("acme-corp")
    idp.create_identity("agent-001", "acme-corp", Role.AGENT, "Production Agent")
    idp.create_identity("admin-001", "acme-corp", Role.ADMIN, "Platform Admin")

    key_id, plaintext = idp.issue_api_key("agent-001")
    print(f"  Issued API key: {key_id} for agent-001")

    ctx = idp.authenticate(plaintext)
    assert ctx is not None, "Authentication failed"
    print(f"  Authenticated as: {ctx.identity.identity_id} ({ctx.identity.role.value})")
    assert ctx.can(Permission.MUTATION_SUBMIT)
    assert not ctx.can(Permission.TENANT_MANAGE)
    print("  Permissions: AGENT can submit mutations, cannot manage tenants ✓")

    # Revocation
    assert idp.revoke_api_key(key_id)
    assert idp.authenticate(plaintext) is None
    print("  Revoked key → authentication fails ✓")

    print("=" * 78)
    print("Identity Provider self-test PASSED.")
    print("=" * 78)


if __name__ == "__main__":
    self_test()  # pragma: no cover
