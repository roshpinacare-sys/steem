/**
 * rateLimiter.js — V96
 * General-purpose in-memory rate limiter using a sliding window counter.
 *
 * Usage:
 *   const { RateLimiter } = require('./lib/rateLimiter');
 *   const limiter = new RateLimiter(60_000, 30); // 30 req/min
 *   const { allowed, remaining, resetAt } = limiter.check(ip);
 *
 * Design notes:
 *   - Uses Map<key, { count, windowStart }>
 *   - Window resets after windowMs elapsed since windowStart
 *   - Old keys cleaned up every 5 minutes to prevent unbounded memory growth
 *   - Never throws; safe to call on every request
 */

'use strict';

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

class RateLimiter {
  /**
   * @param {number} windowMs   - Rolling window length in milliseconds
   * @param {number} maxRequests - Maximum allowed requests per window per key
   */
  constructor(windowMs, maxRequests) {
    this.windowMs    = windowMs;
    this.maxRequests = maxRequests;
    this._store      = new Map(); // Map<key, { count: number, windowStart: number }>

    // Periodic cleanup: remove stale windows every 5 minutes
    this._cleanupTimer = setInterval(() => this._cleanup(), CLEANUP_INTERVAL_MS);
    // Do not keep the process alive solely for cleanup
    if (this._cleanupTimer.unref) this._cleanupTimer.unref();
  }

  /**
   * Check (and record) a request for the given key.
   *
   * @param {string} key - Typically the requester's IP address
   * @returns {{ allowed: boolean, remaining: number, resetAt: Date }}
   */
  check(key) {
    const now   = Date.now();
    const entry = this._store.get(key);

    // No entry yet, or current window has expired → start fresh window
    if (!entry || now - entry.windowStart >= this.windowMs) {
      this._store.set(key, { count: 1, windowStart: now });
      return {
        allowed:   true,
        remaining: this.maxRequests - 1,
        resetAt:   new Date(now + this.windowMs),
      };
    }

    // Within the current window
    if (entry.count < this.maxRequests) {
      entry.count += 1;
      return {
        allowed:   true,
        remaining: this.maxRequests - entry.count,
        resetAt:   new Date(entry.windowStart + this.windowMs),
      };
    }

    // Limit exceeded
    return {
      allowed:   false,
      remaining: 0,
      resetAt:   new Date(entry.windowStart + this.windowMs),
    };
  }

  /**
   * Remove entries whose windows have already expired.
   * Called automatically every 5 minutes; may also be called manually in tests.
   */
  _cleanup() {
    const now = Date.now();
    for (const [key, entry] of this._store) {
      if (now - entry.windowStart >= this.windowMs) {
        this._store.delete(key);
      }
    }
  }

  /** Stop the background cleanup timer (useful in tests). */
  destroy() {
    clearInterval(this._cleanupTimer);
  }
}

module.exports = { RateLimiter };
