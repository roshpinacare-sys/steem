/**
 * soldier-claims.mjs — R282 · SOLDIER REWARD CLAIMS (income capture)
 * THE MEASURED GAP (2026-10-08, chain truth): settled + pending rewards sat
 * UNCLAIMED on army accounts (israelnews: 359.77 vests + 0.223 STEEM
 * pending) because only the MASTER account had a claim path in the execute
 * batch. Unclaimed rewards are income rotting on-chain — the claim op
 * (canonical id 39, R209 live-proven, POSTING authority) is serialized and
 * the whole custody fleet is chain-verified (14/14). This module closes the
 * loop: chain-truth trigger → claim op → executeAs → journaled txid.
 * LAW: the trigger is ALWAYS the chain's own reward_* balances (never a
 * guess, never a stale state); every attempt is journaled with its verdict;
 * signing fail-closes on custody exactly like every other rail (the
 * executeAs think-gate owns that decision — this module never bypasses it).
 * The read side runs WITH or WITHOUT credentials.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { rpcCall } from "./measure.mjs";
import { executeAs } from "./signer.mjs";
import { reviveArmyCustody } from "./vault-revival.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const FILE = path.join(STATE, "soldier-claims.json");
const ARMY_FILE = path.join(STATE, "army.json");
const EVENTS = path.join(STATE, "events.jsonl");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
};
const appendLine = (p, v) => {
  try { fs.appendFileSync(p, JSON.stringify(v) + "\n"); } catch { /* journal never throws into the rail */ }
};

const num = (s) => { const n = Number(String(s ?? "0").split(" ")[0]); return Number.isFinite(n) ? n : 0; };

/* the fleet roster: army.json accounts keys (the recruited soldiers). The
 * master is NOT here — its claim path already lives in the execute batch
 * (front-loaded, A-9 law). One roster source: the army state. */
export function soldierRoster() {
  const a = readJson(ARMY_FILE, null);
  const keys = a?.accounts && typeof a.accounts === "object" ? Object.keys(a.accounts) : [];
  return keys.filter((k) => typeof k === "string" && k.length > 2);
}

/* chain truth for a batch of accounts: pending reward balances. One RPC for
 * the whole fleet (get_accounts is batched) — junk rows → null (never a
 * fake zero account). */
export async function pendingMap(names) {
  const out = {};
  if (!Array.isArray(names) || !names.length) return out;
  const r = await rpcCall("condenser_api.get_accounts", [names]).catch(() => ({ ok: false }));
  if (!r.ok) return out;
  const rows = Array.isArray(r.result) ? r.result : [];
  for (const row of rows) {
    if (!row?.name) continue;
    const steem = num(row.reward_steem_balance);
    const sbd = num(row.reward_sbd_balance);
    const vests = num(row.reward_vesting_balance);
    out[row.name] = { steem, sbd, vests, any: steem + sbd + vests > 0 };
  }
  return out;
}

/* R282 · SOLDIER CLAIMS PASS: chain-truth pending → claim op per account →
 * executeAs (posting). Bounded by maxClaimsPerRun (the tail waits for the
 * next cycle — the SAME law as the execute batch's maxOpsPerCycle). Every
 * attempt lands in state/soldier-claims.json + one event line.
 * CUSTODY-ORDER LAW (the engine's cycle order, enforced here too): the
 * vault revival runs FIRST — in a fresh process memory custody is EMPTY,
 * the think-gate lawfully refuses (T-80, measured live), and revival is
 * the only lawful adoption path (chain-judged WIFs, GEN-2 first). The
 * revival is idempotent + self-healing — ALREADY-VERIFIED accounts skip. */
