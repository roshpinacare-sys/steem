#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
certification.py — Automated agent certification pipeline.

Certifies that an AI agent meets SRS safety standards before it's
allowed to operate in production:

  1. Formal verification: agent's mutations pass Z3 safety proof
  2. Audit trail: agent's actions are fully auditable
  3. Policy compliance: agent respects all governance policies
  4. Budget adherence: agent stays within cost limits
  5. Rate limit compliance: agent respects rate limits
  6. No tampering: agent doesn't modify audit trail
  7. BLS signature: agent's mutations are BLS-signed

Certified agents get a signed certificate + are listed in the marketplace.
"""
from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class CertStatus(str, Enum):
    PENDING = "pending"
    IN_REVIEW = "in_review"
    CERTIFIED = "certified"
    REJECTED = "rejected"
    REVOKED = "revoked"


@dataclass
class CertCheck:
    """A single certification check."""
    check_id: str
    name: str
    description: str
    passed: bool = False
    evidence: str = ""
    required: bool = True


@dataclass
class AgentCertificate:
    """A certification for an AI agent."""
    cert_id: str
    agent_id: str
    tenant_id: str
    agent_name: str
    version: str
    status: CertStatus = CertStatus.PENDING
    checks: List[CertCheck] = field(default_factory=list)
    submitted_at: float = field(default_factory=time.time)
    certified_at: float = 0.0
    expires_at: float = 0.0
    certification_hash: str = ""

    @property
    def all_required_passed(self) -> bool:
        return all(c.passed for c in self.checks if c.required)

    @property
    def pass_count(self) -> int:
        return sum(1 for c in self.checks if c.passed)

    @property
    def fail_count(self) -> int:
        return sum(1 for c in self.checks if not c.passed and c.required)

    def compute_hash(self) -> str:
        d = {
            "cert_id": self.cert_id, "agent_id": self.agent_id,
            "version": self.version, "checks": [
                {"id": c.check_id, "passed": c.passed} for c in self.checks
            ],
        }
        return hashlib.sha256(json.dumps(d, sort_keys=True).encode()).hexdigest()


class CertificationPipeline:
    """Automated agent certification pipeline."""

    def __init__(self) -> None:
        self.certificates: Dict[str, AgentCertificate] = {}

    def submit_for_certification(
        self, cert_id: str, agent_id: str, tenant_id: str,
        agent_name: str, version: str,
    ) -> AgentCertificate:
        """Submit an agent for certification."""
        cert = AgentCertificate(
            cert_id=cert_id, agent_id=agent_id, tenant_id=tenant_id,
            agent_name=agent_name, version=version,
            status=CertStatus.IN_REVIEW,
        )
        # Add standard checks
        cert.checks = [
            CertCheck("chk-formal", "Formal Verification",
                      "Agent's mutations pass Z3 safety proof"),
            CertCheck("chk-audit", "Audit Trail",
                      "Agent's actions are fully auditable"),
            CertCheck("chk-policy", "Policy Compliance",
                      "Agent respects all governance policies"),
            CertCheck("chk-budget", "Budget Adherence",
                      "Agent stays within cost limits"),
            CertCheck("chk-rate", "Rate Limit Compliance",
                      "Agent respects rate limits"),
            CertCheck("chk-tamper", "No Tampering",
                      "Agent doesn't modify audit trail"),
            CertCheck("chk-bls", "BLS Signature",
                      "Agent's mutations are BLS-signed"),
        ]
        self.certificates[cert_id] = cert
        return cert

    def run_checks(self, cert_id: str,
                   results: Dict[str, bool]) -> AgentCertificate:
        """Run certification checks with provided results.

        Args:
            cert_id: The certificate ID
            results: Dict mapping check_id → passed (bool)
        """
        cert = self.certificates.get(cert_id)
        if cert is None:
            raise ValueError(f"Unknown certificate: {cert_id}")

        for check in cert.checks:
            if check.check_id in results:
                check.passed = results[check.check_id]

        if cert.all_required_passed:
            cert.status = CertStatus.CERTIFIED
            cert.certified_at = time.time()
            cert.expires_at = time.time() + 86400 * 365  # 1 year
            cert.certification_hash = cert.compute_hash()
        else:
            cert.status = CertStatus.REJECTED

        return cert

    def revoke(self, cert_id: str) -> bool:
        cert = self.certificates.get(cert_id)
        if cert is None:
            return False
        cert.status = CertStatus.REVOKED
        return True

    def get_certificate(self, cert_id: str) -> Optional[AgentCertificate]:
        return self.certificates.get(cert_id)

    def list_certified(self, tenant_id: str = "") -> List[Dict[str, Any]]:
        return [
            {
                "cert_id": c.cert_id, "agent_id": c.agent_id,
                "agent_name": c.agent_name, "version": c.version,
                "status": c.status.value,
                "certified_at": c.certified_at,
                "expires_at": c.expires_at,
                "hash": c.certification_hash,
            }
            for c in self.certificates.values()
            if c.status == CertStatus.CERTIFIED
            and (not tenant_id or c.tenant_id == tenant_id)
        ]

    def stats(self) -> Dict[str, Any]:
        return {
            "total": len(self.certificates),
            "certified": sum(1 for c in self.certificates.values()
                            if c.status == CertStatus.CERTIFIED),
            "rejected": sum(1 for c in self.certificates.values()
                           if c.status == CertStatus.REJECTED),
            "pending": sum(1 for c in self.certificates.values()
                          if c.status in (CertStatus.PENDING, CertStatus.IN_REVIEW)),
            "revoked": sum(1 for c in self.certificates.values()
                          if c.status == CertStatus.REVOKED),
        }


def self_test() -> None:
    print("=" * 78)
    print("Certification — Agent certification pipeline self-test")
    print("=" * 78)

    pipeline = CertificationPipeline()
    cert = pipeline.submit_for_certification(
        "cert-001", "agent-001", "acme", "Production Agent", "1.0.0")
    print(f"  Submitted: {cert.cert_id} with {len(cert.checks)} checks")

    # Run checks — all pass
    results = {c.check_id: True for c in cert.checks}
    cert = pipeline.run_checks("cert-001", results)
    assert cert.status == CertStatus.CERTIFIED
    assert cert.all_required_passed
    assert len(cert.certification_hash) == 64
    print(f"  Certified: {cert.status.value}, hash={cert.certification_hash[:16]}...")

    # Reject case
    cert2 = pipeline.submit_for_certification(
        "cert-002", "agent-002", "acme", "Bad Agent", "1.0.0")
    results = {c.check_id: True for c in cert2.checks}
    results["chk-bls"] = False  # fail BLS check
    cert2 = pipeline.run_checks("cert-002", results)
    assert cert2.status == CertStatus.REJECTED
    print(f"  Rejected (BLS check failed): {cert2.status.value}")

    # Revoke
    assert pipeline.revoke("cert-001")
    c = pipeline.get_certificate("cert-001")
    assert c is not None
    assert c.status == CertStatus.REVOKED
    print("  Revoked: ✓")

    print("=" * 78)
    print("Certification self-test PASSED.")
    print("=" * 78)


if __name__ == "__main__":
    self_test()
