/**
 * truthrail-outcome.mjs — R316 · THE TRUTHRAIL OUTCOME GATE
 * (Z/main agent, 2026-10-11; plan §3-P3: sovereignty-execution-plan-Z).
 *
 * THE DISEASE IT CURES: for weeks every run was GREEN while the mission was
 * idle — custody 14/14, selftest green, and yet draftsQueued=0, zero posts,
 * zero outside voters ("everything confirmed, nothing works"). Green gates
 * measure the MACHINE; this rail measures the OUTCOME on the live chain and
 * turns the run RED only when the machine itself fails at its one job.
 *
 * MEASURED (every number from the public chain, never from books):
 *   posts24h      — fleet posts created in the last 24h (roster accounts)
 *   outsideVotes  — votes on those posts from accounts OUTSIDE the roster
 *                   (anti-closed-loop metric: the roster cannot vote its way
 *                   to success; only the world can)
 *
 * VERDICT LAW (red only on machine-controllable failure):
 *   RED-STREAM-STARVING (exit 1) — stream ARMED and posts24h == 0 after a
 *                   healthy RPC round: the stream is starving in production.
 *                   This is the public alarm; pulse + digest still run
 *                   (their workflow steps are if: always()).
 *   PASS-STANDBY (exit 0) — the army-social rail's OWN fresh receipt says
 *                   SOCIAL-STANDBY (state/social.json, written every cycle
 *                   by runSocial's exec29 choke-point). The readiness gate is
 *                   the live authority over the roster — it is re-evaluated
 *                   every run, never cached (exec29/29-b) — so when it stands
 *                   the fleet DOWN, the stream cannot "starve"; it is
 *                   lawfully idle by owner directive (2026-10-14 low-profile
 *                   law). Measured 2026-10-17: armed-file true (CI_SOCIAL_ARMED
 *                   secret) + gate STANDBY produced 19h of hourly RED spam —
 *                   a red page the owner's own standby law controls trains
 *                   the operator to ignore red (this file's own disease
 *                   doctrine). The receipt outranks the armed FILE because
 *                   the gate outranks the standing order: the standing order
 *                   is a precondition, the gate verdict is the measured law
 *                   of THIS cycle. When the owner arms the gate, the receipt
 *                   disappears (verdict leaves SOCIAL-STANDBY) and the RED
 *                   law is instantly live again — fail-closed both ways.
 *   WARN-CLOSED-LOOP             — posts24h > 0 but outsideVotes == 0.
 *                   NOT red: outside votes depend on the world, not the
 *                   machine; a red page the world controls trains the
 *                   operator to ignore red.
 *   PASS                          — posts24h > 0 AND outsideVotes >= 1.
 *   PASS-UNARMED                  — stream not armed; nothing can starve.
 *   RPC-FAILED (exit 0)           — cannot measure is not an alarm; honest
 *                   absence, recorded in state/truthrail.json.
 *
 * SELF-CHECK: `node truthrail-outcome.mjs --selfcheck` runs the pure vectors
 * and exits 0/1 WITHOUT touching the network. Production mode writes
 * state/truthrail.json and merges truthrail* fields into
 * state/ci-last-heartbeat.json so the daily digest issue and the run summary
 * inherit them automatically.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(DIR, "..", "..");
const STATE = path.join(DIR, "state");

/* the working fleet — the exact roster the custody step verifies (ci-cycle) */
export const TRUTHRAIL_ROSTER = [
  "headcorner", "cashmachine", "haran", "israelnews", "lsa", "macrame",
  "siq", "tov", "wic", "wog", "woq", "hcsoldier4", "hcsoldier5", "hcsoldier6",
];

const RPC_NODES = [
  "https://api.steemit.com",
  "https://api.steemitdev.com",
  "https://steem-api.ctimeg.com",
];

