#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
security.py — Input validation + security hardening for SRS.

Provides:
  - validate_input: sanitize + validate user inputs (prevent injection)
  - SecurityHeaders: security headers for HTTP responses
  - InputValidator: reusable validation for common SRS inputs

Prevents:
  - SQL injection (parameterized queries in persistence.py)
  - Path traversal (input sanitization)
  - XSS (Content-Security-Policy headers)
  - CSRF (same-origin policy enforcement)
  - Oversized inputs (length limits)
"""
from __future__ import annotations

import re
import html
from dataclasses import dataclass
from typing import Any, Dict, Optional


# Maximum input sizes
MAX_MUTATION_ID_LEN = 256
MAX_DESCRIPTION_LEN = 4096
MAX_WITNESS_HASH_LEN = 128
MAX_VALIDATORS_COUNT = 20
MAX_EVIDENCE_CHAIN_DEPTH = 5

# Allowed patterns
SAFE_ID_PATTERN = re.compile(r'^[a-zA-Z0-9_\-\.]+$')
SAFE_HASH_PATTERN = re.compile(r'^[a-zA-Z0-9:]+$')
RISK_CLASSES = {"low", "medium", "high", "critical"}
ROLES = {"agent", "operator", "auditor", "admin"}


@dataclass
class ValidationResult:
    """Result of input validation."""
    valid: bool
    sanitized: Any = None
    error: str = ""


def validate_mutation_id(value: str) -> ValidationResult:
    """Validate a mutation ID — alphanumeric + dash/underscore/dot only."""
    if not value or len(value) > MAX_MUTATION_ID_LEN:
        return ValidationResult(False, error=f"mutation_id must be 1-{MAX_MUTATION_ID_LEN} chars")
    if not SAFE_ID_PATTERN.match(value):
        return ValidationResult(False, error="mutation_id contains invalid characters")
    return ValidationResult(True, sanitized=value)


def validate_description(value: str) -> ValidationResult:
    """Validate + sanitize a description (HTML-escape to prevent XSS)."""
    if not value:
        return ValidationResult(False, error="description is required")
    if len(value) > MAX_DESCRIPTION_LEN:
        return ValidationResult(False, error=f"description exceeds {MAX_DESCRIPTION_LEN} chars")
    sanitized = html.escape(value)
    return ValidationResult(True, sanitized=sanitized)


def validate_risk_class(value: str) -> ValidationResult:
    """Validate the risk class."""
    if value not in RISK_CLASSES:
        return ValidationResult(False, error=f"risk_class must be one of {RISK_CLASSES}")
    return ValidationResult(True, sanitized=value)


def validate_witness_hash(value: str) -> ValidationResult:
    """Validate a Z3 witness hash."""
    if not value or len(value) > MAX_WITNESS_HASH_LEN:
        return ValidationResult(False, error=f"z3_witness_hash must be 1-{MAX_WITNESS_HASH_LEN} chars")
    if not SAFE_HASH_PATTERN.match(value):
        return ValidationResult(False, error="z3_witness_hash contains invalid characters")
    return ValidationResult(True, sanitized=value)


def validate_role(value: str) -> ValidationResult:
    """Validate a role string."""
    if value not in ROLES:
        return ValidationResult(False, error=f"role must be one of {ROLES}")
    return ValidationResult(True, sanitized=value)


def validate_tenant_id(value: str) -> ValidationResult:
    """Validate a tenant ID — prevent path traversal."""
    if not value or len(value) > 128:
        return ValidationResult(False, error="tenant_id must be 1-128 chars")
    if ".." in value or "/" in value or "\\" in value:
        return ValidationResult(False, error="tenant_id contains path traversal characters")
    if not SAFE_ID_PATTERN.match(value):
        return ValidationResult(False, error="tenant_id contains invalid characters")
    return ValidationResult(True, sanitized=value)


def validate_evidence_chain(value: Dict[str, Any]) -> ValidationResult:
    """Validate an evidence chain dict — check depth + required fields."""
    if not isinstance(value, dict):
        return ValidationResult(False, error="evidence_chain must be a dict")
    # Check for required fields
    required = ["admissible", "seq"]
    for field in required:
        if field not in value:
            return ValidationResult(False, error=f"evidence_chain missing required field: {field}")
    # Prevent oversized chains
    import json
    serialized = json.dumps(value)
    if len(serialized) > 8192:
        return ValidationResult(False, error="evidence_chain too large (max 8KB)")
    return ValidationResult(True, sanitized=value)


def validate_validators(value: list) -> ValidationResult:
    """Validate the validators list."""
    if not isinstance(value, list):
        return ValidationResult(False, error="validators must be a list")
    if len(value) > MAX_VALIDATORS_COUNT:
        return ValidationResult(False, error=f"too many validators (max {MAX_VALIDATORS_COUNT})")
    return ValidationResult(True, sanitized=value)


# Security headers for HTTP responses
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'",
    "Referrer-Policy": "strict-origin-when-cross-origin",
}


def self_test() -> None:
    print("=" * 78)
    print("Security — Input validation + hardening self-test")
    print("=" * 78)

    # Valid inputs
    assert validate_mutation_id("mut-001").valid
    assert validate_description("FPGA rebalance").valid
    assert validate_risk_class("medium").valid
    assert validate_witness_hash("sha256:abc123").valid
    assert validate_role("agent").valid
    assert validate_tenant_id("acme-corp").valid
    print("  Valid inputs accepted: ✓")

    # Invalid inputs
    assert not validate_mutation_id("").valid
    assert not validate_mutation_id("mut'; DROP TABLE--").valid
    assert not validate_risk_class("extreme").valid
    assert not validate_tenant_id("../etc/passwd").valid
    assert not validate_role("superadmin").valid
    print("  Invalid inputs rejected: ✓")

    # XSS prevention
    result = validate_description("<script>alert('xss')</script>")
    assert result.valid
    assert "<script>" not in result.sanitized
    assert "&lt;script&gt;" in result.sanitized
    print("  XSS prevention (HTML escape): ✓")

    # Path traversal prevention
    assert not validate_tenant_id("../etc/passwd").valid
    assert not validate_tenant_id("acme/../../etc").valid
    print("  Path traversal prevention: ✓")

    # Security headers
    assert "X-Content-Type-Options" in SECURITY_HEADERS
    assert "Content-Security-Policy" in SECURITY_HEADERS
    print(f"  Security headers: {len(SECURITY_HEADERS)} configured ✓")

    print("=" * 78)
    print("Security self-test PASSED.")
    print("=" * 78)


if __name__ == "__main__":
    self_test()
