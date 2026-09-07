# Qodo V24

A self-healing, privacy-aware AI agent for autonomous software delivery.
Given an objective, it plans, writes, validates, commits, canaries, merges,
and monitors a change — with a Three.js dashboard for real-time visibility.

```
GitHub workflow_dispatch / webhook
        │
        ▼
  Architect ──► Coder ──► 5-gate validator ──► Ghost Commit ──► Canary ──► Merge + SRE watch
  (typed plan)  (patch)   lockfile · blast-radius · DOM        (PR branch)  (5% traffic)   (auto-revert)
                          · shadow-traffic · chaos-monkey
```

Every phase checkpoints to Upstash Redis and resumes transparently after a
crash. A kill switch (`QODO_HALT=true`), a hash-chained audit log, SHA-pinned
"sacred files", secret/path guards, and a per-category trust ledger bound the
agent's autonomy.

## Repository layout

| Path | What it is |
|---|---|
| `packages/agent/` | The agent. `src/pipeline/` is the phase orchestrator; `src/agents/` the LLM roles; `src/validators/` the gate; `src/services/` integrations and infrastructure. |
| `apps/mission-control/` | React dashboard — one responsive **Platform Shell** (`src/shell/`) on every surface, desktop and the Android APK alike. Runs on real data: a device-local GitHub token (runs/jobs/PRs/commits/files/dispatch) and/or the telemetry proxy; the built-in simulator is strictly opt-in and labeled. `src/mobile/` retains only the shared derive/sandbox engine. |
| `worker/`, `packages/agent/worker/` | Cloudflare Workers: telemetry proxy (auth/SSE/dispatch), AST fragment parser, GitHub webhook receiver. |
| `examples/local-simulator/` | Mock-only demo harness. **Not the product** — see its README. |
| `docs/` | Living documentation. `docs/history/` is the archived audit trail — including the pre-restoration docs whose claims were never verified. |
| `k8s/`, `Dockerfile`, `k6/` | Deployment artifacts (statically reviewed; see RUNBOOK for their prerequisites). |

## Verified quickstart

Every command below is exercised by CI on every push (`.github/workflows/agent-pipeline.yml`):

```bash
npm ci                  # install (root lockfile, npm workspaces)
npm run typecheck       # tsc --noEmit across all workspaces — 0 errors
npm test                # agent suite: 1,139 tests (vitest)
npm run build           # agent: tsc emit (dist mirrors src) + dashboard: vite
npm run test:examples   # 28 mock-pipeline tests in examples/local-simulator

# one-shot agent run (fails fast without real credentials — by design)
node packages/agent/dist/cli.js --dry-run
```

Required env (see `.env.example` for the full ~70-variable reference):
`GITHUB_TOKEN`, `GROQ_API_KEY`, `UPSTASH_REDIS_REST_URL`,
`UPSTASH_REDIS_REST_TOKEN`, `REPO`, `OBJECTIVE`.

`--dry-run` (or `DRY_RUN=true`) runs the full plan/code/gate flow and halts
before the first destructive operation (Ghost Commit, canary deploy, merge)
with a simulation report.

## Setup & operations

- **Guided setup:** `docs/SETUP.md` (free-tier services, ~10 minutes), then
  `node bootstrap.mjs` to collect credentials and push repo secrets.
- **Check your configuration** without launching anything:
  `node bootstrap.mjs --verify` (add `--live` to ping GitHub/Redis/Groq with
  your real credentials). `node packages/agent/dist/cli.js --help` works with
  zero configuration.
- **Owner control & readiness:** `.qodo/policy.yml` gives *this repo* a
  versioned budget cap, autonomy floor and approval mode (`docs/POLICY.md`).
  `node packages/agent/dist/cli.js --doctor` is a one-command, offline
  readiness + next-run preview; `--policy` prints just the control surface.
