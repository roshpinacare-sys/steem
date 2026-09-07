#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
cloud.py — SRS Cloud managed offering (SaaS) configuration + billing tiers.

Provides:
  - CloudTier: pricing tiers (free, pro, enterprise)
  - CloudConfig: SaaS configuration per tenant
  - CloudManager: manages cloud tenants, billing, usage limits

This defines the commercial strategy for SRS-as-a-Service.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class CloudTier(str, Enum):
    FREE = "free"
    PRO = "pro"
    ENTERPRISE = "enterprise"


TIER_LIMITS: Dict[CloudTier, Dict[str, Any]] = {
    CloudTier.FREE: {
        "name": "Free",
        "price_monthly": 0,
        "max_agents": 1,
        "max_mutations_per_day": 100,
        "max_tenants": 1,
        "max_storage_mb": 100,
        "support": "community",
        "features": ["basic_policy", "audit_trail", "rest_api"],
    },
    CloudTier.PRO: {
        "name": "Professional",
        "price_monthly": 499,
        "max_agents": 50,
        "max_mutations_per_day": 10000,
        "max_tenants": 5,
        "max_storage_mb": 10000,
        "support": "email",
        "features": ["basic_policy", "audit_trail", "rest_api", "grpc_api",
                      "prometheus", "compliance_reports", "marketplace"],
    },
    CloudTier.ENTERPRISE: {
        "name": "Enterprise",
        "price_monthly": 4999,
        "max_agents": -1,  # unlimited
        "max_mutations_per_day": -1,
        "max_tenants": -1,
        "max_storage_mb": -1,
        "support": "24/7 + dedicated",
        "features": ["basic_policy", "audit_trail", "rest_api", "grpc_api",
                      "prometheus", "compliance_reports", "marketplace",
                      "oidc", "replication", "sandboxing", "tracing",
                      "custom_policies", "on_premise", "sla_99_99"],
    },
}


@dataclass
class CloudTenant:
    """A cloud tenant with billing + usage tracking."""
    tenant_id: str
    tier: CloudTier
    created_at: float = field(default_factory=time.time)
    billing_email: str = ""
    mutations_today: int = 0
    mutations_date: str = ""  # YYYY-MM-DD for daily reset
    storage_used_mb: float = 0.0
    agents_count: int = 0
    subscription_active: bool = True
    trial_ends_at: float = 0.0  # 0 = no trial

    @property
    def limits(self) -> Dict[str, Any]:
        return TIER_LIMITS[self.tier]

    def can_add_agent(self) -> bool:
        limit: Any = self.limits["max_agents"]
        # limit already set above
        return bool(limit == -1 or self.agents_count < limit)

    def can_submit_mutation(self) -> bool:
        limit = self.limits["max_mutations_per_day"]
        if limit == -1:
            return True
        # Reset daily counter
        today = time.strftime("%Y-%m-%d")
        if self.mutations_date != today:
            self.mutations_today = 0
            self.mutations_date = today
        return bool(self.mutations_today < limit)

    def record_mutation(self) -> None:
        today = time.strftime("%Y-%m-%d")
        if self.mutations_date != today:
            self.mutations_today = 0
            self.mutations_date = today
        self.mutations_today += 1

    def monthly_cost(self) -> int:
        return int(self.limits["price_monthly"])

    def to_dict(self) -> Dict[str, Any]:
        return {
            "tenant_id": self.tenant_id, "tier": self.tier.value,
            "tier_name": self.limits["name"],
            "monthly_cost": self.monthly_cost(),
            "mutations_today": self.mutations_today,
            "max_mutations": self.limits["max_mutations_per_day"],
            "agents": self.agents_count,
            "max_agents": self.limits["max_agents"],
            "features": self.limits["features"],
            "subscription_active": self.subscription_active,
        }


class CloudManager:
    """Manages cloud tenants + billing."""

    def __init__(self) -> None:
        self.tenants: Dict[str, CloudTenant] = {}

    def create_tenant(self, tenant_id: str, tier: CloudTier = CloudTier.FREE,
                      billing_email: str = "", trial_days: int = 0) -> CloudTenant:
        tenant = CloudTenant(
            tenant_id=tenant_id, tier=tier, billing_email=billing_email,
            trial_ends_at=time.time() + trial_days * 86400 if trial_days > 0 else 0,
        )
        self.tenants[tenant_id] = tenant
        return tenant

    def upgrade_tenant(self, tenant_id: str, tier: CloudTier) -> bool:
        t = self.tenants.get(tenant_id)
        if t is None:
            return False
        t.tier = tier  # type: ignore[assignment]
        return True
        return True

    def get_tenant(self, tenant_id: str) -> Optional[CloudTenant]:
        return self.tenants.get(tenant_id)

    def monthly_revenue(self) -> int:
        return sum(t.monthly_cost() for t in self.tenants.values()
                   if t.subscription_active)

    def list_tiers(self) -> List[Dict[str, Any]]:
        return [
            {
                "tier": tier.value, "name": data["name"],
                "price_monthly": data["price_monthly"],
                "max_agents": data["max_agents"],
                "max_mutations_per_day": data["max_mutations_per_day"],
                "features": data["features"],
            }
            for tier, data in TIER_LIMITS.items()
        ]

    def stats(self) -> Dict[str, Any]:
        return {
            "total_tenants": len(self.tenants),
            "active_subscriptions": sum(1 for t in self.tenants.values()
                                       if t.subscription_active),
            "monthly_revenue": self.monthly_revenue(),
            "by_tier": {
                tier.value: sum(1 for t in self.tenants.values() if t.tier == tier)
                for tier in CloudTier
            },
        }


def self_test() -> None:
    print("=" * 78)
    print("SRS Cloud — Managed offering + billing self-test")
    print("=" * 78)

    mgr = CloudManager()

    # Create tenants at different tiers
    free = mgr.create_tenant("startup-co", CloudTier.FREE)
    pro = mgr.create_tenant("scaleup-co", CloudTier.PRO, "billing@scaleup.com")
    ent = mgr.create_tenant("enterprise-co", CloudTier.ENTERPRISE, "finance@enterprise.com")

    print(f"  Free: ${free.monthly_cost()}/mo, {free.limits['max_agents']} agents")
    print(f"  Pro: ${pro.monthly_cost()}/mo, {pro.limits['max_agents']} agents")
    print(f"  Enterprise: ${ent.monthly_cost()}/mo, {ent.limits['max_agents']} agents")

    # Revenue
    assert mgr.monthly_revenue() == 0 + 499 + 4999
    print(f"  Monthly revenue: ${mgr.monthly_revenue()} ✓")

    # Tier limits
    assert free.can_add_agent()
    assert free.can_submit_mutation()
    for _ in range(100):
        free.record_mutation()
    assert not free.can_submit_mutation()  # free tier limit
    print("  Free tier: 100 mutations/day limit enforced ✓")

    # Upgrade
    assert mgr.upgrade_tenant("startup-co", CloudTier.PRO)
    t = mgr.get_tenant("startup-co")
    assert t is not None
    assert t.tier == CloudTier.PRO
    print("  Upgrade: Free → Pro ✓")

    print("=" * 78)
    print("SRS Cloud self-test PASSED.")
    print("=" * 78)


if __name__ == "__main__":
    self_test()
