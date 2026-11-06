#!/usr/bin/env node
/**
 * sovereign-kpi.mjs — daily sovereign score 0-100 (blueprint P1).
 *
 * Grounded in real fleet receipts only; no fabricated inputs:
 *   receipts/custody-patrol.jsonl   → custody pillar (verified accounts, fp)
 *   receipts/fill-kpi.jsonl         → activity pillar (creates/cancels/fills 24h)
 *   receipts/grid-beat.jsonl        → hygiene pillar (ARMED-LIVE streak)
 *   receipts/effectiveness-audit.jsonl → hygiene flags + treasury trajectory
 *   condenser_api.get_accounts      → funded-capital pillar (real liquid balances)
 *
 * Laws encoded:
 *   - liquidity-stays-liquid: score NEVER rewards spending principal; it
 *     rewards *usable* budget breadth (accounts that can actually place an
 *     order) and realized fills.
 *   - sovereignty-is-the-center: custody is the heaviest pillar.
 *
 * Usage:
 *   node sovereign-kpi.mjs                 # compute + append receipts + state
 *   node sovereign-kpi.mjs --print-only    # compute, print, write nothing
 */

import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = process.env.STEEM_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RECEIPTS = path.join(ROOT, 'receipts');
const STATE = path.join(ROOT, 'state');

/* ---------------- pure scoring core (unit-tested) ---------------- */

export const WEIGHTS = {
  custody: 30,
  fundedCapital: 25,
  activity: 20,
  hygiene: 15,
  treasury: 10,
};

export const FUNDED_MIN_STEEM = 2.0; // below this an account cannot clear reserves

/**
 * Pure sovereign-score computation. `s` carries ONLY observed signals:
 *   custodyVerified, custodyTotal   — from judge/patrol
 *   fundedAccounts, rosterTotal     — accounts with liquid STEEM > FUNDED_MIN_STEEM
 *   liquidSteemTotal                — fleet-wide liquid STEEM (steem)
 *   liquidSteemTarget               — capital floor the doctrine wants deployed
 *   fills24h, churn24h              — from fill-kpi.jsonl latest line
 *   beatVerdicts                    — last N grid-beat verdict strings
 *   auditFlags                      — count of effectiveness-audit flags
 *   treasuryDaysToFloor             — days until treasury hits delegation floor
 */
export function scoreFromSignals(s) {
  const pillars = {};

  /* custody: verified / total, heaviest pillar */
  const cTot = Math.max(1, s.custodyTotal ?? 13);
  pillars.custody = (WEIGHTS.custody * (s.custodyVerified ?? 0)) / cTot;

  /* funded capital: blend of breadth (how many accounts can trade) and depth */
  const breadth = ((s.fundedAccounts ?? 0) / Math.max(1, s.rosterTotal ?? 13)) * WEIGHTS.fundedCapital * 0.5;
  const depth = Math.min(1, (s.liquidSteemTotal ?? 0) / Math.max(1e-9, s.liquidSteemTarget ?? 100)) * WEIGHTS.fundedCapital * 0.5;
  pillars.fundedCapital = breadth + depth;

  /* activity: realized fills matter most; churn alone caps at 40% of pillar */
  const fillPart = Math.min(1, (s.fills24h ?? 0) / 10) * 0.6;
  const churnPart = Math.min(1, (s.churn24h ?? 0) / 100) * 0.4;
  pillars.activity = WEIGHTS.activity * (fillPart + churnPart);

  /* hygiene: beat health streak (last 6) minus audit flags */
  const verdicts = (s.beatVerdicts ?? []).slice(-6);
  const liveShare = verdicts.length ? verdicts.filter((v) => v === 'ARMED-LIVE').length / verdicts.length : 0;
  const flagPenalty = Math.min(1, (s.auditFlags ?? 0) / 5);
  pillars.hygiene = WEIGHTS.hygiene * (liveShare * 0.7 + 0.3) * (1 - flagPenalty);

  /* treasury: days-to-floor vs 365d horizon */
  const d = s.treasuryDaysToFloor ?? 0;
  pillars.treasury = WEIGHTS.treasury * Math.max(0, Math.min(1, d / 365));

  const score = Math.round(Object.values(pillars).reduce((a, b) => a + b, 0) * 10) / 10;
  const verdict = score >= 80 ? 'SOVEREIGN-STRONG' : score >= 55 ? 'SOVEREIGN-PARTIAL' : score >= 30 ? 'SOVEREIGN-THIN' : 'SOVEREIGN-EMPTY';
  return { score, verdict, pillars: round2(pillars) };
}

