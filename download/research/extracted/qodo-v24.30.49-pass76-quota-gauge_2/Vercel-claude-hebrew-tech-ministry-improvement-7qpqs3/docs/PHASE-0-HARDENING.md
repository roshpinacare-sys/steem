# Phase 0 — Post-Implementation Hardening Pass

A focused improvement pass over the shipped resume loop (ADR-005). Every item
here maps to a risk or key assumption the Binnacle Phase 0 handoff already
flagged; nothing is invented. Scope is reliability, operability, and one
missing observability connection — no new features, no scope creep (risk T10).

## Findings

### F1 — Reaper stale window vs. lock TTL (was a latent duplicate-dispatch window)

The handoff's key assumption U6 requires the reaper timeout to exceed the
worst-case `workflow_dispatch → first-checkpoint` latency; otherwise the reaper
requeues a run that is merely *slow to start* (GitHub Actions queue time +
runner boot + `npm ci`/build + `loadState`), causing a duplicate dispatch.

As first shipped, the drain reaper defaulted to `staleMs = 15 min`, below the
realistic Actions cold-start ceiling, while `acquireLock` TTL is 600 s. The
lock guarantees correctness (no two concurrent runs per PR), so this was never
a data bug — but it was a wasteful duplicate-dispatch window under load.

**Fix.** Default `staleMs` raised to **30 min** and made env-tunable
(`QODO_TRIGGER_STALE_MS`), with `QODO_TRIGGER_MAX_ATTEMPTS`,
`QODO_TRIGGER_MAX_BATCH`, and `QODO_TRIGGER_REAP_ONLY`. The timing contract is
documented in Invariant #12 (reaper = best-effort delivery; `acquireLock` =
authoritative dedup). Empty repo vars fall back to code defaults (Zod
`preprocess` maps `"" → undefined`), so the drain workflow can expose the knobs
safely. Covered by new tests (`maxBatch` cap, reap-only, slow-run-not-requeued).

### F2 — Silent dead-letter backlog (reliability)

Poison triggers dead-letter to `qodo:trigger:dead` after the attempt cap, but
nothing surfaced it — a stuck backlog would be invisible. The drain now logs a
depth snapshot every tick and emits a loud `log.warn` +
`trigger.dead_letter.present` telemetry event whenever `dead > 0`.

### F3 — No backlog visibility without shell access (missing connection)

The resume loop had no read surface. Added `GET /trigger-queue/health` to the
telemetry proxy (session-auth-gated, read-only `LLEN`) returning
`{ queued, processing, dead, ts }`, so operators — and Mission Control — can
see the drain keeping up and catch a dead-letter backlog. This connects the
consumer (ADR-005) to the existing observability boundary without touching the
agent or widening the Worker's trust surface.

## Deliberately NOT done (and why)

- **Alert delivery wiring** (`ALERT_WEBHOOK_URL`): no send helper exists in
  `src/`, and alert *delivery* is a live-mode concern. The structured
  telemetry + `log.warn` above is the offline-buildable signal; wiring a real
  alert channel belongs with the live-mode checklist (`PHASE-0-LIVE-MODE.md`).
- **Worker → adapter import**: unchanged; the payload contract is already
  aligned (see ADR-005 "Deferred"). Importing the TS adapter into the Worker
  needs a Workers-safe Redis client and buys nothing for Phase 0.
- **Mission Control queue-health card**: the endpoint exists; a UI card is a
  live-only surface (the app defaults to the on-device sandbox) and would add
  UI weight for a feature only meaningful once a live proxy is connected. Left
  as a fast follow, not bundled here.

## Verification

Offline: `npm run typecheck`, `npm test` (resume-loop suite extended to 10
cases), `npm run build`, dead-integrations green. Live-mode round-trip and the
new health endpoint against real Redis remain tracked in
`docs/PHASE-0-LIVE-MODE.md`.
