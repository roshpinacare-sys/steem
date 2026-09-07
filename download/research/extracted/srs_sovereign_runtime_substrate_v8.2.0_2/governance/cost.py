#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
cost.py — Cost tracking and budget enforcement for AI agent operations.

Provides:
  - CostEvent: a single cost-generating operation
  - CostTracker: tracks costs per agent, per tenant, per operation type
  - Budget: per-agent or per-tenant budget with enforcement
  - CostReport: aggregated cost report

Every Z3 solve, BLS sign, Qiskit execution, and memory operation has a
measurable cost. The cost tracker records these and enforces budgets,
preventing runaway agents from consuming unbounded resources.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


# Cost model (per-operation, in micro-dollars — 1 micro-dollar = $0.000001)
# These are MEASURED costs based on the benchmark results.
COST_MODEL: Dict[str, float] = {
    "z3_solve":           0.1,    # ~2ms compute
    "z3_contention":      1.0,    # ~20ms compute
    "bls_sign":           5.0,    # ~112ms compute
    "bls_verify":        12.0,    # ~260ms compute
    "bls_aggregate":      0.6,    # ~13ms compute
    "qiskit_execute":    50.0,    # ~1s quantum sim
    "adaqc_compile":      0.01,   # ~20µs
    "seg_admission":      0.001,  # ~6µs
    "memory_add":         0.001,
    "memory_delete":      0.001,
    "memory_retrieve":    0.0005,
    "audit_append":       0.0001,
    "dna_encode":         0.01,   # ~56µs
}


@dataclass
class CostEvent:
    """A single cost-generating operation."""
    timestamp: float
    tenant_id: str
    agent_id: str
    operation: str
    cost_micro: float  # cost in micro-dollars
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class Budget:
    """A spending budget for a tenant or agent."""
    budget_id: str
    tenant_id: str
    agent_id: Optional[str]  # None = tenant-wide budget
    limit_micro: float  # budget limit in micro-dollars
    spent_micro: float = 0.0
    period_seconds: float = 3600.0  # 1 hour default
    period_start: float = field(default_factory=time.time)
    enforced: bool = True  # if True, deny operations when budget exhausted

    @property
    def remaining(self) -> float:
        return max(0.0, self.limit_micro - self.spent_micro)

    @property
    def exhausted(self) -> bool:
        return self.enforced and self.spent_micro >= self.limit_micro

    def reset_if_needed(self) -> None:
        """Reset the budget if the period has elapsed."""
        if time.time() - self.period_start > self.period_seconds:
            self.spent_micro = 0.0
            self.period_start = time.time()


class CostTracker:
    """Tracks costs and enforces budgets for all SRS operations."""

    def __init__(self) -> None:
        self.events: List[CostEvent] = []
        self.budgets: Dict[str, Budget] = {}  # budget_id -> Budget

    def record(self, tenant_id: str, agent_id: str, operation: str,
               metadata: Optional[Dict[str, Any]] = None) -> CostEvent:
        """Record a cost event and update budgets."""
        cost = COST_MODEL.get(operation, 0.001)
        event = CostEvent(
            timestamp=time.time(),
            tenant_id=tenant_id,
            agent_id=agent_id,
            operation=operation,
            cost_micro=cost,
            metadata=metadata or {},
        )
        self.events.append(event)

        # Update budgets
        for budget in self.budgets.values():
            budget.reset_if_needed()
            if budget.tenant_id == tenant_id:
                if budget.agent_id is None or budget.agent_id == agent_id:
                    budget.spent_micro += cost

        return event

    def can_spend(self, tenant_id: str, agent_id: str,
                  operation: str) -> bool:
        """Check if the operation is within budget."""
        cost = COST_MODEL.get(operation, 0.001)
        for budget in self.budgets.values():
            budget.reset_if_needed()
            if budget.tenant_id == tenant_id:
                if budget.agent_id is None or budget.agent_id == agent_id:
                    if budget.exhausted:
                        return False
                    if budget.enforced and budget.remaining < cost:
                        return False
        return True

    def set_budget(self, budget_id: str, tenant_id: str,
                   limit_micro: float, agent_id: Optional[str] = None,
                   period_seconds: float = 3600.0) -> Budget:
        budget = Budget(
            budget_id=budget_id, tenant_id=tenant_id,
            agent_id=agent_id, limit_micro=limit_micro,
            period_seconds=period_seconds,
        )
        self.budgets[budget_id] = budget
        return budget

    def report(self, tenant_id: Optional[str] = None,
               agent_id: Optional[str] = None) -> Dict[str, Any]:
        """Generate a cost report."""
        events = [e for e in self.events
                  if (tenant_id is None or e.tenant_id == tenant_id)
                  and (agent_id is None or e.agent_id == agent_id)]

        total_micro = sum(e.cost_micro for e in events)
        by_op: Dict[str, float] = {}
        for e in events:
            by_op[e.operation] = by_op.get(e.operation, 0.0) + e.cost_micro

        return {
            "total_events": len(events),
            "total_cost_micro": total_micro,
            "total_cost_dollars": total_micro / 1_000_000,
            "by_operation": by_op,
            "budgets": {
                bid: {
                    "limit_micro": b.limit_micro,
                    "spent_micro": b.spent_micro,
                    "remaining_micro": b.remaining,
                    "exhausted": b.exhausted,
                }
                for bid, b in self.budgets.items()
                if tenant_id is None or b.tenant_id == tenant_id
            },
        }


def self_test() -> None:
    print("=" * 78)
    print("Cost Tracker — Budget enforcement self-test")
    print("=" * 78)

    tracker = CostTracker()

    # Set a budget: $0.10 (100K micro-dollars) for tenant "acme"
    tracker.set_budget("acme-budget", "acme", limit_micro=100_000)

    # Record some operations
    tracker.record("acme", "agent-001", "z3_solve")
    tracker.record("acme", "agent-001", "bls_sign")
    tracker.record("acme", "agent-001", "qiskit_execute")

    report = tracker.report(tenant_id="acme")
    print(f"  Events: {report['total_events']}")
    print(f"  Total cost: ${report['total_cost_dollars']:.6f}")
    print(f"  Budget remaining: ${report['budgets']['acme-budget']['remaining_micro'] / 1e6:.6f}")

    # Budget should not be exhausted
    assert not report["budgets"]["acme-budget"]["exhausted"]
    assert tracker.can_spend("acme", "agent-001", "z3_solve")
    print("  Budget not exhausted: can spend ✓")

    # Exhaust the budget
    for _ in range(2000):
        tracker.record("acme", "agent-001", "qiskit_execute")

    assert not tracker.can_spend("acme", "agent-001", "qiskit_execute")
    print("  Budget exhausted: cannot spend ✓")

    print("=" * 78)
    print("Cost Tracker self-test PASSED.")
    print("=" * 78)


if __name__ == "__main__":
    self_test()  # pragma: no cover