const round2 = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 100) / 100]));

/* ---------------- receipt readers (defensive, honest) ---------------- */

const lastLine = (f) => {
  try {
    const lines = readFileSync(f, 'utf8').trim().split('\n').filter(Boolean);
    return JSON.parse(lines[lines.length - 1]);
  } catch {
    return null;
  }
};
const lastNLines = (f, n) => {
  try {
    const lines = readFileSync(f, 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-n).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
};

export function gatherSignals({ fetchChain = true } = {}) {
  const sig = {};
  const patrol = lastLine(path.join(RECEIPTS, 'custody-patrol.jsonl'));
  /* schema-drift tolerant: patrol writes `live`, beat-loop writes `liveAccounts` */
  sig.custodyVerified = patrol?.live ?? patrol?.liveAccounts ?? patrol?.custodyVerified ?? 0;
  sig.custodyTotal = 13;

  const fill = lastLine(path.join(RECEIPTS, 'fill-kpi.jsonl'));
  sig.fills24h = fill?.fills?.count ?? 0;
  sig.churn24h = fill?.ops?.churnTotal ?? 0;

  const beats = lastNLines(path.join(RECEIPTS, 'grid-beat.jsonl'), 6);
  sig.beatVerdicts = beats.map((b) => b.verdict).filter(Boolean);

  const audit = lastLine(path.join(RECEIPTS, 'effectiveness-audit.jsonl'));
  const flagsRaw = audit?.verdict ?? audit?.flagsLine ?? '';
  const m = String(flagsRaw).match(/flags=([^\]]*)\]/);
  sig.auditFlags = m ? m[1].split(',').filter((x) => x.includes(':')).length : 0;
  sig.treasuryDaysToFloor = Number(String(flagsRaw).match(/treasuryDaysToFloor=([0-9.]+)/)?.[1] ?? 0) || (audit?.treasuryDaysToFloor ?? 0);

  sig.rosterTotal = 13;
  sig.liquidSteemTarget = 100;
  sig.fundedAccounts = 0;
  sig.liquidSteemTotal = 0;
  if (fetchChain) {
    try {
      const names = ['headcorner','cashmachine','haran','israelnews','lsa','macrame','siq','tov','wic','wog','woq','hcsoldier4','hcsoldier5'];
      const body = JSON.stringify({ jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [names], id: 1 });
      const res = awaitJson(fetch('https://api.steemit.com', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(20000) }));
      // filled by caller (async shell) — see gatherSignalsAsync
      void res;
    } catch { /* honest fallback: zeros */ }
  }
  return sig;
}

/** async variant — the real entry point (chain + receipts). */
export async function gatherSignalsAsync() {
  const sig = gatherSignals({ fetchChain: false });
  try {
    const names = ['headcorner','cashmachine','haran','israelnews','lsa','macrame','siq','tov','wic','wog','woq','hcsoldier4','hcsoldier5'];
    const body = JSON.stringify({ jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [names], id: 1 });
    const r = await fetch('https://api.steemit.com', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(20000) });
    const j = await r.json();
    const accounts = j?.result ?? [];
    sig.liquidSteemTotal = Math.round(accounts.reduce((a, x) => a + parseFloat(x.balance), 0) * 1000) / 1000;
    sig.fundedAccounts = accounts.filter((x) => parseFloat(x.balance) > FUNDED_MIN_STEEM).length;
    sig.rosterTotal = accounts.length || 13;
  } catch {
    /* honest: leave zeros; chain is not the judge of this run */
  }
  return sig;
}

/* ---------------- main ---------------- */

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const printOnly = process.argv.includes('--print-only');
  const signals = await gatherSignalsAsync();
  const { score, verdict, pillars } = scoreFromSignals(signals);
  const row = { ts: new Date().toISOString(), score, verdict, pillars, signals };
  console.log(JSON.stringify(row));
  if (!printOnly) {
    mkdirSync(RECEIPTS, { recursive: true });
    mkdirSync(STATE, { recursive: true });
    appendFileSync(path.join(RECEIPTS, 'sovereign-kpi.jsonl'), JSON.stringify(row) + '\n');
    writeFileSync(path.join(STATE, 'sovereign-kpi.json'), JSON.stringify(row, null, 2) + '\n');
  }
}

/** tiny helper kept for testability */
export function awaitJson(p) { return p.then((r) => r.json()); }
export const hasReceipts = (dir = RECEIPTS) => existsSync(path.join(dir, 'custody-patrol.jsonl'));
