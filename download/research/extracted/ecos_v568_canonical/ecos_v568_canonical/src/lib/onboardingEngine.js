'use strict';

  /**
   * OnboardingEngine — V116 P12-02
   * ─────────────────────────────────────────────────────────────────────────────
   * Displaced-worker onboarding: paid orientation tasks that take <60 seconds each.
   * V116: _progress Map is now persisted to PostgreSQL orientation_progress table.
   */

  const ORIENTATION_TASKS = [
    { id: 'orient_01', domain: 'legal',      title: 'Legal Term Basics',         question: 'What is "consideration" in contract law?', options: ['A fee paid to a lawyer','Something of value exchanged between parties','The judge's deliberation period','A written contract clause'], correctAnswer: 'Something of value exchanged between parties', maxSeconds: 30, rewardMicro: 25000 },
    { id: 'orient_02', domain: 'insurance',  title: 'Claim Assessment Basics',   question: 'Which document is most important when validating an insurance claim?', options: ['The claimant's social media posts','The original policy document','News articles about the incident','The adjuster's personal opinion'], correctAnswer: 'The original policy document', maxSeconds: 45, rewardMicro: 25000 },
    { id: 'orient_03', domain: 'compliance', title: 'AI Oversight Fundamentals', question: 'Under EU AI Act Art.14, who must be able to override a high-risk AI decision?', options: ['The AI system itself','A human operator','The software vendor','An automated monitor'], correctAnswer: 'A human operator', maxSeconds: 45, rewardMicro: 25000 },
    { id: 'orient_04', domain: 'finance',    title: 'Payment Fraud Signals',     question: 'Which is the strongest red flag in a payment transaction?', options: ['Round-number amounts','Transaction at 3 PM','Beneficiary in same city','New account sending large sum immediately'], correctAnswer: 'New account sending large sum immediately', maxSeconds: 60, rewardMicro: 25000 },
    { id: 'orient_05', domain: 'general',    title: 'Validator Ethics',          question: 'A task requester offers a bonus if you validate their claim as correct. You should:', options: ['Accept — it's extra income','Decline and flag the task for bias','Ask for a larger bonus','Validate it if it looks reasonable'], correctAnswer: 'Decline and flag the task for bias', maxSeconds: 60, rewardMicro: 25000 },
  ];

  class OnboardingEngine {
    /** @param {{ creditSystem?, auditLog?, logger?, db? }} opts */
    constructor({ creditSystem = null, auditLog = null, logger = null, db = null } = {}) {
      this._creditSystem = creditSystem;
      this._auditLog     = auditLog;
      this._log          = logger || console;
      this._db           = db;   // V116: pg Pool for persistence
      this._progress     = new Map(); // userId -> { completedTaskIds: Set, totalEarnedMicro }
    }

    // ── DB helpers (P12-02) ───────────────────────────────────────────────────

    async _loadProgress(userId) {
      if (this._db) {
        try {
          const res = await this._db.query(
            'SELECT task_id, completed_at, reward_micro FROM orientation_progress WHERE user_id = $1',
            [userId]
          );
          if (res.rows.length > 0) {
            const completedTaskIds = new Set(res.rows.map(r => r.task_id));
            const totalEarnedMicro = res.rows.reduce((s, r) => s + Number(r.reward_micro), 0);
            this._progress.set(userId, { completedTaskIds, totalEarnedMicro });
            return { completedTaskIds, totalEarnedMicro };
          }
        } catch (err) {
          this._log.warn?.({ err, userId }, '[OnboardingEngine] DB load failed, using in-memory');
        }
      }
      return this._progress.get(userId) || { completedTaskIds: new Set(), totalEarnedMicro: 0 };
    }

    async _saveTaskCompletion(userId, taskId, rewardMicro) {
      const prog = this._progress.get(userId) || { completedTaskIds: new Set(), totalEarnedMicro: 0 };
      prog.completedTaskIds.add(taskId);
      prog.totalEarnedMicro += rewardMicro;
      this._progress.set(userId, prog);

      if (this._db) {
        try {
          await this._db.query(`
            INSERT INTO orientation_progress (user_id, task_id, completed_at, reward_micro)
            VALUES ($1, $2, NOW(), $3)
            ON CONFLICT (user_id, task_id) DO NOTHING
          `, [userId, taskId, rewardMicro]);
        } catch (err) {
          this._log.warn?.({ err, userId, taskId }, '[OnboardingEngine] DB save failed');
        }
      }
    }

    // ── Public API ────────────────────────────────────────────────────────────

    listTasks() {
      return ORIENTATION_TASKS.map(({ correctAnswer: _c, ...pub }) => pub);
    }

    async getNextTask(userId) {
      const prog = await this._loadProgress(userId);
      const next = ORIENTATION_TASKS.find(t => !prog.completedTaskIds.has(t.id));
      if (!next) return { done: true, message: 'All orientation tasks completed.' };
      const { correctAnswer: _c, ...pub } = next;
      return { done: false, task: pub };
    }

    async completeTask({ userId, taskId, answer }) {
      if (!userId) throw new Error('OnboardingEngine.completeTask: userId required');
      if (!taskId) throw new Error('OnboardingEngine.completeTask: taskId required');

      const task = ORIENTATION_TASKS.find(t => t.id === taskId);
      if (!task) throw new Error(`OnboardingEngine.completeTask: unknown taskId ${taskId}`);

      const prog = await this._loadProgress(userId);
      if (prog.completedTaskIds.has(taskId)) {
        return { alreadyCompleted: true, rewardMicro: 0, correctAnswer: task.correctAnswer };
      }

      const isCorrect = String(answer || '').trim() === task.correctAnswer;
      // Credit regardless of correctness (learning model — reward participation)
      await this._saveTaskCompletion(userId, taskId, task.rewardMicro);

      if (this._creditSystem && typeof this._creditSystem.credit === 'function') {
        try { await this._creditSystem.credit(userId, task.rewardMicro, 'ORIENTATION_TASK'); } catch (_) {}
      }

      this._logAudit('ORIENTATION_TASK_COMPLETED', { userId, taskId, isCorrect, rewardMicro: task.rewardMicro });

      return {
        success: true,
        isCorrect,
        correctAnswer: task.correctAnswer,
        rewardMicro: task.rewardMicro,
        rewardUsd: (task.rewardMicro / 1_000_000).toFixed(4),
      };
    }

    async getProgress(userId) {
      const prog = await this._loadProgress(userId);
      const completed = ORIENTATION_TASKS.filter(t => prog.completedTaskIds.has(t.id));
      const total = ORIENTATION_TASKS.length;
      return {
        userId,
        completedCount: completed.length,
        totalCount: total,
        totalEarnedMicro: prog.totalEarnedMicro,
        totalEarnedUsd: (prog.totalEarnedMicro / 1_000_000).toFixed(4),
        completedTaskIds: [...prog.completedTaskIds],
        percentComplete: Math.round((completed.length / total) * 100),
        allDone: completed.length === total,
      };
    }

    _logAudit(type, data) {
      try {
        if (this._auditLog && typeof this._auditLog.append === 'function') {
          this._auditLog.append({ type, ...data, ts: new Date().toISOString() });
        }
      } catch (_) {}
    }

    static taskList() { return ORIENTATION_TASKS.map(({ correctAnswer: _c, ...pub }) => pub); }
  }

  module.exports = { OnboardingEngine, ORIENTATION_TASKS };
  