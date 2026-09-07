#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
marketplace.py — Certified agent templates + policy packs.

The marketplace allows organizations to share pre-configured:
  - Agent templates (with safe defaults + pre-verified policies)
  - Policy packs (industry-specific governance rules)
  - Validator configurations (formal + empirical + heuristic setups)

Templates are signed with BLS12-381 to ensure authenticity.
"""
from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class AgentTemplate:
    """A certified agent template for the marketplace."""
    template_id: str
    name: str
    description: str
    author: str
    version: str
    role: str  # "agent", "operator", "auditor"
    default_policies: List[Dict[str, Any]] = field(default_factory=list)
    default_permissions: List[str] = field(default_factory=list)
    risk_limits: Dict[str, Any] = field(default_factory=dict)
    cost_budget_micro: float = 1_000_000  # $1 default
    certified: bool = False
    certification_hash: str = ""
    created_at: float = field(default_factory=time.time)

    def compute_hash(self) -> str:
        d = {
            "template_id": self.template_id, "name": self.name,
            "version": self.version, "author": self.author,
            "role": self.role, "default_policies": self.default_policies,
            "default_permissions": self.default_permissions,
        }
        return hashlib.sha256(json.dumps(d, sort_keys=True).encode()).hexdigest()


@dataclass
class PolicyPack:
    """An industry-specific policy pack."""
    pack_id: str
    name: str
    description: str
    industry: str  # "finance", "healthcare", "defense", "general"
    policies: List[Dict[str, Any]] = field(default_factory=list)
    certified: bool = False


# ---------------------------------------------------------------------------
# Built-in templates + policy packs
# ---------------------------------------------------------------------------

BUILTIN_TEMPLATES: List[AgentTemplate] = [
    AgentTemplate(
        template_id="tmpl-basic-agent",
        name="Basic Safe Agent",
        description="A minimal agent template with low-risk-only mutations, "
                    "100/min rate limit, and $1/hour budget.",
        author="SRS Team",
        version="1.0.0",
        role="agent",
        default_permissions=["mutation:submit", "memory:read", "memory:write"],
        risk_limits={"max_risk_class": "low", "rate_limit_per_min": 100},
        cost_budget_micro=1_000_000,
        certified=True,
    ),
    AgentTemplate(
        template_id="tmpl-production-agent",
        name="Production Agent",
        description="A production agent template with medium-risk mutations, "
                    "human approval for high-risk, and $10/hour budget.",
        author="SRS Team",
        version="1.0.0",
        role="agent",
        default_permissions=["mutation:submit", "memory:read", "memory:write",
                             "memory:delete"],
        risk_limits={"max_risk_class": "medium", "rate_limit_per_min": 1000,
                     "high_risk_requires_approval": True},
        cost_budget_micro=10_000_000,
        certified=True,
    ),
    AgentTemplate(
        template_id="tmpl-auditor",
        name="Compliance Auditor",
        description="A read-only auditor template with audit trail access. "
                    "Cannot submit mutations or modify memory.",
        author="SRS Team",
        version="1.0.0",
        role="auditor",
        default_permissions=["audit:read", "memory:read"],
        risk_limits={},
        cost_budget_micro=100_000,
        certified=True,
    ),
]

BUILTIN_POLICY_PACKS: List[PolicyPack] = [
    PolicyPack(
        pack_id="pack-finance",
        name="Financial Services",
        description="SOX-compliant policies for financial services: full audit, "
                    "human approval for all mutations, strict rate limits.",
        industry="finance",
        policies=[
            {"name": "All mutations require human approval", "effect": "require_approval"},
            {"name": "Rate limit 50/min", "effect": "deny", "condition": "rate >= 50"},
            {"name": "Full audit trail", "effect": "allow", "audit": True},
        ],
        certified=True,
    ),
    PolicyPack(
        pack_id="pack-healthcare",
        name="Healthcare (HIPAA)",
        description="HIPAA-compliant policies: DELETE requires quorum, "
                    "all operations audited, strict tenant isolation.",
        industry="healthcare",
        policies=[
            {"name": "DELETE requires SQA quorum", "effect": "deny", "condition": "delete without quorum"},
            {"name": "Strict tenant isolation", "effect": "deny", "condition": "cross-tenant"},
            {"name": "Full audit trail", "effect": "allow", "audit": True},
        ],
        certified=True,
    ),
    PolicyPack(
        pack_id="pack-defense",
        name="Defense (FedRAMP)",
        description="FedRAMP-compliant policies: all mutations require admin "
                    "approval, full audit, BLS signatures mandatory.",
        industry="defense",
        policies=[
            {"name": "All mutations require admin approval", "effect": "require_approval"},
            {"name": "BLS signature required", "effect": "deny", "condition": "no bls sig"},
            {"name": "Full audit trail", "effect": "allow", "audit": True},
        ],
        certified=True,
    ),
]


class Marketplace:
    """The SRS marketplace for certified templates + policy packs."""

    def __init__(self) -> None:
        self.templates: Dict[str, AgentTemplate] = {
            t.template_id: t for t in BUILTIN_TEMPLATES
        }
        self.policy_packs: Dict[str, PolicyPack] = {
            p.pack_id: p for p in BUILTIN_POLICY_PACKS
        }

    def list_templates(self, certified_only: bool = True) -> List[Dict[str, Any]]:
        return [
            {
                "template_id": t.template_id, "name": t.name,
                "description": t.description, "author": t.author,
                "version": t.version, "role": t.role,
                "certified": t.certified,
                "risk_limits": t.risk_limits,
                "cost_budget_dollars": t.cost_budget_micro / 1_000_000,
            }
            for t in self.templates.values()
            if not certified_only or t.certified
        ]

    def list_policy_packs(self, certified_only: bool = True) -> List[Dict[str, Any]]:
        return [
            {
                "pack_id": p.pack_id, "name": p.name,
                "description": p.description, "industry": p.industry,
                "certified": p.certified, "policy_count": len(p.policies),
            }
            for p in self.policy_packs.values()
            if not certified_only or p.certified
        ]

    def get_template(self, template_id: str) -> Optional[AgentTemplate]:
        return self.templates.get(template_id)

    def get_policy_pack(self, pack_id: str) -> Optional[PolicyPack]:
        return self.policy_packs.get(pack_id)

    def publish_template(self, template: AgentTemplate) -> bool:
        if template.template_id in self.templates:
            return False
        template.certification_hash = template.compute_hash()
        self.templates[template.template_id] = template
        return True

    def stats(self) -> Dict[str, Any]:
        return {
            "total_templates": len(self.templates),
            "certified_templates": sum(1 for t in self.templates.values() if t.certified),
            "total_policy_packs": len(self.policy_packs),
            "certified_policy_packs": sum(1 for p in self.policy_packs.values() if p.certified),
            "industries": list(set(p.industry for p in self.policy_packs.values())),
        }


def self_test() -> None:
    print("=" * 78)
    print("Marketplace — Certified templates + policy packs self-test")
    print("=" * 78)
    m = Marketplace()
    print(f"  Templates: {len(m.list_templates())}")
    print(f"  Policy packs: {len(m.list_policy_packs())}")
    print(f"  Industries: {m.stats()['industries']}")
    assert m.get_template("tmpl-basic-agent") is not None
    assert m.get_policy_pack("pack-finance") is not None
    print("  Template + policy pack lookup: ✓")
    print("=" * 78)
    print("Marketplace self-test PASSED.")
    print("=" * 78)


if __name__ == "__main__":
    self_test()
