# Titai — Canonical Agent Platform v18

Titai is a local-first studio for designing, running, inspecting, governing, and
recovering AI-agent work. It includes deterministic zero-key simulation, optional
commercial and local model adapters, policy-gated tools, human approvals, a live
execution canvas, structural evidence, a tamper-evident audit chain, governed
memory, and repository-owned durability contracts.

The v18 package adds the Sovereign Capability Foundry, signed capability packages, a scoped local registry, Mission Compiler, policy compilation, controlled self-improvement, multi-agent handoffs, persistent Foundry candidates, and the Local Document Tool Pack. The complete platform remains in development while the Capability Foundry subsystem is classified as a controlled capability pilot.

## Highlights

- **Mission Control and Living Canvas** — inspect plans, dependencies, tools,
  approvals, artifacts, and terminal outcomes in real time.
- **Evidence Ledger** — exposes event gaps, unresolved calls, approval gaps, and
  reconstructability instead of treating a status badge as proof.
- **Canonical execution pack** — research claims, ADRs, dependency-aware tasks,
  acceptance gates, adversarial findings, and independent-verification rules.
- **Portable durability core** — leases, revisioned checkpoints, deterministic
  side-effect receipts, reconciliation, bounded workers, crash proof, and encrypted
  durable snapshots.
- **SQLite hardening** — transactional run idempotency, event/audit serialization,
  durable job and receipt schema, transactional outbox, and migration validation.
- **Governed Memory Ledger** — user-owned records with provenance, confidence,
  sensitivity, correction, expiry, deletion, explainable scoring, and retrieval budgets.
- **Encrypted application backup** — consistent SQLite snapshot, AES-256-GCM,
  integrity validation, atomic restore, overwrite protection, and negative tests.
- **Security boundaries** — deny-by-default policy path, bounded tool schemas,
  SSRF defenses, safer regular expressions, closed registration by default,
  context-bound secret encryption, CSP, and browser security headers.
- **Observability and budgets** — local SLO metrics, latency percentiles, backlog
  signals, run deadlines, output limits, and deterministic context truncation.
- **Release evidence** — CycloneDX SBOM, license inventory, model inventory, source
  provenance, English-only validation, secret scanning, and repeatable Roast checks.

## Technology

Next.js 15 · React 19 · TypeScript · Tailwind CSS v4 · Drizzle ORM · SQLite
(`better-sqlite3`) · Auth.js · next-intl · React Flow · SSE · Vitest · Playwright.

## Safe quickstart

1. Install dependencies on a development machine that permits the documented
   native SQLite package:

   ```bash
   npm ci
   ```

   On a security-sensitive workstation where native install scripts are not
   permitted, use:

   ```bash
   npm ci --ignore-scripts --no-audit --no-fund
   npm run test:safe
   ```

   This constrained mode does not prove native database behavior.

