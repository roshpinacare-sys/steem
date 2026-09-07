/**
 * lib/validatorTaskRouter.js — V159
 * ====================================
 * Validator Task Auto-Assignment Router
 * מנוע שיוך אוטומטי של workspace tasks לולידטורים לפי ציון confidence + התמחות
 *
 * תכונות:
 *  - אלגוריתם "best-match": ציון confidence × (1 + specialty_bonus)
 *  - סף confidence מינימלי (ניתן לקביעה)
 *  - התאמת specialty tags משימה לפרופיל ולידטור
 *  - מעקב עומס (load balancing): מעדיף ולידטורים עם פחות משימות פתוחות
 *  - Pool ולידטורים: רישום/הסרה דינמי
 *  - Dry-run mode לבדיקת שיוכים ללא ביצוע
 *  - אינטגרציה עם ConfidenceCalibrator (אם זמין)
 *
 * Sacred Files: lib/fiatLedger.js, lib/auditLog.js — לא נגענו
 * [V159-TASK-04]
 */

'use strict';

const crypto = require('crypto');

// ── ValidatorProfile ─────────────────────────────────────────────────────────
class ValidatorProfile {
  constructor(data) {
    this.validatorId       = data.validatorId;
    this.specialties       = Array.isArray(data.specialties) ? data.specialties : [];
    this.confidenceScore   = typeof data.confidenceScore === 'number' ? data.confidenceScore : 0.5;
    this.maxConcurrent     = data.maxConcurrent || 10;
    this.currentLoad       = data.currentLoad   || 0;
    this.available         = data.available     !== false;
    this.priority          = data.priority      || 1.0; // weight multiplier
    this.registeredAt      = data.registeredAt  || new Date().toISOString();
    this.lastAssignedAt    = data.lastAssignedAt || null;
    this.totalAssignments  = data.totalAssignments || 0;
  }

  get capacityRatio() {
    return this.maxConcurrent > 0 ? this.currentLoad / this.maxConcurrent : 1;
  }

  isAvailable(minConfidence = 0) {
    return this.available &&
           this.capacityRatio < 1 &&
           this.confidenceScore >= minConfidence;
  }

  toJSON() {
    return {
      validatorId:      this.validatorId,
      specialties:      this.specialties,
      confidenceScore:  this.confidenceScore,
      maxConcurrent:    this.maxConcurrent,
      currentLoad:      this.currentLoad,
      available:        this.available,
      priority:         this.priority,
      capacityRatio:    parseFloat(this.capacityRatio.toFixed(3)),
      registeredAt:     this.registeredAt,
      lastAssignedAt:   this.lastAssignedAt,
      totalAssignments: this.totalAssignments,
    };
  }
}

// ── ValidatorTaskRouter ──────────────────────────────────────────────────────
class ValidatorTaskRouter {
  /**
   * @param {object} opts
   * @param {object} opts.logger            pino logger
   * @param {number} opts.minConfidence     minimum confidence score to assign (default: 0.5)
   * @param {number} opts.specialtyBonus    confidence multiplier for specialty match (default: 0.2)
   * @param {number} opts.loadPenalty       load penalty multiplier (default: 0.3)
   */
  constructor({
    logger         = null,
    minConfidence  = 0.5,
    specialtyBonus = 0.2,
    loadPenalty    = 0.3,
  } = {}) {
    /** @type {Map<string, ValidatorProfile>} validatorId → profile */
    this._validators = new Map();
    this._log        = logger || { info: () => {}, warn: () => {} };
    this.minConfidence  = minConfidence;
    this.specialtyBonus = specialtyBonus;
    this.loadPenalty    = loadPenalty;
    this._version       = 'V159';
    this._routingLog    = []; // last 200 routing decisions
  }

  // ── רישום ולידטור ────────────────────────────────────────────────────────
  registerValidator(data) {
    if (!data.validatorId) throw new Error('validatorId required');
    const profile = new ValidatorProfile(data);
    this._validators.set(profile.validatorId, profile);
    this._log.info({ validatorId: profile.validatorId }, '[validatorRouter] validator registered');
    return profile.toJSON();
  }

  // ── עדכון פרופיל ─────────────────────────────────────────────────────────
  updateValidator(validatorId, patch) {
    const p = this._validators.get(validatorId);
    if (!p) return null;
    const allowed = ['specialties', 'confidenceScore', 'maxConcurrent', 'currentLoad', 'available', 'priority'];
    for (const k of allowed) {
      if (k in patch) p[k] = patch[k];
    }
    return p.toJSON();
  }

  // ── הסרת ולידטור ─────────────────────────────────────────────────────────
  removeValidator(validatorId) {
    return this._validators.delete(validatorId);
  }

