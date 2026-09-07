/**
 * ECOS Confidence Calibrator — Platt Scaling
 * -------------------------------------------
 * הופך logprobs גולמיים מ-Ollama להסתברות מכויילת אמיתית.
 *
 * V8 — תיקונים:
 *   [FIX-3] serializeParams() + loadParams() מחוברים כעת לקריאה/כתיבה בשרת.
 *           ב-ecos-api-server.js: auto-load בהפעלה, auto-save אחרי fit().
 *           כך params שורדים restart — AUTO_FLOW יכול לעבוד לאחר calibration.
 *
 * [FIX-V10-3] fit() עכשיו מאמת שכל rawScore הוא בטווח 0..1.
 *   אם רוב הדוגמאות מחוץ לטווח (כנראה logprobs גולמיים שלא נורמלו) — זורק TypeError.
 *   אם רק חלק מחוץ לטווח — מסנן אותם ומוסיף אזהרה (במקום כישלון שקט).
 *
 * [FIX-V25-2] logger injection:
 *   setLogger(log) — injectable pino logger מ-ecos-api-server.js.
 *   console.warn הוחלף ב-this._log.warn עם structured fields.
 *   Fallback: console.warn (backward-compat לטסטים שלא מזריקים logger).
 *
 * שימוש:
 *   1. calibrator.fit(labeledData)           — חד-פעמי, 50+ דוגמאות
 *   2. calibrator.calibrate(rawScore)        — בכל inference
 *   3. calibrator.serializeParams()          — שמור ל-DB/file
 *   4. calibrator.loadParams(saved)          — טען ב-startup
 *   5. calibrator.setLogger(pinoLogger)      — [V25] inject logger מהשרת
 *
 * איסוף labeled data מ-approvalRepo (כשיש npm install pg):
 *   SELECT raw_confidence AS rawScore, (decision = 'approve')::int AS label
 *   FROM approvals
 *   WHERE raw_confidence IS NOT NULL
 *   ORDER BY created_at DESC
 *   LIMIT 500;
 */

'use strict';

class ConfidenceCalibrator {
  constructor() {
    /**
     * Platt scaling: P(correct | score) = sigmoid(A * score + B)
     * A, B מחושבים ב-fit(). לפני fit — לא מכויל.
     */
    this._A = null;
    this._B = null;
    this._fitted = false;
    this._sampleCount = 0;
    this._fittedAt = null;
    // [FIX-V25-2] injectable logger — fallback to console for tests
    this._log = {
      warn:  (obj, msg) => console.warn(msg || obj),  // eslint-disable-line no-console
      info:  (obj, msg) => console.info(msg || obj),  // eslint-disable-line no-console
    };
  }

  /**
   * [FIX-V25-2] Inject pino logger from ecos-api-server.js.
   * Call immediately after construction:
   *   calibrator.setLogger(logger.child({ component: 'calibrator' }));
   *
   * @param {{ warn: Function, info: Function }} log
   */
  setLogger(log) {
    if (log && typeof log.warn === 'function') {
      this._log = log;
    }
  }

  /**
   * האם הכיול בוצע ויש מספיק דוגמאות לסמוך עליו.
   */
  get isReady() {
    return this._fitted && this._sampleCount >= 50;
  }

