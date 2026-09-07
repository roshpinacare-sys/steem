# ADR-0047 — Hash-Pinned Operating-System Key Custody Helper

## Status
Accepted

## Context
Pure TypeScript cannot directly prove Windows DPAPI, TPM, Linux Secret Service, smart-card, or hardware-token custody without a platform integration.

## Decision
Use a minimal external helper only when its platform, binary hash, backend identity, allowed purposes, input schema, timeout, and no-shell invocation are verified. The portable encrypted keystore remains the explicit fallback.

## Consequences
No opaque helper is trusted. Missing platform custody remains visible and blocking; fallback never silently claims hardware protection.