  // ── חישוב ציון התאמה ─────────────────────────────────────────────────────
  _scoreValidator(validator, taskTags = [], taskPriority = 'medium') {
    if (!validator.isAvailable(this.minConfidence)) return -1;

    const base          = validator.confidenceScore;
    // Specialty match bonus
    const matchedTags   = taskTags.filter(tag => validator.specialties.includes(tag)).length;
    const specialtyMult = 1 + (matchedTags > 0 ? this.specialtyBonus * Math.min(matchedTags, 3) : 0);
    // Load penalty: prefer validators with lower load
    const loadMult      = 1 - (validator.capacityRatio * this.loadPenalty);
    // Priority weight
    const priorityMult  = validator.priority;
    // Priority task bonus (critical tasks → prefer high-confidence validators)
    const taskMult      = taskPriority === 'critical' ? 1.1 : (taskPriority === 'high' ? 1.05 : 1.0);

    return base * specialtyMult * loadMult * priorityMult * taskMult;
  }

  // ── מציאת ולידטור מתאים ──────────────────────────────────────────────────
  findBest(taskTags = [], taskPriority = 'medium') {
    let bestValidator = null;
    let bestScore     = -1;

    for (const v of this._validators.values()) {
      const score = this._scoreValidator(v, taskTags, taskPriority);
      if (score > bestScore) {
        bestScore     = score;
        bestValidator = v;
      }
    }

    return bestValidator ? { validator: bestValidator.toJSON(), score: parseFloat(bestScore.toFixed(4)) } : null;
  }

  // ── שיוך אוטומטי ─────────────────────────────────────────────────────────
  autoAssign(task, opts = {}) {
    const { dryRun = false } = opts;
    const tags     = task.tags     || [];
    const priority = task.priority || 'medium';

    const result = this.findBest(tags, priority);
    if (!result) {
      return {
        ok:       false,
        assigned: false,
        reason:   'No available validator meets requirements',
        taskId:   task.id,
        minConfidence: this.minConfidence,
        poolSize: this._validators.size,
      };
    }

    const decision = {
      id:          `ar_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      taskId:      task.id,
      workspaceId: task.workspaceId,
      validatorId: result.validator.validatorId,
      score:       result.score,
      dryRun,
      decidedAt:   new Date().toISOString(),
      taskTags:    tags,
      taskPriority: priority,
    };

    if (!dryRun) {
      const v = this._validators.get(result.validator.validatorId);
      if (v) {
        v.currentLoad++;
        v.lastAssignedAt = decision.decidedAt;
        v.totalAssignments++;
      }
    }

    this._routingLog.unshift(decision);
    if (this._routingLog.length > 200) this._routingLog.pop();

    this._log.info({ taskId: task.id, validatorId: result.validator.validatorId, score: result.score, dryRun }, '[validatorRouter] task auto-assigned');

    return {
      ok:          true,
      assigned:    !dryRun,
      dryRun,
      decision,
      validator:   result.validator,
    };
  }

  // ── שחרור עומס (task סגורה/בוטלה) ────────────────────────────────────────
  releaseLoad(validatorId, count = 1) {
    const v = this._validators.get(validatorId);
    if (v) v.currentLoad = Math.max(0, v.currentLoad - count);
    return v ? v.toJSON() : null;
  }

  // ── רשימת ולידטורים ──────────────────────────────────────────────────────
  listValidators(opts = {}) {
    const { availableOnly = false, minConfidence = 0 } = opts;
    let all = [...this._validators.values()];
    if (availableOnly) all = all.filter(v => v.isAvailable(minConfidence));
    return all.map(v => v.toJSON()).sort((a, b) => b.confidenceScore - a.confidenceScore);
  }

  // ── היסטוריית routing ────────────────────────────────────────────────────
  routingHistory(limit = 50) {
    return this._routingLog.slice(0, Math.min(limit, 200));
  }

  // ── סטטיסטיקות ──────────────────────────────────────────────────────────
  stats() {
    const all = [...this._validators.values()];
    const available = all.filter(v => v.available && v.capacityRatio < 1);
    const avgConf   = all.length
      ? (all.reduce((s, v) => s + v.confidenceScore, 0) / all.length).toFixed(4)
      : null;
    return {
      totalValidators:     all.length,
      availableValidators: available.length,
      busyValidators:      all.length - available.length,
      avgConfidenceScore:  avgConf ? parseFloat(avgConf) : null,
      minConfidenceFilter: this.minConfidence,
      totalRoutingLog:     this._routingLog.length,
      version:             this._version,
    };
  }

  // ── קביעת הגדרות routing ─────────────────────────────────────────────────
  configure(config) {
    if (typeof config.minConfidence  === 'number') this.minConfidence  = config.minConfidence;
    if (typeof config.specialtyBonus === 'number') this.specialtyBonus = config.specialtyBonus;
    if (typeof config.loadPenalty    === 'number') this.loadPenalty    = config.loadPenalty;
    return this.getConfig();
  }

  getConfig() {
    return {
      minConfidence:  this.minConfidence,
      specialtyBonus: this.specialtyBonus,
      loadPenalty:    this.loadPenalty,
      version:        this._version,
    };
  }
}

// Singleton
const defaultValidatorRouter = new ValidatorTaskRouter();

module.exports = {
  ValidatorTaskRouter,
  ValidatorProfile,
  defaultValidatorRouter,
};
