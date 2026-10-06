/**
 * index.ts — SAOS sovereign engine HTTP service (port 3040).
 * T-12: master credential is ENGINE-HELD (operator's standing order) —
 * signing is doctrine-capped in signer.mjs; credentials never leave memory;
 * every broadcast is journaled with txids (never keys).
 */
import { runCycle, cycleRunning, cycleMarker } from "./daily.mjs";
import { externalParity, internalFeed, accountState, openOrders, measureAll } from "./measure.mjs";
import { execStatus, credentialState, armedConf, adoptCredentialText, verifyRoles, spoilagePublic } from "./signer.mjs";
import { soldiersPublic } from "./soldiers.mjs";
import { intelState } from "./intel.mjs";
import { curatorState } from "./curator.mjs";
import { learningState } from "./learning.mjs";
import { adaptationBoot, publicAdaptation } from "./adaptation.mjs";
adaptationBoot(); // R210 §XVI: restart counter — adaptation store proves persistence across boots
import { discoveryState } from "./discovery.mjs";
import { fleetState } from "./fleet.mjs";
import { startHyperGrid, hyperState } from "./hypergrid.mjs";
import { webintelState } from "./webintel.mjs";
import { contentState } from "./content.mjs";
import { rcTankState } from "./rctank.mjs";
import { payoutsState } from "./payouts.mjs";
import { weaveState } from "./weave.mjs";
import * as fs from "node:fs";
import * as path from "node:path";

const PORT = 3040;
const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const ACCOUNT = process.env.SAOS_ACCOUNT || "headcorner";

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };
const readLines = (p, n = 20) => {
  try {
    return fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean).slice(-n)
      .map((l) => { try { return JSON.parse(l); } catch { return { unparsed: l.slice(0, 120) }; } });
  } catch { return []; }
};

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

// T-16 brute-force bound for /adopt-credential (in-memory timestamps)
const adoptAttempts: number[] = [];

