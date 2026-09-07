# ADR-0036: Context-separated key hierarchy and portable memory

## Status
Accepted for sovereign development mode.

## Problem
One undifferentiated application secret creates excessive blast radius, while proprietary memory indexes create restore and migration lock-in.

## Alternatives
1. One installation secret. Minimal operations, maximum blast radius.
2. Hardware-only keys. Strong custody but excludes systems without supported hardware.
3. Derive context-separated installation, tenant, workspace, data, backup, and signing keys from a recoverable root; keep hardware custody optional. Preserve canonical memory in an open hash-bound format and rebuild derived indexes.

## Decision
Use HKDF context separation and independent Ed25519 signing identities. Export memory with provenance, confidence, authority, corrections, sensitivity, expiry, content hashes, and scope. Detect duplicate, conflict, missing correction target, and cross-tenant import.

## Risks
Root-key custody and rotation are not yet connected to TPM or OS keychain adapters. Energy and operational cost of large exports remain unmeasured.

## Acceptance evidence
- `src/lib/sovereignty/key-hierarchy.ts`
- `src/lib/sovereignty/memory-portability.ts`
- `tests/sovereign-key-hierarchy.test.ts`
- `tests/sovereign-memory-portability.test.ts`
