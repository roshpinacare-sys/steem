/**
 * ECOS Royalty Trigger
 * --------------------
 * מופעל אוטומטית כשמשתמשים ב-patch קיים כדי לרפא פלט AI.
 * הולידטור שיצר את ה-patch מקבל reward_per_reuse לחשבון שלו.
 *
 * זהו הלב הכלכלי של ECOS:
 *   "התיקון הוא נכס. הוא מרוויח לנצח."
 *
 * זרימה:
 *   1. semanticPatchEngine.findSemanticPatch() מוצא match
 *   2. selfRefinementAgent.healOutput() מיישם את ה-patch
 *   3. **royaltyTrigger.pay(patchId, missionId)** ← כאן
 *   4. fiatLedger מעביר reward מ-PLATFORM לולידטור
 *   5. knowledgePatchRepo מעדכן reuse_count ו-earned_micro
 *   6. auditLog מתעד
 *
 * חיבור ל-API flow:
 *   ב-ecos-api-server.js, אחרי healOutput(), הוסף:
 *     const reward = await royaltyTrigger.pay(patch.id, missionId);
 *
 * [FIX-V25-1] logger injection:
 *   constructor מקבל opts.logger — injectable pino logger.
 *   Fallback: console.warn (backward-compat לטסטים שלא מזריקים logger).
 *   ecos-api-server.js מזריק את ה-singleton logger בעת יצירת instance.
 *
 * TODO שלב 1:
 *   [x] חבר ל-ecos-api-server.js
 *   [x] וודא ש-PLATFORM account תמיד ממומן (seed_production.sql)
 *   [x] הוסף SSE event כדי שהולידטור יראה +$ בזמן אמת
 */

'use strict';

const { defaultLedger, SYSTEM_ACCOUNTS } = require('./fiatLedger');
const { defaultAuditLog }                = require('./auditLog');

class RoyaltyTrigger {
  constructor(opts = {}) {
    this.ledger   = opts.ledger   || defaultLedger;
    this.auditLog = opts.auditLog || defaultAuditLog;
    // db pool — inject בפרודקשן, null ב-tests
    this.pool     = opts.pool     || null;
    // [FIX-V25-1] injectable logger — fallback to console.warn for tests
    this._log     = opts.logger   || {
      warn:  (obj, msg) => console.warn(msg || obj),   // eslint-disable-line no-console
      info:  (obj, msg) => console.info(msg || obj),   // eslint-disable-line no-console
      error: (obj, msg) => console.error(msg || obj),  // eslint-disable-line no-console
    };
  }

  /**
   * שלם תמלוג לולידטור שיצר patch ששוכפל.
   *
   * @param {string} patchId
   * @param {string} missionId   — למטרות audit בלבד
   * @returns {Promise<{paid: boolean, rewardMicro: bigint, validatorId: string}|null>}
   */
  async pay(patchId, missionId) {
    if (!patchId) throw new TypeError('RoyaltyTrigger.pay: patchId required');

    // טען נתוני patch מ-DB (אם pool זמין)
    let patch;
    if (this.pool) {
      const { rows } = await this.pool.query(
        `SELECT id, validator_id, reward_per_reuse
         FROM knowledge_patches WHERE id = $1 AND active = true`,
         [patchId]
      );
      if (rows.length === 0) {
        // [FIX-V25-1] was: console.warn(...)
        this._log.warn({ component: 'royalty', patchId }, 'patch not found or inactive');
        return null;
      }
      patch = rows[0];
    } else {
      // ב-demo/test: mock patch
      // [FIX-V25-1] was: console.warn(...)
      this._log.warn({ component: 'royalty', patchId, missionId }, 'no DB pool — skipping royalty (demo mode)');
      return { paid: false, rewardMicro: 0n, validatorId: null };
    }

    const validatorId    = patch.validator_id;
    const rewardMicro    = BigInt(patch.reward_per_reuse || 0);

    if (rewardMicro <= 0n) {
      return { paid: false, rewardMicro: 0n, validatorId };
    }

    // העבר מ-PLATFORM → ולידטור
    this.ledger.ensureAccount(validatorId);
    this.ledger.transfer(
      SYSTEM_ACCOUNTS.PLATFORM,
      validatorId,
      rewardMicro,
      { kind: 'ROYALTY', patchId, missionId }
    );

    // עדכן reuse_count ו-earned_micro ב-DB
    await this.pool.query(
      `UPDATE knowledge_patches
       SET reuse_count = reuse_count + 1,
           earned_micro = earned_micro + $1
       WHERE id = $2`,
      [rewardMicro.toString(), patchId]
    );

    // Audit
    this.auditLog.append('ROYALTY_PAID', {
      patchId,
      missionId,
      validatorId,
      rewardMicro: rewardMicro.toString(),
    });

    return { paid: true, rewardMicro, validatorId };
  }
}

const defaultRoyaltyTrigger = new RoyaltyTrigger();

module.exports = { RoyaltyTrigger, defaultRoyaltyTrigger };
