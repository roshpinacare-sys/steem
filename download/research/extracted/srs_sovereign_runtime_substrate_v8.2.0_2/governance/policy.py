#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
policy.py — Policy engine for SRS governance.

Provides:
  - Policy: a declarative rule (condition → effect)
  - PolicyEngine: evaluates policies against requests
  - PolicySet: a collection of policies with priority

Policies can express:
  - "Agents in tenant X cannot mutate resources in tenant Y"
  - "High-risk mutations require human approval"
  - "Rate limit: max 100 mutations per minute per agent"
  - "Memory DELETE requires SQA quorum + audit trail"

The policy engine is the single decision point for all governance
questions. Every SEG, SQA, and Adm decision can be overridden by policy.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Set


class Effect(str, Enum):
    ALLOW = "allow"
    DENY = "deny"
    REQUIRE_APPROVAL = "require_approval"


@dataclass
class Policy:
    """A declarative governance policy."""
    policy_id: str
    name: str
    description: str
    effect: Effect
    priority: int = 100  # lower = higher priority
    condition: Optional[Callable[[Dict[str, Any]], bool]] = None
    enabled: bool = True
    created_at: float = field(default_factory=time.time)

    def evaluate(self, context: Dict[str, Any]) -> Optional[Effect]:
        """Evaluate this policy against the request context.

        Returns the Effect if the condition matches, None otherwise.
        """
        if not self.enabled:
            return None
        if self.condition is None or self.condition(context):
            return self.effect  # type: ignore[no-any-return]  # type: ignore[no-any-return]
        # already returns Effect enum
        return None


class PolicyEngine:
    """Evaluates a set of policies against a request.

    Policies are evaluated in priority order (lowest priority number first).
    The first matching policy's effect wins. If no policy matches, the
    default effect is ALLOW (open by default — can be changed).
    """

    def __init__(self, default_effect: Effect = Effect.ALLOW) -> None:
        self.policies: List[Policy] = []
        self.default_effect = default_effect

    def add_policy(self, policy: Policy) -> None:
        self.policies.append(policy)
        self.policies.sort(key=lambda p: p.priority)

    def remove_policy(self, policy_id: str) -> bool:
        before = len(self.policies)
        self.policies = [p for p in self.policies if p.policy_id != policy_id]
        return len(self.policies) < before

    def evaluate(self, context: Dict[str, Any]) -> Effect:
        """Evaluate all policies against the context.

        Returns the effect of the first matching policy, or the default.
        """
        for policy in self.policies:
            effect = policy.evaluate(context)
            if effect is not None:
                return effect
        return self.default_effect

    def list_policies(self) -> List[Dict[str, Any]]:
        return [
            {
                "policy_id": p.policy_id, "name": p.name,
                "effect": p.effect.value, "priority": p.priority,
                "enabled": p.enabled,
            }
            for p in self.policies
        ]


# ---------------------------------------------------------------------------
# Built-in policies
# ---------------------------------------------------------------------------

def _tenant_isolation(ctx: Dict[str, Any]) -> bool:
    """Deny cross-tenant access."""
    return (ctx.get("resource_tenant") != ctx.get("request_tenant")
            and ctx.get("resource_tenant") is not None)


def _high_risk_requires_human(ctx: Dict[str, Any]) -> bool:
    """High-risk mutations require human approval."""
    return ctx.get("risk_class") == "high" or ctx.get("risk_class") == "critical"


def _rate_limit_100_per_min(ctx: Dict[str, Any]) -> bool:
    """Rate limit: max 100 mutations per minute per agent."""
    count: int = ctx.get("mutations_last_minute", 0)  # type: ignore[assignment]
    return count >= 100


def _delete_requires_quorum(ctx: Dict[str, Any]) -> bool:
    """Memory DELETE requires SQA quorum."""
    return (ctx.get("action") == "memory:delete"
            and not ctx.get("sqa_certified", False))


def default_policy_set() -> PolicyEngine:
    """Return a PolicyEngine with the default enterprise policy set."""
    engine = PolicyEngine(default_effect=Effect.ALLOW)

    # Priority 10: tenant isolation (highest priority — deny cross-tenant)
    engine.add_policy(Policy(
        policy_id="tenant-isolation",
        name="Tenant Isolation",
        description="Deny cross-tenant access to resources",
        effect=Effect.DENY,
        priority=10,
        condition=_tenant_isolation,
    ))

    # Priority 20: high-risk requires human approval
    engine.add_policy(Policy(
        policy_id="high-risk-human-approval",
        name="High-Risk Human Approval",
        description="High-risk mutations require human operator approval",
        effect=Effect.REQUIRE_APPROVAL,
        priority=20,
        condition=_high_risk_requires_human,
    ))

    # Priority 30: rate limiting
    engine.add_policy(Policy(
        policy_id="rate-limit-100",
        name="Rate Limit 100/min",
        description="Max 100 mutations per minute per agent",
        effect=Effect.DENY,
        priority=30,
        condition=_rate_limit_100_per_min,
    ))

    # Priority 40: DELETE requires quorum
    engine.add_policy(Policy(
        policy_id="delete-requires-quorum",
        name="DELETE Requires Quorum",
        description="Memory DELETE requires SQA quorum certification",
        effect=Effect.DENY,
        priority=40,
        condition=_delete_requires_quorum,
    ))

    return engine


def self_test() -> None:
    print("=" * 78)
    print("Policy Engine — Governance policy self-test")
    print("=" * 78)

    engine = default_policy_set()
    print(f"  Policies loaded: {len(engine.policies)}")

    # Test 1: same-tenant access → ALLOW
    ctx1 = {"request_tenant": "acme", "resource_tenant": "acme",
            "action": "mutation:submit", "risk_class": "low"}
    assert engine.evaluate(ctx1) == Effect.ALLOW
    print("  Same-tenant low-risk mutation: ALLOW ✓")

    # Test 2: cross-tenant → DENY
    ctx2 = {"request_tenant": "acme", "resource_tenant": "other",
            "action": "mutation:submit", "risk_class": "low"}
    assert engine.evaluate(ctx2) == Effect.DENY
    print("  Cross-tenant access: DENY ✓")

    # Test 3: high-risk → REQUIRE_APPROVAL
    ctx3 = {"request_tenant": "acme", "resource_tenant": "acme",
            "action": "mutation:submit", "risk_class": "high"}
    assert engine.evaluate(ctx3) == Effect.REQUIRE_APPROVAL
    print("  High-risk mutation: REQUIRE_APPROVAL ✓")

    # Test 4: DELETE without quorum → DENY
    ctx4 = {"request_tenant": "acme", "resource_tenant": "acme",
            "action": "memory:delete", "sqa_certified": False}
    assert engine.evaluate(ctx4) == Effect.DENY
    print("  DELETE without quorum: DENY ✓")

    # Test 5: rate limit
    ctx5 = {"request_tenant": "acme", "resource_tenant": "acme",
            "action": "mutation:submit", "mutations_last_minute": 100}
    assert engine.evaluate(ctx5) == Effect.DENY
    print("  Rate limit (100/min): DENY ✓")

    print("=" * 78)
    print("Policy Engine self-test PASSED.")
    print("=" * 78)


if __name__ == "__main__":
    self_test()  # pragma: no cover
