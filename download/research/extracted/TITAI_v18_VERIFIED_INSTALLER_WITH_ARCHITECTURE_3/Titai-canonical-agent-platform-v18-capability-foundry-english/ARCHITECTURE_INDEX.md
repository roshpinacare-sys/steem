# TITAI v18 Architecture Index

This installer contains the complete TITAI v18 source, architecture, canonical design records, migrations, tests, release evidence, and Windows installation commands.

## Start here

1. `README.md` — project overview and operating model.
2. `docs/ARCHITECTURE.md` — current high-level architecture.
3. `docs/canonical/04_TARGET_ARCHITECTURE.md` — target platform architecture.
4. `docs/canonical/18_AGENT_EXECUTION_PROTOCOL.md` — canonical execution protocol.
5. `docs/canonical/20_DATA_LIFECYCLE_CONTRACT.md` — data and memory lifecycle.
6. `docs/canonical/41_V13_PILOT_SCOPE.md` — controlled pilot scope.
7. `docs/canonical/50_V15_SOVEREIGNTY_ARCHITECTURE.md` — sovereignty architecture.
8. `docs/canonical/55_V16_ARCHITECTURE_DELTA.md` — operational sovereignty changes.
9. `docs/canonical/60_V17_ARCHITECTURE_DELTA.md` — physical evidence and pilot gates.
10. `docs/canonical/65_V18_CAPABILITY_FOUNDRY_ARCHITECTURE.md` — Capability Foundry and Mission Compiler architecture.

## Core source areas

- `src/app/` — web application, API routes, and operator surfaces.
- `src/lib/` — durable execution, evidence, security, sovereignty, models, memory, and capability services.
- `src/lib/capabilities/` — signed packages, registry, Foundry, Mission Compiler, policy, sandbox, teams, evaluation, and improvement lab.
- `drizzle/` — ordered SQLite migrations.
- `scripts/` — validation, evidence, packaging, installer, migration, and release tooling.
- `skills/` — repository skills and capability definitions.
- `tests/` — isolated regression, security, persistence, race, mutation, and vertical-slice tests.
- `docs/roast/` — adversarial findings, playbook, and release manifest.

## Installation commands

- `INSTALL.cmd` — install and build TITAI.
- `START.cmd` — start the local application.
- `STOP.cmd` — stop the local application.
- `VERIFY.cmd` — verify installation health.
- `VERIFY_DEEP.cmd` — run deeper v18 validation.
- `REPAIR.cmd` — repair dependencies, migrations, and build.
- `BACKUP.cmd` / `RESTORE.cmd` — encrypted local backup and restore.
- `UNINSTALL_KEEP_DATA.cmd` — remove runtime while preserving data.
- `UNINSTALL_REMOVE_ALL.cmd` — remove the installation and its local data after confirmation.

## Important operating boundary

The complete TITAI platform remains classified as `SOVEREIGN DEVELOPMENT MODE` and `DEVELOPMENT ONLY`. The Capability Foundry subsystem is classified as `CONTROLLED CAPABILITY PILOT`. Physical gates such as target-hardware model benchmarking, TPM/OS key custody, unmanaged-browser E2E, two-host execution, target energy measurement, and external-host verification remain evidence-gated.
