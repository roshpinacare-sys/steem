---
name: laya-system1
description: "Use when running, interpreting, or extending the SAOS System-1 reflex plane (רפלקס v112 — NandhaKishorM/laya adoption): the autonomous Python decision service on 127.0.0.1:3037 (/health · /decide · /triage · /guard · /route), its five coded memory laws (lazy single-flight · idle-15m unload · load-gate 2000MB · post-decision shed 700MB · watchdog 250MB exit=99), and the never-silent abstention contract that escalates to System-2 (the LLM). Enforces loopback-only trustedFetch, 64KB body cap, fail-honest health, and the rule that an abstention is a first-class signal — never silence."
license: MIT
metadata:
  adapted-from: "NandhaKishorM/laya — autonomous Python service with smart decision-making and coded memory laws (assessed clean-room; no source vendored)"
  saos-adoption: "v112.0.0 רפלקס — docs/LAYA-ADOPTION.md (rebuild-v112 wave, restored from the recovery-v110 spec; version line owned by the main session)"
  code-level: "mini-services/laya-service/main.py (stdlib-only service, memory laws as named constants) · src/lib/saos/system1.ts (trustedFetch + guardFromDecide + system1Kpis) · /api/saos/system1 (GET flat board · POST decide/triage/guard/route) · views/system1.tsx · supervisor-node.ts child #5 (:3037)"
---

# Laya System-1 (SAOS adaptation)

The רפלקס plane turns "decide fast and cheap" into a **gated reflex service with survival laws**. System-1 is the coded, sub-millisecond scorer; System-2 is the LLM. The bridge between them is the abstention — and an abstention is **never silent**: it is a first-class escalation signal.

## The System-1 / System-2 contract

- `/decide` scores a numeric feature map against a preset's weights (sigmoid over the weighted sum → confidence 0..1).
- `|confidence − 0.5| < preset.gate` → **abstain** with the fixed Hebrew reason `"רף-הימנעות — מסלול System-2 נדרש (לעולם לא שקט)"`. The upstream caller (`guardFromDecide` in `src/lib/saos/system1.ts`) maps this to `{needsSystem2: true, reason}` — the LLM takes the wheel. An abstention is honesty about reflex limits, never a hidden failure.
- `go` / `no-go` are reflex verdicts — fast, cheap, and audited in the oplog.

## The endpoints (loopback 127.0.0.1:3037 only)

| Endpoint | Body | Gate | Verdict shape |
|---|---|---|---|
| `GET /health` | — | — | live memory truth from /proc + counters + loaded preset |
| `POST /decide` | `{preset, features:{...}, context?}` | preset gate | `{decision: go\|no-go\|abstain, confidence, reason, elapsedMs, memoryShed?}` |
| `POST /triage` | `{items:[{id, score}]}` | 0.5 | `{ranked:[{id, score, tier: urgent\|soon\|later}], abstained:[ids]}` |
| `POST /guard` | `{action, risk}` | 0.5 | `{verdict: allow\|block\|abstain}` — **unknown action → block (fail-closed)** |
| `POST /route` | `{candidates:[{name, cost, latencyMs, health}]}` | 0.75 **advisory** | `{pick, advisory}` — below-gate still returns the best pick, flagged |

Presets (in-code, lazy single-flight loaded): `ops-guardian` (conservative, gate 0.18) · `growth-scout` (aggressive, gate 0.06) · `balanced-core` (gate 0.12).

## The five memory laws (coded, enforced, /health-truthed)

Born from the v112 live-OOM incident: the kernel killed a fleet member twice (exit=137; dmesg showed next-server at 1.4GB). The doctrine: **dying honestly is survival** — the reflex service may kill itself, the web tier must never be OOM-killed in its place.

1. **L1 lazy single-flight load** — presets load on first use only; a `threading.Lock` collapses concurrent first-loads into one load.
2. **L2 idle unload 15m** — a daemon sweeps every 60s; unused preset state is unloaded (`lastUnloadReason="idle-15m"`).
3. **L3 load-gate 2000MB** — before any load: `MemAvailable < 2000MB` (read from /proc/meminfo, not claimed) → **503 fail-closed**, no load happens.
4. **L4 post-decision shed 700MB** — after every decision: pressure below 700MB → immediate unload, `memoryShed:true` in that response.
5. **L5 mid-load watchdog 250MB** — a 5s daemon while a handler is active: `MemAvailable < 250MB` → `os._exit(99)` immediately, with a stdout log line. The supervisor (`supervisor-node.ts`, child #5) revives it; the web never dies.

## House transport law (trustedFetch)

Every byte to the service goes through `trustedFetch` (`src/lib/saos/system1.ts`): the URL must be **exactly** `http://127.0.0.1:3037` + a safe path — anything else is refused **before any bytes move** (no fetch, no DNS, no touch). 3s AbortController timeout, 64KB body cap enforced pre-send. Health reads are fail-honest: service down → `{ok:false, reason}` in Hebrew, never faked data.

## Provenance & boundaries

Adapted from **NandhaKishorM/laya** (clean-room; assessed honestly in docs/LAYA-ADOPTION.md). **Stolen:** abstention-gate semantics, the System-1/System-2 split, memory laws as survival law. **Refused:** any heavyweight runtime or cloud dependency — the house reflex runs on Python 3 stdlib only (http.server · json · os · time · threading; zero pip), loopback-only, presets in code.
