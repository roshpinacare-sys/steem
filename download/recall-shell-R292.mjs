#!/usr/bin/env node
/* R292 · RECALL-EXTERNAL-SHELL — the router's execute-now action, executed
 * lawfully through the signer's think gate (single-body law).
 *
 * Evidence (chain-sourced, 2026-10-09):
 *   · powerspan holds 80820 VESTS (50.12 SP) of headcorner since 09-04
 *   · powerspan has ZERO own vests (100% ours), is NOT in custody, NOT in
 *     personas, has no rc-pool role, no rent ever received
 *   · its votes (animal-shelter, steemburnup, kosya) earn nothing for us
 *   · router verdict: recall-shell-powerspan execute-now (+0.0236 SP/day)
 *
 * LAWS:
 *   · op is delegate_vesting_shares with amount exactly 0 — a pure recall,
 *     structurally unable to create exposure (think-gate exception R292,
 *     armed in exec-armed.json with a dated evidence note)
 *   · pre-read the live delegation; if it is already 0/absent → ALREADY-DONE
 *   · post-verify on chain; journal every attempt to receipts/recall-shell.jsonl
 *   · keys never printed; public artifacts only (txid, verdicts)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { executeAs, verifyRoles } from "../mini-services/saos-engine/signer.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const RECEIPTS = path.join(DIR, "..", "mini-services", "saos-engine", "receipts", "recall-shell.jsonl");
const HEAD = "headcorner";
const SHELL = "powerspan";
const RPCS = ["https://api.steemit.com", "https://api.justyy.com", "https://steem.61bts.com"];

async function rpc(method, params, timeoutMs = 15000) {
  let lastErr = null;
  for (const base of RPCS) {
    try {
      const r = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const j = await r.json();
      if (j.error) { lastErr = j.error.message; continue; }
      return { ok: true, result: j.result };
    } catch (e) { lastErr = String(e?.message ?? e); }
  }
  return { ok: false, error: lastErr };
}
const num = (s) => parseFloat(String(s ?? "0").replace(/[^0-9.\-]/g, "")) || 0;
const journal = (v) => { fs.mkdirSync(path.dirname(RECEIPTS), { recursive: true }); fs.appendFileSync(RECEIPTS, JSON.stringify(v) + "\n"); };

const at = new Date().toISOString();
console.log(`[recall-shell-R292] at ${at}`);

/* 1 · pre-read live delegation */
const pre = await rpc("condenser_api.get_vesting_delegations", [HEAD, "", 100]);
if (!pre.ok) {
  journal({ at, verdict: "PRE-READ-FAIL", error: pre.error });
  console.error("pre-read failed:", pre.error);
  process.exit(1);
}
const rows = pre.result ?? [];
const mine = rows.find((d) => d.delegatee === SHELL);
const currentVests = mine ? num(mine.vesting_shares) : 0;
console.log(`pre-read: delegation to ${SHELL} = ${currentVests.toFixed(6)} VESTS (${(currentVests / 1612.65).toFixed(2)} SP)`);
if (currentVests <= 0) {
  journal({ at, verdict: "ALREADY-DONE", shell: SHELL, currentVests: 0 });
  console.log("verdict: ALREADY-DONE — no delegation to recall");
  process.exit(0);
}

/* 2 · identity boot: chain-prove the master credential in THIS process
 * (the think gate requires custody proven this run — R233 gap closure) */
const ver = await verifyRoles(HEAD);
if (!ver.ok) {
  journal({ at, verdict: "IDENTITY-UNPROVEN", reason: String(ver.reason ?? ver.verdict ?? "unknown").slice(0, 120) });
  console.error("identity not chain-proven:", ver.reason ?? ver.verdict);
  process.exit(3);
}
console.log("identity: chain-proven (match order:", ver.matchedOrder ?? "n/a", ")");

/* 3 · recall through the think gate (active authority) */
const ops = [["delegate_vesting_shares", { delegator: HEAD, delegatee: SHELL, vesting_shares: "0.000000 VESTS" }]];
const res = await executeAs(HEAD, ops, { tag: "R292-recall-shell", role: "active" });
console.log("executeAs:", JSON.stringify({ ok: res.ok, verdict: res.verdict, txid: res.txid ?? null, reasons: res.reasons ?? res.reason ? [res.reasons ?? res.reason].flat().slice(0, 3) : undefined }));
journal({ at, verdict: res.ok ? (res.verdict ?? "BROADCASTED") : String(res.verdict ?? "REFUSED"), shell: SHELL, currentVests, txid: res.txid ?? null, error: res.error ?? null });

if (!res.ok) process.exit(2);

/* 4 · post-verify on chain (node lag tolerated: retry up to 5 × 3s) */
let verified = false, seen = null;
for (let i = 0; i < 5; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const post = await rpc("condenser_api.get_vesting_delegations", [HEAD, "", 100]);
  if (post.ok) {
    const row = (post.result ?? []).find((d) => d.delegatee === SHELL);
    seen = row ? num(row.vesting_shares) : 0;
    if (seen <= 0) { verified = true; break; }
  }
}
const out = { at: new Date().toISOString(), verdict: verified ? "RECALLED-VERIFIED" : "BROADCASTED-VERIFY-PENDING", shell: SHELL, vestsBefore: currentVests, vestsAfter: seen, txid: res.txid ?? null };
journal(out);
console.log("post-verify:", JSON.stringify(out));

/* 5 · expected effect: the 50.12 SP enters the 7-day expiring queue →
 * lands ~2026-10-16 → headcorner battery +50 SP (scaling detector will see it) */
console.log("note: recalled vests mature through the 7-day expiring queue (~2026-10-16)");
