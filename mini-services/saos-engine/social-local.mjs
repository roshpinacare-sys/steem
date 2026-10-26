/* social-local.mjs — W18 · THE LOCAL EXECUTION LEG OF THE ARMED SOCIAL RAIL.
 * CI's exec-cycle runs runSocial every 2h — but W18 (the arming commit) is
 * push-blocked by the dead git-cred (measured 2026-10-20, incident SEC-6);
 * until a fresh token lands, THIS office is the executor. The 30-min loop
 * adds NO law and NO permission: the dual-key gate (readiness.json ×
 * Autonomy SOCIAL-ARMING.json), the stealth window (11-21 UTC, R254),
 * the anti-farm caps and every think-gate/spamgate still judge per call.
 * Laws honored: gate-closed ⇒ STANDBY receipt (same as CI); window-closed ⇒
 * due=0; any error ⇒ logged, never crashed, never retried hot. */
import { runSocial } from "./army-social.mjs";
import { appendFileSync } from "node:fs";
import path from "node:path";

const LOG = path.join(new URL(".", import.meta.url).pathname, "state", "social-local.log");
const log = (o) => { try { appendFileSync(LOG, JSON.stringify(o) + "\n"); } catch { /* read-only fs */ } };

const TICK_MS = 30 * 60_000;

async function cycle() {
  const t0 = Date.now();
  try {
    const r = await runSocial({ now: new Date() });
    log({ at: new Date().toISOString(), verdict: r?.verdict ?? null, gate: r?.gate?.mode ?? null, executed: r?.executed ?? 0, due: r?.due ?? 0, refused: r?.refused ?? 0, ms: Date.now() - t0 });
  } catch (e) {
    log({ at: new Date().toISOString(), error: String(e?.message ?? e).slice(0, 160), ms: Date.now() - t0 });
  }
}

await cycle(); /* first cycle immediately — the gate+window laws decide */
setInterval(cycle, TICK_MS);
log({ at: new Date().toISOString(), boot: true, tickMs: TICK_MS, law: "no new law — every call passes the full gate stack" });
