"""Tests for example agents, RBAC dashboard, benchmark runner, and security."""
from __future__ import annotations

import os

import pytest


# ===========================================================================
# examples/example_agent.py — Python example agent
# ===========================================================================

def test_example_agent_python_exists():
    """The Python example agent file exists."""
    path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "examples", "example_agent.py",
    )
    assert os.path.exists(path)
    content = open(path).read()
    assert "SRSCClient" in content
    assert "submit_mutation" in content or "submitMutation" in content
    assert "health" in content.lower()


def test_example_agent_typescript_exists():
    """The TypeScript example agent file exists."""
    path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "examples", "example_agent.ts",
    )
    assert os.path.exists(path)
    content = open(path).read()
    assert "SRSCClient" in content
    assert "submitMutation" in content


def test_example_agent_go_exists():
    """The Go example agent file exists."""
    path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "examples", "example_agent.go",
    )
    assert os.path.exists(path)
    content = open(path).read()
    assert "NewSRSCClient" in content
    assert "SubmitMutation" in content


def test_example_agent_python_runs():
    """The Python example agent runs end-to-end."""
    import subprocess, sys
    result = subprocess.run(
        [sys.executable, "examples/example_agent.py"],
        capture_output=True, text=True, timeout=30,
        cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    )
    assert result.returncode == 0
    assert "completed successfully" in result.stdout


# ===========================================================================
# api/admin.html — RBAC management dashboard
# ===========================================================================

def test_admin_dashboard_exists():
    """The admin dashboard HTML exists."""
    path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "api", "admin.html",
    )
    assert os.path.exists(path)


def test_admin_dashboard_has_management_ui():
    """The admin dashboard has identity + policy management elements."""
    path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "api", "admin.html",
    )
    content = open(path).read()
    assert "Identity" in content or "identity" in content.lower()
    assert "Policy" in content or "policy" in content.lower()
    assert "Audit" in content or "audit" in content.lower()
    assert "Cost" in content or "cost" in content.lower()
    assert "<script>" in content


# ===========================================================================
# api/security.py — Input validation + hardening
# ===========================================================================

def test_security_validate_valid_inputs():
    from api.security import (
        validate_mutation_id, validate_description, validate_risk_class,
        validate_witness_hash, validate_role, validate_tenant_id,
    )
    assert validate_mutation_id("mut-001").valid
    assert validate_description("test description").valid
    assert validate_risk_class("medium").valid
    assert validate_witness_hash("sha256:abc123").valid
    assert validate_role("agent").valid
    assert validate_tenant_id("acme").valid


def test_security_rejects_sql_injection():
    from api.security import validate_mutation_id
    result = validate_mutation_id("mut'; DROP TABLE mutations;--")
    assert not result.valid
    assert "invalid characters" in result.error


def test_security_rejects_path_traversal():
    from api.security import validate_tenant_id
    assert not validate_tenant_id("../etc/passwd").valid
    assert not validate_tenant_id("acme/../../etc").valid
    assert not validate_tenant_id("acme\\..\\..").valid


def test_security_prevents_xss():
    from api.security import validate_description
    result = validate_description("<script>alert('xss')</script>")
    assert result.valid
    assert "<script>" not in result.sanitized
    assert "&lt;script&gt;" in result.sanitized


def test_security_rejects_oversized_inputs():
    from api.security import validate_mutation_id, validate_description
    assert not validate_mutation_id("x" * 1000).valid
    assert not validate_description("x" * 10000).valid


def test_security_rejects_invalid_risk_class():
    from api.security import validate_risk_class
    assert not validate_risk_class("extreme").valid
    assert not validate_risk_class("").valid


def test_security_rejects_invalid_role():
    from api.security import validate_role
    assert not validate_role("superadmin").valid
    assert not validate_role("").valid


def test_security_evidence_chain_validation():
    from api.security import validate_evidence_chain
    assert validate_evidence_chain({"admissible": True, "seq": 1}).valid
    assert not validate_evidence_chain({}).valid  # missing required fields
    assert not validate_evidence_chain("not a dict").valid


def test_security_validators_count_limit():
    from api.security import validate_validators
    assert validate_validators([]).valid
    assert validate_validators([{"id": f"v{i}"} for i in range(20)]).valid
    assert not validate_validators([{"id": f"v{i}"} for i in range(21)]).valid


def test_security_headers_configured():
    from api.security import SECURITY_HEADERS
    assert "X-Content-Type-Options" in SECURITY_HEADERS
    assert "X-Frame-Options" in SECURITY_HEADERS
    assert "Content-Security-Policy" in SECURITY_HEADERS
    assert "Strict-Transport-Security" in SECURITY_HEADERS


def test_security_self_test(capsys):
    from api.security import self_test
    self_test()
    assert "PASSED" in capsys.readouterr().out


# ===========================================================================
# benchmarks/bench_srs.py — benchmark suite exists + is valid
# ===========================================================================

def test_benchmark_suite_exists():
    """The benchmark suite file exists and has test functions."""
    path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "benchmarks", "bench_srs.py",
    )
    assert os.path.exists(path)
    content = open(path).read()
    assert "def test_bls_sign_benchmark" in content
    assert "def test_seg_admission_benchmark" in content
    assert "def test_z3_nominal_solve_benchmark" in content
    assert "def test_adaqc_compile_benchmark" in content
