# CLAUDE HANDOFF — V33.20

Read `CLAUDE.md`, `MASTER_DIRECTIVE.md`, `PROGRAM_CHARTER.md`, and the V33 governance registries before making changes.

## Canonical result

V33.20 adds a local two-daemon durable authority reference with:

- `src/app/external-durable-authority-v33_20.ts`
- `src/cli/durable-lease-authority-daemon-v33_20.ts`
- `tests/external-durable-authority-v33_20.test.ts`
- `scripts/external-durable-authority-proof-v33_20.mjs`

Do not describe it as PostgreSQL, SPIFFE/SPIRE, multi-host consensus or production-ready. The accepted evidence class is:

`LOCAL_SUPERVISORD_TWO_DAEMON_SQLITE_WAL_REFERENCE`

The local workload URI format is SPIFFE-shaped but the identity provider is explicitly `LOCAL_ENTERPRISE_PKI_REFERENCE`.

## Required validation

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm run validate:v33.20
```

Production promotion remains blocked.
