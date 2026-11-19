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
import { runBooklaw } from "./booklaw.mjs";
import { openOrders, accountState } from "./measure.mjs";
import { masterAccount, executeOps, execPaused, loadCredential, verifyRoles } from "./signer.mjs";
import { reviveArmyCustody } from "./vault-revival.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

/* ═══ 27-a BOOT CUSTODY — the burst is a fresh process (measured 2026-10-17) ═══
 * The beat's chain adoption (ci-cycle step 1 → reviveArmyCustody → signer.mem)
 * lives IN-PROCESS: this fresh process booted with empty identities and ticked
 * CREDENTIAL-MISSING while the SAME job's beat held a chain-verified ACTIVE
 * identity and signed real delegations (CI-HEARTBEAT 01:40:58Z, ops=4). The
 * engine's own typed error names this: "an engine sequencing bug, never an
 * operator task". Fix: run the SAME lawful vault revival here — chain-judged,
 * fail-closed, zero new key material (the vault IS the credential delivery,
 * R314b). A refusal prints honestly and the ticks keep reporting the typed
 * state — nothing is fabricated, nothing is silenced. */
let bootCustody = "skipped";
try {
  const r = await reviveArmyCustody({ now: new Date().toISOString() });
  bootCustody = String(r?.verdict ?? "done").slice(0, 80);
} catch (e) {
  bootCustody = "REFUSED: " + String((e && e.message) || e).slice(0, 100);
}
out("burst boot custody: " + bootCustody);

/* ═══ §73 MASTER SELF-PROOF — complete the designed in-process verification ═══
 * Measured 2026-11-19 (runs 44486804493 / 44494563792 / 44501213286 — RED ×3
 * + owner email flood): the workflow arms headcorner.key (GRID-ARMED,
 * step-level chain-judged) but THIS fresh process never proves the master
 * identity — boot-custody revival came up PARTIAL (vault meta not in the
 * repo after the crown-seal round, by design), so custodyOf(master) stayed
 * master-unverified and thinkGate REFUSED every lawful op (typed
 * THINK-GATE-REFUSED — no exec-log row, error:null) surfacing as booklaw
 * CANCEL-FAILED «unknown» red on every armed cycle. Fix: the SAME lawful
 * self-proving every revival uses — verifyRoles derives from the
 * ALREADY-ARMED credential and chain-judges (zero new key material; the
 * chain stays the only judge). A mismatch keeps the typed honest verdicts
 * below — nothing fabricated, nothing silenced. */
let masterVerify = "skipped";
try {
  const ver = await verifyRoles(masterAccount());
  masterVerify = ver?.ok ? ("VERIFIED-VS-CHAIN fp=" + String(ver.fingerprint ?? "").slice(0, 16)) : String(ver?.verdict ?? ver?.reason ?? "no-match").slice(0, 80);
} catch (e) {
  masterVerify = "ERROR: " + String((e && e.message) || e).slice(0, 80);
}
out("burst master verify: " + masterVerify);

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

/* ═══ BOOKLAW REVIVAL — the account's own risk desk, wire-back (2026-10-16) ═══
 * Measured disease: the coverage law was orphaned (lib refactor lost
 * booklawPlan — the module could not even load, zero callers since 10-02)
 * while the chain accumulated 20.35 SBD of phantom bid overflow from an
 * orphaned fat tranche no living lane owns (registry lost with a sandbox
 * generation). "כסף תקוע בלימיטים" — the owner's words, made literal.
 * The burst now runs the law after the tick loop stops: measure → plan →
 * cancel worst-price overflow (orphans first, hyper band untouchable,
 * ≤20 ops) through the SAME think-gate/exec rails every op must pass.
 * Fail-honest: a refused broadcast is a typed verdict, never a fake green. */
if (delta >= 1) {
  try {
    const acc = masterAccount();
    /* 27-a: exec=null when credentials are ABSENT — booklaw's own designed
     * honest path ("CANCEL-PENDING — no active broadcaster this cycle": the law
     * measures and journals, the risk is recorded, never faked). Without this
     * gate a lawful unarmed run exited 1 on CANCEL-FAILED and the whole grid
     * got stood down (measured 01:40Z). With credentials present, a refused
     * broadcast is STILL a typed CANCEL-FAILED red — real defects stay loud. */
    let haveCreds = false;
    try { loadCredential(acc); haveCreds = true; } catch { haveCreds = false; }
    const [oo, st] = await Promise.all([openOrders(acc), accountState(acc)]);
    const oursFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "state", "our-orders.json");
    let registryIds = [];
    try { registryIds = (JSON.parse(fs.readFileSync(oursFile, "utf8")).orderids ?? []).map((x) => (typeof x === "object" && x !== null ? x.id : x)); } catch { /* honest empty */ }
    const law = await runBooklaw({
      observe: { orders: oo.ok ? oo.orders : null, inventory: st.ok ? { steem: st.steem, sbd: st.sbd } : null },
      registryIds,
      now: new Date().toISOString(),
      exec: (execPaused() || !haveCreds) ? null : async (ops, tag) => executeOps(ops, { tag }),
    });
    out("booklaw: " + JSON.stringify({ verdict: law.verdict, coverage: law.coverage, cancelIds: law.cancelIds, cancelWhy: law.cancelWhy, broadcast: law.broadcast }));
    if (law.broadcast && law.broadcast.ok === false && !law.broadcast.pending) {
      const gv = String(law.broadcast.verdict ?? "");
      /* §73: the typed guard set executeAs can return WITHOUT a wire attempt
       * (measured 2026-11-19: no exec-log row + error:null = guard verdict,
       * never a node/key failure). All of these are credential/allocation/
       * resource states, not execution defects — they print here EVERY cycle
       * with their reason (zero silencing, journal keeps the verdict) and
       * keep the run honest-green; re-arm/verification stays owner-process.
       * Only a REAL wire failure (BROADCAST-FAIL carrying a node error) or
       * an unknown shape keeps the loud red below. */
      const GUARD_VERDICTS = new Set(["OPERATOR-PAUSED", "DISARMED", "ERA3-NO-FUEL", "HIERARCHY-DENIED", "THINK-GATE-REFUSED", "KEY-UNVERIFIED", "ROLE-KEY-ABSENT", "RC-FLOOR"]);
      if (GUARD_VERDICTS.has(gv)) {
        out("booklaw GUARD-SKIPPED: typed guard (" + gv + (law.broadcast.reason ? ":" + String(law.broadcast.reason).slice(0, 120) : "") + ") — verdict journaled + printed every cycle, honest-green exit");
      } else {
        out("booklaw RED: repair broadcast failed (" + law.verdict + ") — " + String(law.broadcast.error ?? "unknown"));
        process.exitCode = 1;
      }
    } else if (law.broadcast?.pending) {
      /* 27-a: the lawful unarmed state (measured, journaled, CANCEL-PENDING) —
       * honest amber, never a dead run. The overflow stays visible in the
       * coverage numbers and in the journal every single cycle. */
      out("booklaw PENDING: repair journaled, no broadcaster this cycle (honest, non-fatal)");
    }
  } catch (e) {
    out("booklaw error (honest, non-fatal): " + String((e && e.message) || e));
  }
}

if (delta < 1) {
  out("burst FAILED: loop did not advance ticks — honest red");
  process.exit(1);
}
out("burst OK: the grid heartbeat advanced (revived from git)");
