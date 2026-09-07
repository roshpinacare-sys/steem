#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
partner_program.py — System integrator certification + partner track.

Provides:
  - PartnerTier: partner levels (registered, silver, gold, platinum)
  - Partner: a certified system integrator
  - PartnerProgram: manages partner registration + certification

Partners are system integrators who deploy SRS for enterprises.
Certified partners get:
  - Co-marketing rights
  - Priority support
  - Training materials
  - Revenue share
  - Marketplace listing
"""
from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class PartnerTier(str, Enum):
    REGISTERED = "registered"
    SILVER = "silver"
    GOLD = "gold"
    PLATINUM = "platinum"


PARTNER_BENEFITS: Dict[PartnerTier, Dict[str, Any]] = {
    PartnerTier.REGISTERED: {
        "name": "Registered Partner",
        "revenue_share_pct": 0,
        "support_level": "community",
        "training_hours": 0,
        "co_marketing": False,
        "priority_support": False,
        "marketplace_listing": False,
    },
    PartnerTier.SILVER: {
        "name": "Silver Partner",
        "revenue_share_pct": 10,
        "support_level": "email",
        "training_hours": 8,
        "co_marketing": True,
        "priority_support": False,
        "marketplace_listing": True,
    },
    PartnerTier.GOLD: {
        "name": "Gold Partner",
        "revenue_share_pct": 20,
        "support_level": "priority",
        "training_hours": 24,
        "co_marketing": True,
        "priority_support": True,
        "marketplace_listing": True,
    },
    PartnerTier.PLATINUM: {
        "name": "Platinum Partner",
        "revenue_share_pct": 30,
        "support_level": "dedicated",
        "training_hours": 40,
        "co_marketing": True,
        "priority_support": True,
        "marketplace_listing": True,
    },
}


@dataclass
class Partner:
    """A certified SRS system integrator partner."""
    partner_id: str
    name: str
    tier: PartnerTier = PartnerTier.REGISTERED
    contact_email: str = ""
    website: str = ""
    region: str = ""
    certified_engineers: int = 0
    deployments: int = 0
    annual_revenue: float = 0.0
    joined_at: float = field(default_factory=time.time)
    certified_at: float = 0.0
    active: bool = True

    @property
    def benefits(self) -> Dict[str, Any]:
        return PARTNER_BENEFITS[self.tier]

    @property
    def revenue_share(self) -> float:
        share_pct = self.benefits["revenue_share_pct"]
        return float(self.annual_revenue * share_pct / 100)


class PartnerProgram:
    """Manages the SRS partner program."""

    def __init__(self) -> None:
        self.partners: Dict[str, Partner] = {}

    def register(self, partner_id: str, name: str,
                 contact_email: str = "", website: str = "",
                 region: str = "") -> Partner:
        """Register a new partner."""
        partner = Partner(
            partner_id=partner_id, name=name,
            contact_email=contact_email, website=website, region=region,
            tier=PartnerTier.REGISTERED,
        )
        self.partners[partner_id] = partner
        return partner

    def upgrade(self, partner_id: str, tier: PartnerTier) -> bool:
        """Upgrade a partner to a higher tier."""
        p = self.partners.get(partner_id)
        if p is None:
            return False
        p.tier = tier
        p.certified_at = time.time()
        return True

    def record_deployment(self, partner_id: str, revenue: float = 0) -> bool:
        """Record a deployment by a partner."""
        p = self.partners.get(partner_id)
        if p is None:
            return False
        p.deployments += 1
        p.annual_revenue += revenue
        return True

    def get_partner(self, partner_id: str) -> Optional[Partner]:
        return self.partners.get(partner_id)

    def list_partners(self, tier: Optional[PartnerTier] = None) -> List[Dict[str, Any]]:
        return [
            {
                "partner_id": p.partner_id, "name": p.name,
                "tier": p.tier.value, "tier_name": p.benefits["name"],
                "region": p.region, "deployments": p.deployments,
                "certified_engineers": p.certified_engineers,
                "revenue_share_pct": p.benefits["revenue_share_pct"],
            }
            for p in self.partners.values()
            if p.active and (tier is None or p.tier == tier)
        ]

    def total_revenue_share(self) -> float:
        """Total revenue share owed to all partners."""
        return sum(p.revenue_share for p in self.partners.values() if p.active)

    def stats(self) -> Dict[str, Any]:
        return {
            "total_partners": len(self.partners),
            "active": sum(1 for p in self.partners.values() if p.active),
            "by_tier": {
                t.value: sum(1 for p in self.partners.values() if p.tier == t)
                for t in PartnerTier
            },
            "total_deployments": sum(p.deployments for p in self.partners.values()),
            "total_revenue_share": self.total_revenue_share(),
        }

    def list_tiers(self) -> List[Dict[str, Any]]:
        return [
            {
                "tier": t.value, "name": b["name"],
                "revenue_share_pct": b["revenue_share_pct"],
                "support_level": b["support_level"],
                "training_hours": b["training_hours"],
                "co_marketing": b["co_marketing"],
                "priority_support": b["priority_support"],
            }
            for t, b in PARTNER_BENEFITS.items()
        ]


def self_test() -> None:
    print("=" * 78)
    print("Partner Program — System integrator certification self-test")
    print("=" * 78)

    prog = PartnerProgram()

    # Register partners
    p1 = prog.register("p-001", "Acme Integrators", "info@acme.com",
                        "https://acme.com", "North America")
    p2 = prog.register("p-002", "TechDeploy Co", "contact@techdeploy.com",
                        "https://techdeploy.com", "Europe")
    print(f"  Registered: {p1.name} ({p1.tier.value}), {p2.name} ({p2.tier.value})")

    # Upgrade
    assert prog.upgrade("p-001", PartnerTier.GOLD)
    assert prog.partners["p-001"].tier == PartnerTier.GOLD
    print(f"  Upgraded Acme to Gold: {prog.partners['p-001'].benefits['name']}")

    # Record deployments
    prog.record_deployment("p-001", revenue=100_000)
    prog.record_deployment("p-002", revenue=50_000)
    share = prog.total_revenue_share()
    # Gold = 20% of $100K = $20K
    assert share == 20_000
    print(f"  Revenue share: ${share:,.0f} ✓")

    # Stats
    stats = prog.stats()
    print(f"  Stats: {stats['total_partners']} partners, {stats['total_deployments']} deployments")

    # List tiers
    tiers = prog.list_tiers()
    assert len(tiers) == 4
    print(f"  Tiers: {len(tiers)} levels (Registered → Platinum)")

    print("=" * 78)
    print("Partner Program self-test PASSED.")
    print("=" * 78)


if __name__ == "__main__":
    self_test()