async function rpcAt(node, method, params) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(node, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
      signal: ctrl.signal,
    });
    const j = await r.json();
    if (j?.error) return { ok: false, error: String(j.error?.message ?? "rpc-error").slice(0, 100) };
    return { ok: true, result: j?.result ?? null, node };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 100) };
  } finally {
    clearTimeout(t);
  }
}

export async function rpcCall(method, params) {
  let last = null;
  for (const node of RPC_NODES) {
    const r = await rpcAt(node, method, params);
    if (r.ok) return r;
    last = r.error;
  }
  return { ok: false, error: last ?? "all-rpc-nodes-failed" };
}

/* ── pure (vector-locked): window + outside-vote math ────────────────────── */
export function withinLast24h(isoCreated, nowIso) {
  const t = Date.parse(String(isoCreated ?? ""));
  if (!Number.isFinite(t)) return false;
  const now = Date.parse(nowIso);
  return now - t >= 0 && now - t <= 24 * 3600 * 1000;
}

export function outsideVotesOf(activeVotes, roster) {
  const set = new Set(roster.map((r) => String(r).toLowerCase()));
  let outside = 0;
  let total = 0;
  for (const v of Array.isArray(activeVotes) ? activeVotes : []) {
    const who = String(v?.voter ?? "").toLowerCase();
    if (!who) continue;
    const pct = Number(v?.percent ?? 0);
    if (pct <= 0) continue; /* dust and flag weights are not support */
    total += 1;
    if (!set.has(who)) outside += 1;
  }
  return { outside, total };
}

/* a standby receipt older than this is NOT lawful standby — a stale receipt
 * with an armed standing order means the rail failed to report = machine
 * failure, the RED law applies (fail-closed toward the alarm) */
export const STANDBY_FRESH_MS = 35 * 60_000; /* heartbeat ~18min; 35min = one missed cycle of grace */

export function standbyReceiptOf(socialState, nowIso, { freshMs = STANDBY_FRESH_MS } = {}) {
  try {
    /* accepts a path (production) or an already-parsed object (pure vectors) */
    const d = typeof socialState === "string" ? JSON.parse(fs.readFileSync(socialState, "utf8")) : socialState;
    const at = String(d?.at ?? "");
    const t = Date.parse(at);
    const fresh = Number.isFinite(t) && Date.parse(nowIso) - t >= 0 && Date.parse(nowIso) - t <= freshMs;
    return {
      present: true,
      fresh,
      lawful: fresh === true && d?.verdict === "SOCIAL-STANDBY",
      verdict: String(d?.verdict ?? ""),
      gateMode: String(d?.gate?.mode ?? ""),
      gateReason: String(d?.gate?.reason ?? "").slice(0, 160),
      at,
    };
  } catch {
    return { present: false, fresh: false, lawful: false, verdict: "", gateMode: "", gateReason: "", at: "" };
  }
}

export function verdictOf({ armed, posts24h, outsideVotes, rpcHealthy, standbyLawful = false }) {
  if (!rpcHealthy) return "RPC-FAILED";
  if (standbyLawful) return "PASS-STANDBY"; /* the rail's own gate stands down — measured, fresh, owner law */
  if (!armed) return "PASS-UNARMED";
  if (posts24h === 0) return "RED-STREAM-STARVING";
  return outsideVotes >= 1 ? "PASS" : "WARN-CLOSED-LOOP";
}

