"""Tests for MCP adapter, web dashboard, and marketplace."""
from __future__ import annotations

import json
import os

import pytest


# ===========================================================================
# api/mcp_adapter.py
# ===========================================================================

def test_mcp_gateway_lists_6_tools():
    """The MCP gateway exposes 6 tools."""
    from api.mcp_adapter import MCPGateway
    gw = MCPGateway("http://localhost:8000", "")
    tools = gw.list_tools()
    assert len(tools) == 6
    tool_names = [t["name"] for t in tools]
    assert "srs_submit_mutation" in tool_names
    assert "srs_query_audit" in tool_names
    assert "srs_verify_audit" in tool_names
    assert "srs_list_policies" in tool_names
    assert "srs_cost_report" in tool_names
    assert "srs_health" in tool_names


def test_mcp_handle_tools_list_request():
    """JSON-RPC tools/list returns all tools."""
    from api.mcp_adapter import MCPGateway, handle_mcp_request
    gw = MCPGateway("http://localhost:8000", "")
    req = {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}
    resp = handle_mcp_request(req, gw)
    assert "result" in resp
    assert len(resp["result"]["tools"]) == 6


def test_mcp_handle_unknown_tool():
    """Unknown tool name returns error."""
    from api.mcp_adapter import MCPGateway
    gw = MCPGateway("http://localhost:8000", "")
    result = gw.handle_tool_call("nonexistent_tool", {})
    assert "error" in result


def test_mcp_handle_unknown_method():
    """Unknown JSON-RPC method returns error."""
    from api.mcp_adapter import MCPGateway, handle_mcp_request
    gw = MCPGateway("http://localhost:8000", "")
    req = {"jsonrpc": "2.0", "id": 2, "method": "unknown/method", "params": {}}
    resp = handle_mcp_request(req, gw)
    assert "error" in resp


def test_mcp_tools_have_descriptions():
    """Each MCP tool has a description and input schema."""
    from api.mcp_adapter import MCPGateway
    gw = MCPGateway("http://localhost:8000", "")
    for tool in gw.list_tools():
        assert len(tool["description"]) > 10
        assert "type" in tool["inputSchema"]


def test_mcp_handle_tool_call_with_api():
    """MCP health tool call works via the test API."""
    from api.mcp_adapter import MCPGateway
    from fastapi.testclient import TestClient
    from api.server import app, runtime

    runtime.initialize()
    client = TestClient(app)

    # Use the test client as the "API" by monkey-patching _call_api
    gw = MCPGateway("http://localhost:8000", "")
    original_call = gw._call_api

    def mock_call(method, path, data):
        if method == "GET" and path == "/v1/health":
            resp = client.get(path)
            return resp.json()
        return {"error": "not implemented in test"}

    gw._call_api = mock_call
    result = gw.handle_tool_call("srs_health", {})
    assert result["status"] == "ok"


# ===========================================================================
# api/dashboard.html
# ===========================================================================

def test_dashboard_html_exists():
    """The web dashboard HTML file exists."""
    dashboard_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "api", "dashboard.html",
    )
    assert os.path.exists(dashboard_path)


def test_dashboard_has_key_elements():
    """The dashboard HTML contains the expected UI elements."""
    dashboard_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "api", "dashboard.html",
    )
    content = open(dashboard_path).read()
    assert "SRS Dashboard" in content
    assert "health" in content.lower()
    assert "audit" in content.lower()
    assert "policies" in content.lower()
    assert "refresh" in content.lower()
    assert "<script>" in content
    assert "fetch(" in content


# ===========================================================================
# api/marketplace.py
# ===========================================================================

def test_marketplace_lists_certified_templates():
    """The marketplace lists at least 3 certified templates."""
    from api.marketplace import Marketplace
    m = Marketplace()
    templates = m.list_templates(certified_only=True)
    assert len(templates) >= 3
    for t in templates:
        assert t["certified"] is True


def test_marketplace_lists_certified_policy_packs():
    """The marketplace lists at least 3 certified policy packs."""
    from api.marketplace import Marketplace
    m = Marketplace()
    packs = m.list_policy_packs(certified_only=True)
    assert len(packs) >= 3
    industries = [p["industry"] for p in packs]
    assert "finance" in industries
    assert "healthcare" in industries
    assert "defense" in industries


def test_marketplace_get_template():
    """Getting a template by ID returns the template."""
    from api.marketplace import Marketplace
    m = Marketplace()
    t = m.get_template("tmpl-basic-agent")
    assert t is not None
    assert t.name == "Basic Safe Agent"
    assert t.role == "agent"
    assert t.certified is True


def test_marketplace_get_policy_pack():
    """Getting a policy pack by ID returns the pack."""
    from api.marketplace import Marketplace
    m = Marketplace()
    p = m.get_policy_pack("pack-finance")
    assert p is not None
    assert p.industry == "finance"
    assert len(p.policies) > 0


def test_marketplace_publish_template():
    """Publishing a new template adds it to the marketplace."""
    from api.marketplace import Marketplace, AgentTemplate
    m = Marketplace()
    t = AgentTemplate(
        template_id="tmpl-custom",
        name="Custom Agent",
        description="A custom template",
        author="Test",
        version="1.0.0",
        role="agent",
    )
    assert m.publish_template(t) is True
    assert m.get_template("tmpl-custom") is not None
    # Duplicate publish fails
    assert m.publish_template(t) is False


def test_marketplace_stats():
    """Marketplace stats returns correct counts."""
    from api.marketplace import Marketplace
    m = Marketplace()
    stats = m.stats()
    assert stats["total_templates"] >= 3
    assert stats["certified_templates"] >= 3
    assert stats["total_policy_packs"] >= 3
    assert "finance" in stats["industries"]


def test_marketplace_self_test(capsys):
    """Marketplace self_test() runs without error."""
    from api.marketplace import self_test
    self_test()
    captured = capsys.readouterr()
    assert "PASSED" in captured.out


def test_mcp_self_test(capsys):
    """MCP adapter self_test() runs without error."""
    from api.mcp_adapter import self_test
    self_test()
    captured = capsys.readouterr()
    assert "PASSED" in captured.out
