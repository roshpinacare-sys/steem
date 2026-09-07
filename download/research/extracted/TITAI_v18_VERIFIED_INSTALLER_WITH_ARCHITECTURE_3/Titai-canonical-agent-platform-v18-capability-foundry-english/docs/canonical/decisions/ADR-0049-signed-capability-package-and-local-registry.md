# ADR-0049: Signed capability package and local registry

## Status
Accepted for the bounded v18 Capability Foundry pilot.

## Decision
All extensible capability types use one signed manifest. A tenant/workspace-scoped local registry is authoritative for quarantine, qualification, installation, activation, revocation, rollback, and uninstall. Installation never implies activation.

## Consequences
Unsigned, modified, expired, incompatible, over-permissioned, revoked, or stale-evidence packages fail closed. Sandbox strength remains a separate release gate.
