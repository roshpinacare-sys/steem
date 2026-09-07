# Dead-Code Triage — v24.30.0

**Status:** Restored 2026-07-07. This file is referenced by `CHANGELOG.md`
(24.30.1, "Reliability" section) but was missing from the consolidated
archive — a broken doc-to-file reference caught during repository-hygiene
review. Reconstructed from `scripts/dead-code-allowlist.json`, which is the
source of truth `scripts/check-dead-integrations.mjs` reads at CI time.

## Why this file exists

`check-dead-integrations.mjs` flags any exported function/const/class in
`packages/agent/src/{services,validators,agents}` that has no reference
outside its own file — a cheap, dependency-free proxy for "written, tested,
but never wired into a real pipeline run" (the bug class documented in
`06-CHANGELOG.md` Pass 33+ audits).

A raw flag isn't proof of dead code — the checker is a text search, not a
call graph, so it also fires on exports that are only used by tests, or
re-exported through an `index.ts`. Each flag has to be triaged once: either
wired into the pipeline, or recorded here with a reason so CI stops
re-flagging it. **A flag with no allowlist entry and no wiring is a real
gap** — this is what keeps the checker meaningful instead of turning into
permanent noise.

## Current state

Running the checker against this baseline:

```
$ node scripts/check-dead-integrations.mjs
check-dead-integrations: 85 export(s) flagged; all are in the allowlist.
```

All 85 flagged exports have a corresponding entry in
`scripts/dead-code-allowlist.json`, each tagged `intentional-public-api`.
**Zero untriaged flags** — CI (`agent-pipeline.yml`, `test` job) fails only
if a *new* unwired export appears without a matching allowlist entry.

## Breakdown by area

| Area | Files with allowlisted exports | Entries |
|------|-------------------------------|---------|
| `src/services/` (core) | ~30 files | ~65 |
| `src/services/integrations/` | 8 files | 9 |
| `src/validators/` | 1 file (`path-guard-scoped.ts`) | 3 |
| `src/agents/` | 4 files (`darwin-engine`, `meta-agent`, `supervisor`, `warden`) | 6 |

Representative examples and why they're legitimately unwired-but-kept:

- `path-guard-scoped.ts` — `loadPathGuardConfig`, `isPathAllowed`,
  `assertPathsAllowed` are called from `utils/path-guard.ts` (the delegate
  wired into `coder.ts`) and from tests directly; the checker's file-local
  reference search doesn't follow the delegate indirection, hence the flag.
- `audit-log.ts` → `verifyAuditChain` — exposed for operators/CI to verify
  the hash chain out-of-band (`08-VALIDATION.md`), not called from the
  pipeline itself by design.
- `ast-doc.ts` → `generateMermaidDiagram` / `generateMermaidGraph` — CLI/doc
  generation helpers invoked on demand, not part of the autonomous loop.
- `support-ticket-bridge.ts` (6 entries) — integration surface consumed by
  the ticket-ingestion webhook path, exercised in
  `tests/integrations/`, not from `cli.ts` directly.

## Action items closed by this pass

- [x] Recreate the missing file so the `CHANGELOG.md` reference resolves.
- [x] Re-run `check-dead-integrations.mjs` against the current tree and
      confirm 0 untriaged flags (still true — no regressions).

## Follow-up (unchanged from Pass 35/36 recommendations, still open)

- `fs.realpathSync` symlink-jail check is only applied in
  `r2-storage.ts` (24.30.1). `path-guard-scoped.ts` remains
  string-normalization-only by design (see in-code comment: it validates
  patch paths *before* they exist on disk, so `realpathSync` doesn't apply
  there). No action needed unless a future caller writes patch files
  directly to a real filesystem path before this check runs.
- Knip (`knip.json`) triage against `packages/agent` still needs a run with
  `node_modules` installed; not possible in a network-isolated shell. Flag
  for the next pass with install access.
