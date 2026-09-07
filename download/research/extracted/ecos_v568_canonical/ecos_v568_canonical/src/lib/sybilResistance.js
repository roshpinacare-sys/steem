'use strict';

  /**
   * SybilResistance — V116 P12-04
   * ─────────────────────────────────────────────────────────────────────────────
   * Detects and blocks Sybil attacks in validator onboarding.
   * V116: _decisions Map persisted to PostgreSQL sybil_decisions table.
   *
   * Score: 0–100. Block threshold: >= 70. Review threshold: >= 40.
   */

  const BLOCK_THRESHOLD  = 70;
  const REVIEW_THRESHOLD = 40;
  const IP_WINDOW_MS     = 10 * 60 * 1000;
  const IP_MAX_SIGNUPS   = 3;

  class SybilResistance {
    /** @param {{ auditLog?, logger?, db? }} opts */
    constructor({ auditLog = null, logger = null, db = null } = {}) {
      this._auditLog      = auditLog;
      this._log           = logger || console;
      this._db            = db;   // V116: pg Pool for persistence
      this._ipLog         = new Map();
      this._emailIndex    = new Map();
      this._fpIndex       = new Map();
      this._referralDepth = new Map();
      this._decisions     = new Map();
    }

    // ── DB helpers (P12-04) ───────────────────────────────────────────────────

    async _saveDecision(userId, verdict, score, signals) {
      this._decisions.set(userId, { verdict, score, signals, evaluatedAt: new Date().toISOString() });
      if (this._db) {
        try {
          await this._db.query(
            'INSERT INTO sybil_decisions (user_id, verdict, score, signals, evaluated_at) VALUES ($1, $2, $3, $4, NOW())',
            [userId, verdict, score, JSON.stringify(signals)]
          );
        } catch (err) {
          this._log.warn?.({ err, userId }, '[SybilResistance] DB save failed');
        }
      }
    }

    async _listFlaggedFromDB() {
      if (this._db) {
        try {
          const res = await this._db.query(
            "SELECT user_id, verdict, score, signals, evaluated_at FROM sybil_decisions WHERE verdict IN ('BLOCK','REVIEW') ORDER BY evaluated_at DESC LIMIT 200"
          );
          return res.rows.map(r => ({ userId: r.user_id, verdict: r.verdict, score: r.score, signals: r.signals, evaluatedAt: r.evaluated_at }));
        } catch (err) {
          this._log.warn?.({ err }, '[SybilResistance] DB listFlagged failed');
        }
      }
      return [...this._decisions.values()].filter(d => d.verdict !== 'ALLOW');
    }

    // ── Scoring ───────────────────────────────────────────────────────────────

    _scoreIpVelocity(ip, userId) {
      if (!ip) return 0;
      const now = Date.now();
      if (!this._ipLog.has(ip)) this._ipLog.set(ip, []);
      const log = this._ipLog.get(ip).filter(e => now - e.ts < IP_WINDOW_MS);
      log.push({ userId, ts: now });
      this._ipLog.set(ip, log);
      const count = new Set(log.map(e => e.userId)).size;
      if (count > IP_MAX_SIGNUPS * 2) return 35;
      if (count > IP_MAX_SIGNUPS) return 20;
      return 0;
    }

    _scoreEmailSimilarity(email, userId) {
      if (!email) return 0;
      const normalized = email.toLowerCase().replace(/\+[^@]*@/, '@').replace(/\.(?=[^@]*@)/g, '');
      if (!this._emailIndex.has(normalized)) this._emailIndex.set(normalized, []);
      const existing = this._emailIndex.get(normalized);
      if (existing.includes(userId)) return 0;
      existing.push(userId);
      const isAlias = /\+/.test(email) || (email.split('@')[0].match(/\d{2,}$/) !== null);
      if (existing.length > 2) return 30;
      if (existing.length > 1) return 15;
      if (isAlias) return 10;
      return 0;
    }

    _scoreDeviceFingerprint(fp, userId) {
      if (!fp) return 0;
      if (!this._fpIndex.has(fp)) this._fpIndex.set(fp, []);
      const existing = this._fpIndex.get(fp);
      if (!existing.includes(userId)) existing.push(userId);
      if (existing.length > 3) return 30;
      if (existing.length > 1) return 20;
      return 0;
    }

    _scoreSkillTest(score) {
      if (score === null || score === undefined) return 0;
      if (score >= 1.0) return 15;
      if (score >= 0.98) return 8;
      return 0;
    }

    _scoreReferralDepth(referredBy, userId) {
      if (!referredBy) return 0;
      const parentDepth = this._referralDepth.get(referredBy) || 0;
      const myDepth = parentDepth + 1;
      this._referralDepth.set(userId, myDepth);
      if (myDepth > 4) return 20;
      if (myDepth > 2) return 10;
      return 0;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    async evaluate({ userId, email, ip = null, deviceFingerprint = null, referredBy = null, skillTestScore = null }) {
      if (!userId) throw new Error('SybilResistance.evaluate: userId required');
      if (!email)  throw new Error('SybilResistance.evaluate: email required');

      const signals = [];
      let totalScore = 0;

      const ipScore = this._scoreIpVelocity(ip, userId);
      if (ipScore > 0) signals.push({ signal: 'ip_velocity', score: ipScore });
      totalScore += ipScore;

      const emailScore = this._scoreEmailSimilarity(email, userId);
      if (emailScore > 0) signals.push({ signal: 'email_similarity', score: emailScore });
      totalScore += emailScore;

      const fpScore = this._scoreDeviceFingerprint(deviceFingerprint, userId);
      if (fpScore > 0) signals.push({ signal: 'device_fingerprint', score: fpScore });
      totalScore += fpScore;

      const skillScore = this._scoreSkillTest(skillTestScore);
      if (skillScore > 0) signals.push({ signal: 'perfect_skill_test', score: skillScore });
      totalScore += skillScore;

      const refScore = this._scoreReferralDepth(referredBy, userId);
      if (refScore > 0) signals.push({ signal: 'referral_depth', score: refScore });
      totalScore += refScore;

      totalScore = Math.min(100, totalScore);
      const verdict = totalScore >= BLOCK_THRESHOLD ? 'BLOCK' : totalScore >= REVIEW_THRESHOLD ? 'REVIEW' : 'ALLOW';

      await this._saveDecision(userId, verdict, totalScore, signals);
      this._logAudit('SYBIL_EVALUATION', { userId, verdict, score: totalScore, signals });

      return { verdict, score: totalScore, signals };
    }

    async listFlagged() {
      return this._listFlaggedFromDB();
    }

    _logAudit(type, data) {
      try { if (this._auditLog?.append) this._auditLog.append({ type, ...data, ts: new Date().toISOString() }); } catch (_) {}
    }

    static blockThreshold()  { return BLOCK_THRESHOLD; }
    static reviewThreshold() { return REVIEW_THRESHOLD; }
  }

  module.exports = { SybilResistance, BLOCK_THRESHOLD, REVIEW_THRESHOLD };
  