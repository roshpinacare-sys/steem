# ADR-0023: Encrypted Application Database Backup and Atomic Restore

Status: Accepted for local file-based deployments.

## Problem

A backup claim is false until a consistent snapshot can be encrypted, corrupted or wrong-key input is rejected, and a clean target can be restored and validated.

## Decision

Provide a local application-database backup format that:

- Creates a consistent SQLite snapshot with `VACUUM INTO` after a WAL checkpoint.
- Verifies quick-check, foreign keys, and required tables before packaging.
- Encrypts the complete database snapshot with scrypt and AES-256-GCM using authenticated format context.
- Records application version, migrations, database hash, size, and creation time inside the encrypted payload.
- Writes backup and restore targets atomically.
- Refuses overwrite unless explicitly authorized and preserves a displaced database during replacement.
- Re-verifies database integrity before final restore.

Passphrases are supplied through environment variables and are not stored in the archive or command line.

## Alternatives

1. Copy the live SQLite file directly. Rejected because WAL state can make the copy inconsistent.
2. Export rows to unencrypted JSON. Rejected because it exposes secrets and can lose database semantics.
3. Require cloud backup. Rejected because it creates a mandatory external dependency.

## Consequences

The database and in-database artifacts can be restored without a cloud service. Operators must stop application writers before replacement restore, protect the passphrase separately, and retain the matching source release. Full RTO/RPO drills on a clean deployment remain operational work.
