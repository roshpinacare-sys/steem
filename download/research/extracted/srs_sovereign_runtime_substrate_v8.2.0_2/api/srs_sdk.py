#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
srs_sdk.py — Python SDK for the SRS REST API.

Usage:
    from api.srs_sdk import SRSCClient

    client = SRSCClient("http://localhost:8000", api_key="...")
    result = client.submit_mutation(
        mutation_id="mut-001",
        description="FPGA rebalance",
        risk_class="medium",
        z3_witness_hash="sha256:abc123",
        evidence_chain={...},
        validators=[...],
    )
    print(result.admissible)
"""
from __future__ import annotations

import json
import urllib.request
import urllib.error
from dataclasses import dataclass
from typing import Any, Dict, List, Optional


@dataclass
class MutationResult:
    mutation_id: str
    admissible: bool
    reason: str
    certified_at: float


class SRSCClient:
    """SRS REST API client.

    Args:
        base_url: The SRS API base URL (e.g. "http://localhost:8000")
        api_key: The API key for authentication
    """

    def __init__(self, base_url: str, api_key: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key

    def _request(self, method: str, path: str,
                 data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        url = f"{self.base_url}{path}"
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        body = json.dumps(data).encode() if data else None
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req) as resp:
                return dict(json.loads(resp.read().decode()))
        except urllib.error.HTTPError as e:
            error_body = e.read().decode()
            raise RuntimeError(f"HTTP {e.code}: {error_body}") from e

    def health(self) -> Dict[str, Any]:
        """Check server health (no auth required)."""
        return self._request("GET", "/v1/health")

    def issue_api_key(self, tenant_id: str, identity_id: str,
                      role: str = "agent", display_name: str = "",
                      ttl_seconds: float = 0) -> Dict[str, Any]:
        """Issue a new API key (requires admin)."""
        return self._request("POST", "/v1/auth/api-key", {
            "tenant_id": tenant_id, "identity_id": identity_id,
            "role": role, "display_name": display_name, "ttl_seconds": ttl_seconds,
        })

    def submit_mutation(
        self, mutation_id: str, description: str, risk_class: str,
        z3_witness_hash: str, evidence_chain: Dict[str, Any],
        validators: Optional[List[Dict[str, Any]]] = None, seq: int = 0,
    ) -> MutationResult:
        """Submit a mutation for SEG evaluation."""
        data = {
            "mutation_id": mutation_id, "description": description,
            "risk_class": risk_class, "z3_witness_hash": z3_witness_hash,
            "evidence_chain": evidence_chain,
            "validators": validators or [], "seq": seq,
        }
        result = self._request("POST", "/v1/mutations", data)
        return MutationResult(
            mutation_id=result["mutation_id"],
            admissible=result["admissible"],
            reason=result["reason"],
            certified_at=result.get("certified_at", 0.0),
        )

    def query_audit(self, tenant_id: Optional[str] = None,
                    identity_id: Optional[str] = None,
                    action: Optional[str] = None,
                    resource: Optional[str] = None) -> Dict[str, Any]:
        """Query the audit trail."""
        params = []
        if tenant_id: params.append(f"tenant_id={tenant_id}")
        if identity_id: params.append(f"identity_id={identity_id}")
        if action: params.append(f"action={action}")
        if resource: params.append(f"resource={resource}")
        qs = "&".join(params)
        path = f"/v1/audit{'?' + qs if qs else ''}"
        return self._request("GET", path)

    def verify_audit(self) -> Dict[str, Any]:
        """Verify audit chain integrity."""
        return self._request("GET", "/v1/audit/verify")

    def list_policies(self) -> Dict[str, Any]:
        """List active policies."""
        return self._request("GET", "/v1/policies")

    def cost_report(self, tenant_id: Optional[str] = None,
                    agent_id: Optional[str] = None) -> Dict[str, Any]:
        """Get cost report."""
        params = []
        if tenant_id: params.append(f"tenant_id={tenant_id}")
        if agent_id: params.append(f"agent_id={agent_id}")
        qs = "&".join(params)
        path = f"/v1/cost/report{'?' + qs if qs else ''}"
        return self._request("GET", path)

    def stats(self) -> Dict[str, Any]:
        """Get runtime statistics."""
        return self._request("GET", "/v1/stats")
