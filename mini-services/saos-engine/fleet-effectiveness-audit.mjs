/**
 * fleet-effectiveness-audit.mjs — FLEET EFFECTIVENESS AUDIT (REVISIT-R315).
 *
 * WHY (operator order 2026-11-02, verbatim intent): "יש הרבה חשבונות שאין
 * להם delegation והם לא יכולים להיות פעילים בלי אנרגיה ... הארכיטקטורה
 * צריכה לעלות על זה לבד" — accounts opened by the architecture must be
 * SELF-AUDITED continuously: can they actually transact (RC/energy), do
 * they hold delegation, are their keys in the vault, and does every action
 * taken once get REVISITED. Green custody ≠ effective fleet.
 *
 * WHAT (all numbers measured from the live chain, never from books):
 *   per account: STEEM / SBD liquid, own/d-out/d-in/net SP, RC manabar %,
 *   delegation-floor status (rail law: publisher 100 / soldier 20),
 *   key-custody role coverage (census + chain authorities),
 *   flags: BELOW-FLOOR, ZERO-SP, NO-KEYS, TREASURY-DRAIN (power-down),
 *   delta vs the previous audit line (track changes over time).
 *   Plus the REVISIT REGISTRY: every one-shot action gets a re-check row;
 *   overdue items are flagged here, every run, until closed.
 *
 * OUTPUT: receipts/fleet-effectiveness.jsonl (append; one line per run)
 * EXIT:  0 = all effective, 3 = flags present (honest non-zero signal),
 *        1 = measurement refused.
 * Never prints key material — fingerprints only.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { DELEGATION_LAW, spmFromGlobals, netSpOf } from "./delegation-rail.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(DIR, "..", "..");
const STATE = path.join(DIR, "state");
const RECEIPTS = path.join(REPO, "receipts", "fleet-effectiveness.jsonl");
const REVISIT = path.join(STATE, "revisit-registry.jsonl");
const CENSUS = path.join(REPO, ".secrets", "census-verified.json");

async function rpc(method, params, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch("https://api.steemit.com", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }), signal: AbortSignal.timeout(20000) });
      const j = await r.json();
      if (j.error) throw new Error(String(j.error.message).slice(0, 100));
      return j.result;
    } catch (e) { last = e; if (i < tries - 1) await new Promise((r) => setTimeout(r, 1200 * (i + 1))); }
  }
  throw last;
}
const num = (amt) => parseFloat(String(amt ?? "0").split(" ")[0]) || 0;

function lastAuditLine() {
  try {
    const lines = fs.readFileSync(RECEIPTS, "utf8").trim().split("\n").filter(Boolean);
    return JSON.parse(lines[lines.length - 1]);
  } catch { return null; }
}

function readRevisit() {
  try { return fs.readFileSync(REVISIT, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}

async function main() {
  const at = new Date().toISOString();
  const census = JSON.parse(fs.readFileSync(CENSUS, "utf8"));
  const roster = Object.keys(census).filter((k) => !k.startsWith("_"));

  const dgpo = await rpc("condenser_api.get_dynamic_global_properties", []);
  const spm = spmFromGlobals(dgpo);
  if (!spm) { console.log("EFFECTIVENESS-AUDIT REFUSED reason=dgpo"); process.exit(1); }

  const accs = (await rpc("condenser_api.get_accounts", [roster])).map((a) => Object.fromEntries([[String(a.name), a]]))
    .reduce((m, x) => ({ ...m, ...x }), {});
  const rc = (await rpc("rc_api.find_rc_accounts", { accounts: roster })).rc_accounts;
  const rcByName = new Map(rc.map((x) => [x.account, x]));

  const prev = lastAuditLine();
  const prevBy = new Map((prev?.accounts ?? []).map((a) => [a.account, a]));

  const accounts = [];
  const flags = [];
  for (const name of roster) {
    const a = accs[name];
    if (!a) { accounts.push({ account: name, error: "NOT-ON-CHAIN" }); flags.push(`${name}:NOT-ON-CHAIN`); continue; }
    const ownSP = num(a.vesting_shares) / 1e6 * spm;
    const dOut = num(a.delegated_vesting_shares) / 1e6 * spm;
    const dIn = num(a.received_vesting_shares) / 1e6 * spm;
    const netSp = netSpOf(a, spm);
    const r = rcByName.get(name);
    const rcMax = r ? parseInt(r.max_rc, 10) : 0;
    const rcCur = r ? parseInt(r.rc_manabar.current_mana, 10) : 0;
    const rcPct = rcMax ? Math.round(1000 * rcCur / rcMax) / 10 : 0;
    const isSoldier = DELEGATION_LAW.soldiers.includes(name);
    const floor = name === "headcorner" ? DELEGATION_LAW.treasuryKeepSp : (isSoldier ? DELEGATION_LAW.floorSp.soldier : DELEGATION_LAW.floorSp.publisher);
    const keyRoles = Object.keys(census[name] ?? {}).filter((k) => ["owner", "active", "posting", "memo"].includes(k));
    const p = prevBy.get(name);
    const fl = [];
    if (netSp <= 0.001) fl.push("ZERO-SP");
    else if (name !== "headcorner" && netSp < floor) fl.push("BELOW-FLOOR");
    if (!keyRoles.length) fl.push("NO-KEYS");
    if (name === "headcorner" && num(a.to_withdraw) > 0) fl.push("POWERDOWN-ACTIVE");
    const delta = p ? { netSp: Math.round((netSp - p.netSp) * 100) / 100, rcPct: Math.round((rcPct - p.rcPct) * 10) / 10, sbd: Math.round((num(a.sbd_balance) - p.sbd) * 1000) / 1000 } : null;
    accounts.push({
      account: name, steem: num(a.balance), sbd: num(a.sbd_balance),
      ownSP: Math.round(ownSP * 10) / 10, dOut: Math.round(dOut * 10) / 10, dIn: Math.round(dIn * 10) / 10,
      netSp: Math.round(netSp * 10) / 10, rcPct, floor, flags: fl, keyRoles, delta,
    });
    for (const f of fl) flags.push(`${name}:${f}`);
  }

  /* treasury trajectory: power-down drain → days until keep floor breached */
  const hc = accounts.find((a) => a.account === "headcorner");
  let treasuryDaysToFloor = null;
  if (hc?.flags.includes("POWERDOWN-ACTIVE")) {
    const weeklyDrain = num(accs.headcorner.vesting_withdraw_rate) / 1e6 * spm;
    if (weeklyDrain > 0) treasuryDaysToFloor = Math.round(((hc.netSp - hc.floor) / (weeklyDrain / 7)) * 10) / 10;
  }

  /* revisit registry — overdue one-shot actions */
  const now = Date.now();
  const revisit = readRevisit();
  const overdue = revisit.filter((r) => r.due && !r.closedAt && new Date(r.due).getTime() < now).map((r) => `${r.id}:${r.tag}`);
  if (overdue.length) flags.push(...overdue.map((o) => `REVISIT-OVERDUE(${o})`));

  /* law-list accounts with NO census entry = opened-but-keyless wounds (tracked every run) */
  const lawAll = [...DELEGATION_LAW.publishers, ...DELEGATION_LAW.soldiers];
  const wounds = lawAll.filter((n) => !roster.includes(n)).map((n) => `${n}:NO-KEYS-IN-CENSUS`);
  flags.push(...wounds);

  const line = {
    at, spm: Math.round(spm * 100) / 100, accounts, wounds, flags,
    treasuryDaysToFloor, revisitOpen: revisit.filter((r) => !r.closedAt).length,
    revisitOverdue: overdue,
    effective: flags.length === 0,
    law: "measured-from-chain-only; floors from DELEGATION_LAW; no claims — numbers",
  };
  fs.mkdirSync(path.dirname(RECEIPTS), { recursive: true });
  fs.appendFileSync(RECEIPTS, JSON.stringify(line) + "\n");

  console.log(`EFFECTIVENESS-AUDIT ${line.effective ? "ALL-EFFECTIVE" : "FLAGS-PRESENT"} accounts=${accounts.length} flags=[${flags.join(",") || "none"}] treasuryDaysToFloor=${treasuryDaysToFloor ?? "n/a"} revisitOpen=${line.revisitOpen} revisitOverdue=${overdue.length}`);
  process.exit(line.effective ? 0 : 3);
}

main().catch((e) => { console.log(`EFFECTIVENESS-AUDIT ERROR ${String(e?.message ?? e).slice(0, 140)}`); process.exit(1); });
