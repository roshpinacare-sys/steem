# Security, Trust, and Safety

## Primary trust boundaries

Browser to application, user to workspace, model to context, model to capability broker,
broker to tool, ingestion to knowledge, memory to future runs, application to provider,
worker to control plane, adapter to external protocol, build to release, and backup to restore.

## Required controls

- Deny-by-default authorization and explicit delegation.
- Capability descriptors independent of prompt content.
- Schema validation, output validation, redaction, timeout, cancellation, and idempotency.
- Risk-based approval with visible scope and side effects.
- Prompt and retrieval injection tests at every untrusted-text boundary.
- Tenant, run, memory, cache, telemetry, and backup isolation.
- Asset inventory, hashes, license review, provenance, signing, and verification.
- Resource ceilings for tokens, model calls, tools, CPU, memory, disk, network, and time.
- Structured security errors without secret leakage.

## Red-team minimum

Test direct and indirect injection, malicious tool descriptions, poisoned documents,
confused deputy, argument smuggling, excessive agency, output injection, data exfiltration,
cross-tenant retrieval, stale approval, replay, denial of service, dependency compromise,
model replacement, audit tampering, backup theft, and unsafe recovery.
