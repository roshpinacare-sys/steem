'use strict';
/**
 * src/lib/solvencyAlertEvaluator404.js — ECOS V404 (Phase P292) — Solvency Alert Evaluator
 *
 * Configurable threshold-based alerting over V403 solvency attestations.
 * Emits structured alerts when surplus drops below `minSurplusMicro` or the
 * reserve-to-liability ratio falls under `minRatio`. Pure, deterministic, no
 * side effects on sacred (R1). No new deps (R3). Identifiers end in 404 (R2).
 *
 * @version 404.0.0
 */

const ALERT_EVALUATOR_VERSION_404 = '404.0.0';

function _big404(v) {
  if (v == null) return null;
  try { return typeof v === 'bigint' ? v : BigInt(v); } catch (_) { return null; }
}

function createSolvencyAlertEvaluator404(rules) {
  rules = rules || {};
  const minSurplus = _big404(rules.minSurplusMicro);  // bigint or null
  const minRatio = Number.isFinite(rules.minRatio) ? Number(rules.minRatio) : null; // e.g. 1.05
  const insolventIsAlert = rules.insolventIsAlert !== false; // default true

  function evaluate404(attestation) {
    const alerts = [];
    if (!attestation || typeof attestation !== 'object') {
      return { alerts: [{ code: 'BAD_ATTESTATION_404', severity: 'critical', message: 'attestation missing' }], severity: 'critical' };
    }
    if (insolventIsAlert && attestation.solvent === false) {
      alerts.push({ code: 'INSOLVENT_404', severity: 'critical', message: 'reserve below liabilities',
        totalLiabilities: attestation.totalLiabilities, reserveMicro: attestation.reserveMicro });
    }
    if (minSurplus != null) {
      const surplus = _big404(attestation.surplusMicro);
      if (surplus != null && surplus < minSurplus) {
        alerts.push({ code: 'LOW_SURPLUS_404', severity: 'warn', message: 'surplus below threshold',
          surplusMicro: surplus.toString(), thresholdMicro: minSurplus.toString() });
      }
    }
    if (minRatio != null) {
      const liab = _big404(attestation.totalLiabilities);
      const res = _big404(attestation.reserveMicro);
      if (liab != null && res != null && liab > 0n) {
        const ratio = Number(res) / Number(liab);
        if (Number.isFinite(ratio) && ratio < minRatio) {
          alerts.push({ code: 'LOW_RATIO_404', severity: 'warn', message: 'reserve/liability ratio below threshold',
            ratio: ratio.toFixed(6), threshold: minRatio });
        }
      }
    }
    const severity = alerts.some(a => a.severity === 'critical') ? 'critical'
                   : alerts.some(a => a.severity === 'warn') ? 'warn'
                   : 'ok';
    return { alerts, severity };
  }

  return { evaluate404, rules: { minSurplusMicro: minSurplus != null ? minSurplus.toString() : null, minRatio, insolventIsAlert } };
}

module.exports = {
  ALERT_EVALUATOR_VERSION_404,
  createSolvencyAlertEvaluator404,
};
