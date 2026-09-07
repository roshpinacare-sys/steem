# 11 — V24 Observability Fix: Mission Control was structurally blind to ~90% of the system

## Why this pass happened

The backend (`cli.ts` + 12 agents + ~30 services) emits 27 distinct `telemetry.decision(phase, ...)` tags. The Mission Control UI is the only place a human sees what the system is actually doing. This pass traced the full path from `telemetry.decision()` calls in the backend to what actually renders in the browser, and found the UI was discarding almost all of it — not due to missing data, but due to filtering/field bugs on the frontend and one missing event on the backend. This is very likely the cause of the "very narrow description" observed when using the app: the richest, newest parts of V24 (every oracle, every autonomous agent, every safety guard except four) had no path to the screen at all.

## Root causes found and fixed

### 1. `DecisionTimeline.tsx` — hardcoded 6-phase allowlist silently dropped ~22 real phases

```ts
const PHASE_ORDER = ["architect", "coder", "warden", "gate", "canary", "meta-agent"] as const;
...
if (!(PHASE_ORDER as readonly string[]).includes(phase)) continue;
```

Grepping every `telemetry?.decision("...")` call site across `packages/agent/src` turns up 27 distinct phase tags: `architect, coder, gate, warden, meta-agent, secret-guard, necromancer, mentor, semantic-dag, compliance-oracle, context-enricher, darwin-engine, infra-oracle, janitor, style-aligner, ui-synthesizer, cartographer, incident, sre-feedback, semantic-cache, skill-exchange, vector-skill-exchange, edge-fragment, edge-test, edge-test-channel, r2-storage, ai-router, run`. Only 4 of those (`architect`, `coder`, `gate`, `meta-agent`; `warden` is a 5th, see below) were in the allowlist — every event from every other agent (all 5 previously-unwired oracles: compliance, context-enricher, darwin-engine, infra, plus janitor, style-aligner, ui-synthesizer, cartographer, incident-resolver, sre-feedback, and every infra/cache/memory event) was silently discarded at line 56 before ever reaching the render. Additionally, `"canary"` was in the allowlist but nothing in the codebase ever calls `telemetry.decision("canary", ...)` with that literal string (the canary block's own validation call is tagged `"gate"` via `runGuarded`), so that slot in the old UI was permanently empty regardless of activity.

**Fix:** replaced the fixed allowlist with `apps/mission-control/src/utils/phase-meta.ts` — a label + category lookup, not a filter. Any phase, registered or not, now renders; an unregistered phase falls into an "Other" category with its raw name instead of disappearing. `DecisionTimeline.tsx` now groups by category (Core Pipeline / Safety & Governance / Autonomous Agents / Infra & Memory / Run Lifecycle / Other) so the panel scales as more agents are added instead of needing a manual allowlist edit every time.

### 2. `warden.ts` — worth noting as a *correct* pattern, not a bug

Initial read looked like `agents/warden.ts` was dead code (nothing in `cli.ts` imports it directly). On closer inspection it's wired correctly, just indirectly: `coder.ts` passes `wardenGuard` as the 4th-argument guard callback into `validateAndRetry()`, so Warden's AST-based rejections (bare `any`, `console.log`, un-try/caught `await`) participate in the same retry-and-feedback loop as schema validation, and its rejections do reach `loadWardenLessons()`/`recordWardenRejection()` (a 14-day Redis memory the Coder reads back to avoid repeating the same mistake). No change needed here — flagging it so it isn't mistakenly "fixed" into a redundant second call site in a future pass.

### 3. `RunHistory.tsx` — every run showed "in-progress" forever, and "0ms" duration, always

```ts
if (ev.phase === "done")        entry.outcome = "success";
if (ev.phase === "fatal-error") entry.outcome = "failure";
if (ev.ts && entry.startedAt) { entry.durationMs = ...; }
```

Two independent field-name bugs, both dead on arrival:
- The pipeline never emits an event with `phase === "done"` or `phase === "fatal-error"` — completion is `telemetry.decision("run", "done", ...)` and the crash path is `telemetry.decision("run", "fatal-error", ...)`. Both put the terminal signal in `decision`, not `phase`. The check compared the wrong field, so it could never match — every run's outcome stayed at its default `"in-progress"` no matter how it actually ended.
- `TelemetryEvent` has no `ts` field (it's `timestamp`) — `ev.ts` was always `undefined`, so the duration branch never ran and every row showed `0ms`.

**Fix:** corrected both field references (`ev.decision === "done" / "fatal-error"`, `ev.timestamp`). Also discovered while fixing this: `telemetry.decision("run", "done", ...)` **did not exist anywhere** — `s.phase = "done"` in `cli.ts` only ever updated the Redis-persisted `RunState` checkpoint, never the telemetry stream the UI reads. Added the missing `await telemetry.decision("run", "done", { prNumber, commitSha })` call right where the run actually completes. Without this, fixing the frontend field name alone would still have shown every successful run stuck at "in-progress" — the event to detect simply didn't exist yet.

### 4. `App.tsx` — `currentPhase` was computed and never used anywhere

`TelemetryContext.tsx` computes `currentPhase` (the latest event's phase) correctly and exposes it through `useTelemetryCtx()`. Grepping the entire `apps/mission-control/src` tree for `currentPhase` turns up exactly one hit: the definition itself. The primary "Current Mission" hero panel — the first thing anyone sees — showed only the static objective string the user typed at dispatch time, with no live indication of what phase the run was actually in or what it had last decided.

**Fix:** `App.tsx` now derives the latest event via the existing (also previously unused outside `RunHistory`) `latestEvent()` helper in `styles.ts`, and renders a live status line — phase label, last decision, timestamp, and a color-coded dot (amber/running, green/done, red/failed) — directly under the mission text.

## Files changed

```
apps/mission-control/src/utils/phase-meta.ts        (new — shared label/category registry)
apps/mission-control/src/components/DecisionTimeline.tsx  (category-grouped, non-lossy rendering)
apps/mission-control/src/components/RunHistory.tsx         (fixed outcome + duration field bugs)
apps/mission-control/src/App.tsx                            (live phase/decision status in hero panel)
packages/agent/src/cli.ts                                   (added missing terminal `run/done` telemetry event)
```

## Verified this pass

Every file above was transformed with `esbuild` (TS/JSX stripped, `--bundle=false`, output discarded) to confirm no syntax errors were introduced. **Not run:** `tsc --noEmit`, `vitest`, or a live render — this sandbox has no access to the project's actual dependency graph for a full typecheck. Run `npm run build && npm test` in `apps/mission-control` and `packages/agent` before merging.

## Explicitly out of scope for this pass

This pass targeted the observability path end-to-end (backend telemetry emission → proxy → frontend rendering) because that's what the reported symptom pointed at. It did **not** re-verify the 26 backend files `10-V24-AUDIT-AND-FIXES.md` already flagged as "not independently verified" (`sbom-generator.ts`, `license-checker.ts`, `cve-scanner.ts`, `otel-tracer.ts`, `prometheus-metrics.ts`, `slo-tracker.ts`, `alerting-rules.ts`, `confidence-scorer.ts`, `model-consensus.ts`, `dry-run.ts`, `hot-reload-config.ts`, `progress-bar.ts`, `style-aligner.ts`, `infra-oracle.ts`, `compliance-oracle.ts`, `context-enricher.ts`, `ui-synthesizer.ts`, `janitor.ts`, `cartographer.ts`, `canary.ts`, `health-check.ts`, `incident-resolver.ts`, `sre-feedback.ts`, `skill-exchange.ts`, `vector-skill-exchange.ts`, `ast-doc.ts`, every test file). Those files now at least have a UI path to be *seen* acting once their telemetry fires — but whether each one's actual logic is sound is still unverified. That remains the highest-value next pass: the observability layer can now show the truth, but nobody has yet confirmed what each of those 26 files' "truth" actually is.
