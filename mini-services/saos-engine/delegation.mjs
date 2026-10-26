/**
 * delegation.mjs — T-73 · THE EQUAL-POWER RAIL (כוח-ההצבעה מתחלק שווה).
 * The operator's mandate (trace 1a105453cdc437b1): "יש לוודא שהריבונות
 * מעבירה ומטפלת בהאצלת כוח לחיילים ברשתות בצורה שווה כדי שנוכל לקבל את
 * מלוא סכום ההצבעות בסופו של דבר וגם כוח פעילות מלא ככל הניתן לכל החיילים".
 *
 * MEASURED (evidence/t73/probe2.mjs): the fleet's effective vests spread is
 * unequal (own + received: powerspan 80,820; siq 57,632; tov 57,661; wic
 * 56,556; wog 57,709; woq 56,559; hcsoldier1..3 = 0) — the equal-power law
 * (lib.mjs §73f) plans TOP-UPS ONLY (equal means UP, never down), the
 * executor signs vesting_delegation ops from the master's ACTIVE key
 * (delegation is reversible — undelegate returns after 7 days — so this is
 * inside the sovereignty's reversible-face doctrine).
 *
 * State: state/delegation.json (plan + executed txids, journaled).
 * Cadence: the daily cycle runs this at most every 6h; the plan is
 * idempotent (a top-up to target is skipped when the chain already reads
 * equal within 1%).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { rpcCall } from "./measure.mjs";
import { executeAs, masterAccount, execPaused, verifyRoles } from "./signer.mjs";
import { equalPowerLaw } from "./lib.mjs";
import { FLEET } from "./humanity.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const FILE = path.join(STATE, "delegation.json");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJsonAtomic = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
};
const appendLine = (p, row) => { try { fs.appendFileSync(p, JSON.stringify(row) + "\n"); } catch { /* best-effort */ } };
const num = (s) => Number(String(s ?? "").split(" ")[0]) || 0;

/** measure the fleet's effective vests (own + received) — read-only */
export async function measureFleetPower() {
  const delegator = masterAccount();
  const delegatees = [...new Set([...FLEET.filter((a) => a !== delegator), "cashmachine", "haran", "israelnews", "lsa", "macrame"])];
  const [accRows] = await Promise.all([
    rpcCall("condenser_api.get_accounts", [delegatees]),
  ]);
  if (!accRows.ok) return { ok: false, why: "get_accounts-failed", rows: [] };
  const rows = (accRows.result ?? []).filter(Boolean).map((a) => ({
    account: a.name,
    ownVests: num(a.vesting_shares),
    receivedVests: num(a.received_vesting_shares),
    effVests: num(a.vesting_shares) + num(a.received_vesting_shares),
    votingPowerPct: (a.voting_power ?? 0) / 100,
  }));
  return { ok: true, rows, delegator };
}

/** plan (pure over measured rows) — equalPowerLaw. TARGET LAW (§73f, live
 * lesson): a second signer is actively equalizing the same fleet. Its two
 * COMPLETED accounts measured effective EXACTLY 457,332 / 457,332 vests —
 * the converged level. The target DYNMICALLY rides the median of the
 * sibling-completed accounts (own+received within 0.5% of each other, ≥3
 * rows) when found, else the fixed fallback. Equal = converge on the SAME
 * number the fleet is already converging on — never a private target. */
export const POWER_TARGET_VESTS = 457332;
export function dynamicTarget(rows) {
  const effs = rows.map((r) => r.effVests).sort((a, b) => a - b);
  if (effs.length >= 6) {
    /* completed cluster = the ≥6 rows within 0.5% of the median */
    const median = effs[Math.floor(effs.length / 2)];
    const cluster = effs.filter((v) => Math.abs(v - median) / median <= 0.005);
    if (cluster.length >= 3) return Math.round(cluster.reduce((s, v) => s + v, 0) / cluster.length);
  }
  return POWER_TARGET_VESTS;
}
export function planFromRows(rows, target = null) {
  const tgt = target ?? dynamicTarget(rows);
  return equalPowerLaw({ accounts: rows.map((r) => ({ account: r.account, effVests: r.effVests })), target: tgt });
}