async function handle(req) {
  const url = new URL(req.url);
  const p = url.pathname;
  if (p === "/health") return json({ ok: true, service: "saos-engine", account: ACCOUNT, at: new Date().toISOString(), keyless: false, credentialMode: "runtime-adopted · WIFs derived on demand (signer.mjs) · memory-only — never persisted, never logged, never returned", doctrine: "capped-autonomy" });
  if (p === "/status") {
    const execLog = (() => { try { return fs.readFileSync(path.join(STATE, "exec-log.jsonl"), "utf8").trim().split("\n").filter(Boolean).slice(-8).map((l) => { try { return JSON.parse(l); } catch { return { unparsed: l.slice(0, 80) }; } }); } catch { return []; } })();
    let exec = null;
    try { exec = await execStatus(); } catch (e) { exec = { ok: false, reason: String(e?.message ?? e).slice(0, 80) }; }
    /* T-22 ONE-BODY LAW: the live chain layer is computed HERE — the Next
     * proxy became a thin renderer; domain logic exists exactly once. */
    const [oo, acc] = await Promise.all([openOrders(ACCOUNT).catch(() => ({ ok: false, orders: [] })), accountState(ACCOUNT).catch(() => ({ ok: false }))]);
    const observe = readJson(path.join(STATE, "observe.json"));
    const offer = readJson(path.join(STATE, "offer.json"));
    const parityRef = offer?.marks?.paritySbdPerSteem ?? null;
    const pnl = observe?.pnl ?? null;
    const profit = pnl ? {
      ...pnl,
      parityRef,
      unrealizedAtParitySbd:
        (pnl.positionSteem ?? 0) > 1e-9 && parityRef
          ? Math.round((pnl.positionSteem * parityRef - (pnl.positionCostSbd ?? 0)) * 1e6) / 1e6
          : null,
      method: "יסוד-עלות-ממוצע על fill_order חי (A-10, lib.pnlFromFills — מימוש אחד בגוף) · מכירה-בלי-יסוד = unbased, לא רווח",
    } : null;
    return json({
      ok: true, at: new Date().toISOString(), account: ACCOUNT,
      observe,
      state: readJson(path.join(STATE, "state.json")),
      offer,
      convertPlan: readJson(path.join(STATE, "convert-plan.json")),
      daily: readJson(path.join(STATE, "daily-report.json")),
      intel: intelState(),
      curator: curatorState(),
      learning: learningState(),
      discovery: discoveryState(),
      soldiers: soldiersPublic(),
      execution: exec,
      credential: credentialState(),
      /* T-16: the visible price of the blocked signing rail (see signer.mjs
       * spoilagePublic — measured days/votes + ESTIMATED steem, never
       * claimed as measured money) */
      spoilage: spoilagePublic(),
      adaptation: publicAdaptation(), // R210: learned-rule state, verdicts only
      fleet: fleetState(),
      /* T-19b HYPER-GRID: the volume layer — live meter + day counter */
      hyper: hyperState(),
      /* T-22 ONE-BODY live layer — computed by the ENGINE (single source) */
      live: {
        orders: oo.orders ?? [],
        balances: acc.ok ? { steem: acc.steem ?? null, sbd: acc.sbd ?? null, vests: acc.vests ?? null } : null,
        rcPct: acc.ok ? acc.rcPct ?? null : null,
        chainReadOk: acc.ok || oo.ok,
      },
      profit,
      /* T-22 standing teams + the measured scaling curve */
      webintel: webintelState(),
      content: contentState(),
      rcTank: rcTankState(),
      /* T-23 · the payout instrument (estimated→measured converter) + the
       * weave handshake with the second signer (the one-body contract) */
      payouts: payoutsState(),
      weave: weaveState(),
      /* T-21 evidence files the cockpit renders (single source: the engine) */
      roles: readJson(path.join(STATE, "fleet-roles.json")),
      economics: readJson(path.join(STATE, "economics.json")),
      execLog,
      events: readLines(path.join(STATE, "events.jsonl"), 20),
      notes: ["sovereign engine · state lives inside my-project · master credential engine-held, doctrine-capped, never logged", "T-14: continuous-learning layer live — lessons from recorded history, hard-clamped tunings, growth-option discovery", "T-22: one-body law — every domain fact on this page is computed exactly once (here)"],
    });
  }
  if (p === "/hyper") {
    return json({ ok: true, at: new Date().toISOString(), account: ACCOUNT, ...hyperState() });
  }
  if (p === "/payouts") {
    return json({ ok: true, at: new Date().toISOString(), account: ACCOUNT, payouts: payoutsState() });
  }
  if (p === "/weave") {
    return json({ ok: true, at: new Date().toISOString(), account: ACCOUNT, weave: weaveState() });
  }
  if (p === "/cycle") {
    if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);
    /* T-17: START-ACK. The POST returns immediately; the cycle runs detached.
     * The sovereign polls /cycle-status for the marker — no HTTP wait can
     * outlive-or-kill a healthy multi-vote signing cycle again, and the
     * engine-side mutex (daily.mjs cycleInFlight) makes overlap impossible. */
    if (cycleRunning()) {
      return json({ ok: false, error: "cycle-in-flight", since: cycleMarker()?.startedAt ?? null });
    }
    void runCycle().catch((e) => {
      appendLine(path.join(STATE, "events.jsonl"), { type: "cycle.detached-error", at: new Date().toISOString(), error: String(e?.message ?? e).slice(0, 200) });
    });
    return json({ ok: true, started: true, at: new Date().toISOString() });
  }
  if (p === "/cycle-status") {
    return json({ ok: true, at: new Date().toISOString(), running: cycleRunning(), marker: cycleMarker() });
  }
  if (p === "/live") {
    try {
      const [par, feed, acc, oo] = await Promise.all([externalParity(), internalFeed(), accountState(ACCOUNT), openOrders(ACCOUNT)]);
      return json({ ok: true, at: new Date().toISOString(), account: ACCOUNT, parity: par, feed, account_state: acc, orders: oo.orders });
    } catch (e) { return json({ ok: false, error: String(e?.message ?? e).slice(0, 200) }, 502); }
  }
  if (p === "/fills") {
    const meas = await measureAll(ACCOUNT);
    return json({ ok: meas.ok, at: new Date().toISOString(), account: ACCOUNT, ...meas });
  }
  if (p === "/exec-status") {
    try { return json({ ok: true, at: new Date().toISOString(), ...(await execStatus()) }); }
    catch (e) { return json({ ok: false, error: String(e?.message ?? e).slice(0, 160) }, 500); }
  }
  // T-15: the unified agent registry — light route (state files + pids only,
  // zero chain reads) so the cockpit can afford it on every refresh
  if (p === "/fleet") {
    return json({ ok: true, at: new Date().toISOString(), fleet: fleetState({ credential: credentialState(), armedConf: armedConf() }), credential: credentialState(), spoilage: spoilagePublic() });
  }
  // T-16 · paste-revival — the fastest self-service path back to a living
  // signing fleet. Contract: the secret arrives as JSON body {text}, is
  // validated (pure), secured (0600 .secrets/), NEVER logged or echoed, and
  // verified against the chain's own authorities BEFORE the answer. Brute
  // force is bounded: 5 attempts/hour in-memory. On success the very next
  // cycle revives the whole signing fleet (zero restart).
  if (p === "/adopt-credential") {
    if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);
    const hourAgo = Date.now() - 3600_000;
    while (adoptAttempts.length && adoptAttempts[0] < hourAgo) adoptAttempts.shift();
    if (adoptAttempts.length >= 5) return json({ ok: false, error: "rate-limited (5/hour) — wait before retrying" }, 429);
    adoptAttempts.push(Date.now());
    let body: { text?: unknown } = {};
    try { body = await req.json() as { text?: unknown }; } catch { return json({ ok: false, error: "json-body required" }, 400); }
    const adopted = adoptCredentialText(String(body.text ?? ""), { source: "cockpit-paste" });
    if (!adopted.ok) return json({ ok: false, stage: "adopt", reason: adopted.reason });
    let ver: Record<string, unknown> | null = null;
    try { ver = await verifyRoles(adopted.account) as unknown as Record<string, unknown>; } catch (e) { ver = { ok: false, reason: String((e as Error)?.message ?? e).slice(0, 120) }; }
    const verified = Boolean((ver as { ok?: boolean } | null)?.ok);
    return json({
      ok: true, stage: "verified", account: adopted.account, fingerprint: adopted.fingerprint,
      verified, verdict: (ver as { verdict?: string } | null)?.verdict ?? (verified ? "VERIFIED" : null),
      reason: (ver as { reason?: string } | null)?.reason ?? null,
      guidance: (ver as { guidance?: string } | null)?.guidance ?? null,
      proposedPubkeys: (ver as { proposedPubkeys?: unknown } | null)?.proposedPubkeys ?? null,
      next: verified ? "the next cycle (≤10min) revives curate/execute/soldiers/promo — or kick a cycle now"
                     : "credential secured but not matching this account's authorities — install the proposedPubkeys on steemit.com, or paste the CURRENT password instead",
    });
  }
  return json({ ok: false, error: "not-found", routes: ["/health", "/status", "/hyper", "/payouts", "/weave", "/cycle", "/cycle-status", "/live", "/fills", "/exec-status", "/fleet", "/adopt-credential"] }, 404);
}