export async function runSoldierClaims({ now = new Date().toISOString(), maxClaimsPerRun = 6, execute = true } = {}) {
  const day = now.slice(0, 10);
  const roster = soldierRoster();
  const out = {
    day, at: now, roster, verdict: "NO-ROSTER", rosterSize: roster.length,
    scanned: 0, pendingAccounts: [], claimed: [], skipped: [], failed: [],
    maxClaimsPerRun, executed: !!execute, custody: null,
    law: "הטריגר הוא אמת-השרשרת בלבד (reward_* balances) — תביעה על ניחוש אסורה; כל-ניסיון מתועד עם ה-verdict שלו",
  };
  if (!roster.length) { writeJson(FILE, out); return out; }

  if (execute) {
    try {
      const rev = await reviveArmyCustody({ now });
      out.custody = { verdict: rev?.verdict ?? null, verified: rev?.after?.verified ?? null, of: rev?.after?.total ?? null };
    } catch (e) {
      out.custody = { verdict: "REVIVAL-THREW", error: String(e?.message ?? e).slice(0, 160) };
      out.verdict = "CUSTODY-FAILED";
      writeJson(FILE, out);
      return out;
    }
  }

  const pend = await pendingMap(roster);
  out.scanned = Object.keys(pend).length;
  if (out.scanned === 0) { out.verdict = "READ-FAILED"; writeJson(FILE, out); return out; }

  for (const name of roster) {
    const p = pend[name];
    if (!p) { out.skipped.push({ account: name, reason: "no-chain-row" }); continue; }
    if (!p.any) continue;
    out.pendingAccounts.push({ account: name, ...p });
    if (out.claimed.length + out.failed.length >= maxClaimsPerRun) {
      out.skipped.push({ account: name, reason: "budget-bound" });
      continue;
    }
    const op = ["claim_reward_balance", {
      account: name,
      reward_steem: `${p.steem.toFixed(3)} STEEM`,
      reward_sbd: `${p.sbd.toFixed(3)} SBD`,
      reward_vests: `${p.vests.toFixed(6)} VESTS`,
    }];
    if (!execute) { out.claimed.push({ account: name, dryRun: true, op: { ...op[1] } }); continue; }
    try {
      const r = await executeAs(name, [op], { tag: "soldier-claim", role: "posting" });
      const rec = { account: name, verdict: r?.verdict ?? "UNKNOWN", ok: !!r?.ok, txid: r?.txid ?? null, pending: { ...p }, at: new Date().toISOString() };
      if (r?.ok) out.claimed.push(rec); else out.failed.push(rec);
      appendLine(EVENTS, { at: rec.at, type: "soldier-claim", account: name, verdict: rec.verdict, ok: rec.ok, txid: rec.txid, vests: p.vests, steem: p.steem, sbd: p.sbd });
    } catch (e) {
      const rec = { account: name, verdict: "THREW", ok: false, error: String(e?.message ?? e).slice(0, 200), at: new Date().toISOString() };
      out.failed.push(rec);
      appendLine(EVENTS, { at: rec.at, type: "soldier-claim", account: name, verdict: "THREW", ok: false, error: rec.error });
    }
  }

  out.verdict = out.failed.length > 0
    ? (out.claimed.length > 0 ? "PARTIAL" : "FAILED")
    : out.claimed.length > 0 ? "CLAIMED" : out.pendingAccounts.length ? "PENDING-UNEXECUTED" : "NOTHING-PENDING";
  writeJson(FILE, out);
  return out;
}

export function soldierClaimsState() { return readJson(FILE, null); }

/* recruiter evidence: a fresh pass (<26h) that scanned the fleet */
export function soldierClaimsEvidence(nowMs = Date.now()) {
  const s = readJson(FILE, null);
  if (!s || s.verdict === "READ-FAILED" || s.verdict === "NO-ROSTER") return null;
  const at = s.at ? Date.parse(s.at) : NaN;
  if (!Number.isFinite(at) || nowMs - at > 26 * 3600_000) return null;
  return `state/soldier-claims.json: ${s.verdict} at ${s.at} — scanned ${s.scanned}/${s.rosterSize}, pending ${s.pendingAccounts.length}, claimed ${s.claimed.length}, failed ${s.failed.length}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSoldierClaims({ now: new Date().toISOString() }).then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => { console.error("SOLDIER-CLAIMS-FAIL", e); process.exit(1); });
}
