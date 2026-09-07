#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
webhooks.py — Webhook notifications for SRS events.

Sends HTTP POST notifications to registered webhook URLs when:
  - Policy violations occur (mutation denied)
  - Budget exhaustion (cost budget reached)
  - Rate limit exceeded
  - Audit chain tampering detected
  - High-risk mutation submitted
  - Sandbox killed

Enterprises register webhook URLs via the API, and SRS pushes real-time
notifications to their incident response systems (PagerDuty, Slack, etc.).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
import urllib.request
import urllib.error
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class WebhookEvent(str, Enum):
    POLICY_VIOLATION = "policy.violation"
    BUDGET_EXHAUSTED = "budget.exhausted"
    RATE_LIMITED = "rate_limited"
    AUDIT_TAMPERED = "audit.tampered"
    HIGH_RISK_MUTATION = "mutation.high_risk"
    SANDBOX_KILLED = "sandbox.killed"
    MUTATION_ADMITTED = "mutation.admitted"
    MUTATION_REJECTED = "mutation.rejected"


@dataclass
class WebhookSubscription:
    """A registered webhook subscription."""
    sub_id: str
    url: str
    events: List[WebhookEvent]
    secret: str = ""  # for HMAC signature verification
    tenant_id: str = ""
    active: bool = True
    created_at: float = field(default_factory=time.time)
    delivery_count: int = 0
    failure_count: int = 0
    last_delivery: float = 0.0
    last_status: int = 0


class WebhookManager:
    """Manages webhook subscriptions + delivers notifications."""

    def __init__(self) -> None:
        self.subscriptions: Dict[str, WebhookSubscription] = {}

    def subscribe(self, sub_id: str, url: str,
                  events: List[WebhookEvent],
                  secret: str = "",
                  tenant_id: str = "") -> WebhookSubscription:
        """Register a new webhook subscription."""
        import secrets as _secrets
        sub = WebhookSubscription(
            sub_id=sub_id, url=url, events=events,
            secret=secret or _secrets.token_hex(16),
            tenant_id=tenant_id,
        )
        self.subscriptions[sub_id] = sub
        return sub

    def unsubscribe(self, sub_id: str) -> bool:
        if sub_id in self.subscriptions:
            self.subscriptions[sub_id].active = False
            return True
        return False

    def delete_subscription(self, sub_id: str) -> bool:
        if sub_id in self.subscriptions:
            del self.subscriptions[sub_id]
            return True
        return False

    def notify(self, event: WebhookEvent, payload: Dict[str, Any],
               tenant_id: str = "") -> List[Dict[str, Any]]:
        """Send a webhook notification to all matching subscribers.

        Returns a list of delivery results.
        """
        results = []
        for sub in self.subscriptions.values():
            if not sub.active:
                continue
            if event not in sub.events:
                continue
            if sub.tenant_id and tenant_id and sub.tenant_id != tenant_id:
                continue

            result = self._deliver(sub, event, payload)
            results.append(result)
        return results

    def _deliver(self, sub: WebhookSubscription,
                 event: WebhookEvent,
                 payload: Dict[str, Any]) -> Dict[str, Any]:
        """Deliver a single webhook notification."""
        body = json.dumps({
            "event": event.value,
            "timestamp": time.time(),
            "tenant_id": sub.tenant_id,
            "payload": payload,
        }).encode()

        headers = {
            "Content-Type": "application/json",
            "X-SRS-Event": event.value,
            "X-SRS-Webhook-ID": sub.sub_id,
        }

        # HMAC signature for verification
        if sub.secret:
            signature = hmac.new(
                sub.secret.encode(), body, hashlib.sha256
            ).hexdigest()
            headers["X-SRS-Signature"] = signature

        try:
            req = urllib.request.Request(sub.url, data=body,
                                         headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=10) as resp:
                sub.delivery_count += 1
                sub.last_delivery = time.time()
                sub.last_status = resp.status
                return {
                    "sub_id": sub.sub_id, "event": event.value,
                    "status": resp.status, "success": True,
                }
        except Exception as e:
            sub.failure_count += 1
            sub.last_delivery = time.time()
            sub.last_status = 0
            return {
                "sub_id": sub.sub_id, "event": event.value,
                "status": 0, "success": False, "error": str(e),
            }

    def list_subscriptions(self, tenant_id: str = "") -> List[Dict[str, Any]]:
        return [
            {
                "sub_id": s.sub_id, "url": s.url,
                "events": [e.value for e in s.events],
                "active": s.active, "tenant_id": s.tenant_id,
                "delivery_count": s.delivery_count,
                "failure_count": s.failure_count,
            }
            for s in self.subscriptions.values()
            if not tenant_id or s.tenant_id == tenant_id
        ]

    def stats(self) -> Dict[str, Any]:
        return {
            "total_subscriptions": len(self.subscriptions),
            "active": sum(1 for s in self.subscriptions.values() if s.active),
            "total_deliveries": sum(s.delivery_count for s in self.subscriptions.values()),
            "total_failures": sum(s.failure_count for s in self.subscriptions.values()),
        }


# Singleton webhook manager
webhook_manager = WebhookManager()


def self_test() -> None:
    print("=" * 78)
    print("Webhooks — Event notification self-test")
    print("=" * 78)

    mgr = WebhookManager()
    sub = mgr.subscribe("sub-1", "http://localhost:9999/webhook",
                        [WebhookEvent.POLICY_VIOLATION, WebhookEvent.BUDGET_EXHAUSTED],
                        tenant_id="acme")
    print(f"  Subscribed: {sub.sub_id} for {len(sub.events)} events")

    # Notify (will fail to deliver but won't crash)
    results = mgr.notify(
        WebhookEvent.POLICY_VIOLATION,
        {"mutation_id": "mut-001", "reason": "cross-tenant denied"},
        tenant_id="acme",
    )
    assert len(results) == 1
    assert not results[0]["success"]  # expected: no server at :9999
    print(f"  Delivery attempted (failed as expected): ✓")

    # Unsubscribe
    assert mgr.unsubscribe("sub-1")
    assert not mgr.subscriptions["sub-1"].active
    print("  Unsubscribed: ✓")

    print("=" * 78)
    print("Webhooks self-test PASSED.")
    print("=" * 78)


if __name__ == "__main__":
    self_test()
