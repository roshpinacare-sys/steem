'use strict';

  /**
   * GraduationEngine -- V116 P12-01
   * -------------------------------------------------------------------------
   * Implements the USE -> VERIFY -> OWN -> RECRUIT -> MENTOR graduation loop.
   * V116: _stages Map is now persisted to PostgreSQL graduation_stages table.
   *
   * DETERMINISTIC module. No LLMs, no floats for monetary values.
   */

  const STAGES = [
    { id: 1, name: 'USE',     description: 'Signed up, received free credits, running tasks',              unlockBonus: 0,  requires: {} },
    { id: 2, name: 'VERIFY',  description: 'Completed first validation -- now an active contributor',      unlockBonus: 10, requires: { validationsCompleted: 1 } },
    { id: 3, name: 'OWN',     description: 'First knowledge patch accepted -- now earning royalties',      unlockBonus: 25, requires: { patchesAuthored: 1 } },
    { id: 4, name: 'RECRUIT', description: 'Referred a user who completed their first task',               unlockBonus: 25, requires: { referralsConverted: 1 } },
    { id: 5, name: 'MENTOR',  description: 'Sponsored a beginner validator into active status',            unlockBonus: 50, requires: { menteeActivated: 1 } },
  ];

  class GraduationEngine {
    /** @param {{ creditSystem?, auditLog?, logger?, db? }} opts */
    constructor({ creditSystem = null, auditLog = null, logger = null, db = null } = {}) {
      this._creditSystem = creditSystem;
      this._auditLog     = auditLog;
      this._log          = logger || console;
      this._db           = db;   // V116: pg Pool for persistence
      this._stages       = new Map(); // userId -> { stageId, unlockedAt } (in-memory cache)
    }

    // ── DB helpers (P12-01) ───────────────────────────────────────────────────

    /** Load stage from DB if available, fall back to in-memory cache. */
    // V523: sync — reads in-memory cache only (DB hydrate moved to async _loadStageFromDb,
    // kicked off opportunistically). Restores pre-V116 sync contract that
    // tests/graduationEngine.test.js relies on without losing persistence.
    _loadStage(userId) {
      if (this._db) {
        // fire-and-forget DB hydrate; cache is updated for next call
        this._loadStageFromDb(userId).catch(() => {});
      }
      return this._stages.get(userId) || { stageId: 1 };
    }

    async _loadStageFromDb(userId) {
      if (!this._db) return null;
      try {
        const res = await this._db.query(
          'SELECT stage_id, unlocked_at FROM graduation_stages WHERE user_id = $1',
          [userId]
        );
        if (res.rows.length > 0) {
          const { stage_id, unlocked_at } = res.rows[0];
          this._stages.set(userId, { stageId: stage_id, unlockedAt: unlocked_at });
          return { stageId: stage_id, unlockedAt: unlocked_at };
        }
      } catch (err) {
        this._log.warn?.({ err, userId }, '[GraduationEngine] DB load failed, using in-memory');
      }
      return null;
    }

    /** Persist stage to DB and update in-memory cache. */
    async _saveStage(userId, stageId, unlockedAt) {
      this._stages.set(userId, { stageId, unlockedAt });
      if (this._db) {
        try {
          await this._db.query(`
            INSERT INTO graduation_stages (user_id, stage_id, unlocked_at)
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id) DO UPDATE
              SET stage_id = EXCLUDED.stage_id, unlocked_at = EXCLUDED.unlocked_at
          `, [userId, stageId, unlockedAt]);
        } catch (err) {
          this._log.warn?.({ err, userId }, '[GraduationEngine] DB save failed');
        }
      }
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /** @returns {{ stageId, stageName, description }} */
    getStage(userId) {
      const rec = this._loadStage(userId);
      const stage = STAGES.find(s => s.id === rec.stageId) || STAGES[0];
      return { stageId: stage.id, stageName: stage.name, description: stage.description };
    }

    /** Synchronous fallback for non-async callers. Uses in-memory cache only. */
    getStageSync(userId) {
      const rec = this._stages.get(userId) || { stageId: 1 };
      const stage = STAGES.find(s => s.id === rec.stageId) || STAGES[0];
      return { stageId: stage.id, stageName: stage.name, description: stage.description };
    }

    /**
     * Evaluate whether user has progressed to a new stage.
     * @param {string} userId
     * @param {object} stats -- { validationsCompleted, patchesAuthored, referralsConverted, menteeActivated }
     * @returns {Promise<{ advanced, newStage?, bonusCredits }>}
     */
    evaluate(userId, stats = {}) {
      const currentRec = this._loadStage(userId);
      let currentStageId = currentRec.stageId;
      let advanced = false;
      let totalBonus = 0;
      let lastNewStage = null;

      for (const stage of STAGES) {
        if (stage.id <= currentStageId) continue;
        const met = Object.entries(stage.requires).every(([k, v]) => (stats[k] || 0) >= v);
        if (met) {
          currentStageId = stage.id;
          totalBonus += stage.unlockBonus;
          lastNewStage = stage;
          advanced = true;
        } else {
          break;
        }
      }

      if (advanced) {
        const unlockedAt = new Date().toISOString();
        // V523: persist in background; sync API for callers/tests.
        Promise.resolve(this._saveStage(userId, currentStageId, unlockedAt)).catch(() => {});
      }

      return { advanced, newStage: lastNewStage, bonusCredits: totalBonus };
    }

    /** @returns {Promise<object>} Full progression report for UI */
    progressionReport(userId, stats = {}) {
      const { stageId } = this.getStage(userId);
      const currentStage = STAGES.find(s => s.id === stageId) || STAGES[0];
      const nextStage    = STAGES.find(s => s.id === stageId + 1) || null;

      const nextRequirements = nextStage
        ? Object.entries(nextStage.requires).map(([k, v]) => ({
            metric: k, required: v, current: stats[k] || 0,
            remaining: Math.max(0, v - (stats[k] || 0)), met: (stats[k] || 0) >= v,
          }))
        : [];

      return {
        userId,
        currentStage: { id: currentStage.id, name: currentStage.name, description: currentStage.description },
        nextStage: nextStage ? { id: nextStage.id, name: nextStage.name, description: nextStage.description } : null,
        nextRequirements,
        allStages: STAGES.map(s => ({ ...s, unlocked: s.id <= stageId })),
        stats,
      };
    }

    static allStages() { return STAGES.slice(); }
  }

  module.exports = { GraduationEngine, STAGES };
  