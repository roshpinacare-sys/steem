'use strict';

/**
 * sovereignAILedger.js — ECOS V131
 * ===================================
 * Aggregates inference log + translation log + payment ledger into a unified,
 * verifiable "AI balance sheet" for any client or the whole system.
 *
 * Three primary operations:
 *   1. clientReport(clientId)        — full AI activity for one client
 *   2. auditChain({ from, to })      — verify AI chain integrity for a time window
 *   3. stats()                       — system-wide statistics
 *
 * Design:
 *   - Aggregates from defaultInferenceChainLogger + defaultTranslationChainSigner.
 *   - Reads fiatLedger for payment data (Sacred File — read interface only).
 *   - No modifications to sacred files.
 *
 * [V131-AOC-03]
 */

'use strict';

// ── SovereignAILedger ─────────────────────────────────────────────────────────

class SovereignAILedger {
  constructor() {
    this._inferenceLogger = null;
    this._translationSigner = null;
    this._fiatLedger = null;
    this._mmr = null;
  }

  /**
   * Inject dependencies from server startup.
   * @param {object} deps
   * @param {object} deps.inferenceLogger     — defaultInferenceChainLogger
   * @param {object} deps.translationSigner   — defaultTranslationChainSigner
   * @param {object} [deps.fiatLedger]        — FiatLedger instance (Sacred, read-only)
   * @param {object} [deps.mmr]               — defaultMMR
   */
  setDeps({ inferenceLogger, translationSigner, fiatLedger = null, mmr = null }) {
    this._inferenceLogger   = inferenceLogger;
    this._translationSigner = translationSigner;
    this._fiatLedger        = fiatLedger;
    this._mmr               = mmr;
  }

  /**
   * Build a comprehensive AI report for a specific client.
   *
   * @param {string} clientId
   * @returns {{
   *   clientId:        string,
   *   totalInferences: number,
   *   avgConfidence:   number|null,
   *   totalTranslations: number,
   *   totalPaymentsUsd: string,
   *   chainIntact:     boolean,
   *   topTasks:        Array<{ taskId:string, count:number }>,
   *   proofSummary:    { firstHash:string|null, lastHash:string|null, mmrRoot:string|null },
   *   generatedAt:     string
   * }}
   */
  clientReport(clientId) {
    if (!clientId) throw new TypeError('SovereignAILedger.clientReport: clientId required');

    const inferences   = this._inferenceLogger
      ? this._inferenceLogger.getByClient(clientId)
      : [];
    const translations = this._translationSigner
      ? this._translationSigner.getByClient(clientId)
      : [];

    // Average confidence
    const confValues = inferences
      .map(r => r.confidence)
      .filter(c => c !== null && c !== undefined && !Number.isNaN(c));
    const avgConfidence = confValues.length > 0
      ? Math.round((confValues.reduce((s, c) => s + c, 0) / confValues.length) * 10000) / 10000
      : null;

    // Top tasks by inference count
    const taskCounts = {};
    for (const r of inferences) {
      if (r.taskId) {
        taskCounts[r.taskId] = (taskCounts[r.taskId] || 0) + 1;
      }
    }
    const topTasks = Object.entries(taskCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([taskId, count]) => ({ taskId, count }));

    // Payment total from fiatLedger (read only, best-effort)
    let totalPaymentsMicrocents = BigInt(0);
    if (this._fiatLedger) {
      try {
        const balance = this._fiatLedger.balance(clientId);
        // We read debits as proxy for spending — if balance is negative, it's spending
        // Use only positive payments from account history if available
        if (typeof balance === 'bigint' && balance < BigInt(0)) {
          totalPaymentsMicrocents = -balance;
        }
      } catch (_) {
        // account may not exist — non-fatal
      }
    }
    const totalPaymentsUsd = _microcentsToUsdString(totalPaymentsMicrocents);

    // Chain integrity check (basic: all records must have chainHash)
    const allRecords  = [...inferences, ...translations];
    const chainIntact = allRecords.every(r => !!r.chainHash);

    // Proof summary
    const firstHash = inferences[0]?.chainHash || translations[0]?.chainHash || null;
    const lastInf   = inferences[inferences.length - 1];
    const lastTr    = translations[translations.length - 1];
    const lastHash  = lastInf?.chainHash || lastTr?.chainHash || null;
    const mmrRoot   = this._mmr && this._mmr.root ? this._mmr.root() : null;

    return {
      clientId,
      totalInferences:    inferences.length,
      avgConfidence,
      totalTranslations:  translations.length,
      totalPaymentsUsd,
      chainIntact,
      topTasks,
      proofSummary: { firstHash, lastHash, mmrRoot },
      generatedAt:  new Date().toISOString(),
    };
  }