// T-15 SINGLE-INSTANCE LAW (measured live: 3 duplicate engine processes were
// found alive — 1 port owner + 2 zombies from a boot race). A second instance
// must NEVER linger: if the port is held by a HEALTHY engine → clean exit
// (adopt, don't duplicate). Only a short dying-process grace retry is allowed
// (the holder may be mid-death: unhealthy → retry 3×1s, then exit — never
// linger forever like the old 8×1.5s loop that leaked zombies).
let bound = false;
let duplicateExit = false;
// T-80 STRENGTHENED SINGLE-INSTANCE LAW (the measured triple-instance event,
// 2026-10-04: three `bun --hot index.ts` processes alive at once — Bun.serve
// does NOT throw EADDRINUSE synchronously on this runtime, so the old bind-
// catch guard never fired and 3 copies raced each other's orders, burning RC
// and journaling "unknown key" failures). Now: BEFORE binding, probe the
// port's health — a live engine answers → I am the duplicate → clean exit.
// The bind-catch path stays as the second line of defense.
for (let probe = 0; probe < 3 && !duplicateExit; probe++) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(2500) });
    if (r.ok) {
      console.log(`port ${PORT} held by a healthy engine (pre-bind probe) — duplicate-exit (single-instance law)`);
      duplicateExit = true;
      break;
    }
  } catch { /* nothing healthy on the port → proceed to bind */ }
  break;
}
for (let attempt = 1; attempt <= 3 && !bound && !duplicateExit; attempt++) {
  try {
    Bun.serve({
      port: PORT,
      fetch: (req) => handle(req),
      // T-14 root-cause fix (proven in engine.log): Bun's default idleTimeout
      // is 10s — a full cycle takes 10-12s, so the connection was killed
      // mid-cycle and the sovereign got "fetch failed" (1 real cycle fall).
      // 255s = Bun max; doctrine timeout (90s sovereign, 18s exec client)
      // still bounds every caller from the outside.
      idleTimeout: 255,
    });
    bound = true;
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (!/EADDRINUSE|address already in use/i.test(msg)) throw e;
    // who owns the port? healthy engine → I am the duplicate → exit cleanly
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(2500) });
      if (r.ok) {
        console.log(`port ${PORT} held by a healthy engine — duplicate-exit (single-instance law)`);
        duplicateExit = true;
        break;
      }
    } catch { /* holder unhealthy → give it a short dying-grace retry */ }
    if (attempt < 3) {
      console.log(`bind attempt ${attempt} failed (${msg}) — dying-holder grace, retry in 1s`);
      await new Promise((r) => setTimeout(r, 1000));
    } else {
      console.log(`port ${PORT} still held after grace — duplicate-exit (single-instance law)`);
      duplicateExit = true;
    }
  }
}
if (duplicateExit) process.exit(0);
if (!bound) throw new Error(`failed to bind :${PORT}`);

// T-15: the pid file must name the LIVE engine (measured live: a killed
// zombie's pid lingered here and poisoned the fleet registry's evidence)
try { fs.mkdirSync(STATE, { recursive: true }); fs.writeFileSync(path.join(STATE, "engine.pid"), String(process.pid)); } catch { /* best effort */ }

console.log(`saos-engine listening on :${PORT} (capped-autonomy, account=${ACCOUNT})`);

// T-19b HYPER-GRID: the volume layer — one writer, own tick loop, the same
// signing rail, the same doctrine guards. Booted with the engine, healed by
// the same watchdog (process-lifetime = engine lifetime).
try { startHyperGrid(); } catch (e) {
  console.error(`hypergrid boot failed: ${String(e?.message ?? e)}`);
}
