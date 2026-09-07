# ADR-0043: Portable purpose-separated key custody

## Status
Accepted as the portable fallback; OS or hardware custody remains blocked.

## Problem
One universal environment secret cannot safely serve tenant encryption, backups, handoffs, updates, verification, and installation identity.

## Alternatives
1. One environment key for all purposes.
2. Require TPM or an operating-system key store on every installation.
3. Provide an encrypted portable keystore with purpose, version, tenant/workspace scope, rotation, retirement, revocation, expiry, and audit, while keeping OS/hardware custody as a replaceable stronger backend.

## Decision
Adopt option 3. AES-256-GCM encrypts private material under a scrypt-derived wrapping key. Purpose and scope are enforced before use. No silent universal-key fallback is allowed.

## Limitations
The portable file is protected by its passphrase and filesystem controls. It is not equivalent to TPM-backed non-exportable keys.

## Acceptance evidence
- `src/lib/sovereignty/portable-keystore.ts`
- `tests/sovereign-portable-keystore.test.ts`
