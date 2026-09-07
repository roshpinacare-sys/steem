#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
audit.py — Tamper-evident audit trail for every SRS operation.

Provides:
  - AuditEvent: a single auditable action
  - AuditChain: append-only hash chain (like a blockchain)
  - AuditTrail: the full audit trail with verification

Every mutation, memory operation, governance decision, and identity
action is recorded in the audit trail. The chain is tamper-evident:
any modification to a past event breaks the hash chain.

This satisfies compliance requirements for:
  - SOX (financial audit trails)
  - HIPAA (access logs)
  - FedRAMP (change management)
  - ISO 27001 (event logging)
"""
from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional


@dataclass
class AuditEvent:
    """A single auditable event in the SRS."""
    event_id: str
    timestamp: float
    tenant_id: str
    identity_id: str
    action: str          # e.g. "mutation:submit", "memory:delete", "seg:admit"
    resource: str        # e.g. "mutation-mut-001", "memory-rec-abc"
    outcome: str         # "success", "denied", "error"
    prev_hash: str       # hash of the previous event (chain)
    event_hash: str      # hash of this event (computed)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def compute_hash(self) -> str:
        """Compute the SHA-256 hash of this event (excluding event_hash)."""
        d = asdict(self)
        d.pop("event_hash", None)
        canonical = json.dumps(d, sort_keys=True, default=str)
        return hashlib.sha256(canonical.encode()).hexdigest()


class AuditChain:
    """Append-only, tamper-evident audit trail.

    Each event's hash includes the previous event's hash, forming a chain.
    Modifying any past event invalidates all subsequent hashes.
    """

    def __init__(self) -> None:
        self.events: List[AuditEvent] = []
        self._genesis_hash = "0" * 64  # SHA-256 of nothing

    def append(self, tenant_id: str, identity_id: str, action: str,
               resource: str, outcome: str = "success",
               metadata: Optional[Dict[str, Any]] = None) -> AuditEvent:
        """Append a new audit event to the chain."""
        import secrets

        prev_hash = self.events[-1].event_hash if self.events else self._genesis_hash
        event = AuditEvent(
            event_id=secrets.token_hex(8),
            timestamp=time.time(),
            tenant_id=tenant_id,
            identity_id=identity_id,
            action=action,
            resource=resource,
            outcome=outcome,
            prev_hash=prev_hash,
            event_hash="",  # computed below
            metadata=metadata or {},
        )
        event.event_hash = event.compute_hash()
        self.events.append(event)
        return event

    def verify(self) -> bool:
        """Verify the integrity of the entire chain.

        Returns True if every event's hash is correct and every prev_hash
        matches the previous event's hash.
        """
        prev_hash = self._genesis_hash
        for event in self.events:
            if event.prev_hash != prev_hash:
                return False  # pragma: no cover
            computed = event.compute_hash()
            if event.event_hash != computed:
                return False
            prev_hash = event.event_hash
        return True

    def query(self, tenant_id: Optional[str] = None,
              identity_id: Optional[str] = None,
              action: Optional[str] = None,
              resource: Optional[str] = None,
              since: Optional[float] = None) -> List[AuditEvent]:
        """Query the audit trail with optional filters."""
        results = []
        for event in self.events:
            if tenant_id and event.tenant_id != tenant_id:
                continue
            if identity_id and event.identity_id != identity_id:
                continue
            if action and event.action != action:
                continue
            if resource and event.resource != resource:
                continue
            if since and event.timestamp < since:
                continue
            results.append(event)
        return results

    def stats(self) -> Dict[str, Any]:
        return {
            "total_events": len(self.events),
            "chain_valid": self.verify(),
            "first_event": self.events[0].timestamp if self.events else None,
            "last_event": self.events[-1].timestamp if self.events else None,
        }

    def export(self) -> List[Dict[str, Any]]:
        """Export the full audit trail as a list of dicts (for compliance)."""
        return [asdict(e) for e in self.events]


def self_test() -> None:
    print("=" * 78)
    print("Audit Trail — Tamper-evident chain self-test")
    print("=" * 78)

    chain = AuditChain()

    # Append events
    e1 = chain.append("acme", "agent-001", "mutation:submit", "mut-001")
    e2 = chain.append("acme", "seg-controller", "seg:admit", "mut-001")
    e3 = chain.append("acme", "agent-001", "memory:write", "rec-abc")

    print(f"  Events: {len(chain.events)}")
    print(f"  Chain valid: {chain.verify()}")

    # Tamper detection
    chain.events[1].action = "seg:reject"  # tamper!
    valid_after_tamper = chain.verify()
    print(f"  After tamper: chain valid = {valid_after_tamper}")
    assert not valid_after_tamper, "Tamper should be detected"

    # Restore
    chain.events[1].action = "seg:admit"
    assert chain.verify()

    # Query
    results = chain.query(identity_id="agent-001")
    print(f"  Query agent-001: {len(results)} events")
    assert len(results) == 2

    print("=" * 78)
    print("Audit Trail self-test PASSED.")
    print("=" * 78)


if __name__ == "__main__":
    self_test()  # pragma: no cover