  /**
   * Platt Scaling fit — לוגיסטיק regression על raw scores.
   *
   * @param {Array<{rawScore: number, label: 0|1}>} data
   *   rawScore: ערך מנורמל 0..1 (לא logprob גולמי)
   *   label: 1 = APPROVED, 0 = REJECTED/MODIFIED
   * @returns {{ A: number, B: number, sampleCount: number, message: string }}
   */
  fit(data) {
    if (!Array.isArray(data) || data.length < 10) {
      throw new Error('ConfidenceCalibrator.fit: minimum 10 samples required');
    }

    const valid = data.filter(
      d => typeof d.rawScore === 'number' &&
           Number.isFinite(d.rawScore) &&
           (d.label === 0 || d.label === 1)
    );

    if (valid.length < 10) {
      throw new Error('ConfidenceCalibrator.fit: not enough valid samples (need rawScore:number + label:0|1)');
    }

    // [FIX-V10-3] Validate rawScore range 0..1.
    // offlineInference MUST normalize logprobs before calling fit().
    // If raw logprobs (negative values) arrive here, A/B will be computed on the
    // wrong domain and calibrate() will silently return garbage probabilities.
    const outOfRange = valid.filter(d => d.rawScore < 0 || d.rawScore > 1);
    if (outOfRange.length > 0) {
      const pct = ((outOfRange.length / valid.length) * 100).toFixed(0);
      if (outOfRange.length > valid.length * 0.5) {
        // Majority out of range → almost certainly un-normalized logprobs. Hard fail.
        throw new RangeError(
          `ConfidenceCalibrator.fit: ${pct}% of rawScores are outside [0,1] ` +
          `(min=${Math.min(...outOfRange.map(d => d.rawScore)).toFixed(4)}). ` +
          'offlineInference must normalize logprobs to 0..1 before calling fit().'
        );
      }
      // Minority out of range → filter and warn.
      // [FIX-V25-2] was: console.warn(...)
      this._log.warn(
        { component: 'calibrator', outOfRange: outOfRange.length, total: valid.length, pct },
        `fit(): ${outOfRange.length} sample(s) with rawScore outside [0,1] filtered out (${pct}% of input). Check offlineInference normalization.`
      );
      const inRange = valid.filter(d => d.rawScore >= 0 && d.rawScore <= 1);
      if (inRange.length < 10) {
        throw new Error(
          `ConfidenceCalibrator.fit: after filtering out-of-range scores, only ${inRange.length} samples remain (need 10)`
        );
      }
      return this._fitValidated(inRange);
    }

    return this._fitValidated(valid);
  }

  /** Internal: run gradient descent on pre-validated data */
  _fitValidated(valid) {
    let A = 0, B = 0;
    const lr = 0.1;
    const epochs = 1000;

    for (let e = 0; e < epochs; e++) {
      let dA = 0, dB = 0;
      for (const { rawScore: x, label: y } of valid) {
        const p   = this._sigmoid(A * x + B);
        const err = p - y;
        dA += err * x;
        dB += err;
      }
      A -= (lr / valid.length) * dA;
      B -= (lr / valid.length) * dB;
    }

    this._A          = A;
    this._B          = B;
    this._fitted     = true;
    this._sampleCount = valid.length;
    this._fittedAt   = new Date().toISOString();

    return {
      A: this._A,
      B: this._B,
      sampleCount: this._sampleCount,
      fittedAt: this._fittedAt,
      message: this.isReady
        ? `Calibrator ready. A=${A.toFixed(4)}, B=${B.toFixed(4)}, n=${valid.length}`
        : `Calibrated but low sample count (${valid.length}/50) — use with caution`,
    };
  }

  /**
   * המיר raw score (0..1) לכויל.
   * אם הכיול לא בוצע — מחזיר null → HITL (invariant §2).
   *
   * @param {number|null} rawScore
   * @returns {number|null} calibrated probability 0..1, or null
   */
  calibrate(rawScore) {
    if (rawScore === null || rawScore === undefined) return null;
    if (!this._fitted) return null; // anti-scam invariant: לא מכויל → null → HITL
    const p = this._sigmoid(this._A * rawScore + this._B);
    return Math.round(p * 10000) / 10000;
  }

  /**
   * [FIX-3] שמור פרמטרים לקובץ/DB.
   * @returns {{ A: number, B: number, sampleCount: number, fittedAt: string }|null}
   */
  serializeParams() {
    if (!this._fitted) return null;
    return {
      A: this._A,
      B: this._B,
      sampleCount: this._sampleCount,
      fittedAt: this._fittedAt,
    };
  }

  /**
   * [FIX-3] טען פרמטרים שמורים.
   * @param {{ A: number, B: number, sampleCount: number, fittedAt?: string }} params
   */
  loadParams({ A, B, sampleCount, fittedAt }) {
    if (typeof A !== 'number' || typeof B !== 'number') {
      throw new TypeError('loadParams: A and B must be numbers');
    }
    this._A           = A;
    this._B           = B;
    this._sampleCount = sampleCount || 0;
    this._fitted      = true;
    this._fittedAt    = fittedAt || null;
  }

  _sigmoid(x) {
    return 1 / (1 + Math.exp(-x));
  }
}

// Singleton — ecos-api-server.js עושה loadParams() + setLogger() על זה בהפעלה
const defaultCalibrator = new ConfidenceCalibrator();

module.exports = { ConfidenceCalibrator, defaultCalibrator };
