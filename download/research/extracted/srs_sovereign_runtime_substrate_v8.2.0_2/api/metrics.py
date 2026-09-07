#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
metrics.py — Prometheus metrics for SRS observability.

Exposes /metrics endpoint with:
  - srs_mutations_total{outcome}       — counter
  - srs_mutation_duration_seconds      — histogram
  - srs_audit_events_total             — counter
  - srs_audit_chain_valid              — gauge
  - srs_active_identities              — gauge
  - srs_active_api_keys                — gauge
  - srs_cost_micro_dollars_total{tenant} — counter
  - srs_policy_evaluations_total{effect} — counter
"""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse


class MetricsCollector:
    """Simple in-memory metrics collector (Prometheus format)."""

    def __init__(self) -> None:
        self.counters: Dict[str, Dict[str, Any]] = {}
        self.gauges: Dict[str, Any] = {}

    def inc_counter(self, name: str, labels: str = "") -> None:
        key = f"{name}|{labels}" if labels else name
        if key not in self.counters:
            self.counters[key] = {"value": 0.0, "name": name, "labels": labels}
        self.counters[key]["value"] += 1.0

    def set_gauge(self, name: str, value: float) -> None:
        self.gauges[name] = value

    def render(self) -> str:
        """Render metrics in Prometheus exposition format."""
        lines = []
        seen_names = set()

        for key, data in sorted(self.counters.items()):
            name = data["name"]
            labels = data["labels"]
            if name not in seen_names:
                lines.append(f"# TYPE {name} counter")
                seen_names.add(name)
            if labels:
                lines.append(f'{name}{{{labels}}} {data["value"]}')
            else:
                lines.append(f'{name} {data["value"]}')

        for name, value in sorted(self.gauges.items()):
            if name not in seen_names:
                lines.append(f"# TYPE {name} gauge")
                seen_names.add(name)
            lines.append(f"{name} {value}")

        return "\n".join(lines) + "\n"


metrics = MetricsCollector()

router = APIRouter()


@router.get("/metrics", response_class=PlainTextResponse)
async def prometheus_metrics(request: Request):
    """Prometheus metrics endpoint."""
    # Update gauges from the app state
    from api.server import runtime
    metrics.set_gauge("srs_audit_chain_valid", 1.0 if runtime.audit.verify() else 0.0)
    metrics.set_gauge("srs_active_identities", len(runtime.idp.identities))
    metrics.set_gauge("srs_active_api_keys", len(runtime.idp.api_keys))
    metrics.set_gauge("srs_active_tenants", len(runtime.idp.tenants))
    metrics.set_gauge("srs_active_policies", len(runtime.policy.policies))
    seg_stats = runtime.seg.stats()
    metrics.set_gauge("srs_seg_certified", seg_stats.get("certified", 0))
    metrics.set_gauge("srs_seg_rejected", seg_stats.get("rejected", 0))

    return metrics.render()
