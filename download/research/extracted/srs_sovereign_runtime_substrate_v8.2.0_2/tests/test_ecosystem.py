"""Tests for OpenAPI spec, SDKs, and Kubernetes deployment resources."""
from __future__ import annotations

import json
import os

import pytest


# ===========================================================================
# OpenAPI 3.0 spec
# ===========================================================================

def test_openapi_spec_exists_and_is_valid():
    """The OpenAPI 3.0 spec file exists and is valid JSON."""
    spec_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "api", "openapi.json",
    )
    assert os.path.exists(spec_path)
    with open(spec_path) as f:
        spec = json.load(f)
    assert spec["openapi"].startswith("3.")
    assert spec["info"]["title"] == "SRS — Sovereign Runtime Substrate"
    assert "paths" in spec


def test_openapi_spec_has_all_endpoints():
    """The OpenAPI spec includes all 9 API endpoints."""
    from api.server import app
    spec = app.openapi()
    expected_paths = {
        "/v1/health", "/v1/auth/api-key", "/v1/mutations",
        "/v1/audit", "/v1/audit/verify", "/v1/policies",
        "/v1/cost/report", "/v1/stats", "/metrics",
    }
    actual_paths = set(spec["paths"].keys())
    assert expected_paths.issubset(actual_paths), \
        f"Missing paths: {expected_paths - actual_paths}"


def test_openapi_spec_has_schemas():
    """The OpenAPI spec includes Pydantic model schemas."""
    from api.server import app
    spec = app.openapi()
    assert "components" in spec
    assert "schemas" in spec["components"]
    schemas = spec["components"]["schemas"]
    assert "MutationRequest" in schemas
    assert "MutationResponse" in schemas
    assert "HealthResponse" in schemas


def test_openapi_spec_served_at_docs():
    """The /docs endpoint serves the Swagger UI."""
    from fastapi.testclient import TestClient
    from api.server import app
    client = TestClient(app)
    resp = client.get("/docs")
    assert resp.status_code == 200
    assert "swagger" in resp.text.lower() or "openapi" in resp.text.lower()


def test_openapi_json_endpoint():
    """The /openapi.json endpoint serves the spec."""
    from fastapi.testclient import TestClient
    from api.server import app
    client = TestClient(app)
    resp = client.get("/openapi.json")
    assert resp.status_code == 200
    spec = resp.json()
    assert spec["openapi"].startswith("3.")


# ===========================================================================
# TypeScript SDK
# ===========================================================================

def test_typescript_sdk_exists():
    """The TypeScript SDK file exists."""
    sdk_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "api", "srs_sdk.ts",
    )
    assert os.path.exists(sdk_path)
    content = open(sdk_path).read()
    assert "export class SRSCClient" in content
    assert "submitMutation" in content
    assert "health" in content
    assert "queryAudit" in content
    assert "verifyAudit" in content
    assert "listPolicies" in content
    assert "costReport" in content
    assert "stats" in content


def test_typescript_sdk_has_interfaces():
    """The TypeScript SDK exports all response interfaces."""
    sdk_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "api", "srs_sdk.ts",
    )
    content = open(sdk_path).read()
    for interface in [
        "HealthResponse", "APIKeyResponse", "MutationRequest",
        "MutationResponse", "AuditEvent", "AuditQueryResponse",
        "AuditVerifyResponse", "Policy", "PoliciesResponse",
        "CostReport", "Stats",
    ]:
        assert f"export interface {interface}" in content, \
            f"Missing interface: {interface}"


# ===========================================================================
# Go SDK
# ===========================================================================

def test_go_sdk_exists():
    """The Go SDK file exists."""
    sdk_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "api", "srs_sdk.go",
    )
    assert os.path.exists(sdk_path)
    content = open(sdk_path).read()
    assert "package srs_sdk" in content
    assert "type SRSCClient struct" in content
    assert "func (c *SRSCClient) Health" in content
    assert "func (c *SRSCClient) SubmitMutation" in content
    assert "func (c *SRSCClient) VerifyAudit" in content


def test_go_sdk_has_types():
    """The Go SDK defines all response types."""
    sdk_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "api", "srs_sdk.go",
    )
    content = open(sdk_path).read()
    for type_name in [
        "HealthResponse", "MutationResponse", "MutationRequest",
        "AuditVerifyResponse",
    ]:
        assert f"type {type_name} struct" in content, \
            f"Missing type: {type_name}"


# ===========================================================================
# Kubernetes resources
# ===========================================================================

def test_k8s_crd_exists():
    """The Kubernetes CRD file exists."""
    crd_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "deploy", "k8s", "crd.yaml",
    )
    assert os.path.exists(crd_path)


def test_k8s_crd_is_valid_yaml():
    """The CRD YAML is valid and has expected resources."""
    import yaml
    crd_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "deploy", "k8s", "crd.yaml",
    )
    with open(crd_path) as f:
        docs = list(yaml.safe_load_all(f))
    # Should contain: CRD, Deployment, Service, PVC, ServiceMonitor
    kinds = [d.get("kind") for d in docs if d]
    assert "CustomResourceDefinition" in kinds
    assert "Deployment" in kinds
    assert "Service" in kinds


def test_k8s_example_exists():
    """The example SRS instance YAML exists."""
    example_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "deploy", "k8s", "example-srs.yaml",
    )
    assert os.path.exists(example_path)
    import yaml
    with open(example_path) as f:
        doc = yaml.safe_load(f)
    assert doc["kind"] == "SRSInstance"
    assert doc["spec"]["replicas"] >= 1


# ===========================================================================
# Helm chart
# ===========================================================================

def test_helm_chart_exists():
    """The Helm Chart.yaml exists."""
    chart_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "deploy", "helm", "Chart.yaml",
    )
    assert os.path.exists(chart_path)
    import yaml
    with open(chart_path) as f:
        chart = yaml.safe_load(f)
    assert chart["apiVersion"] == "v2"
    assert chart["name"] == "srs"
    assert chart["appVersion"] == "5.3.0"


def test_helm_values_exist():
    """The Helm values.yaml exists."""
    values_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "deploy", "helm", "values.yaml",
    )
    assert os.path.exists(values_path)
    import yaml
    with open(values_path) as f:
        values = yaml.safe_load(f)
    assert "replicaCount" in values
    assert "image" in values
    assert "persistence" in values
    assert "monitoring" in values
