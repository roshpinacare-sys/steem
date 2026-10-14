/**
 * shell-watch.mjs — R299 · THE UN-SHELL METER (the shelling incident).
 *
 * WHAT IT MEASURES: steemit.com's web layer "shelled" the whole 14-account
 * roster (measured 2026-10-13/14 by exec28/steem-2: the origin serves the
 * landing shell for all 14 while chain truth stays intact and control
 * accounts render fully from the same IP). The chain API cannot see this —
 * it is a frontend-level, per-account filter. This probe fetches each
 * account's profile page from the machine that runs the engine (the same
 * vantage exec28 used) and records the display state HONESTLY.
 *
 * Verdicts (fail-honest, never guessed):
 *   "challenge"  — Cloudflare interstitial (cannot judge from here)
 *   "rendered"   — HTTP 200 and the account marker appears in the payload
 *   "shell"      — HTTP 200 without the account marker (the landing shell)
 *   "http-<code>"— any other status
 *
 * Zero keys, zero broadcast, read-only. State → state/shell-status.json
 * (committed with the heartbeat state like every honest book).
 */

import fs from "node:fs";
import path from "node:path";

const CONTROL_ACCOUNT = "steemit"; // the official account — renders for healthy vantages
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TIMEOUT_MS = 20000;

const STATE_DIR = process.env.SAOS_STATE_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), "state");

async function probeOne(account) {
  const url = `https://steemit.com/@${account}`;
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await r.text();
    const ms = Date.now() - t0;
    if (r.status === 403 && /just a moment|challenges\.cloudflare/i.test(body)) {
      return { account, verdict: "challenge", http: 403, ms };
    }
    if (r.status !== 200) return { account, verdict: `http-${r.status}`, http: r.status, ms };
    const marker = new RegExp(`@?${account}(?![a-z0-9-])`, "i");
    const hasMarker = marker.test(body) || body.includes(`"${account}"`);
    return { account, verdict: hasMarker ? "rendered" : "shell", http: 200, ms, htmlBytes: body.length };
  } catch (e) {
    return { account, verdict: "error", error: String(e?.message ?? e).slice(0, 100), ms: Date.now() - t0 };
  }
}

/** probe the full roster + control; persist an honest snapshot; return it. */
export async function runShellWatch({ now = new Date().toISOString(), roster = [], stateDir = STATE_DIR } = {}) {
  const accounts = [...roster, CONTROL_ACCOUNT];
  const verdicts = [];
  for (const a of accounts) verdicts.push(await probeOne(a));
  const control = verdicts.find((v) => v.account === CONTROL_ACCOUNT) ?? null;
  const fleet = verdicts.filter((v) => v.account !== CONTROL_ACCOUNT);
  const shelled = fleet.filter((v) => v.verdict === "shell").length;
  const rendered = fleet.filter((v) => v.verdict === "rendered").length;
  const challenged = fleet.filter((v) => v.verdict === "challenge").length;
  const report = {
    at: now,
    probe: "roshpinacare.shell-watch/1",
    verdicts,
    control,
    summary: {
      fleetTotal: fleet.length,
      shelled,
      rendered,
      challenged,
      verdict: challenged > fleet.length / 2 ? "CANNOT-JUDGE" : shelled === 0 ? "UN-SHELLED" : shelled >= fleet.length / 2 ? "SHELLED" : "PARTIAL",
    },
  };
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    const p = path.join(stateDir, "shell-status.json");
    const t = `${p}.tmp.${process.pid}`;
    fs.writeFileSync(t, JSON.stringify(report, null, 2));
    fs.renameSync(t, p);
  } catch { /* read-only state: the return value still carries the truth */ }
  return report;
}

export default { runShellWatch, probeOne };
