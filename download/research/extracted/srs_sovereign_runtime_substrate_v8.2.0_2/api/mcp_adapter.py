#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
mcp_adapter.py — Model Context Protocol (MCP) integration for SRS.

This adapter makes SRS the governance layer for MCP-compatible AI agents.
Any MCP agent (Claude, GPT, etc.) that supports tool use can route its
mutations through SRS for formal verification + governance.

Provides:
  - MCPTool: wraps SRS operations as MCP-callable tools
  - MCPGateway: translates MCP tool calls into SRS REST API calls
  - MCP_AGENT_TEMPLATE: a certified agent template for MCP integration

MCP Protocol:
  Agents call tools via JSON-RPC. This adapter exposes SRS operations
  (submit_mutation, query_audit, verify_audit, etc.) as MCP tools.

Usage:
  from api.mcp_adapter import MCPGateway
  gateway = MCPGateway(base_url="http://localhost:8000", api_key="...")
  result = gateway.handle_tool_call("submit_mutation", {...})
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class MCPTool:
    """An MCP-callable tool definition."""
    name: str
    description: str
    input_schema: Dict[str, Any]
    handler: Any  # callable


# ---------------------------------------------------------------------------
# MCP Tool definitions — these are the tools SRS exposes to MCP agents
# ---------------------------------------------------------------------------

MCP_TOOLS: List[MCPTool] = [
    MCPTool(
        name="srs_submit_mutation",
        description="Submit a state mutation for SEG (Sovereign Execution Gate) evaluation. "
                    "The mutation must pass 5 mandatory checks: admissibility, sequence epoch, "
                    "SQA quorum, Z3 witness hash binding, and certificate reference resolution. "
                    "Returns admissible=True if certified, False if rejected.",
        input_schema={
            "type": "object",
            "properties": {
                "mutation_id": {"type": "string", "description": "Unique mutation identifier"},
                "description": {"type": "string", "description": "Human-readable description"},
                "risk_class": {"type": "string", "enum": ["low", "medium", "high", "critical"],
                               "default": "medium"},
                "z3_witness_hash": {"type": "string", "description": "SHA-256 hash of the Z3 proof witness"},
                "evidence_chain": {"type": "object", "description": "Evidence chain with admissible, seq, sqa_certificate_ref"},
                "validators": {"type": "array", "description": "List of validator verdicts"},
                "seq": {"type": "integer", "default": 0},
            },
            "required": ["mutation_id", "description", "risk_class", "z3_witness_hash", "evidence_chain"],
        },
        handler=None,  # set by MCPGateway
    ),
    MCPTool(
        name="srs_query_audit",
        description="Query the tamper-evident audit trail. Returns events matching the "
                    "specified filters. Requires auditor or admin role.",
        input_schema={
            "type": "object",
            "properties": {
                "tenant_id": {"type": "string"},
                "identity_id": {"type": "string"},
                "action": {"type": "string"},
                "resource": {"type": "string"},
            },
        },
        handler=None,
    ),
    MCPTool(
        name="srs_verify_audit",
        description="Verify the integrity of the audit chain. Returns valid=True if no "
                    "tampering is detected. This is the cryptographic proof that the "
                    "audit trail has not been modified.",
        input_schema={"type": "object", "properties": {}},
        handler=None,
    ),
    MCPTool(
        name="srs_list_policies",
        description="List all active governance policies. Policies control tenant isolation, "
                    "rate limiting, risk-based approval requirements, and DELETE quorum enforcement.",
        input_schema={"type": "object", "properties": {}},
        handler=None,
    ),
    MCPTool(
        name="srs_cost_report",
        description="Get a cost report showing total operations, cost in dollars, and "
                    "budget status. Useful for monitoring agent spending.",
        input_schema={
            "type": "object",
            "properties": {
                "tenant_id": {"type": "string"},
                "agent_id": {"type": "string"},
            },
        },
        handler=None,
    ),
    MCPTool(
        name="srs_health",
        description="Check SRS server health. Returns status, version, test count, and "
                    "coverage percentage. No authentication required.",
        input_schema={"type": "object", "properties": {}},
        handler=None,
    ),
]


# ---------------------------------------------------------------------------
# MCP Gateway — translates MCP tool calls into SRS REST API calls
# ---------------------------------------------------------------------------

