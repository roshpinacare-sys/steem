#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
oidc.py — OIDC/OAuth2 identity provider integration.

Provides:
  - OIDCConfig: configuration for an external identity provider
  - OIDCVerifier: verifies JWT tokens from external IdPs (Okta, Auth0, Keycloak)
  - ExternalIdentity: maps an external OIDC identity to an SRS Identity

This allows enterprises to use their existing identity infrastructure
(Okta, Auth0, Azure AD, Keycloak) instead of SRS's built-in API keys.

Usage:
  verifier = OIDCVerifier(OIDCConfig(
      issuer="https://your-org.okta.com",
      client_id="srs-client",
      client_secret="...",
  ))
  identity = verifier.verify_token(jwt_token)
  if identity:
      ctx = AuthContext(identity=identity, ...)
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from governance.identity import Identity, Role, Permission, ROLE_PERMISSIONS, AuthContext


@dataclass
class OIDCConfig:
    """Configuration for an external OIDC identity provider."""
    issuer: str              # e.g. "https://your-org.okta.com"
    client_id: str           # SRS's client ID registered with the IdP
    client_secret: str = ""  # SRS's client secret (for confidential clients)
    jwks_url: str = ""       # URL to fetch the IdP's public keys
    default_role: Role = Role.AGENT
    default_tenant: str = "external"
    scopes: list = field(default_factory=lambda: ["openid", "profile", "email"])

    @property
    def authorization_url(self) -> str:
        return f"{self.issuer}/oauth2/v1/authorize"

    @property
    def token_url(self) -> str:
        return f"{self.issuer}/oauth2/v1/token"

    @property
    def userinfo_url(self) -> str:
        return f"{self.issuer}/oauth2/v1/userinfo"


@dataclass
class ExternalIdentity:
    """An identity verified by an external OIDC provider."""
    external_id: str       # sub claim from the JWT
    email: str = ""
    name: str = ""
    tenant_id: str = "external"
    role: Role = Role.AGENT
    provider: str = ""     # "okta", "auth0", "keycloak", "azure"
    claims: Dict[str, Any] = field(default_factory=dict)

    def to_identity(self) -> Identity:
        """Convert to an SRS Identity."""
        return Identity(
            identity_id=f"{self.provider}:{self.external_id}",
            tenant_id=self.tenant_id,
            role=self.role,
            display_name=self.name or self.email,
            metadata={"provider": self.provider, "email": self.email,
                      "external_id": self.external_id},
        )


class OIDCVerifier:
    """Verifies JWT tokens from external OIDC providers.

    In production, this would use the `python-jose` or `PyJWT` library
    to verify JWT signatures against the IdP's public keys (JWKS).
    Here we provide a reference implementation that decodes JWTs
    without signature verification (for development/testing).
    """

    def __init__(self, config: OIDCConfig) -> None:
        self.config = config

    def decode_jwt(self, token: str) -> Optional[Dict[str, Any]]:
        """Decode a JWT token without signature verification.

        WARNING: This is for development only. Production must verify
        the JWT signature against the IdP's JWKS.
        """
        try:
            parts = token.split(".")
            if len(parts) != 3:
                return None
            # Decode payload (part 1)
            payload = parts[1]
            # Add padding
            payload += "=" * (4 - len(payload) % 4)
            decoded = base64.urlsafe_b64decode(payload)
            return dict(json.loads(decoded)) if decoded else None
        except Exception:
            return None

    def verify_token(self, token: str) -> Optional[ExternalIdentity]:
        """Verify a JWT token and return the external identity.

        Returns None if the token is invalid or expired.
        """
        claims = self.decode_jwt(token)
        if claims is None:
            return None

        # Check expiry
        exp = claims.get("exp")
        if exp is not None and time.time() > exp:
            return None

        # Check issuer (if configured)
        iss = claims.get("iss", "")
        if self.config.issuer and iss != self.config.issuer:
            return None

        # Extract identity
        sub = claims.get("sub", "")
        if not sub:
            return None

        return ExternalIdentity(
            external_id=sub,
            email=claims.get("email", ""),
            name=claims.get("name", ""),
            tenant_id=claims.get("tenant_id", self.config.default_tenant),
            role=self.config.default_role,
            provider=self._detect_provider(iss),
            claims=claims,
        )

    def _detect_provider(self, issuer: str) -> str:
        """Detect the OIDC provider from the issuer URL."""
        issuer_lower = issuer.lower()
        if "okta" in issuer_lower:
            return "okta"
        elif "auth0" in issuer_lower:
            return "auth0"
        elif "keycloak" in issuer_lower:
            return "keycloak"
        elif "azure" in issuer_lower or "microsoft" in issuer_lower:
            return "azure"
        return "oidc"


def create_test_jwt(payload: Dict[str, Any], secret: str = "test-secret") -> str:
    """Create a test JWT token (unsigned, for development only).

    The signature is a placeholder — do not use in production.
    """
    header = {"alg": "HS256", "typ": "JWT"}
    header_b64 = base64.urlsafe_b64encode(
        json.dumps(header).encode()
    ).rstrip(b"=").decode()
    payload_b64 = base64.urlsafe_b64encode(
        json.dumps(payload).encode()
    ).rstrip(b"=").decode()
    # Fake signature (not verified in development mode)
    sig = base64.urlsafe_b64encode(b"fake-signature").rstrip(b"=").decode()
    return f"{header_b64}.{payload_b64}.{sig}"


def self_test() -> None:
    print("=" * 78)
    print("OIDC — External identity provider integration self-test")
    print("=" * 78)

    config = OIDCConfig(
        issuer="https://acme.okta.com",
        client_id="srs-client",
        default_tenant="acme",
    )
    verifier = OIDCVerifier(config)

    # Create a valid test JWT
    token = create_test_jwt({
        "sub": "user-123",
        "email": "agent@acme.com",
        "name": "Test Agent",
        "iss": "https://acme.okta.com",
        "exp": time.time() + 3600,
        "tenant_id": "acme",
    })

    identity = verifier.verify_token(token)
    assert identity is not None
    assert identity.external_id == "user-123"
    assert identity.email == "agent@acme.com"
    assert identity.provider == "okta"
    print(f"  Valid token verified: {identity.external_id} ({identity.provider}) ✓")

    # Expired token
    expired_token = create_test_jwt({
        "sub": "expired-user",
        "iss": "https://acme.okta.com",
        "exp": time.time() - 3600,
    })
    assert verifier.verify_token(expired_token) is None
    print("  Expired token rejected: ✓")

    # Wrong issuer
    wrong_iss_token = create_test_jwt({
        "sub": "user-456",
        "iss": "https://wrong.okta.com",
        "exp": time.time() + 3600,
    })
    assert verifier.verify_token(wrong_iss_token) is None
    print("  Wrong issuer rejected: ✓")

    # Convert to SRS identity
    srs_identity = identity.to_identity()
    assert srs_identity.identity_id == "okta:user-123"
    assert srs_identity.tenant_id == "acme"
    print(f"  Converted to SRS identity: {srs_identity.identity_id} ✓")

    print("=" * 78)
    print("OIDC self-test PASSED.")
    print("=" * 78)


if __name__ == "__main__":
    self_test()
