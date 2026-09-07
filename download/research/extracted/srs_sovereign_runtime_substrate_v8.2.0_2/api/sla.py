#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
sla.py — SLA monitoring + incident management for SRS Cloud.

Provides:
  - SLAConfig: service level agreement configuration
  - SLAMonitor: tracks uptime, response times, and SLA compliance
  - Incident: a service disruption event
  - IncidentManager: manages incident lifecycle (open → investigating → resolved)

Tracks:
  - Uptime percentage (target: 99.99% for Enterprise)
  - Response time P95 (target: <100ms for API)
  - Mutation admission latency (target: <10ms)
  - Audit chain verification (target: <1ms)
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class IncidentSeverity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class IncidentStatus(str, Enum):
    OPEN = "open"
    INVESTIGATING = "investigating"
    IDENTIFIED = "identified"
    RESOLVED = "resolved"
    POSTMORTEM = "postmortem"


@dataclass
class SLAConfig:
    """Service level agreement targets."""
    uptime_target_pct: float = 99.99       # Enterprise: 99.99%, Pro: 99.9%
    response_time_p95_ms: float = 100.0    # API P95 latency
    mutation_latency_ms: float = 10.0      # SEG admission latency
    audit_verify_ms: float = 1.0           # Audit chain verification
    max_incidents_per_month: int = 1       # Max allowed incidents


@dataclass
class Incident:
    """A service disruption incident."""
    incident_id: str
    title: str
    severity: IncidentSeverity
    status: IncidentStatus = IncidentStatus.OPEN
    created_at: float = field(default_factory=time.time)
    resolved_at: float = 0.0
    duration_s: float = 0.0
    affected_tenants: List[str] = field(default_factory=list)
    root_cause: str = ""
    resolution: str = ""
    postmortem: str = ""


class SLAMonitor:
    """Monitors SLA compliance + tracks uptime."""

    def __init__(self, config: SLAConfig = SLAConfig()) -> None:
        self.config = config
        self._check_points: List[Dict[str, Any]] = []
        self._total_checks: int = 0
        self._successful_checks: int = 0
        self._response_times: List[float] = []

    def record_check(self, success: bool, response_time_ms: float = 0) -> None:
        """Record a health check result."""
        self._total_checks += 1
        if success:
            self._successful_checks += 1
        self._response_times.append(response_time_ms)
        self._check_points.append({
            "timestamp": time.time(), "success": success,
            "response_ms": response_time_ms,
        })
        # Keep only last 10000 checks
        if len(self._check_points) > 10000:
            self._check_points = self._check_points[-10000:]

    @property
    def uptime_pct(self) -> float:
        if self._total_checks == 0:
            return 100.0
        return (self._successful_checks / self._total_checks) * 100

    @property
    def p95_response_ms(self) -> float:
        if not self._response_times:
            return 0.0
        sorted_times = sorted(self._response_times)
        idx = int(len(sorted_times) * 0.95)
        return sorted_times[min(idx, len(sorted_times) - 1)]

    def sla_compliant(self) -> bool:
        """Check if current metrics meet SLA targets."""
        return (self.uptime_pct >= self.config.uptime_target_pct and
                self.p95_response_ms <= self.config.response_time_p95_ms)

    def report(self) -> Dict[str, Any]:
        return {
            "uptime_pct": round(self.uptime_pct, 4),
            "uptime_target": self.config.uptime_target_pct,
            "sla_met": self.uptime_pct >= self.config.uptime_target_pct,
            "p95_response_ms": round(self.p95_response_ms, 2),
            "response_target_ms": self.config.response_time_p95_ms,
            "total_checks": self._total_checks,
            "successful_checks": self._successful_checks,
            "failed_checks": self._total_checks - self._successful_checks,
        }


class IncidentManager:
    """Manages incident lifecycle."""

    def __init__(self) -> None:
        self.incidents: Dict[str, Incident] = {}

    def create(self, incident_id: str, title: str,
               severity: IncidentSeverity,
               affected_tenants: Optional[List[str]] = None) -> Incident:
        inc = Incident(
            incident_id=incident_id, title=title, severity=severity,
            affected_tenants=affected_tenants or [],
        )
        self.incidents[incident_id] = inc
        return inc

    def update_status(self, incident_id: str, status: IncidentStatus,
                      note: str = "") -> bool:
        inc = self.incidents.get(incident_id)
        if inc is None:
            return False
        inc.status = status
        if status == IncidentStatus.RESOLVED:
            inc.resolved_at = time.time()
            inc.duration_s = inc.resolved_at - inc.created_at
            if note:
                inc.resolution = note
        elif status == IncidentStatus.IDENTIFIED and note:
            inc.root_cause = note
        elif status == IncidentStatus.POSTMORTEM and note:
            inc.postmortem = note
        return True

    def list_incidents(self, status: Optional[IncidentStatus] = None) -> List[Dict]:
        return [
            {"incident_id": i.incident_id, "title": i.title,
             "severity": i.severity.value, "status": i.status.value,
             "duration_s": i.duration_s, "affected_tenants": i.affected_tenants}
            for i in self.incidents.values()
            if status is None or i.status == status
        ]

    def stats(self) -> Dict[str, Any]:
        return {
            "total_incidents": len(self.incidents),
            "open": sum(1 for i in self.incidents.values()
                       if i.status in (IncidentStatus.OPEN, IncidentStatus.INVESTIGATING)),
            "resolved": sum(1 for i in self.incidents.values()
                           if i.status == IncidentStatus.RESOLVED),
            "critical": sum(1 for i in self.incidents.values()
                           if i.severity == IncidentSeverity.CRITICAL),
        }


def self_test() -> None:
    print("=" * 78)
    print("SLA Monitor + Incident Management self-test")
    print("=" * 78)
    # SLA monitoring
    mon = SLAMonitor(SLAConfig(uptime_target_pct=99.0, response_time_p95_ms=200))
    for _ in range(100):
        mon.record_check(success=True, response_time_ms=50)
    mon.record_check(success=False, response_time_ms=500)  # 1 failure
    assert abs(mon.uptime_pct - 99.0) < 0.01
    assert mon.sla_compliant()
    print(f"  Uptime: {mon.uptime_pct}% (target: 99.0%) ✓")
    # Incident
    im = IncidentManager()
    inc = im.create("inc-001", "API degradation", IncidentSeverity.HIGH, ["acme"])
    im.update_status("inc-001", IncidentStatus.IDENTIFIED, "DB connection pool exhausted")
    im.update_status("inc-001", IncidentStatus.RESOLVED, "Increased pool size")
    assert im.incidents["inc-001"].status == IncidentStatus.RESOLVED
    assert im.incidents["inc-001"].duration_s > 0
    print(f"  Incident resolved: {im.incidents['inc-001'].duration_s:.1f}s duration ✓")
    print("=" * 78)
    print("SLA + Incident self-test PASSED.")
    print("=" * 78)


if __name__ == "__main__":
    self_test()