class MCPGateway:
    """Gateway that exposes SRS as MCP tools.

    Any MCP-compatible agent (Claude, GPT with tool use, etc.) can call
    these tools to submit mutations, query audits, and verify governance.
    """

    def __init__(self, base_url: str = "http://localhost:8000",
                 api_key: str = "") -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.tools: Dict[str, MCPTool] = {t.name: t for t in MCP_TOOLS}

    def list_tools(self) -> List[Dict[str, Any]]:
        """Return the list of available MCP tools (for MCP protocol handshake)."""
        return [
            {
                "name": t.name,
                "description": t.description,
                "inputSchema": t.input_schema,
            }
            for t in MCP_TOOLS
        ]

    def handle_tool_call(self, tool_name: str,
                         arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Handle an MCP tool call by routing to the SRS REST API.

        This is the main entry point for MCP agents.
        """
        if tool_name not in self.tools:
            return {"error": f"Unknown tool: {tool_name}"}

        tool = self.tools[tool_name]

        # Route to the appropriate SRS API endpoint
        if tool_name == "srs_submit_mutation":
            return self._call_api("POST", "/v1/mutations", arguments)
        elif tool_name == "srs_query_audit":
            return self._call_api("GET", "/v1/audit", arguments)
        elif tool_name == "srs_verify_audit":
            return self._call_api("GET", "/v1/audit/verify", {})
        elif tool_name == "srs_list_policies":
            return self._call_api("GET", "/v1/policies", {})
        elif tool_name == "srs_cost_report":
            return self._call_api("GET", "/v1/cost/report", arguments)
        elif tool_name == "srs_health":
            return self._call_api("GET", "/v1/health", {})
        else:
            return {"error": f"Unimplemented tool: {tool_name}"}

    def _call_api(self, method: str, path: str,
                  data: Dict[str, Any]) -> Dict[str, Any]:
        """Call the SRS REST API."""
        import urllib.request
        import urllib.error

        url = f"{self.base_url}{path}"
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        # For GET with query params, build URL
        if method == "GET" and data:
            params = "&".join(f"{k}={v}" for k, v in data.items() if v)
            if params:
                url += f"?{params}"
            body = None
        else:
            body = json.dumps(data).encode() if data else None

        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req) as resp:
                return dict(json.loads(resp.read().decode()))
        except urllib.error.HTTPError as e:
            return {"error": f"HTTP {e.code}", "detail": e.read().decode()}
        except Exception as e:
            return {"error": str(e)}


# ---------------------------------------------------------------------------
# MCP Server — JSON-RPC handler
# ---------------------------------------------------------------------------

def handle_mcp_request(request: Dict[str, Any],
                       gateway: MCPGateway) -> Dict[str, Any]:
    """Handle a single MCP JSON-RPC request.

    Supports:
      - tools/list: return available tools
      - tools/call: execute a tool
    """
    method = request.get("method", "")
    req_id = request.get("id")
    params = request.get("params", {})

    if method == "tools/list":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"tools": gateway.list_tools()},
        }
    elif method == "tools/call":
        tool_name = params.get("name", "")
        arguments = params.get("arguments", {})
        result = gateway.handle_tool_call(tool_name, arguments)
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"content": [{"type": "text", "text": json.dumps(result)}]},
        }
    else:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32601, "message": f"Method not found: {method}"},
        }


def self_test() -> None:
    print("=" * 78)
    print("MCP Adapter — Model Context Protocol integration self-test")
    print("=" * 78)

    gateway = MCPGateway("http://localhost:8000", api_key="")
    tools = gateway.list_tools()
    print(f"  MCP tools available: {len(tools)}")
    for t in tools:
        print(f"    {t['name']}: {t['description'][:60]}...")

    # Test JSON-RPC tools/list
    req = {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}
    resp = handle_mcp_request(req, gateway)
    assert "result" in resp
    assert len(resp["result"]["tools"]) == 6
    print(f"\n  JSON-RPC tools/list: {len(resp['result']['tools'])} tools ✓")

    # Test unknown method
    req = {"jsonrpc": "2.0", "id": 2, "method": "unknown/method", "params": {}}
    resp = handle_mcp_request(req, gateway)
    assert "error" in resp
    print("  Unknown method: error returned ✓")

    print("\n" + "=" * 78)
    print("MCP Adapter self-test PASSED.")
    print("=" * 78)


if __name__ == "__main__":
    self_test()
