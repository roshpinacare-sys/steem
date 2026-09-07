'use strict';

/**
 * ValidatorReputation — V99
 * ─────────────────────────────────────────────────────────────────────────────
 * Tracks per-validator performance metrics and computes a 0–100 reputation
 * score used for leaderboard display and smart routing decisions.
 *
 * Score formula (weighted average, clamped to [0, 100]):
 *   approvalRate  (weight 0.3): approved / (approved + rejected)
 *   volumeScore   (weight 0.3): log(totalTasks + 1) / log(100), clamped 0–1
 *   earningsScore (weight 0.4): totalEarned / median(allValidators.totalEarned)
 *
 * All arithmetic is done in plain JS floats — no BigInt, no external deps.
 */

class ValidatorReputation {
  constructor() {
    // Map<validatorId, Stats>
    this._stats = new Map();
  }

  // ── record ────────────────────────────────────────────────────────────────
  /**
   * Record a validation outcome. Called after every resolveApproval.
   * @param {string} validatorId
   * @param {object} opts
   * @param {string} opts.decision   — 'approve' | 'reject' | 'modified'
   * @param {number} [opts.confidence]
   * @param {string|number} [opts.priceUsd]
   * @param {string} [opts.missionId]
   */
  record(validatorId, { decision, confidence, priceUsd, missionId } = {}) {
    if (!validatorId || typeof validatorId !== 'string') return;

    if (!this._stats.has(validatorId)) {
      this._stats.set(validatorId, {
        validatorId,
        totalTasks:  0,
        approved:    0,
        rejected:    0,
        totalEarned: 0,   // in USD (float)
        lastActiveAt: null,
      });
    }

    const s = this._stats.get(validatorId);
    s.totalTasks++;
    s.lastActiveAt = new Date().toISOString();

    const d = String(decision || '').toLowerCase();
    if (d === 'approve' || d === 'approved' || d === 'modified') {
      s.approved++;
    } else {
      s.rejected++;
    }

    // Credit earnings: validator gets 40% of priceUsd for HITL approvals
    const price = parseFloat(priceUsd);
    if (Number.isFinite(price) && price > 0) {
      s.totalEarned += price * 0.4;
    }
  }

  // ── _computeScore ─────────────────────────────────────────────────────────
  _computeScore(stats, medianEarned) {
    if (!stats || stats.totalTasks === 0) return 0;

    const approvalRate  = stats.approved / (stats.approved + stats.rejected || 1);
    const volumeScore   = Math.min(1, Math.log(stats.totalTasks + 1) / Math.log(100));
    const earningsScore = medianEarned > 0
      ? Math.min(1, stats.totalEarned / medianEarned)
      : (stats.totalEarned > 0 ? 1 : 0);

    const raw = (approvalRate * 0.3) + (volumeScore * 0.3) + (earningsScore * 0.4);
    return Math.round(Math.min(100, Math.max(0, raw * 100)));
  }

  // ── _medianEarned ─────────────────────────────────────────────────────────
  _medianEarned() {
    const earnings = Array.from(this._stats.values()).map(s => s.totalEarned);
    if (earnings.length === 0) return 0;
    earnings.sort((a, b) => a - b);
    const mid = Math.floor(earnings.length / 2);
    return earnings.length % 2 === 0
      ? (earnings[mid - 1] + earnings[mid]) / 2
      : earnings[mid];
  }

  // ── getScore ──────────────────────────────────────────────────────────────
  /**
   * Get reputation score (0–100) for a validator.
   * Returns 0 if validator has no recorded activity.
   * @param {string} validatorId
   * @returns {number}
   */
  getScore(validatorId) {
    const s = this._stats.get(validatorId);
    if (!s) return 0;
    return this._computeScore(s, this._medianEarned());
  }

  // ── getStats ──────────────────────────────────────────────────────────────
  /**
   * Get full stats for a validator.
   * @param {string} validatorId
   * @returns {object|null}
   */
  getStats(validatorId) {
    const s = this._stats.get(validatorId);
    if (!s) return null;
    const median = this._medianEarned();
    const score  = this._computeScore(s, median);
    const rank   = this.getRank(validatorId);
    return {
      validatorId:  s.validatorId,
      score,
      totalTasks:   s.totalTasks,
      approved:     s.approved,
      rejected:     s.rejected,
      approvalRate: s.totalTasks > 0
        ? Math.round((s.approved / s.totalTasks) * 10000) / 100
        : 0,
      totalEarned:  Math.round(s.totalEarned * 10000) / 10000,
      rank,
      lastActiveAt: s.lastActiveAt,
    };
  }

  // ── getLeaderboard ────────────────────────────────────────────────────────
  /**
   * Get top N validators sorted by score descending.
   * @param {number} [limit=10]
   * @returns {object[]}
   */
  getLeaderboard(limit = 10) {
    const median = this._medianEarned();
    const all    = Array.from(this._stats.values())
      .map(s => ({
        validatorId:  s.validatorId,
        score:        this._computeScore(s, median),
        totalTasks:   s.totalTasks,
        approved:     s.approved,
        rejected:     s.rejected,
        approvalRate: s.totalTasks > 0
          ? Math.round((s.approved / s.totalTasks) * 10000) / 100
          : 0,
        totalEarned:  Math.round(s.totalEarned * 10000) / 10000,
        lastActiveAt: s.lastActiveAt,
      }))
      .sort((a, b) => b.score - a.score || b.totalTasks - a.totalTasks);

    return all.slice(0, Math.max(1, limit)).map((v, i) => ({ ...v, rank: i + 1 }));
  }

  // ── getRank ───────────────────────────────────────────────────────────────
  /**
   * Get 1-indexed rank of a validator (by score descending).
   * Returns 0 if validator unknown.
   * @param {string} validatorId
   * @returns {number}
   */
  getRank(validatorId) {
    const median = this._medianEarned();
    const sorted = Array.from(this._stats.values())
      .sort((a, b) => {
        const sa = this._computeScore(a, median);
        const sb = this._computeScore(b, median);
        return sb - sa || b.totalTasks - a.totalTasks;
      });
    const idx = sorted.findIndex(s => s.validatorId === validatorId);
    return idx === -1 ? 0 : idx + 1;
  }
}

module.exports = { ValidatorReputation };
