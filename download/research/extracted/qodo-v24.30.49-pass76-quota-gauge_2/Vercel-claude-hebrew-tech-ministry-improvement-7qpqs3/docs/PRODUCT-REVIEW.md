# Product Review — Qodo as a product (2026-07)

A product-team pass (architecture, product engineering, UX, automation,
strategy) over the restored codebase. Items marked **shipped** landed with
this review; everything else is a prioritized backlog with honest
value/effort/risk so the next contributor doesn't have to rediscover it.
The owner-level strategy built on top of this friction audit — capability
assessment, ranked roadmap, implementation phases — lives in
`PRODUCT_EVOLUTION_ROADMAP.md` at the repo root.

## What the product is

"Give it an objective; get a merged, canaried, monitored change" — an
autonomous delivery agent whose differentiation is not code generation but
the **guardrail system around it**: 5-gate validation, hash-chained audit
log, kill switch, sacred-file pinning, trust ledger, mentor mode, dry-run.
The honest pitch: *the safest way to let an agent touch production*.

## Where users actually feel friction (ranked)

1. **First run.** ~70 env vars; previously no way to know whether your
   configuration was viable without launching a real mission.
   **Shipped:** `node bootstrap.mjs --verify` (grouped ✓/✗/– report, exit
   codes for scripting, `--live` pings GitHub/Redis/Groq with your real
   credentials) and CLI `--help`/`--version` that work with zero config.
2. **First look.** Mission Control rendered silently-empty panels when the
   telemetry proxy wasn't configured — indistinguishable from "broken".
   **Shipped:** an explicit first-run setup panel naming the one missing
   step.
3. **Trust in autonomy.** `--dry-run` was advertised but did nothing
   (fixed during the overhaul — now halts before commit/deploy/merge with a
   simulation report). This is the single most important trust feature; the
   README leads with it.

## Opportunity backlog (deliberately not implemented now)

| Opportunity | Value | Effort | Risk / why deferred |
|---|---|---|---|
| **Wire `canAutoMerge` into the merge phase** — trust ledger already scores per-category bonds; merge currently ignores them. Gate auto-merge on bond ≥ threshold, else flip to mentor mode. | High: turns the trust ledger from bookkeeping into the product's core promise | Medium | Changes core merge behavior; needs its own e2e scenarios + a migration story for existing repos (all bonds start at 50 → nothing auto-merges) |
| **GitHub App auth instead of a PAT** | High: org installability, scoped permissions, no long-lived token in secrets | Medium-high | New auth path through GitHubClient; keep PAT as fallback |
| **Per-run cost budget** (`QODO_MAX_USD_CENTS`): kill-switch when costTracker crosses it, surfaced in the PR comment | High for anyone paying for tokens | Low-medium | Needs careful placement so a budget halt checkpoints cleanly |
| **Mission Control: run timeline & cost panel from existing telemetry** (cost-summary events already emitted; UI ignores them) | Medium-high | Medium | Frontend has no test harness yet — add vitest+RTL first |
| **Obfuscator single-pass renamer** (ts-morph per-decl rename is quadratic; scale suites take minutes — see `tests/scale/`) | Medium: unlocks big-file privacy mode | Medium | Correctness-sensitive; the scale suite is the ready-made oracle |
| **Single-command demo** (`npx qodo demo`): run the examples/local-simulator against a sample repo with zero credentials | Medium: sells the product in 60 seconds | Low | Keep the simulator honestly labeled as a mock |
| **Publish the k8s image in CI** (build+push on tag) so the KEDA path is one `kubectl apply` away | Medium | Low | Needs a registry decision (ghcr.io) + secret |
| **Frontend test harness + App.tsx decomposition** (594 lines, inline styles) | Medium: maintainability | Medium | Do harness first; decompose behind it |
| **Sourcegraph/ClearlyDefined license cross-check** (license-checker trusts the lockfile's self-reported field — archive GAP) | Low-medium | Medium | External API dependency; rate limits |

## Principles applied (and worth keeping)

- Nothing ships claimed-but-unverified: every quickstart command is what CI
  runs; docs that predate real execution live in `docs/history/` with
  warnings.
- Guardrails must be *wired*, not written: dry-run, path-guard, license
  policy and the audit log were all "existing but unreachable" until this
  overhaul; the dead-integrations CI check now fails the build when a new
  export has no call site.
- No complexity without a user on the other end: the service-consolidation
  and hexagonal-DI ideas were considered and rejected (see `docs/adr/001`).
