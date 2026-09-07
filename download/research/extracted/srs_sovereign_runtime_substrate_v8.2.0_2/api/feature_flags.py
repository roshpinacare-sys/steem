#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
feature_flags.py — Runtime feature toggles for gradual rollout.

Provides:
  - FeatureFlag: a named toggle with enabled/disabled state
  - FeatureFlagManager: manages flags + per-tenant overrides

Enables gradual rollout of new features:
  - Global on/off
  - Per-tenant enable/disable
  - Percentage rollout (e.g., 10% of tenants)
  - Environment-based (dev/staging/prod)
"""
from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class FeatureFlag:
    """A runtime feature toggle."""
    flag_id: str
    name: str
    description: str
    enabled: bool = False
    rollout_pct: float = 0.0  # 0-100, percentage of tenants
    environment: str = "all"  # "dev", "staging", "prod", "all"
    tenant_overrides: Dict[str, bool] = field(default_factory=dict)  # tenant_id → enabled
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def is_enabled_for(self, tenant_id: str = "",
                       environment: str = "prod") -> bool:
        """Check if this flag is enabled for a specific tenant + environment."""
        # Check environment
        if self.environment != "all" and self.environment != environment:
            return False
        # Check tenant override
        if tenant_id in self.tenant_overrides:
            return self.tenant_overrides[tenant_id]
        # Check global
        if self.enabled:
            return True
        # Check percentage rollout
        if self.rollout_pct > 0 and tenant_id:
            hash_val = int(hashlib.sha256(tenant_id.encode()).hexdigest(), 16)
            return (hash_val % 100) < self.rollout_pct
        return False


class FeatureFlagManager:
    """Manages feature flags."""

    def __init__(self) -> None:
        self.flags: Dict[str, FeatureFlag] = {}

    def register(self, flag_id: str, name: str, description: str,
                 enabled: bool = False, rollout_pct: float = 0.0,
                 environment: str = "all") -> FeatureFlag:
        flag = FeatureFlag(
            flag_id=flag_id, name=name, description=description,
            enabled=enabled, rollout_pct=rollout_pct, environment=environment,
        )
        self.flags[flag_id] = flag
        return flag

    def enable(self, flag_id: str) -> bool:
        f = self.flags.get(flag_id)
        if f is None:
            return False
        f.enabled = True
        f.updated_at = time.time()
        return True

    def disable(self, flag_id: str) -> bool:
        f = self.flags.get(flag_id)
        if f is None:
            return False
        f.enabled = False
        f.updated_at = time.time()
        return True

    def set_rollout(self, flag_id: str, pct: float) -> bool:
        f = self.flags.get(flag_id)
        if f is None:
            return False
        f.rollout_pct = max(0.0, min(100.0, pct))
        f.updated_at = time.time()
        return True

    def override_tenant(self, flag_id: str, tenant_id: str,
                        enabled: bool) -> bool:
        f = self.flags.get(flag_id)
        if f is None:
            return False
        f.tenant_overrides[tenant_id] = enabled
        f.updated_at = time.time()
        return True

    def is_enabled(self, flag_id: str, tenant_id: str = "",
                   environment: str = "prod") -> bool:
        f = self.flags.get(flag_id)
        if f is None:
            return False
        return f.is_enabled_for(tenant_id, environment)

    def list_flags(self) -> List[Dict[str, Any]]:
        return [
            {"flag_id": f.flag_id, "name": f.name, "enabled": f.enabled,
             "rollout_pct": f.rollout_pct, "environment": f.environment,
             "overrides": len(f.tenant_overrides)}
            for f in self.flags.values()
        ]

    def stats(self) -> Dict[str, Any]:
        return {
            "total_flags": len(self.flags),
            "enabled": sum(1 for f in self.flags.values() if f.enabled),
            "disabled": sum(1 for f in self.flags.values() if not f.enabled),
            "with_rollout": sum(1 for f in self.flags.values() if f.rollout_pct > 0),
        }


# Built-in SRS feature flags
def default_flags() -> FeatureFlagManager:
    """Return the default SRS feature flag set."""
    mgr = FeatureFlagManager()
    mgr.register("grpc-api", "gRPC API", "High-performance gRPC endpoint",
                 enabled=True, environment="all")
    mgr.register("websocket-events", "WebSocket Events", "Real-time audit streaming",
                 enabled=True, environment="all")
    mgr.register("sandbox", "Agent Sandboxing", "Resource-limited agent execution",
                 enabled=False, rollout_pct=10.0, environment="prod")
    mgr.register("oidc", "OIDC Integration", "External identity provider support",
                 enabled=True, environment="all")
    mgr.register("marketplace", "Marketplace", "Certified agent templates",
                 enabled=True, environment="all")
    mgr.register("compliance-reports", "Compliance Reports", "SOX/HIPAA/FedRAMP reports",
                 enabled=True, environment="all")
    mgr.register("partner-program", "Partner Program", "System integrator track",
                 enabled=False, rollout_pct=0.0, environment="prod")
    mgr.register("community-bounties", "Community Bounties", "Open-source bounty system",
                 enabled=False, environment="dev")
    return mgr


def self_test() -> None:
    print("=" * 78)
    print("Feature Flags — Runtime toggles self-test")
    print("=" * 78)
    mgr = default_flags()
    assert mgr.is_enabled("grpc-api")
    assert not mgr.is_enabled("sandbox")  # 10% rollout, may or may not be enabled
    assert mgr.is_enabled("grpc-api", tenant_id="acme")
    mgr.override_tenant("sandbox", "acme", True)
    assert mgr.is_enabled("sandbox", tenant_id="acme")
    print("  Tenant override: sandbox enabled for acme ✓")
    mgr.set_rollout("sandbox", 100.0)
    assert mgr.is_enabled("sandbox", tenant_id="anyone")
    print("  100% rollout: sandbox enabled for all ✓")
    stats = mgr.stats()
    print(f"  Stats: {stats['total_flags']} flags, {stats['enabled']} enabled")
    print("=" * 78)
    print("Feature Flags self-test PASSED.")
    print("=" * 78)


if __name__ == "__main__":
    self_test()
