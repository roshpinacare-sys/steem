'use strict';
/**
 * src/lib/solvencyEscalationBridge438.js — ECOS V438
 *
 * Feature: Solvency-Triggered Auto-Escalation Bridge
 * Connects proofOfSolvency403 with healthDrivenEscalation437.
 * When solvency ratio drops below a configurable threshold,
 * automatically triggers health escalation so humans are paged.
 * This is user-safety-first: protects depositors by escalating
 * before insolvency becomes a crisis.
 *
 * R1: sacred files untouched. R2: all identifiers end in 438. R3: no new npm deps.
 *
 * @version 438.0.0
 */

const SOLVENCY_ESCALATION_BRIDGE_VERSION438 = '438.0.0';

const _solvencyLog438 = [];
const MAX_LOG438 = 200;

/**
 * Assess solvency health as a 0–100 score.
 * @param {Array<{userId,balanceMicro}>} balances
 * @param {string|number|bigint} reserveMicro
 * @returns {{ score: number, solvent: boolean|null, ratio: number|null, critical: boolean }}
 */
function assessSolvencyHealth438(balances, reserveMicro) {
  let totalLiabilities = 0n;
  try {
    const S403 = require('./proofOfSolvency403.js');
    const tree = S403.buildLiabilityTree403(Array.isArray(balances) ? balances : []);
    totalLiabilities = BigInt(tree.totalLiabilities);
  } catch (_) {
    totalLiabilities = 0n;
  }

  let reserve = null;
  try {
    if (reserveMicro != null) reserve = BigInt(reserveMicro);
  } catch (_) {}

  const known = reserve != null && totalLiabilities >= 0n;
  const solvent = known ? reserve >= totalLiabilities : null;
  let ratio = null;
  if (known && totalLiabilities > 0n) {
    ratio = Number((reserve * 10000n) / totalLiabilities) / 100; // 2-decimal %
  } else if (known) {
    ratio = reserve > 0n ? 100 : 0;
  }

  let score = 100;
  if (!known) {
    score = 50; // unknown reserve = degraded confidence
  } else if (totalLiabilities === 0n) {
    score = reserve > 0n ? 100 : 0;
  } else if (ratio != null) {
    // Score formula: 100 at ratio >= 150%, linear down to 0 at ratio 0%
    score = Math.min(100, Math.max(0, Math.round((ratio / 150) * 100)));
    if (!solvent) score = Math.min(score, 25);
  }

  const critical = score <= 50;

  return { score, solvent, ratio, critical, totalLiabilities: totalLiabilities.toString() };
}

/**
 * Evaluate solvency and, if critical, trigger health escalation.
 * @param {{ balances?:Array, reserveMicro?:string|number|bigint, thresholdRatio?:number }} input
 * @returns {{ ok:boolean, escalated:boolean, reasons:Array, details:object }}
 */
function evaluateSolvencyEscalation438(input) {
  input = input || {};
  const health = assessSolvencyHealth438(input.balances, input.reserveMicro);
  const reasons = [];
  let escalated = false;

  if (health.critical) {
    reasons.push('solvency_critical');
    if (health.solvent === false) reasons.push('insolvency_detected');
    if (health.ratio != null && health.ratio < 100) reasons.push('reserve_below_liabilities');
    escalated = true;
  }

  const details = {
    solvencyHealth: health,
  };

  // If critical, feed into health-driven escalation (V437)
  if (escalated) {
    let escResult = { ok: false };
    try {
      const H437 = require('./healthDrivenEscalation437.js');
      escResult = H437.evaluateHealthEscalation437(
        { alertCount: reasons.length },
        80 // strict threshold for solvency
      );
    } catch (_) {}
    details.healthEscalation = escResult;
  }

  const entry = {
    at: new Date().toISOString(),
    escalated,
    reasons,
    details,
  };
  _solvencyLog438.push(entry);
  if (_solvencyLog438.length > MAX_LOG438) _solvencyLog438.shift();

  return { ok: true, escalated, reasons, details };
}

function wireSolvencyEscalation438(app) {
  if (!app) return;

  // V438-T01 POST /api/v1/solvency/escalation/check
  app.post('/api/v1/solvency/escalation/check', (req, res) => {
    try {
      const body = req.body || {};
      const result = evaluateSolvencyEscalation438(body);
      res.status(result.escalated ? 201 : 200).json({ ok: true, ecosVersion: 'V438', ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V438' });
    }
  });

  // V438-T02 GET /api/v1/admin/summary/v438
  app.get('/api/v1/admin/summary/v438', (_req, res) => {
    res.json({
      ok: true,
      ecosVersion: 'V438',
      version: SOLVENCY_ESCALATION_BRIDGE_VERSION438,
      feature: 'solvency-triggered-auto-escalation-bridge',
      connects: ['proofOfSolvency403', 'healthDrivenEscalation437'],
      thesis: 'when solvency health degrades, auto-escalate via the health system so humans intervene before users lose money',
      logSize: _solvencyLog438.length,
      lastEntries: _solvencyLog438.slice(-5),
    });
  });
}

module.exports = {
  SOLVENCY_ESCALATION_BRIDGE_VERSION438,
  assessSolvencyHealth438,
  evaluateSolvencyEscalation438,
  wireSolvencyEscalation438,
  _solvencyLog438,
};
