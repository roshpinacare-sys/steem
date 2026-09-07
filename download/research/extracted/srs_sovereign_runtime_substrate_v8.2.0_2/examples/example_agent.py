#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
example_agent.py — A complete example AI agent using the SRS SDK.

Demonstrates: authenticate → submit mutation → query audit → verify → stats.
"""
from __future__ import annotations
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from api.srs_sdk import SRSCClient

def main() -> int:
    print("=" * 78)
    print("SRS Example Agent — Full agent lifecycle demonstration")
    print("=" * 78)
    base_url = os.environ.get("SRS_API_URL", "http://localhost:8000")
    from api.server import runtime
    runtime.initialize()
    api_key = runtime.admin_key

    # Try connecting to a running server; fall back to in-process test client
    client = SRSCClient(base_url, api_key)
    try:
        client.health()
    except Exception:
        print("  (No server running — using in-process test client)")
        from fastapi.testclient import TestClient
        from api.server import app
        tc = TestClient(app)
        # Monkey-patch the SDK to use the test client
        original_request = client._request
        def mock_request(method, path, data=None):
            if method == "GET":
                resp = tc.get(path, headers={"Authorization": f"Bearer {api_key}"})
            else:
                resp = tc.post(path, json=data, headers={"Authorization": f"Bearer {api_key}"})
            if resp.status_code >= 400:
                raise RuntimeError(f"HTTP {resp.status_code}: {resp.text}")
            return resp.json()
        client._request = mock_request

    # 1. Health
    health = client.health()
    print(f"\n1. Health: {health['status']} v{health['version']} ({health['coverage']} coverage)")

    # 2. Issue agent key
    key_resp = client.issue_api_key(
        tenant_id="example-tenant", identity_id="example-agent",
        role="agent", display_name="Example AI Agent")
    print(f"\n2. Issued API key for 'example-agent' (key_id: {key_resp['key_id']})")
    agent_client = SRSCClient(base_url, key_resp["api_key"])

    # 3. Submit mutation
    print(f"\n3. Submitting mutation...")
    try:
        result = agent_client.submit_mutation(
            mutation_id="example-mut-001", description="FPGA clock rebalance",
            risk_class="low", z3_witness_hash="sha256:example123",
            evidence_chain={"admissible": True, "seq": 1,
                            "sqa_certificate_ref": "quorum:self#bls_evidence_binding",
                            "z3_witness_hash": "sha256:example123"},
            validators=[
                {"validator_id": "v1", "validator_type": "FORMAL", "admit": True, "assurance": 0.95},
                {"validator_id": "v2", "validator_type": "EMPIRICAL", "admit": True, "assurance": 0.88},
                {"validator_id": "v3", "validator_type": "HEURISTIC", "admit": True, "assurance": 0.81},
            ], seq=1)
        print(f"   Admissible: {result.admissible}, Reason: {result.reason}")
    except Exception as e:
        print(f"   Error: {e}")

    # 4. Audit trail
    print(f"\n4. Audit trail:")
    try:
        audit = client.query_audit(tenant_id="example-tenant")
        print(f"   Events: {audit['count']}")
        for e in audit["events"][-3:]:
            print(f"   - {e['action']} → {e['resource']} ({e['outcome']})")
    except Exception as e:
        print(f"   Error: {e}")

    # 5. Verify audit
    print(f"\n5. Audit verification:")
    try:
        v = client.verify_audit()
        print(f"   Valid: {v['valid']}, Events: {v['event_count']}")
    except Exception as e:
        print(f"   Error: {e}")

    # 6. Policies
    print(f"\n6. Active policies:")
    try:
        for p in client.list_policies()["policies"]:
            print(f"   - {p['name']}: {p['effect']}")
    except Exception as e:
        print(f"   Error: {e}")

    # 7. Stats
    print(f"\n7. Stats:")
    try:
        s = client.stats()
        print(f"   Identities: {s['identities']}, Tenants: {s['tenants']}, Policies: {s['policies']}")
    except Exception as e:
        print(f"   Error: {e}")

    print(f"\n{'=' * 78}")
    print("Example agent completed successfully!")
    print("=" * 78)
    return 0

if __name__ == "__main__":
    sys.exit(main())
