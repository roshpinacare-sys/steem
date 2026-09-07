# Changelog — V255 (Phase P151) — Automation Execution

**Release:** ECOS V255 · 2026-06-01 · AI lead

## Direction
V254 introduced the automation catalog — a validated, discoverable home for reusable recipes.
V255 **closes the loop**: registered automations can now be *executed*, step-by-step, with the
full safety stack engaged at each step.

## Feature — `automationRunner255` (src/lib + lib mirror)

### runAutomation255(opts)
Executes an automation recipe from the V254 catalog:
1. Load recipe by id from `automationCatalog254`.
2. For each step: resolve the tool runner via `toolCatalog237.getRunner237(name)`.
3. **Before** each step: call `classifyToolCall240` (V240 interlock):
   - `block` → abort the entire run immediately (`ABORTED`).
   - `require_hitl` → pause the run (`HITL_PAUSED`) and return — a human must approve before resuming.
   - `allow` → proceed.
4. Execute the tool `fn(args, ctx)`.
5. If `step.verify` defined → `assertNotSilentFailure240(result, spec)` — catches silent failures.
6. Persist every step via `appendMissionStep241` (crash-recovery substrate).
7. Emit progress events via optional `onProgress(event)` callback.

### triggerIntake255(opts)
Intake entry point for scheduled / webhook / event-triggered automations.
Finds all catalog entries matching `triggerType` and runs each via `runAutomation255`.

## API Endpoints

| Method | Path | Tag | Description |
|--------|------|-----|-------------|
| `POST` | `/api/v1/automations/:id/run` | V255-T01 | Execute a recipe; streams ndjson progress |
| `POST` | `/api/v1/automations/trigger-intake` | V255-T02 | Fire all matching-trigger automations |
| `GET`  | `/api/v1/admin/summary/v255` | V255-T03 | V255 summary |

## Verification
- `node --check` clean; `tests/v255.test.js` all pass.
- V254 (tests/v254.test.js) unchanged.
- Sacred files UNTOUCHED (R1): fiatLedger `563e9b1f…` · auditLog `e5a5c2c2…`.
- Zero new npm deps (R6).

## Breaking changes
None. Additive only.

## Next
- HITL resume: `POST /api/v1/automations/:runId/resume` after human approval.
- Gumloop populates catalog with real automation recipes.
- Automation scheduler (cron-based `triggerIntake255` calls for `schedule` triggers).
