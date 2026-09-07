/**
 * lib/workspaceRateLimiterService.js — ECOS V176
 * ═══════════════════════════════════════════════════════════════════════════
 * Per-Workspace Request Rate Limiter — in-memory token bucket
 *
 * Provides a per-workspace rate limiter using the token bucket algorithm.
 * Each workspace gets its own bucket that refills at a configurable rate.
 * An admin endpoint exposes live statistics for all active buckets.
 *
 * Features:
 *  - Token bucket per workspace (configurable capacity + refill rate)
 *  - check(workspaceId) → { allowed, remaining, resetAt, workspaceId }
 *  - stats() → aggregate stats for all active buckets
 *  - Automatic cleanup of stale buckets (no DB needed — pure in-memory)
 *  - Zero external dependencies (R6)
 *  - NODE_ENV=test exports (R8)
 *
 * Token bucket algorithm:
 *  - Each workspace bucket starts full (capacity tokens).
 *  - Each request consumes 1 token.
 *  - Tokens refill at `refillRate` tokens per `refillWindowMs` milliseconds.
 *  - If the bucket is empty, the request is rejected (429).
 *
 * Sacred Files: lib/fiatLedger.js, lib/auditLog.js — UNTOUCHED
 * [V176-T03]
 *
 * @version 176.0.0
 */
'use strict';

// ── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_CAPACITY       = 60;   // max tokens per bucket
const DEFAULT_REFILL_RATE    = 60;   // tokens added per refill window
const DEFAULT_REFILL_WINDOW  = 60_000; // 1 minute in ms
const CLEANUP_INTERVAL_MS    = 5 * 60_000; // clean stale buckets every 5 min
const STALE_THRESHOLD_MS     = 10 * 60_000; // bucket is stale if idle > 10 min

// ── Errors ───────────────────────────────────────────────────────────────────
class RateLimitExceededError extends Error {
  constructor(workspaceId, resetAt) {
    super(`Rate limit exceeded for workspace ${workspaceId}. Resets at ${resetAt.toISOString()}`);
    this.name        = 'RateLimitExceededError';
    this.code        = 'RATE_LIMIT_EXCEEDED';
    this.statusCode  = 429;
    this.workspaceId = workspaceId;
    this.resetAt     = resetAt;
  }
}

// ── Token Bucket ──────────────────────────────────────────────────────────────
class TokenBucket {
  /**
   * @param {object} opts
   * @param {number} opts.capacity      — maximum tokens
   * @param {number} opts.refillRate    — tokens added per refill window
   * @param {number} opts.refillWindowMs — window length in ms
   */
  constructor({ capacity, refillRate, refillWindowMs }) {
    this.capacity       = capacity;
    this.refillRate     = refillRate;
    this.refillWindowMs = refillWindowMs;
    this.tokens         = capacity;          // start full
    this.lastRefillAt   = Date.now();
    this.lastAccessAt   = Date.now();
    this.totalRequests  = 0;
    this.rejectedRequests = 0;
  }

  /**
   * Refill tokens based on elapsed time since last refill.
   * @private
   */
  _refill() {
    const now     = Date.now();
    const elapsed = now - this.lastRefillAt;
    if (elapsed <= 0) return;

    const tokensToAdd = Math.floor((elapsed / this.refillWindowMs) * this.refillRate);
    if (tokensToAdd > 0) {
      this.tokens       = Math.min(this.capacity, this.tokens + tokensToAdd);
      this.lastRefillAt = now;
    }
  }

  /**
   * Attempt to consume one token.
   *
   * @returns {{ allowed: boolean, remaining: number, resetAt: Date }}
   */
  consume() {
    this._refill();
    this.lastAccessAt = Date.now();
    this.totalRequests++;

    if (this.tokens > 0) {
      this.tokens--;
      return {
        allowed:   true,
        remaining: this.tokens,
        resetAt:   new Date(this.lastRefillAt + this.refillWindowMs),
      };
    }

    this.rejectedRequests++;
    return {
      allowed:   false,
      remaining: 0,
      resetAt:   new Date(this.lastRefillAt + this.refillWindowMs),
    };
  }

  /**
   * Return a snapshot of the bucket state.
   */
  snapshot() {
    this._refill();
    return {
      capacity:         this.capacity,
      tokens:           this.tokens,
      refillRate:       this.refillRate,
      refillWindowMs:   this.refillWindowMs,
      lastRefillAt:     new Date(this.lastRefillAt).toISOString(),
      lastAccessAt:     new Date(this.lastAccessAt).toISOString(),
      totalRequests:    this.totalRequests,
      rejectedRequests: this.rejectedRequests,
    };
  }
}