2. Copy `.env.example` to `.env`. Generate independent random values for
   `AUTH_SECRET` and `ENCRYPTION_KEY`. A cross-platform Node command is:

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
   ```

3. Apply migrations:

   ```bash
   npm run db:migrate
   ```

4. Optional disposable demo seed: set `TITAI_ALLOW_DESTRUCTIVE_SEED=1` and a
   unique `TITAI_DEMO_PASSWORD` of at least 12 characters in `.env`, then run:

   ```bash
   npm run seed
   ```

5. Start the app:

   ```bash
   npm run dev
   ```

Simulation works without any model API key. Ollama can provide a local model path.

## Core validation commands

| Command | Purpose |
|---|---|
| `npm run canonical:validate` | Validate claims, tasks, ADR references, coverage, and dependency graph |
| `npm run language:validate` | Enforce the English-only source distribution |
| `npm run lint` | Noninteractive source, JSON, dangerous-code, and client-boundary checks |
| `npm run typecheck` | TypeScript validation |
| `npm run db:migrations:validate` | Apply every SQL migration in built-in SQLite and verify structural invariants |
| `npm run test:safe` | Full deterministic suite using the configured SQLite driver |
| `npm run test:persistence` | Persistence suites through the portable SQLite driver |
| `npm run test:v14` | Focused v14 persistence, recovery, tenancy, and release tests |
| `npm run pilot:v14:prove` | Multi-process, approval, outbox, disk-full, restore, and failure-matrix proof |
| `npm run eval:baseline` | Reproducible lifecycle and evidence evaluation |
| `npm run durable:prove` | Crash-after-side-effect, lease takeover, resume, restore, and verifier proof |
| `npm run roast:static` | Repeatable adversarial control scan |
| `npm run roast:validate` | Validate all machine-readable Roast findings |
| `npm run roast:dynamic` | Run runtime, recovery, security, product, release, and performance Roast modes |
| `npm run mutation:v12` | Run curated semantic mutation probes |
| `npm run benchmark:v12` | Generate deterministic local microbenchmarks |
| `npm run release:evidence` | Generate SBOM, licenses, model inventory, and source provenance |
| `npm run release:audit` | Validate package exclusions, canonical integrity, language, and credential hygiene |
| `npm run build` | Telemetry-disabled production build |

## Backup and restore

Stop application writers before a replacement restore. Store the passphrase
separately from the backup and source repository.

```bash
npm run backup:create
npm run backup:restore
```

The scripts load `.env` and use:

- `DATABASE_PATH`
- `TITAI_BACKUP_PATH`
- `TITAI_BACKUP_PASSPHRASE`
- `TITAI_RESTORE_OVERWRITE=1` only for an explicitly authorized replacement

Restore validates encryption, database hash, SQLite quick-check, foreign keys,
and required tables before atomically replacing a target.

## Canonical agent workflow

Every coding or research agent must begin with [`AGENTS.md`](AGENTS.md):

```bash
npm run canonical:validate
npm run canonical:next
npm run canonical:context -- TASK-ID
```

A builder may mark work `implemented`; only an independent verifier may mark it
`verified` or `done`.

## Important limitations

- The selected pilot workflow has portable SQLite, bounded-build, multi-process lease,
  approval compare-and-set, outbox, disk-full, and encrypted clean-restore evidence.
- The browser installed in the validation container is governed by a deny-all URL policy,
  so browser E2E, accessibility, visual regression, responsive, and offline browser gates
  remain environment blocked and were not bypassed.
- The pilot failure matrix proves 21 of 25 scenarios; the remaining scenarios depend on
  browser evidence or final hash-bound release verification.
- Live remote-model continuation across arbitrary process restarts remains outside the
  validated pilot boundary.
- Drizzle ORM remains on the locked version until a real upgraded package can be acquired,
  integrity-checked, migrated, tested, and rolled back in an isolated environment.

See [`docs/canonical/49_V14_PILOT_ENGINEERING_REPORT.md`](docs/canonical/49_V14_PILOT_ENGINEERING_REPORT.md), [`docs/canonical/48_V14_EVIDENCE_INDEX.md`](docs/canonical/48_V14_EVIDENCE_INDEX.md), and [`docs/canonical/47_V14_HONEST_LIMITATIONS.md`](docs/canonical/47_V14_HONEST_LIMITATIONS.md).

## License

MIT.

## v12 evidence control surfaces

- **Run Dossier** exposes model routing, governed context, runner mode, approval state, tool effects, and recovery evidence.
- **Operations signal plane** exposes local SLO posture, approval waits, durable-job state, and outbox pressure.
- These surfaces report control evidence; they do not claim semantic correctness or production health.

The release remains **DEVELOPMENT ONLY** until native SQLite, full build, browser E2E, accessibility, live-provider restart, full tenancy, and independent-verification gates pass.


## Sovereign development mode

v15 adds three evidence-backed local-first slices: a zero-key local workflow, signed air-gap handoffs, and signed offline updates with rollback. The accurate classifications remain `SOVEREIGN DEVELOPMENT MODE` and `DEVELOPMENT ONLY` until a real local model, process-level outbound audit, measured target-hardware energy, offline clean installation, and independent final-hash verification pass.

Safe proof commands:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run sovereignty:safe
```

## v16 operational sovereignty

v16 adds a vendor-neutral real local-runtime lifecycle, fail-closed model qualification,
purpose-separated portable key custody, governed lexical retrieval without embeddings,
process-attributed Linux network evidence, real signed-update migration rehearsal, a clean
offline dependency-install proof, signed isolated-worker execution, and an authoritative
per-file test runner that requires process exit.

The release still does **not** claim a real local generative-model benchmark, browser or
accessibility completion, OS/TPM-backed key custody, or measured target-hardware energy.
The accurate classifications remain `SOVEREIGN DEVELOPMENT MODE` and `DEVELOPMENT ONLY`.

Primary v16 commands:

```bash
npm run test
npm run v16:update-rehearsal
npm run v16:network-audit
npm run v16:node:prove
npm run v16:hardware
npm run v16:model:qualify
```
