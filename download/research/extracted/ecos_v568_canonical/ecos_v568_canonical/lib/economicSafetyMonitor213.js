'use strict';
/**
 * lib/economicSafetyMonitor213.js — ECOS V213 (Phase P102)
 *
 * Operationalizes the "red flags to monitor immediately" layer from the ECOS
 * strategic economic research. Five pure indices, each with thresholds and an
 * ok/warn/critical status, plus an overall worst-of assessment. Pure +
 * dependency-free (R6); fully unit-testable; version-suffixed (…213, BUG-L safe).
 *
 * Indices (sources in research §3 + "red flags to monitor"):
 *   1. Faucet/Sink Ratio          — token emission vs burn (supply pressure)
 *   2. Reputation Inflation Index — reputation minted vs decayed (rep debasement)
 *   3. Reputation Gini            — concentration of reputation/voting power
 *   4. Hollow Task Rate           — share of <15s auto-approved tasks (sybil/bots)
 *   5. Treasury Liquidity Ratio   — external stable assets vs native token in treasury
 *
 * @version 213.0.0
 */

const STATUS = { OK: 'ok', WARN: 'warn', CRITICAL: 'critical' };

class SafetyInputError213 extends Error {
  constructor(msg) { super(msg); this.name = 'SafetyInputError213'; this.code = 'SAFETY_INPUT'; this.statusCode = 400; }
}

function _num(v, name) {
  const n = Number(v);
  if (!isFinite(n)) throw new SafetyInputError213(`${name} must be a finite number`);
  return n;
}
function _worst(statuses) {
  if (statuses.includes(STATUS.CRITICAL)) return STATUS.CRITICAL;
  if (statuses.includes(STATUS.WARN)) return STATUS.WARN;
  return STATUS.OK;
}

/**
 * 1) Faucet/Sink Ratio = emission / burn. Higher = more inflationary.
 *    Research: emission >30% above burn over 30d is a red flag.
 *    ok <=1.3, warn <=2.0, critical >2.0. (burn=0 with emission>0 → critical)
 */
function faucetSinkRatio213(emission, burn) {
  emission = _num(emission, 'emission'); burn = _num(burn, 'burn');
  if (emission < 0 || burn < 0) throw new SafetyInputError213('emission/burn must be >= 0');
  let ratio;
  if (burn === 0) ratio = emission === 0 ? 1 : Infinity;
  else ratio = emission / burn;
  const status = ratio > 2.0 ? STATUS.CRITICAL : (ratio > 1.3 ? STATUS.WARN : STATUS.OK);
  return { id: 'faucet_sink_ratio', label: 'Faucet/Sink Ratio',
    value: ratio === Infinity ? null : Math.round(ratio * 1000) / 1000,
    infinite: ratio === Infinity, thresholds: { warn: 1.3, critical: 2.0 }, status,
    note: 'token emission vs burn; >1 means net supply growth' };
}

/**
 * 2) Reputation Inflation Index = repMinted / repDecayed.
 *    Research: >2.5 over ~2 weeks signals easy-task flooding / rep debasement.
 *    ok <=1.5, warn <=2.5, critical >2.5.
 */
function reputationInflationIndex213(repMinted, repDecayed) {
  repMinted = _num(repMinted, 'repMinted'); repDecayed = _num(repDecayed, 'repDecayed');
  if (repMinted < 0 || repDecayed < 0) throw new SafetyInputError213('rep values must be >= 0');
  let idx;
  if (repDecayed === 0) idx = repMinted === 0 ? 1 : Infinity;
  else idx = repMinted / repDecayed;
  const status = idx > 2.5 ? STATUS.CRITICAL : (idx > 1.5 ? STATUS.WARN : STATUS.OK);
  return { id: 'reputation_inflation_index', label: 'Reputation Inflation Index',
    value: idx === Infinity ? null : Math.round(idx * 1000) / 1000,
    infinite: idx === Infinity, thresholds: { warn: 1.5, critical: 2.5 }, status,
    note: 'reputation minted vs decayed; high = rep losing meaning' };
}

/**
 * 3) Reputation Gini coefficient over a list of per-account reputations.
 *    Research: >0.75 → vulnerable to governance capture.
 *    ok <=0.6, warn <=0.75, critical >0.75.
 */
function reputationGini213(reputations) {
  if (!Array.isArray(reputations)) throw new SafetyInputError213('reputations must be an array');
  const xs = reputations.map(r => _num(r, 'reputation')).filter(r => r >= 0).sort((a, b) => a - b);
  const n = xs.length;
  const sum = xs.reduce((a, b) => a + b, 0);
  let gini = 0;
  if (n > 0 && sum > 0) {
    let cum = 0;
    for (let i = 0; i < n; i++) cum += (i + 1) * xs[i];
    gini = (2 * cum) / (n * sum) - (n + 1) / n;
    if (gini < 0) gini = 0;
  }
  const status = gini > 0.75 ? STATUS.CRITICAL : (gini > 0.6 ? STATUS.WARN : STATUS.OK);
  return { id: 'reputation_gini', label: 'Reputation Gini Concentration',
    value: Math.round(gini * 1000) / 1000, accounts: n,
    thresholds: { warn: 0.6, critical: 0.75 }, status,
    note: 'inequality of reputation/voting power; high = capture risk' };
}

