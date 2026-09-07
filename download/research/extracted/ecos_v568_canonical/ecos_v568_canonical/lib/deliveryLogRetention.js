/**
 * deliveryLogRetention.js — ECOS V140
 * ────────────────────────────────────────────────────────────────────────────
 * [V140-DL-01] Delivery Log Retention Policy — purge old entries and report
 * stats for the notification_delivery_log table (added in V138-ND01).
 *
 * Without this, the delivery log grows unbounded in production.
 *
 * Features:
 *   - purge(days?)  — DELETE rows older than N days (default: ECOS_DELIVERY_LOG_RETENTION_DAYS || 30)
 *   - stats()       — aggregate counts by channel, success flag, day bucket
 *   - schedulePurge(intervalMs) — set up periodic background purge
 *   - endpoint: GET /api/v1/rank/notifications/delivery-log/stats
 *   - endpoint: POST /api/v1/rank/notifications/delivery-log/purge  (admin)
 *
 * [V140-DL-01] Initial implementation
 */

'use strict';

const DEFAULT_RETENTION_DAYS = 30;

class DeliveryLogRetention {
  /**
   * @param {object} opts
   * @param {object}  opts.dbPool        — Postgres pool (required for DB ops)
   * @param {number}  [opts.retentionDays] — default days to retain (env override)
   * @param {object}  [opts.logger]
   */
  constructor(opts = {}) {
    this._db              = opts.dbPool || null;
    this._retentionDays   = opts.retentionDays
      || parseInt(process.env.ECOS_DELIVERY_LOG_RETENTION_DAYS || String(DEFAULT_RETENTION_DAYS), 10);
    this._log             = opts.logger || console;
    this._timer           = null;
    this._lastPurge       = null;
    this._lastPurgeCount  = 0;
  }

  /**
   * Purge delivery log entries older than N days.
   *
   * @param {number} [days] — override instance default
   * @returns {Promise<{ ok, deleted, cutoff, retentionDays }>}
   */
  async purge(days) {
    if (!this._db) {
      return { ok: false, error: 'DB not connected', deleted: 0 };
    }
    const retentionDays = days != null ? days : this._retentionDays;
    const cutoff        = new Date(Date.now() - retentionDays * 86_400_000).toISOString();

    try {
      const result = await this._db.query(
        `DELETE FROM notification_delivery_log WHERE created_at < $1`,
        [cutoff]
      );
      const deleted        = result.rowCount || 0;
      this._lastPurge      = new Date().toISOString();
      this._lastPurgeCount = deleted;
      this._log.info && this._log.info(
        { deleted, retentionDays, cutoff },
        '[DeliveryLogRetention] Purged old delivery log entries'
      );
      return { ok: true, deleted, cutoff, retentionDays };
    } catch (err) {
      this._log.error && this._log.error({ err: err.message }, '[DeliveryLogRetention] purge failed');
      return { ok: false, error: err.message, deleted: 0 };
    }
  }

  /**
   * Aggregate stats for the delivery log.
   *
   * @returns {Promise<{ ok, totalRecords, byChannel, successRate, byDay, retentionPolicy }>}
   */
  async stats() {
    if (!this._db) {
      return {
        ok: false,
        error: 'DB not connected',
        retentionPolicy: { retentionDays: this._retentionDays },
      };
    }

    try {
      // Total + success rate
      const totals = await this._db.query(`
        SELECT
          COUNT(*)                                          AS total,
          COUNT(*) FILTER (WHERE success = true)           AS success_count,
          COUNT(*) FILTER (WHERE success = false)          AS failure_count,
          AVG(latency_ms) FILTER (WHERE latency_ms IS NOT NULL) AS avg_latency_ms
        FROM notification_delivery_log
      `);

      // By channel
      const byChannel = await this._db.query(`
        SELECT
          channel,
          COUNT(*)                                AS count,
          COUNT(*) FILTER (WHERE success = true)  AS success_count,
          AVG(latency_ms)                         AS avg_latency_ms
        FROM notification_delivery_log
        GROUP BY channel
        ORDER BY count DESC
        LIMIT 20
      `);

      // By day (last 14 days)
      const byDay = await this._db.query(`
        SELECT
          DATE_TRUNC('day', created_at)::date AS day,
          COUNT(*)                             AS count,
          COUNT(*) FILTER (WHERE success)      AS success_count
        FROM notification_delivery_log
        WHERE created_at > NOW() - INTERVAL '14 days'
        GROUP BY 1
        ORDER BY 1 DESC
      `);

      const row   = totals.rows[0] || {};
      const total = parseInt(row.total || 0, 10);
      const succ  = parseInt(row.success_count || 0, 10);

      return {
        ok: true,
        totalRecords:  total,
        successCount:  succ,
        failureCount:  parseInt(row.failure_count || 0, 10),
        successRate:   total > 0 ? Math.round((succ / total) * 1000) / 10 : null,
        avgLatencyMs:  row.avg_latency_ms ? Math.round(parseFloat(row.avg_latency_ms)) : null,
        byChannel:     byChannel.rows.map(r => ({
          channel:      r.channel,
          count:        parseInt(r.count, 10),
          successCount: parseInt(r.success_count, 10),
          avgLatencyMs: r.avg_latency_ms ? Math.round(parseFloat(r.avg_latency_ms)) : null,
        })),
        byDay: byDay.rows.map(r => ({
          day:          r.day,
          count:        parseInt(r.count, 10),
          successCount: parseInt(r.success_count, 10),
        })),
        retentionPolicy: {
          retentionDays:  this._retentionDays,
          lastPurge:      this._lastPurge,
          lastPurgeCount: this._lastPurgeCount,
        },
      };
    } catch (err) {
      this._log.error && this._log.error({ err: err.message }, '[DeliveryLogRetention] stats failed');
      return { ok: false, error: err.message };
    }
  }

  /**
   * Schedule periodic background purge.
   * @param {number} [intervalMs] — default: 24h
   */
  schedulePurge(intervalMs = 86_400_000) {
    if (this._timer) return; // already scheduled
    this._timer = setInterval(() => {
      this.purge().catch(err =>
        this._log.error && this._log.error({ err: err.message }, '[DeliveryLogRetention] scheduled purge failed')
      );
    }, intervalMs);
    if (this._timer.unref) this._timer.unref(); // don't block Node exit
    this._log.info && this._log.info(
      { intervalHours: Math.round(intervalMs / 3_600_000), retentionDays: this._retentionDays },
      '[DeliveryLogRetention] Scheduled periodic purge'
    );
  }

  stopSchedule() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────────

let _instance = null;
function getDeliveryLogRetention(opts = {}) {
  if (!_instance) _instance = new DeliveryLogRetention(opts);
  return _instance;
}
function resetInstance() { _instance = null; }

module.exports = { DeliveryLogRetention, getDeliveryLogRetention, resetInstance };