// ── Service ───────────────────────────────────────────────────────────────────
class WorkspaceRateLimiterService {
  /**
   * @param {object}  opts
   * @param {number} [opts.capacity]       — default bucket capacity
   * @param {number} [opts.refillRate]     — default refill rate
   * @param {number} [opts.refillWindowMs] — default refill window
   * @param {object} [opts.logger]
   */
  constructor({
    capacity       = DEFAULT_CAPACITY,
    refillRate     = DEFAULT_REFILL_RATE,
    refillWindowMs = DEFAULT_REFILL_WINDOW,
    logger         = null,
  } = {}) {
    this._capacity       = capacity;
    this._refillRate     = refillRate;
    this._refillWindowMs = refillWindowMs;
    this._log            = logger || { info: () => {}, warn: () => {}, error: () => {} };
    this._version        = 'V176';

    /** @type {Map<string, TokenBucket>} workspaceId → TokenBucket */
    this._buckets = new Map();

    // Periodic cleanup of stale buckets
    this._cleanupTimer = setInterval(() => this._cleanup(), CLEANUP_INTERVAL_MS);
    if (this._cleanupTimer.unref) this._cleanupTimer.unref();
  }

  // ── check ─────────────────────────────────────────────────────────────────
  /**
   * Check (and consume one token from) the bucket for a workspace.
   *
   * @param {string}  workspaceId
   * @param {object} [opts]
   * @param {number} [opts.capacity]       — override capacity for this workspace
   * @param {number} [opts.refillRate]     — override refill rate
   * @param {number} [opts.refillWindowMs] — override refill window
   * @returns {{ allowed: boolean, remaining: number, resetAt: Date, workspaceId: string }}
   */
  check(workspaceId, opts = {}) {
    if (!workspaceId) throw new Error('workspaceId required');

    if (!this._buckets.has(workspaceId)) {
      this._buckets.set(workspaceId, new TokenBucket({
        capacity:       opts.capacity       || this._capacity,
        refillRate:     opts.refillRate     || this._refillRate,
        refillWindowMs: opts.refillWindowMs || this._refillWindowMs,
      }));
    }

    const result = this._buckets.get(workspaceId).consume();
    return { ...result, workspaceId };
  }

  // ── getBucketStats ────────────────────────────────────────────────────────
  /**
   * Get the current stats for a specific workspace bucket.
   *
   * @param {string} workspaceId
   * @returns {object|null}
   */
  getBucketStats(workspaceId) {
    const bucket = this._buckets.get(workspaceId);
    if (!bucket) return null;
    return { workspaceId, ...bucket.snapshot() };
  }

  // ── stats ─────────────────────────────────────────────────────────────────
  /**
   * Return aggregate statistics for all active buckets.
   *
   * @returns {{ activeBuckets: number, totalRequests: number, rejectedRequests: number, buckets: object[] }}
   */
  stats() {
    const buckets = [];
    let totalRequests    = 0;
    let rejectedRequests = 0;

    for (const [workspaceId, bucket] of this._buckets) {
      const snap = bucket.snapshot();
      buckets.push({ workspaceId, ...snap });
      totalRequests    += snap.totalRequests;
      rejectedRequests += snap.rejectedRequests;
    }

    return {
      activeBuckets:    this._buckets.size,
      totalRequests,
      rejectedRequests,
      allowedRequests:  totalRequests - rejectedRequests,
      config: {
        defaultCapacity:       this._capacity,
        defaultRefillRate:     this._refillRate,
        defaultRefillWindowMs: this._refillWindowMs,
      },
      buckets,
    };
  }

  // ── _cleanup ──────────────────────────────────────────────────────────────
  /**
   * Remove stale buckets (not accessed in the last STALE_THRESHOLD_MS).
   * @private
   */
  _cleanup() {
    const now = Date.now();
    for (const [workspaceId, bucket] of this._buckets) {
      if (now - bucket.lastAccessAt > STALE_THRESHOLD_MS) {
        this._buckets.delete(workspaceId);
      }
    }
  }

  /** Stop the background cleanup timer (useful in tests). */
  destroy() {
    clearInterval(this._cleanupTimer);
  }

  /** @internal — for testing only */
  _clear() { this._buckets.clear(); }
}

// ── Singleton ─────────────────────────────────────────────────────────────────
const defaultRateLimiterService = new WorkspaceRateLimiterService();

module.exports = {
  WorkspaceRateLimiterService,
  TokenBucket,
  RateLimitExceededError,
  DEFAULT_CAPACITY,
  DEFAULT_REFILL_RATE,
  DEFAULT_REFILL_WINDOW,
  defaultRateLimiterService,
};

if (process.env.NODE_ENV === 'test') {
  module.exports._wsRateLimiter = defaultRateLimiterService;
}
