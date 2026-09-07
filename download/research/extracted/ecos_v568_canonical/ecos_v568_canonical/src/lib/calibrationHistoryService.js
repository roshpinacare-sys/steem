/**
 * lib/calibrationHistoryService.js — V158
 * ==========================================
 * Calibration History Service
 * שומר היסטוריה של פיטינגים לקאליברטור (Platt scaling)
 * מאפשר צפייה בשיפורים לאורך זמן + ייצוא CSV
 *
 * [V158-TASK-07] — Calibration History Tab backend
 * Sacred Files: lib/fiatLedger.js, lib/auditLog.js — לא נגענו
 */

'use strict';

const crypto = require('crypto');

// ── CalibrationFitRecord ─────────────────────────────────────────────────────
class CalibrationFitRecord {
  constructor(data) {
    this.id          = data.id          || `cf_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    this.A           = typeof data.A === 'number' ? data.A : null;
    this.B           = typeof data.B === 'number' ? data.B : null;
    this.sampleCount = data.sampleCount || 0;
    this.brier       = typeof data.brier === 'number'  ? data.brier  : null; // Brier score
    this.auc         = typeof data.auc   === 'number'  ? data.auc    : null; // ROC AUC
    this.accuracy    = typeof data.accuracy === 'number' ? data.accuracy : null;
    this.trigger     = data.trigger || 'manual'; // 'auto' | 'manual' | 'startup'
    this.fittedAt    = data.fittedAt || new Date().toISOString();
    this.note        = (data.note || '').slice(0, 500);
  }

  toJSON() {
    return {
      id:          this.id,
      A:           this.A,
      B:           this.B,
      sampleCount: this.sampleCount,
      brier:       this.brier,
      auc:         this.auc,
      accuracy:    this.accuracy,
      trigger:     this.trigger,
      fittedAt:    this.fittedAt,
      note:        this.note,
    };
  }
}

// ── CalibrationHistoryService ────────────────────────────────────────────────
class CalibrationHistoryService {
  constructor({ db = null, logger = null, maxInMemory = 500 } = {}) {
    this._records   = []; // in-memory circular buffer
    this._maxMem    = maxInMemory;
    this._db        = db;
    this._log       = logger || { info: () => {}, warn: () => {} };
    this._version   = 'V158';
  }

  setDb(db) { this._db = db; }

  // ── רשום fit ────────────────────────────────────────────────────────────
  async recordFit(data) {
    const rec = new CalibrationFitRecord(data);
    this._records.unshift(rec); // newest first
    if (this._records.length > this._maxMem) this._records.pop();

    if (this._db) {
      try {
        await this._db.query(
          `INSERT INTO calibration_history
            (id, a_param, b_param, sample_count, brier_score, roc_auc, accuracy, trigger_type, fitted_at, note)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (id) DO NOTHING`,
          [
            rec.id, rec.A, rec.B, rec.sampleCount,
            rec.brier, rec.auc, rec.accuracy,
            rec.trigger, rec.fittedAt, rec.note,
          ]
        );
      } catch (dbErr) {
        this._log.warn({ err: dbErr.message }, '[calibrationHistory] DB insert failed (in-memory persisted)');
      }
    }

    this._log.info({ fitId: rec.id, samples: rec.sampleCount, trigger: rec.trigger }, '[calibrationHistory] fit recorded');
    return rec.toJSON();
  }

  // ── רשימת היסטוריה ─────────────────────────────────────────────────────
  async list({ limit = 50, cursor, trigger } = {}) {
    const max = Math.min(parseInt(limit, 10) || 50, 500);

    if (this._db) {
      try {
        const conditions = [];
        const params = [];
        let   idx = 1;
        if (trigger) { conditions.push(`trigger_type = $${idx++}`); params.push(trigger); }
        if (cursor)  { conditions.push(`id < $${idx++}`);           params.push(cursor); }
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const sql = `SELECT * FROM calibration_history ${where} ORDER BY fitted_at DESC LIMIT $${idx}`;
        params.push(max);
        const r = await this._db.query(sql, params);
        const records = r.rows.map(row => ({
          id:          row.id,
          A:           row.a_param,
          B:           row.b_param,
          sampleCount: row.sample_count,
          brier:       row.brier_score,
          auc:         row.roc_auc,
          accuracy:    row.accuracy,
          trigger:     row.trigger_type,
          fittedAt:    row.fitted_at,
          note:        row.note,
        }));
        return {
          records,
          count:      records.length,
          nextCursor: records.length === max ? records[records.length - 1].id : null,
        };
      } catch (dbErr) {
        this._log.warn({ err: dbErr.message }, '[calibrationHistory] DB list failed, fallback to memory');
      }
    }

    // In-memory fallback
    let records = [...this._records];
    if (trigger) records = records.filter(r => r.trigger === trigger);
    if (cursor) {
      const ci = records.findIndex(r => r.id === cursor);
      if (ci >= 0) records = records.slice(ci + 1);
    }
    const page = records.slice(0, max);
    return {
      records:    page.map(r => r.toJSON()),
      count:      page.length,
      nextCursor: page.length === max ? page[page.length - 1].id : null,
    };
  }

  // ── סיכום מגמות ─────────────────────────────────────────────────────────
  async trends() {
    const { records } = await this.list({ limit: 30 });
    if (records.length < 2) {
      return { trend: 'insufficient_data', records: records.slice(0, 5) };
    }
    const latest = records[0];
    const oldest = records[records.length - 1];
    const briersImproved = oldest.brier !== null && latest.brier !== null
      ? oldest.brier - latest.brier
      : null;
    const sampleGrowth = latest.sampleCount - oldest.sampleCount;
    return {
      trend:            briersImproved > 0 ? 'improving' : (briersImproved < 0 ? 'degrading' : 'stable'),
      briersImproved,
      sampleGrowth,
      fitCount:         records.length,
      latestA:          latest.A,
      latestB:          latest.B,
      latestSampleCount: latest.sampleCount,
      latestFittedAt:   latest.fittedAt,
      records:          records.slice(0, 5),
    };
  }

  // ── ייצוא CSV ────────────────────────────────────────────────────────────
  async exportCsv(limit = 500) {
    const { records } = await this.list({ limit });
    const header = 'id,A,B,sampleCount,brier,auc,accuracy,trigger,fittedAt,note';
    const rows = records.map(r =>
      [r.id, r.A, r.B, r.sampleCount, r.brier, r.auc, r.accuracy, r.trigger,
       r.fittedAt, `"${(r.note || '').replace(/"/g, '""')}"`].join(',')
    );
    return [header, ...rows].join('\n');
  }

  get length() { return this._records.length; }
}

// Singleton
const defaultCalibrationHistory = new CalibrationHistoryService({ maxInMemory: 500 });

module.exports = { CalibrationHistoryService, defaultCalibrationHistory };