  /**
   * Audit the AI chain for integrity.
   * Checks that all logged inferences in the time window have valid chainHashes,
   * and counts any gaps (missing or null hashes).
   *
   * @param {object} [opts]
   * @param {string} [opts.from]  — ISO date lower bound (inclusive)
   * @param {string} [opts.to]    — ISO date upper bound (inclusive)
   * @returns {{ intact:boolean, verified:number, gaps:number, mmrRoot:string|null }}
   */
  auditChain({ from = null, to = null } = {}) {
    const allInferences   = this._inferenceLogger   ? [...this._inferenceLogger._byId.values()]   : [];
    const allTranslations = this._translationSigner ? [...this._translationSigner._byId.values()] : [];
    const all = [...allInferences, ...allTranslations];

    const fromTs = from ? new Date(from).getTime() : 0;
    const toTs   = to   ? new Date(to).getTime()   : Infinity;

    const inWindow = all.filter(r => {
      const t = new Date(r.timestamp).getTime();
      return t >= fromTs && t <= toTs;
    });

    const gaps    = inWindow.filter(r => !r.chainHash).length;
    const intact  = gaps === 0;
    const mmrRoot = this._mmr && this._mmr.root ? this._mmr.root() : null;

    return {
      intact,
      verified: inWindow.length - gaps,
      gaps,
      mmrRoot,
      window: { from, to },
    };
  }

  /**
   * System-wide statistics.
   *
   * @returns {{
   *   totalInferences:   number,
   *   totalTranslations: number,
   *   avgConfidence:     number|null,
   *   mmrLeafCount:      number,
   *   mmrRoot:           string|null,
   *   chainIntact:       boolean,
   *   generatedAt:       string
   * }}
   */
  stats() {
    const allInferences   = this._inferenceLogger   ? this._inferenceLogger.size   : 0;
    const allTranslations = this._translationSigner ? this._translationSigner.size : 0;

    // Avg confidence across all inferences
    let avgConfidence = null;
    if (this._inferenceLogger && this._inferenceLogger.size > 0) {
      const all    = [...this._inferenceLogger._byId.values()];
      const vals   = all.map(r => r.confidence).filter(c => c !== null && !Number.isNaN(c));
      if (vals.length > 0) {
        avgConfidence = Math.round(
          (vals.reduce((s, c) => s + c, 0) / vals.length) * 10000,
        ) / 10000;
      }
    }

    const mmrRoot      = this._mmr && this._mmr.root ? this._mmr.root() : null;
    const mmrLeafCount = this._mmr
      ? (typeof this._mmr.size === 'number' ? this._mmr.size : (this._mmr._size || 0))
      : 0;

    // Chain intact = no null chainHashes in any logged record
    let chainIntact = true;
    if (this._inferenceLogger) {
      for (const r of this._inferenceLogger._byId.values()) {
        if (!r.chainHash) { chainIntact = false; break; }
      }
    }

    return {
      totalInferences:   allInferences,
      totalTranslations: allTranslations,
      avgConfidence,
      mmrLeafCount,
      mmrRoot,
      chainIntact,
      generatedAt: new Date().toISOString(),
    };
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function _microcentsToUsdString(microcents) {
  if (typeof microcents !== 'bigint') microcents = BigInt(0);
  const cents  = microcents / BigInt(100);
  const dollars = cents / BigInt(100);
  const rem     = cents % BigInt(100);
  return `${dollars.toString()}.${String(rem).padStart(2, '0')}`;
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const defaultSovereignAILedger = new SovereignAILedger();

module.exports = {
  SovereignAILedger,
  defaultSovereignAILedger,
};