/** the power roster: the SOCIAL fleet the operator arms — the signed
 * soldiers + the delegate voices. EXCLUDED: headcorner (the delegator keeps
 * its own working stake) and powerspan (a dormant RC pool, zero social caps
 * by doctrine). The sibling-agent fleet (cashmachine/haran/israelnews/lsa/
 * macrame) rides the MEASUREMENT only — its writer equalizes it itself;
 * racing it is how the first two broadcasts died on chain asserts. */
const POWER_ROSTER = FLEET.filter((a) => a !== "headcorner" && a !== "powerspan");

/** execute the top-up plan (reversible ops only: vesting_delegation upward).
 * dryRun=true computes and plans WITHOUT signing. */
export async function runEqualPower({ dryRun = false, now = new Date().toISOString(), force = false } = {}) {
  const prev = readJson(FILE, null);
  const lastMs = prev?.at ? Date.parse(prev.at) : 0;
  const CADENCE_MS = 6 * 3_600_000; /* at most every 6h — delegation is not a heartbeat */
  if (!force && Number.isFinite(lastMs) && Date.now() - lastMs < CADENCE_MS) {
    return { verdict: "CADENCE-GATED", lastAt: prev.at, executed: prev.executed ?? [] };
  }
  const m = await measureFleetPower();
  if (!m.ok) return { verdict: "MEASURE-FAIL", why: m.why };
  const rows = m.rows.filter((r) => POWER_ROSTER.includes(r.account));
  const plan = planFromRows(rows);
  const out = {
    at: now, delegator: m.delegator,
    rows: m.rows, plan: { verdict: plan.verdict, target: plan.target, cvPct: plan.cvPct, topups: plan.topups },
    executed: [], dryRun, law: plan.law,
  };
  if (plan.verdict === "EQUAL" || plan.verdict === "UNMEASURABLE" || !plan.topups?.length) {
    out.verdict = plan.verdict === "UNMEASURABLE" ? "UNMEASURABLE" : "EQUAL";
    writeJsonAtomic(FILE, out);
    return { verdict: out.verdict, target: plan.target, cvPct: plan.cvPct };
  }
  if (dryRun) {
    out.verdict = "TOPUP-PLANNED-DRY";
    writeJsonAtomic(FILE, out);
    return { verdict: out.verdict, topups: plan.topups, target: plan.target };
  }
  if (execPaused()) return { verdict: "OPERATOR-PAUSED" };
  const master = m.delegator;
  const ver = await verifyRoles(master);
  if (!ver.ok) return { verdict: ver.verdict ?? "KEY-UNVERIFIED", reason: ver.reason ?? null };
  /* §73f · RESIDUAL-FILL EXECUTION (the live race, solved by arithmetic, not
   * timing). Live-measured failures that built this law:
   *   (1) get_vesting_delegations' listing LIES (1.13M listed vs 4.17M in the
   *       account's own delegated_vesting_shares counter);
   *   (2) a SECOND SIGNER equalizes the same fleet at high frequency — any
   *       plan sized once is stale by broadcast time (3 chain asserts);
   *   (3) the chain's own formula: effective = vesting_shares −
   *       delegated_vesting_shares − min(to_withdraw − withdrawn,
   *       withdraw_rate) when a power-down is active.
   * The cure: re-read the account row before EVERY op; size the op at
   * min(deficit, equal-split of what is REALLY available); fire instantly.
   * Small equal-split ops converge over rounds and survive races; a fresh
   * assert (the sibling landed between read and fire) fails ONE small op,
   * not the fleet. */
  const RESERVE = 10_000; /* never delegate to the last vest */
  const pending = [...plan.topups].sort((a, b) => b.topupVests - a.topupVests);
  const executed = [], skipped = [];
  let lastFail = null;
  /* §73f · THE ADAPTIVE-ESTIMATE LAW (the listing lie, made harmless): the
   * account counters overstate what is delegable when concurrent signers'
   * flights are not yet visible to the serving node (live-measured: formula
   * said 1.43M free, the chain asserted below 236K — ~1.2M of commitments
   * the listing hides). Each assert HALVES the trusted estimate (floor
   * 1%) and retries with a proportionally smaller op: the estimate walks
   * DOWN to the chain's real available in bounded steps, every op stays
   * reversible, and no flight of another signer is fought. */
  let estimateFactor = 1.0;
  let asserts = 0;
  while (pending.length && asserts < 5) {
    const accRow = await rpcCall("condenser_api.get_accounts", [[master]]);
    if (!accRow.ok || !accRow.result?.[0]) { lastFail = "pre-op-read-fail"; break; }
    const a = accRow.result[0];
    const nextWd = Date.parse(`${a.next_vesting_withdrawal ?? "1969-12-31T23:59:59"}Z`);
    const wdRate = num(a.vesting_withdraw_rate);
    const wdActive = Number.isFinite(nextWd) && nextWd < 8_640_000_000_000_000 && wdRate > 0;
    const rawAvail = Math.max(0, Math.floor(num(a.vesting_shares) - num(a.delegated_vesting_shares)
      - (wdActive ? Math.min(wdRate, num(a.to_withdraw) - num(a.withdrawn)) : 0)));
    const available = Math.floor(rawAvail * estimateFactor);
    out.availableVests = available; out.estimateFactor = estimateFactor; out.rawAvailableVests = rawAvail;
    const perOp = Math.floor((available - RESERVE) / pending.length);
    const t = pending[0];
    const size = Math.min(t.topupVests, perOp);
    if (size < 1_000) {
      /* this round's honest verdict: the chain's real free mana is below
       * even a 1K-vest op — the sibling's flight consumed it; the 6h cadence
       * retries as delegations return/power-down proceeds */
      out.verdict = "NO-AVAILABLE-MANA";
      out.skipped = [...skipped, ...pending.map((x) => ({ account: x.account, why: "NO-AVAILABLE-MANA", available }))];
      out.error = null;
      writeJsonAtomic(FILE, out);
      return { verdict: out.verdict, executed: executed.length, available, estimateFactor, target: plan.target };
    }
    const res = await executeAs(master, [[
      "delegate_vesting_shares",
      { delegator: master, delegatee: t.account, vesting_shares: `${size.toFixed(6)} VESTS` },
    ]], { tag: "equal-power", role: "active" });
    if (res.ok) {
      executed.push({ ...t, topupVests: size, txid: res.txid ?? null, partial: size < t.topupVests });
      appendLine(path.join(STATE, "events.jsonl"), { type: "equal-power.executed", at: new Date().toISOString(), account: t.account, vests: size, txid: res.txid ?? null });
      const remaining = t.topupVests - size;
      pending.shift();
      if (remaining > 1_000) pending.push({ ...t, topupVests: remaining }); /* the deficit continues next round */
    } else {
      asserts++;
      estimateFactor = Math.max(0.01, estimateFactor / 2);
      lastFail = res.error ?? "unknown";
      skipped.push({ account: t.account, why: "ASSERT-ESTIMATE-HALVED", factor: estimateFactor });
    }
  }
  out.executed = executed;
  out.skipped = skipped;
  out.error = executed.length ? null : lastFail;
  out.verdict = executed.length === 0 ? (lastFail && asserts >= 5 ? "MANA-UNPROVEN-HOLD" : lastFail ? "TOPUP-FAIL" : "NO-AVAILABLE-MANA")
    : pending.length ? `TOPUP-PARTIAL-EXECUTED-${executed.length}` : "TOPUP-EXECUTED";
  writeJsonAtomic(FILE, out);
  return { verdict: out.verdict, executed: executed.length, estimateFactor, target: plan.target, error: out.error ?? null };
}

export function delegationPublic() {
  const d = readJson(FILE, null);
  if (!d) return { initialized: false, law: "מסילת-שוויון-הכוח טרם רצה" };
  return {
    initialized: true, at: d.at ?? null, verdict: d.verdict ?? null, dryRun: !!d.dryRun,
    target: d.plan?.target ?? null, cvPct: d.plan?.cvPct ?? null,
    topupsPlanned: (d.plan?.topups ?? []).length,
    executed: d.executed ?? [],
    rows: (d.rows ?? []).map((r) => ({ account: r.account, effVests: Math.round(r.effVests), vp: r.votingPowerPct })),
    law: d.law ?? null,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dry = !process.argv.includes("--live");
  runEqualPower({ dryRun: dry, force: true }).then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(r.verdict === "TOPUP-FAIL" ? 1 : 0); }).catch((e) => { console.error("EQUAL-POWER-FAIL", e); process.exit(1); });
}