- **See it run at full capability, offline:**
  `node packages/agent/dist/cli.js --eval` runs the *entire* pipeline
  in-process with no network, no keys, and $0 spend — a deterministic local
  LLM, in-memory services, a verified audit chain — and prints an evaluation
  report. Governed by your `.qodo/policy.yml`. Owner-only (`docs/EVAL-MODE.md`).
- **Operations / failure modes:** `docs/RUNBOOK.md`.
- **Architecture:** `docs/ARCHITECTURE.md` · **Safety invariants:** `docs/INVARIANTS.md`.
- **Why things are the way they are:** `docs/adr/`.

## Android app (Mission Control APK)

Every CI run builds Mission Control as an installable Android app — a
phone-first experience (onboarding, bottom-tab navigation, live pipeline
stepper, mentor approvals, in-app connection settings), not a shrunken
desktop page. To get it:

1. Open the repo's **Actions** tab → the latest "Qodo V24 Agent Pipeline"
   run → **Artifacts** (bottom of the run page).
2. Download **`qodo-mission-control-apk`** (kept 30 days) and install the
   `app-debug.apk` inside (enable "install from unknown sources").
3. On first launch, enter your telemetry-proxy URL and dispatch passphrase
   in the app (Settings → Connection, or during onboarding). No rebuild
   needed — the connection is configured on the device. Optionally bake a
   default URL in at build time with the repository **variable**
   `QODO_TELEMETRY_PROXY_URL`.

The native project is generated in CI from
`apps/mission-control/capacitor.config.ts` — it is not committed. Local
build (requires Android SDK + Java 21), from `apps/mission-control`:
`npm run build && npx cap add android && cd android && ./gradlew assembleDebug`.
Every surface — phone, desktop, and the APK — serves the same responsive
**Platform Shell**. It runs on **real data**: paste a fine-grained GitHub token
(stored on-device, sent only to api.github.com) and the whole console works
against your repository — live workflow runs with job/step detail, commits,
pull requests, a full **Files** browser (view/edit/upload = real commits),
**Releases** with APK downloads, **Insights** analytics, **Governance**
(the repo's `.qodo/policy.yml` from trunk + the CLI-mode catalog), and
**Docs** rendered on-device. `New task` dispatches the agent pipeline via
`workflow_dispatch`. The built-in simulator exists but is strictly opt-in and
always labeled — never a silent default. A top-left app menu and a ⌘K palette
navigate everything; **Connections** verifies each integration live.

- **Studio** — an in-browser dev environment. With cross-origin isolation
  (COOP/COEP — the Vite dev/preview servers set it) it boots a full
  WebContainer Node runtime: `npm install`, dev server, live preview, build.
  Where isolation is impossible (the Android WebView) it switches to an
  on-device **local runtime**: your files execute for real in a sandboxed
  iframe with live console capture — never a dead screen.
- **Tasks** — launch delivery tasks (objective + repo, optionally dry-run) and
  watch many run in parallel on a live board.
- **Operate** (Overview · Activity · Runs · Pipeline) and **System**
  (Agents · Safety · Cost · **Automations** — autonomous modes + the resume
  queue + the edge-test executor), all from live telemetry.
- ⌘K opens the task composer; the mentor approval gate rides along.

## CI

`typecheck`, `test` (with a ratcheted coverage gate), `build`, `simulator`,
`security` (TruffleHog + SBOM + license policy), `audit-verify`, and
`android-apk` (Mission Control APK artifact) run secretless on every push
and PR. The write-capable `agent` job runs **only** via `workflow_dispatch`.

## Provenance

This tree was restored and overhauled from the `QODO-V24.30.46` archive. The
archive's own audit logs admit its test suite and compiler were never actually
executed; the first real verification (and what it found — including a parse
error that meant the agent had never compiled) is documented in
`docs/history/BASELINE-VERIFICATION.md`, and the archived documents under
`docs/history/` should be read with that in mind.