/* ── the measurement ──────────────────────────────────────────────────────── */
async function measure({ nowIso }) {
  const health = await rpcCall("condenser_api.get_dynamic_global_properties", []);
  if (!health.ok) {
    return { rpcHealthy: false, error: String(health.error ?? "").slice(0, 100), perPost: [], posts24h: 0, outsideVotes: 0, totalVotes: 0 };
  }
  const posts = [];
  for (const acct of TRUTHRAIL_ROSTER) {
    const r = await rpcCall("condenser_api.get_discussions_by_blog", [{ tag: acct, limit: 5 }]);
    if (!r.ok) continue;
    for (const p of Array.isArray(r.result) ? r.result : []) {
      if (String(p?.author ?? "").toLowerCase() !== acct) continue;
      if (!withinLast24h(p?.created, nowIso)) continue;
      posts.push({ author: acct, permlink: String(p?.permlink ?? "").slice(0, 80), created: p.created });
    }
  }
  let outsideVotes = 0;
  let totalVotes = 0;
  const perPost = [];
  for (const p of posts.slice(0, 12)) {
    const r = await rpcCall("condenser_api.get_content", [p.author, p.permlink]);
    if (!r.ok || !r.result?.author) continue;
    const ov = outsideVotesOf(r.result.active_votes, TRUTHRAIL_ROSTER);
    outsideVotes += ov.outside;
    totalVotes += ov.total;
    perPost.push({ ...p, votes: ov.total, outside: ov.outside });
  }
  return { rpcHealthy: true, perPost, posts24h: posts.length, outsideVotes, totalVotes };
}

