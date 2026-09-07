'use strict';

/**
 * ValidatorRouter — V99
 * ─────────────────────────────────────────────────────────────────────────────
 * Smart routing: directs HITL_QUEUE tasks to the best available registered
 * validator based on specialization keywords, reputation score, and queue depth.
 *
 * Routing priority (in order):
 *   1. Specialization match (TF-IDF cosine > 0.3): route to matching validator
 *   2. High reputation (score > 80) with queue < maxQueueDepth: prefer them
 *   3. Fallback: default pool (null)
 *
 * Reason codes returned:
 *   'specialization_match' — task text overlaps validator's keywords
 *   'high_reputation'      — validator has score > 80 and capacity
 *   'low_queue'            — validator with lowest queue depth selected
 *   'default_pool'         — no specific validator selected
 */

class ValidatorRouter {
  /**
   * @param {import('./validatorReputation').ValidatorReputation} reputationEngine
   */
  constructor(reputationEngine) {
    this._rep      = reputationEngine;
    // Map<validatorId, { specializations: string[], maxQueueDepth: number, currentQueue: number }>
    this._validators = new Map();
    this._totalRouted = 0;
    this._defaultPoolCount = 0;
  }

  // ── registerValidator ─────────────────────────────────────────────────────
  /**
   * Register a validator with their specializations and queue limit.
   * @param {string} validatorId
   * @param {object} opts
   * @param {string[]} [opts.specializations=[]]  — keyword list e.g. ['contract','legal']
   * @param {number}   [opts.maxQueueDepth=10]
   */
  registerValidator(validatorId, { specializations = [], maxQueueDepth = 10 } = {}) {
    if (!validatorId || typeof validatorId !== 'string') return;
    this._validators.set(validatorId, {
      specializations: specializations.map(s => String(s).toLowerCase()),
      maxQueueDepth:   Math.max(1, Number(maxQueueDepth) || 10),
      currentQueue:    0,
    });
  }

  // ── route ─────────────────────────────────────────────────────────────────
  /**
   * Route a task to the best available validator.
   * @param {string} taskText
   * @param {object} [opts]
   * @param {number} [opts.confidence]
   * @param {string|number} [opts.priceUsd]
   * @returns {{ validatorId: string|null, reason: string, score: number }}
   */
  route(taskText, { confidence, priceUsd } = {}) {
    if (this._validators.size === 0) {
      return { validatorId: null, reason: 'default_pool', score: 0 };
    }

    const tokens   = this._tokenize(taskText);
    const queryTf  = this._buildTf(tokens);

    let bestSpecMatch  = null;
    let bestSpecScore  = 0;
    let bestRepMatch   = null;
    let bestRepScore   = 0;

    for (const [vid, info] of this._validators.entries()) {
      // Skip validators at capacity
      if (info.currentQueue >= info.maxQueueDepth) continue;

      // ── Priority 1: specialization TF-IDF match ──
      if (info.specializations.length > 0) {
        const specTf    = this._buildTf(info.specializations);
        const similarity = this._cosine(queryTf, specTf);
        if (similarity > 0.3 && similarity > bestSpecScore) {
          bestSpecScore = similarity;
          bestSpecMatch = vid;
        }
      }

      // ── Priority 2: high reputation + capacity ──
      const repScore = this._rep ? this._rep.getScore(vid) : 0;
      if (repScore > 80 && repScore > bestRepScore) {
        bestRepScore = repScore;
        bestRepMatch = vid;
      }
    }

    if (bestSpecMatch) {
      this._validators.get(bestSpecMatch).currentQueue++;
      this._totalRouted++;
      return { validatorId: bestSpecMatch, reason: 'specialization_match', score: bestSpecScore };
    }

    if (bestRepMatch) {
      this._validators.get(bestRepMatch).currentQueue++;
      this._totalRouted++;
      return { validatorId: bestRepMatch, reason: 'high_reputation', score: bestRepScore };
    }

    // ── Priority 3: lowest queue depth among available ──
    let minQueue = Infinity;
    let minVid   = null;
    for (const [vid, info] of this._validators.entries()) {
      if (info.currentQueue < info.maxQueueDepth && info.currentQueue < minQueue) {
        minQueue = info.currentQueue;
        minVid   = vid;
      }
    }
    if (minVid) {
      this._validators.get(minVid).currentQueue++;
      this._totalRouted++;
      return { validatorId: minVid, reason: 'low_queue', score: 0 };
    }

    // All validators at capacity → default pool
    this._defaultPoolCount++;
    return { validatorId: null, reason: 'default_pool', score: 0 };
  }

  // ── getQueueDepths ────────────────────────────────────────────────────────
  /**
   * Returns current queue depth per registered validator.
   * @returns {Object.<string, number>}
   */
  getQueueDepths() {
    const depths = {};
    for (const [vid, info] of this._validators.entries()) {
      depths[vid] = info.currentQueue;
    }
    return depths;
  }

  // ── unassign ──────────────────────────────────────────────────────────────
  /**
   * Decrement a validator's queue depth when a task is resolved.
   * @param {string} validatorId
   * @param {string} [approvalId]
   */
  unassign(validatorId, approvalId) {
    const info = this._validators.get(validatorId);
    if (info && info.currentQueue > 0) {
      info.currentQueue--;
    }
  }

  // ── stats ─────────────────────────────────────────────────────────────────
  getStats() {
    return {
      registeredValidators: this._validators.size,
      queueDepths:          this.getQueueDepths(),
      totalRouted:          this._totalRouted,
      defaultPool:          this._defaultPoolCount,
    };
  }

  // ── TF-IDF helpers ────────────────────────────────────────────────────────
  _tokenize(text) {
    const STOP = new Set(['the','a','an','is','are','was','were','to','of','in','for','on','with','at','by','from']);
    return String(text || '').toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 0 && !STOP.has(w));
  }

  _buildTf(tokens) {
    const tf = {};
    for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
    return tf;
  }

  _cosine(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (const w of Object.keys(a)) { na += a[w]*a[w]; if (b[w]) dot += a[w]*b[w]; }
    for (const w of Object.keys(b)) nb += b[w]*b[w];
    return (na === 0 || nb === 0) ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
  }
}

module.exports = { ValidatorRouter };