/**
 * 4) Hollow Task Rate = hollowTasks / totalTasks, where hollow = auto-approved
 *    in < 15s with no extended peer review. Research flags abnormal rises.
 *    ok <=0.15, warn <=0.30, critical >0.30.
 */
function hollowTaskRate213(hollowTasks, totalTasks) {
  hollowTasks = _num(hollowTasks, 'hollowTasks'); totalTasks = _num(totalTasks, 'totalTasks');
  if (hollowTasks < 0 || totalTasks < 0) throw new SafetyInputError213('task counts must be >= 0');
  if (hollowTasks > totalTasks) throw new SafetyInputError213('hollowTasks cannot exceed totalTasks');
  const rate = totalTasks === 0 ? 0 : hollowTasks / totalTasks;
  const status = rate > 0.30 ? STATUS.CRITICAL : (rate > 0.15 ? STATUS.WARN : STATUS.OK);
  return { id: 'hollow_task_rate', label: 'Hollow Task Completion Rate',
    value: Math.round(rate * 1000) / 1000, hollowTasks, totalTasks,
    thresholds: { warn: 0.15, critical: 0.30 }, status,
    note: 'share of <15s auto-approved tasks; high = bot/sybil farming' };
}

/**
 * 5) Treasury Liquidity Ratio = externalStable / (externalStable + nativeToken).
 *    Research: below 0.5 = over-exposed to own volatile token.
 *    ok >=0.5, warn >=0.3, critical <0.3.
 */
function treasuryLiquidityRatio213(externalStableValue, nativeTokenValue) {
  externalStableValue = _num(externalStableValue, 'externalStableValue');
  nativeTokenValue = _num(nativeTokenValue, 'nativeTokenValue');
  if (externalStableValue < 0 || nativeTokenValue < 0) throw new SafetyInputError213('treasury values must be >= 0');
  const total = externalStableValue + nativeTokenValue;
  const ratio = total === 0 ? 1 : externalStableValue / total;
  const status = ratio < 0.3 ? STATUS.CRITICAL : (ratio < 0.5 ? STATUS.WARN : STATUS.OK);
  return { id: 'treasury_liquidity_ratio', label: 'Treasury Liquidity Ratio',
    value: Math.round(ratio * 1000) / 1000,
    thresholds: { warn: 0.5, critical: 0.3 }, status,
    note: 'external stable vs native token in treasury; low = reflexive risk' };
}

/**
 * Full assessment over the available inputs. Each index is computed only if its
 * inputs are supplied; the overall status is the worst across computed indices.
 * @param {object} input
 * @returns {{ generatedAt, version, overall, indices, computed, missing }}
 */
function assess213(input = {}) {
  const indices = [];
  const missing = [];
  const tryAdd = (cond, fn) => { if (cond) indices.push(fn()); };

  tryAdd(input.emission != null && input.burn != null,
    () => faucetSinkRatio213(input.emission, input.burn));
  if (input.emission == null || input.burn == null) missing.push('faucet_sink_ratio');

  tryAdd(input.repMinted != null && input.repDecayed != null,
    () => reputationInflationIndex213(input.repMinted, input.repDecayed));
  if (input.repMinted == null || input.repDecayed == null) missing.push('reputation_inflation_index');

  tryAdd(Array.isArray(input.reputations), () => reputationGini213(input.reputations));
  if (!Array.isArray(input.reputations)) missing.push('reputation_gini');

  tryAdd(input.hollowTasks != null && input.totalTasks != null,
    () => hollowTaskRate213(input.hollowTasks, input.totalTasks));
  if (input.hollowTasks == null || input.totalTasks == null) missing.push('hollow_task_rate');

  tryAdd(input.externalStableValue != null && input.nativeTokenValue != null,
    () => treasuryLiquidityRatio213(input.externalStableValue, input.nativeTokenValue));
  if (input.externalStableValue == null || input.nativeTokenValue == null) missing.push('treasury_liquidity_ratio');

  const overall = _worst(indices.map(i => i.status));
  return {
    generatedAt: new Date().toISOString(),
    version: '213.0.0',
    overall,
    indices,
    computed: indices.length,
    missing,
  };
}

module.exports = {
  STATUS,
  SafetyInputError213,
  faucetSinkRatio213,
  reputationInflationIndex213,
  reputationGini213,
  hollowTaskRate213,
  treasuryLiquidityRatio213,
  assess213,
};
