/**
 * blurt.mjs — R294 · THE BLURT ORGAN (האיבר-השלישי: הקו-מתעורר).
 *
 * OWNER ORDER 2026-10-11 (supersedes R254 pause "לגבי blurt תמתין"):
 * "אני רואה בסנדבוקס שהחשבונות blurt לא מחוברים למרות שיש לנו אותם בכספות
 *  צריך לטפל בזה". This organ IS the fix — built fail-closed:
 *
 *   PHASE 1 (LIVE NOW, keyless): every cycle probes the blurt line through
 *   healthy RPC endpoints, verifies every fleet account exists with its
 *   posting authority + mana, and writes state/blurt-probe.json. "Connected"
 *   means: measured, receipted, alarmed when it degrades.
 *
 *   PHASE 2 (ARM-GATED): broadcasting opens ONLY when BOTH hold:
 *     (a) state/blurt-arm.json = { armed: true, mode, approvedBy, order }
 *         — a deliberate owner act, never a default; and
 *     (b) chain-judged posting custody (vault WIF ↔ live posting authority,
 *         same law as hive.mjs — via blurt-custody-judge lineage) AND the
 *         general blurt tx serializer (BLURT_CHAIN_ID + full op-id table —
 *         blurt-ser.mjs today covers account_update/6 only).
 *   Until both exist the organ reports BLURT-SIGNER-PENDING — an honest
 *   refusal, not a fake success. No key material ever touches this module.
 *
 * LAWS: fail-isolated (a blurt fault never stops the Steem/Hive economy);
 * probes read public data only; every verdict journaled; the dead endpoint
 * rpc.blurt.world (NXDOMAIN, measured 2026-10-11) is replaced by
 * rpc.blurt.blog in the failover chain.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const ARM_FILE = path.join(STATE, "blurt-arm.json");
const PROBE_FILE = path.join(STATE, "blurt-probe.json");

/** Healthy blurt RPC endpoints (measured live 2026-10-11 from two independent
 * sandboxes: saboin 200 OK, blurt.blog 200 OK; blurt.world NXDOMAIN). */
export const BLURT_NODES = [
  "https://blurt-rpc.saboin.com",
  "https://rpc.blurt.blog",
];

/** The fleet roster as it exists on blurt (fork-era accounts; measured live
 * 2026-10-11 via condenser_api.get_accounts — all nine exist with posting
 * authorities). Names only — this module never sees keys. */
export const BLURT_ROSTER = [
  "headcorner", "cashmachine", "haran", "israelnews",
  "lsa", "macrame", "wic", "wog", "woq",
];

async function rpcAny(method, params) {
  let lastErr = null;
  for (const node of BLURT_NODES) {
    try {
      const r = await fetch(node, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
        signal: AbortSignal.timeout(15000),
      });
      const j = await r.json();
      if (j.error) { lastErr = new Error(j.error?.message ?? "rpc-error"); continue; }
      return { ok: true, node, result: j.result };
    } catch (e) { lastErr = e; }
  }
  return { ok: false, error: lastErr?.message ?? "all-nodes-failed" };
}

function readJson(p, dflt) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return dflt; }
}
function writeJsonAtomic(p, obj) {
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
  fs.renameSync(tmp, p);
}

/** PHASE 2 gate — the deliberate-owner arm file. Absent/invalid = DISARMED. */
export function blurtArmState() {
  const a = readJson(ARM_FILE, null);
  if (!a || typeof a !== "object") return { armed: false, reason: "no-arm-file" };
  if (a.armed !== true) return { armed: false, reason: a.reason ?? "not-armed" };
  if (!a.approvedBy || !a.order) return { armed: false, reason: "arm-file-incomplete" };
  return { armed: true, mode: a.mode ?? "probe", approvedBy: a.approvedBy, order: a.order };
}

/**
 * PHASE 1 — the live line probe (keyless, public data only).
 * Verdicts: BLURT-PROBE-OK (all roster accounts verified) /
 * BLURT-PROBE-PARTIAL (some missing) / BLURT-PROBE-DEAD (no healthy node).
 */
export async function runBlurtProbe({ now = new Date().toISOString() } = {}) {
  const t0 = Date.now();
  const arm = blurtArmState();
  const r = await rpcAny("condenser_api.get_accounts", [BLURT_ROSTER]);
  if (!r.ok) {
    const receipt = { at: now, verdict: "BLURT-PROBE-DEAD", error: r.error, nodes: BLURT_NODES, arm, ms: Date.now() - t0 };
    writeJsonAtomic(PROBE_FILE, receipt);
    return receipt;
  }
  const byName = new Map((r.result ?? []).map((a) => [a.name, a]));
  const accounts = BLURT_ROSTER.map((name) => {
    const a = byName.get(name);
    if (!a) return { name, exists: false };
    return {
      name,
      exists: true,
      postingKeySet: (a.posting?.key_auths ?? []).length > 0,
      vests: Number(String(a.vesting_shares ?? "0").split(" ")[0]) || 0,
      blurt: Number(String(a.balance ?? "0").split(" ")[0]) || 0,
      vpPct: a.voting_manabar?.current_pct ?? null,
      rcPct: a.rc_manabar ? Math.round(((a.rc_manabar.current ?? 0) / Math.max(1, a.rc_manabar.max ?? 1)) * 100) : null,
    };
  });
  const existing = accounts.filter((a) => a.exists && a.postingKeySet).length;
  const receipt = {
    at: now,
    verdict: existing === BLURT_ROSTER.length ? "BLURT-PROBE-OK" : "BLURT-PROBE-PARTIAL",
    node: r.node,
    accounts,
    existing,
    roster: BLURT_ROSTER.length,
    phase: arm.armed ? `ARMED(${arm.mode};approvedBy=${arm.approvedBy})` : "PROBE-ONLY",
    nextGap: arm.armed
      ? (existing === BLURT_ROSTER.length
        ? "custody-judge posting WIFs, then BLURT-SIGNER (general tx serializer: BLURT_CHAIN_ID + op-id table — blurt-ser covers account_update/6 only)"
        : "missing/partial accounts — resolve before custody")
      : "waiting for owner arm-file (state/blurt-arm.json)",
    ms: Date.now() - t0,
  };
  writeJsonAtomic(PROBE_FILE, receipt);
  return receipt;
}

/**
 * The daily-cycle entry (fail-isolated by construction — caller wraps it in
 * stepWrap). Posting capability intentionally deferred behind the arm file
 * AND the general blurt serializer; the probe itself is the connection.
 */
export async function runBlurtOrgan({ now = new Date().toISOString() } = {}) {
  const probe = await runBlurtProbe({ now });
  const arm = blurtArmState();
  if (!arm.armed) {
    return { verdict: probe.verdict, mode: "probe", reason: "owner-arm-file-absent", probe, executed: 0 };
  }
  if (probe.verdict === "BLURT-PROBE-DEAD") {
    return { verdict: "BLURT-PROBE-DEAD", mode: arm.mode, probe, executed: 0 };
  }
  /* PHASE 2 — armed: the custody-judged posting rail lands here. It stays a
   * typed refusal until the general blurt tx serializer exists; arming the
   * file early must never fake a broadcast. */
  return {
    verdict: "BLURT-SIGNER-PENDING",
    mode: arm.mode,
    probe,
    executed: 0,
    reason: "general blurt tx serializer pending (BLURT_CHAIN_ID + op-id table); custody-judge next",
  };
}
