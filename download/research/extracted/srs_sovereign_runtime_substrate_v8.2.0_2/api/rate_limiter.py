#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rate_limiter.py — Token-bucket rate limiter for DDoS protection.

Provides:
  - RateLimiter: per-identity, per-tenant rate limiting
  - RateLimitMiddleware: FastAPI middleware that enforces rate limits

Configurable limits:
  - Default: 100 requests/minute per API key
  - Tenant-level: 1000 requests/minute per tenant
  - Burst: up to 150 requests in a single burst

Returns 429 Too Many Requests when the limit is exceeded.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Dict, Optional, Tuple

from fastapi import Request, Response
from fastapi.responses import JSONResponse


@dataclass
class TokenBucket:
    """A token-bucket rate limiter."""
    capacity: float  # max tokens (burst size)
    refill_rate: float  # tokens per second
    tokens: float = 0.0
    last_refill: float = field(default_factory=time.time)

    def __post_init__(self) -> None:
        self.tokens = self.capacity

    def consume(self, tokens: float = 1.0) -> bool:
        """Try to consume tokens. Returns True if allowed, False if rate-limited."""
        now = time.time()
        elapsed = now - self.last_refill
        self.tokens = min(self.capacity, self.tokens + elapsed * self.refill_rate)
        self.last_refill = now
        if self.tokens >= tokens:
            self.tokens -= tokens
            return True
        return False


class RateLimiter:
    """Per-identity + per-tenant rate limiter."""

    def __init__(
        self,
        per_identity_rpm: int = 100,  # requests per minute
        per_tenant_rpm: int = 1000,
        burst_multiplier: float = 1.5,
    ) -> None:
        self.per_identity_rpm = per_identity_rpm
        self.per_tenant_rpm = per_tenant_rpm
        self.burst_multiplier = burst_multiplier
        self.identity_buckets: Dict[str, TokenBucket] = {}
        self.tenant_buckets: Dict[str, TokenBucket] = {}

    def _get_identity_bucket(self, identity_id: str) -> TokenBucket:
        if identity_id not in self.identity_buckets:
            capacity = self.per_identity_rpm * self.burst_multiplier
            refill = self.per_identity_rpm / 60.0
            self.identity_buckets[identity_id] = TokenBucket(capacity, refill)
        return self.identity_buckets[identity_id]

    def _get_tenant_bucket(self, tenant_id: str) -> TokenBucket:
        if tenant_id not in self.tenant_buckets:
            capacity = self.per_tenant_rpm * self.burst_multiplier
            refill = self.per_tenant_rpm / 60.0
            self.tenant_buckets[tenant_id] = TokenBucket(capacity, refill)
        return self.tenant_buckets[tenant_id]

    def check(self, identity_id: str, tenant_id: str) -> Tuple[bool, Optional[str]]:
        """Check if the request is within rate limits.

        Returns (allowed, reason). If allowed is False, reason explains why.
        """
        id_bucket = self._get_identity_bucket(identity_id)
        if not id_bucket.consume():
            return False, f"Rate limit exceeded for identity {identity_id}: {self.per_identity_rpm} rpm"

        tenant_bucket = self._get_tenant_bucket(tenant_id)
        if not tenant_bucket.consume():
            return False, f"Rate limit exceeded for tenant {tenant_id}: {self.per_tenant_rpm} rpm"

        return True, None

    def stats(self) -> Dict:
        return {
            "identity_buckets": len(self.identity_buckets),
            "tenant_buckets": len(self.tenant_buckets),
            "per_identity_rpm": self.per_identity_rpm,
            "per_tenant_rpm": self.per_tenant_rpm,
        }


# Singleton rate limiter
rate_limiter = RateLimiter()


async def rate_limit_middleware(request: Request, call_next):
    """FastAPI middleware that enforces rate limits.

    Skips /v1/health and /metrics (no auth needed).
    """
    # Skip rate-limited paths
    if request.url.path in ("/v1/health", "/metrics", "/docs", "/openapi.json"):
        return await call_next(request)

    # Get auth context from the request (set by auth middleware)
    auth_ctx = getattr(request.state, "auth_ctx", None)
    if auth_ctx is None:
        # No auth → skip rate limiting (will be rejected by auth)
        return await call_next(request)

    allowed, reason = rate_limiter.check(
        auth_ctx.identity.identity_id,
        auth_ctx.identity.tenant_id,
    )
    if not allowed:
        return JSONResponse(
            status_code=429,
            content={"detail": reason, "type": "rate_limit_exceeded"},
            headers={"Retry-After": "60"},
        )

    return await call_next(request)


def self_test() -> None:
    print("=" * 78)
    print("Rate Limiter — DDoS protection self-test")
    print("=" * 78)

    rl = RateLimiter(per_identity_rpm=10, per_tenant_rpm=10000)

    # rpm=10, burst=1.5x → capacity=15 → 15 requests allowed, 16th denied
    for i in range(15):
        allowed, _ = rl.check("agent-001", "acme")
        assert allowed, f"Request {i} should be allowed"

    # 16th should fail
    allowed, reason = rl.check("agent-001", "acme")
    assert not allowed
    print(f"  15 requests allowed, 16th denied: ✓")
    print(f"  Reason: {reason[:60] if reason else 'rate limit'}...")  # type: ignore[union-attr]

    print("=" * 78)
    print("Rate Limiter self-test PASSED.")
    print("=" * 78)


if __name__ == "__main__":
    self_test()
