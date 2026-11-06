/**
 * engine.test.mjs — real tests for the scoring core (node:test, zero deps).
 * Run: node --test ops/  (from steem root)  or: node --test ops/engine.test.mjs
 * Anti-slop law: every test pins a NUMBER that engineering decisions depend on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreFromSignals, WEIGHTS, FUNDED_MIN_STEEM } from './sovereign-kpi.mjs';

const BASE = {
  custodyVerified: 13, custodyTotal: 13,
  fundedAccounts: 13, rosterTotal: 13,
  liquidSteemTotal: 100, liquidSteemTarget: 100,
  fills24h: 10, churn24h: 100,
  beatVerdicts: ['ARMED-LIVE','ARMED-LIVE','ARMED-LIVE','ARMED-LIVE','ARMED-LIVE','ARMED-LIVE'],
  auditFlags: 0, treasuryDaysToFloor: 365,
};

test('perfect signals → 100 SOVEREIGN-STRONG', () => {
  const r = scoreFromSignals(BASE);
  assert.equal(r.score, 100);
  assert.equal(r.verdict, 'SOVEREIGN-STRONG');
});

test('custody is the heaviest pillar (30)', () => {
  assert.equal(WEIGHTS.custody, 30);
  const r = scoreFromSignals({ ...BASE, custodyVerified: 0 });
  assert.ok(r.score <= 70, `custody=0 must cap below 70, got ${r.score}`);
});

test('the unfunded-fleet case (measured 2026-11-05): 1/13 funded, 72 STEEM', () => {
  const r = scoreFromSignals({
    ...BASE,
    fundedAccounts: 1, liquidSteemTotal: 72.095,
    fills24h: 3, churn24h: 133, auditFlags: 3, treasuryDaysToFloor: 613.5,
  });
  // breadth=25*0.5*(1/13)=0.96 ; depth=25*0.5*min(1,0.72)=9.01
  assert.equal(r.pillars.fundedCapital, Math.round((0.5 * 25 * (1 / 13) + 0.5 * 25 * 0.72095) * 100) / 100);
  assert.ok(r.score < 80, `real fleet must not flatter itself: ${r.score}`);
  assert.ok(r.verdict !== 'SOVEREIGN-STRONG');
});

test('zero custody and zero liquidity → SOVEREIGN-EMPTY', () => {
  const r = scoreFromSignals({ ...BASE, custodyVerified: 0, fundedAccounts: 0, liquidSteemTotal: 0, fills24h: 0, churn24h: 0, beatVerdicts: [] });
  assert.equal(r.verdict, 'SOVEREIGN-EMPTY');
});

test('score never exceeds 100 even with absurd inputs', () => {
  const r = scoreFromSignals({ ...BASE, fills24h: 1e9, churn24h: 1e9, treasuryDaysToFloor: 1e9, beatVerdicts: [] });
  assert.ok(r.score <= 100);
});

test('degraded beats and audit flags drag hygiene, not other pillars', () => {
  const good = scoreFromSignals(BASE);
  const bad = scoreFromSignals({ ...BASE, beatVerdicts: ['DISARMED','DISARMED','DISARMED','DISARMED','DISARMED','DISARMED'], auditFlags: 5 });
  assert.ok(bad.pillars.hygiene < good.pillars.hygiene);
  assert.equal(bad.pillars.custody, good.pillars.custody);
  assert.equal(bad.pillars.activity, good.pillars.activity);
});

test('FUNDED_MIN_STEEM is above the dust level measured on chain (1.001)', () => {
  assert.ok(FUNDED_MIN_STEEM > 1.001);
});

test('rounding is stable (2 decimals in pillars, 1 in score)', () => {
  const r = scoreFromSignals({ ...BASE, fills24h: 3 });
  for (const v of Object.values(r.pillars)) assert.equal(v, Math.round(v * 100) / 100);
  assert.equal(r.score, Math.round(r.score * 10) / 10);
});