async function main() {
  const selfcheck = process.argv.includes("--selfcheck");
  const nowIso = new Date().toISOString();

  /* pure vectors — the rail refuses to run if it cannot pass its own truth */
  const vectors = [
    [withinLast24h(nowIso, nowIso), true, "now-in-window"],
    [withinLast24h("2020-01-01T00:00:00Z", nowIso), false, "old-post-out"],
    [withinLast24h("not-a-date", nowIso), false, "garbage-date"],
    [outsideVotesOf([{ voter: "cashmachine", percent: 1000 }, { voter: "somehuman", percent: 500 }], TRUTHRAIL_ROSTER).outside, 1, "one-outside"],
    [outsideVotesOf([{ voter: "cashmachine", percent: 1000 }], TRUTHRAIL_ROSTER).outside, 0, "all-inside"],
    [outsideVotesOf([{ voter: "stranger", percent: -500 }], TRUTHRAIL_ROSTER).outside, 0, "flag-not-vote"],
    [outsideVotesOf([{ voter: "cashmachine", percent: 0 }], TRUTHRAIL_ROSTER).total, 0, "dust-not-vote"],
    [verdictOf({ armed: true, posts24h: 0, outsideVotes: 0, rpcHealthy: true }), "RED-STREAM-STARVING", "red-law"],
    [verdictOf({ armed: true, posts24h: 2, outsideVotes: 0, rpcHealthy: true }), "WARN-CLOSED-LOOP", "warn-law"],
    [verdictOf({ armed: true, posts24h: 2, outsideVotes: 3, rpcHealthy: true }), "PASS", "pass-law"],
    [verdictOf({ armed: false, posts24h: 0, outsideVotes: 0, rpcHealthy: true }), "PASS-UNARMED", "unarmed-law"],
    [verdictOf({ armed: true, posts24h: 0, outsideVotes: 0, rpcHealthy: false }), "RPC-FAILED", "no-measure-no-alarm"],
    [verdictOf({ armed: true, posts24h: 0, outsideVotes: 0, rpcHealthy: true, standbyLawful: true }), "PASS-STANDBY", "standby-law-beats-armed-file"],
    [verdictOf({ armed: false, posts24h: 0, outsideVotes: 0, rpcHealthy: true, standbyLawful: true }), "PASS-STANDBY", "standby-law-beats-unarmed"],
    [verdictOf({ armed: true, posts24h: 0, outsideVotes: 0, rpcHealthy: true, standbyLawful: false }), "RED-STREAM-STARVING", "no-receipt-still-red"],
    [standbyReceiptOf({ at: nowIso, verdict: "SOCIAL-STANDBY", gate: { mode: "STANDBY", reason: "owner law" } }, nowIso).lawful, true, "fresh-standby-receipt"],
    [standbyReceiptOf({ at: "2020-01-01T00:00:00Z", verdict: "SOCIAL-STANDBY", gate: { mode: "STANDBY" } }, nowIso).lawful, false, "stale-receipt-not-lawful"],
    [standbyReceiptOf({ at: nowIso, verdict: "SOCIAL-EXECUTED", gate: { mode: "ARMED" } }, nowIso).lawful, false, "armed-receipt-revives-red-law"],
    [standbyReceiptOf(path.join(STATE, "social.json.does-not-exist"), nowIso).present, false, "missing-receipt-honest"],
    [standbyReceiptOf({}, nowIso).present, true, "empty-object-is-present-but-unlawful"],
    [standbyReceiptOf({}, nowIso).lawful, false, "empty-object-not-lawful"],
  ];
  const failed = vectors.filter(([got, want]) => got !== want);

  if (selfcheck) {
    if (failed.length) {
      console.error("TRUTHRAIL-SELFCHECK-FAILED " + JSON.stringify(failed.map((f) => f[2])));
      process.exit(1);
    }
    console.log("TRUTHRAIL-SELFCHECK-PASS " + vectors.length + " vectors");
    return;
  }
  if (failed.length) {
    /* a rail that lies must not run — refuse loudly */
    console.error("TRUTHRAIL-VECTOR-REFUSAL " + JSON.stringify(failed.map((f) => f[2])));
    process.exit(1);
  }

  const armed = fs.existsSync(path.join(ENGINE, ".secrets", "social-armed.json"));
  const receipt = standbyReceiptOf(path.join(STATE, "social.json"), nowIso);
  /* diagnosis: what the streamer (the other armed rail) last did — visible in
   * state + digest so a starvation always carries its own WHY */
  let streamerVerdict = "";
  try { streamerVerdict = String(JSON.parse(fs.readFileSync(path.join(STATE, "ci-last-heartbeat.json"), "utf8"))?.post ?? ""); } catch { }
  const m = await measure({ nowIso });
  const verdict = verdictOf({ armed, posts24h: m.posts24h, outsideVotes: m.outsideVotes, rpcHealthy: m.rpcHealthy, standbyLawful: receipt.lawful });

  const out = {
    at: nowIso,
    rail: "truthrail-r316",
    verdict,
    armed,
    standby: { present: receipt.present, fresh: receipt.fresh, lawful: receipt.lawful, receiptVerdict: receipt.verdict, gateMode: receipt.gateMode, gateReason: receipt.gateReason, at: receipt.at },
    streamerVerdict,
    posts24h: m.posts24h,
    outsideVotes: m.outsideVotes,
    totalVotes: m.totalVotes,
    posts: m.perPost.slice(0, 12),
    law: "RED only when truly armed and starving (machine failure); lawful standby is PASS-STANDBY (owner gate, fresh receipt); closed-loop is WARN (world-dependent); no measure is no alarm",
  };

  fs.mkdirSync(STATE, { recursive: true });
  fs.writeFileSync(path.join(STATE, "truthrail.json"), JSON.stringify(out, null, 2));

  /* merge into the heartbeat state so digest + summary inherit it */
  try {
    const hbPath = path.join(STATE, "ci-last-heartbeat.json");
    if (fs.existsSync(hbPath)) {
      const hb = JSON.parse(fs.readFileSync(hbPath, "utf8"));
      hb.truthrail = verdict;
      hb.truthrailPosts24h = m.posts24h;
      hb.truthrailOutsideVotes = m.outsideVotes;
      if (receipt.lawful) { hb.truthrailStandby = receipt.gateReason || "standby receipt lawful"; }
      else hb.truthrailStandby = null;
      fs.writeFileSync(hbPath, JSON.stringify(hb, null, 2));
    }
  } catch { /* merge never blocks the verdict */ }

  console.log("TRUTHRAIL-VERDICT " + JSON.stringify({ verdict, armed, standbyLawful: receipt.lawful, gateMode: receipt.gateMode, posts24h: m.posts24h, outsideVotes: m.outsideVotes }));
  if (verdict === "RED-STREAM-STARVING") process.exit(1);
}

main().catch((e) => {
  console.error("TRUTHRAIL-FAIL", String(e?.message ?? e).slice(0, 160));
  process.exit(1);
});
