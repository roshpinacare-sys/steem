# ADR-0042: Process-level network evidence with application attribution

## Status
Accepted for Linux validation lanes.

## Problem
Application policy logs cannot prove that libraries, package managers, browsers, model runtimes, or child processes made no hidden network connection.

## Alternatives
1. Trust configuration and application logs.
2. Capture packets without identifying the responsible process.
3. Combine application-level connection instrumentation with Linux `/proc` socket-to-process attribution and preserve both evidence streams.

## Decision
Adopt option 3 for the current Linux validation lane. It records PID, parent PID, executable, command, socket addresses, and instrumented DNS/HTTP/TCP attempts. Other operating systems require equivalent adapters.

## Security impact
Unexpected outbound traffic becomes visible and can block sovereignty classification. Absence of observations is evidence only when the audit ran successfully.

## Acceptance evidence
- `scripts/network-audit-preload.cjs`
- `scripts/process-network-audit.py`
- `docs/canonical/evidence/v16/network/process-evidence.json`
