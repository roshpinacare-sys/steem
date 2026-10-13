#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// HYPERGRID-BURST — bounded tick revival for serverless substrates (T-62).
// ───────────────────────────────────────────────────────────────────────────
// Measured 2026-10-11: the hyper-grid tick loop died with its long-lived
// substrate (lastTickAt frozen 2026-10-10T16:49:38Z while conf.enabled=true —
// a silent 22h+ stall nothing in git noticed). GitHub Actions cannot run a
// permanent 3s loop, but it CAN run a bounded burst: boot the real loop,
// let the governor do its capped work (or tick honestly UNARMED), stop, and
// report the measured delta. The heartbeat lives again — revived FROM git,
// on the public host, free minutes, no external sandbox required.
//
// LAWS:
//  - zero engine changes: startHyperGrid()/hyperState() are the public API,
//    the loop's timers live on globalThis (G = globalThis) — burst stops them.
//  - arming is the operator's standing order (.secrets/exec-armed.json via
//    the substrate env). Unarmed = ticks advance + verdicts honestly say why
//    no ops executed. Burst NEVER arms by itself. Fail-closed.
//  - exit law: enabled && ticks did NOT advance ⇒ exit 1 (the revival failed
//    — the substrate run must go red). disabled ⇒ exit 0 honest no-op.
//  - single-flight: startHyperGrid() is boot-idempotent (one loop/process).
// ═══════════════════════════════════════════════════════════════════════════
import { startHyperGrid, hyperState, hyperConf } from "./hypergrid.mjs";

const G = globalThis;
const BURST_MS = Math.min(Math.max(Number(process.env.HYPER_BURST_MS ?? 90_000), 5_000), 300_000);
const out = (...a) => console.log(...a);

const conf = hyperConf();
const before = hyperState();
/* hyperState() = { running, startedAt, pid, runtime: <hyper-grid.json>, ops: <hyper-ops.json> } —
 * ticks/lastTickAt live under .runtime (the state file), not at the root. */
const beforeTicks = Number(before?.runtime?.ticks ?? 0);
const beforeVerdict = before?.runtime?.lastVerdict ?? "none";

if (conf?.enabled !== true) {
  out(JSON.stringify({ burst: "no-op", reason: "grid disabled by operator switch (conf.enabled !== true)", enabled: conf?.enabled ?? null }));
  process.exit(0);
}

out(`burst: starting hyper-grid loop for ${BURST_MS}ms (ticks so far: ${beforeTicks}, lastVerdict: ${beforeVerdict}, armed-file: operator's standing order)`);
startHyperGrid();
await new Promise((r) => setTimeout(r, BURST_MS));

if (G.__saosHyperTimer) { clearInterval(G.__saosHyperTimer); G.__saosHyperTimer = null; }
if (G.__saosHyperTailTimer) { clearInterval(G.__saosHyperTailTimer); G.__saosHyperTailTimer = null; }

const after = hyperState();
const afterTicks = Number(after?.runtime?.ticks ?? 0);
const delta = afterTicks - beforeTicks;
const result = {
  burst: "done",
  burstMs: BURST_MS,
  ticksBefore: beforeTicks,
  ticksAfter: afterTicks,
  ticksAdvanced: delta,
  lastTickAt: after?.runtime?.lastTickAt ?? null,
  lastVerdict: after?.runtime?.lastVerdict ?? null,
  opsToday: after?.runtime?.opsToday ?? null,
};
out(JSON.stringify(result));

if (delta < 1) {
  out("burst FAILED: loop did not advance ticks — honest red");
  process.exit(1);
}
out("burst OK: the grid heartbeat advanced (revived from git)");
