'use strict';

  /**
   * GoldenTaskEngine — V116 P12-03
   * ─────────────────────────────────────────────────────────────────────────────
   * Injects "golden tasks" (known-answer quality checks) into validator queues.
   * V116: _submissions and _scores Maps persisted to PostgreSQL tables.
   */

  const ACCURACY_THRESHOLD = 0.80;
  const GOLDEN_RATIO       = 0.08;

  const GOLDEN_TASK_LIBRARY = [
    { id: 'golden_legal_001',      domain: 'legal',      question: 'A contract signed under duress is void. True or False?', options: ['True', 'False'], correctAnswer: 'True', explanation: 'Contracts formed under duress lack genuine consent and are voidable/void.', difficulty: 'beginner' },
    { id: 'golden_legal_002',      domain: 'legal',      question: 'Which element is NOT required for a valid contract?', options: ['Offer', 'Acceptance', 'Consideration', 'Notarization'], correctAnswer: 'Notarization', explanation: 'Notarization is not a universal contract requirement. Offer, acceptance, and consideration are the core elements.', difficulty: 'beginner' },
    { id: 'golden_insurance_001',  domain: 'insurance',  question: 'A claimant submits a receipt dated 3 years after the claimed incident. Is this claim likely valid?', options: ['Yes — date discrepancy is normal', 'No — statute of limitations typically bars claims older than 1-3 years', 'Insufficient information'], correctAnswer: 'No — statute of limitations typically bars claims older than 1-3 years', explanation: 'Most insurance policies have a 1-3 year statute of limitations on claims.', difficulty: 'intermediate' },
    { id: 'golden_insurance_002',  domain: 'insurance',  question: 'An insurance adjuster should approve a claim that clearly documents a covered loss with valid receipts.', options: ['True', 'False'], correctAnswer: 'True', explanation: 'A documented covered loss with valid receipts meets all claim approval criteria.', difficulty: 'beginner' },
    { id: 'golden_finance_001',    domain: 'finance',    question: 'A transaction flagged for FATF Travel Rule must include which information?', options: ['Originator and beneficiary name only', 'Originator name, account, address AND beneficiary name, account', 'Only the transaction amount', 'Only the originator details'], correctAnswer: 'Originator name, account, address AND beneficiary name, account', explanation: 'FATF R.16 Travel Rule requires full originator AND beneficiary information for transactions above threshold.', difficulty: 'intermediate' },
    { id: 'golden_ai_safety_001',  domain: 'compliance', question: 'Under EU AI Act Art.14, high-risk AI systems require:', options: ['Full automation without human review', 'Human oversight capability that can override AI decisions', 'At least 3 independent AI systems to agree', 'Public disclosure of all training data'], correctAnswer: 'Human oversight capability that can override AI decisions', explanation: 'EU AI Act Art.14 mandates effective human oversight tools for high-risk AI systems.', difficulty: 'intermediate' },
    { id: 'golden_math_001',       domain: 'general',    question: 'If a validator earns 40% of a $100 task fee, how much do they earn in cents?', options: ['$0.40', '$4.00', '$40.00', '$400.00'], correctAnswer: '$40.00', explanation: '40% of $100 = $40.00', difficulty: 'beginner' },
  
    // ─── V117 P13-08: Legal Document Review Domain Tasks ─────────────────────
    { id: 'golden_legal_003', domain: 'legal', question: 'A document with a forged signature is legally binding.', options: ['True', 'False'], correctAnswer: 'False', explanation: 'A forged signature renders a document void ab initio — it has no legal effect.', difficulty: 'beginner' },
    { id: 'golden_legal_004', domain: 'legal', question: 'Which party bears the burden of proof in a civil breach of contract claim?', options: ['The defendant', 'The claimant (plaintiff)', 'The court', 'Neither party — burden is shared equally'], correctAnswer: 'The claimant (plaintiff)', explanation: 'In civil litigation the claimant must prove their case on the balance of probabilities (>50% likelihood).', difficulty: 'intermediate' },
    { id: 'golden_legal_005', domain: 'legal', question: 'A GDPR data processing agreement must be in place when a controller uses a third-party processor.', options: ['True', 'False', 'Only for data involving EU citizens', 'Only for automated decisions'], correctAnswer: 'True', explanation: 'GDPR Art.28 requires a written contract (DPA) between a data controller and any data processor.', difficulty: 'intermediate' },
    { id: 'golden_legal_006', domain: 'legal', question: 'Under EU AI Act Art.13, providers of high-risk AI systems must ensure outputs include:', options: ['A confidence score only', 'Sufficient transparency for human oversight and a meaningful explanation', 'The full training dataset', 'A human-readable source code listing'], correctAnswer: 'Sufficient transparency for human oversight and a meaningful explanation', explanation: 'EU AI Act Art.13 mandates transparency and explainability to enable effective human oversight of high-risk AI outputs.', difficulty: 'advanced' },
    { id: 'golden_bias_001',       domain: 'general',    question: 'An AI output that systematically rates one demographic group lower without factual basis demonstrates:', options: ['Correct pattern recognition', 'Algorithmic bias requiring human correction', 'Expected variance', 'Data scarcity'], correctAnswer: 'Algorithmic bias requiring human correction', explanation: 'Systematic differential outcomes by demographic without factual basis is algorithmic bias — a HITL intervention trigger.', difficulty: 'beginner' },
  ];

  class GoldenTaskEngine {
    /** @param {{ auditLog?, validatorReputation?, logger?, db? }} opts */
    constructor({ auditLog = null, validatorReputation = null, logger = null, db = null } = {}) {
      this._auditLog   = auditLog;
      this._reputation = validatorReputation;
      this._log        = logger || console;
      this._db         = db;   // V116: pg Pool for persistence
      this._submissions = new Map();
      this._scores      = new Map();
    }

    // ── DB helpers (P12-03) ───────────────────────────────────────────────────

    async _loadScore(validatorId) {
      if (this._db) {
        try {
          const res = await this._db.query(
            'SELECT total, correct, accuracy, flagged FROM golden_task_scores WHERE validator_id = $1',
            [validatorId]
          );
          if (res.rows.length > 0) {
            const s = { total: Number(res.rows[0].total), correct: Number(res.rows[0].correct), accuracy: Number(res.rows[0].accuracy), flagged: res.rows[0].flagged };
            this._scores.set(validatorId, s);
            return s;
          }
        } catch (err) {
          this._log.warn?.({ err }, '[GoldenTaskEngine] DB load score failed');
        }
      }
      return this._scores.get(validatorId) || { total: 0, correct: 0, accuracy: 1.0, flagged: false };
    }

    async _saveScore(validatorId, score) {
      this._scores.set(validatorId, score);
      if (this._db) {
        try {
          await this._db.query(`
            INSERT INTO golden_task_scores (validator_id, total, correct, accuracy, flagged, updated_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
            ON CONFLICT (validator_id) DO UPDATE
              SET total=EXCLUDED.total, correct=EXCLUDED.correct,
                  accuracy=EXCLUDED.accuracy, flagged=EXCLUDED.flagged, updated_at=NOW()
          `, [validatorId, score.total, score.correct, score.accuracy, score.flagged]);
        } catch (err) {
          this._log.warn?.({ err }, '[GoldenTaskEngine] DB save score failed');
        }
      }
    }

    async _saveSubmission(validatorId, taskId, isCorrect, answer, expected) {
      if (this._db) {
        try {
          await this._db.query(`
            INSERT INTO golden_task_submissions (validator_id, task_id, is_correct, answer, expected, submitted_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
            ON CONFLICT (validator_id, task_id) DO UPDATE
              SET is_correct=EXCLUDED.is_correct, answer=EXCLUDED.answer, submitted_at=NOW()
          `, [validatorId, taskId, isCorrect, answer, expected]);
        } catch (err) {
          this._log.warn?.({ err }, '[GoldenTaskEngine] DB save submission failed');
        }
      }
    }

    // ── Public API ────────────────────────────────────────────────────────────

    selectGoldenTask({ domain = null, difficulty = null } = {}) {
      let pool = GOLDEN_TASK_LIBRARY;
      if (domain) pool = pool.filter(t => t.domain === domain || t.domain === 'general');
      if (difficulty) pool = pool.filter(t => t.difficulty === difficulty);
      if (pool.length === 0) pool = GOLDEN_TASK_LIBRARY;
      const task = pool[Math.floor(Math.random() * pool.length)];
      const { correctAnswer: _hidden, explanation: _exp, ...publicTask } = task;
      return { task: { ...publicTask, isGolden: true }, isGolden: true };
    }

    shouldInjectGolden(slotIndex) {
      return slotIndex % Math.round(1 / GOLDEN_RATIO) === 0;
    }

    async gradeSubmission({ validatorId, taskId, answer }) {
      if (!validatorId) throw new Error('GoldenTaskEngine.gradeSubmission: validatorId required');
      if (!taskId)      throw new Error('GoldenTaskEngine.gradeSubmission: taskId required');
      const goldenTask = GOLDEN_TASK_LIBRARY.find(t => t.id === taskId);
      if (!goldenTask)  throw new Error(`GoldenTaskEngine.gradeSubmission: unknown taskId ${taskId}`);

      const isCorrect = String(answer || '').trim() === goldenTask.correctAnswer;
      await this._saveSubmission(validatorId, taskId, isCorrect, answer, goldenTask.correctAnswer);

      const score = await this._loadScore(validatorId);
      score.total   += 1;
      score.correct += isCorrect ? 1 : 0;
      score.accuracy = score.correct / score.total;
      score.flagged  = score.total >= 3 && score.accuracy < ACCURACY_THRESHOLD;
      await this._saveScore(validatorId, score);

      this._logAudit('GOLDEN_TASK_GRADED', { validatorId, taskId, isCorrect, accuracy: score.accuracy, flagged: score.flagged });
      if (score.flagged) this._logAudit('VALIDATOR_GOLDEN_FLAGGED', { validatorId, accuracy: score.accuracy, total: score.total });

      return { isCorrect, correctAnswer: goldenTask.correctAnswer, explanation: goldenTask.explanation, accuracy: score.accuracy, total: score.total, correct: score.correct, flagged: score.flagged };
    }

    async getScore(validatorId) {
      return this._loadScore(validatorId);
    }

    async listFlagged() {
      if (this._db) {
        try {
          const res = await this._db.query('SELECT validator_id, total, correct, accuracy, flagged FROM golden_task_scores WHERE flagged = TRUE');
          return res.rows.map(r => ({ validatorId: r.validator_id, total: Number(r.total), correct: Number(r.correct), accuracy: Number(r.accuracy), flagged: r.flagged }));
        } catch (err) {
          this._log.warn?.({ err }, '[GoldenTaskEngine] DB listFlagged failed');
        }
      }
      const flagged = [];
      for (const [validatorId, score] of this._scores.entries()) {
        if (score.flagged) flagged.push({ validatorId, ...score });
      }
      return flagged;
    }

    _logAudit(type, data) {
      try { if (this._auditLog?.append) this._auditLog.append({ type, ...data, ts: new Date().toISOString() }); } catch (_) {}
    }

    static goldenRatio()       { return GOLDEN_RATIO; }
    static accuracyThreshold() { return ACCURACY_THRESHOLD; }
    static taskLibrary()       { return GOLDEN_TASK_LIBRARY.map(({ correctAnswer: _c, explanation: _e, ...pub }) => pub); }
    static taskLibraryFull()   { return GOLDEN_TASK_LIBRARY.slice(); }
  }

  module.exports = { GoldenTaskEngine, GOLDEN_TASK_LIBRARY, ACCURACY_THRESHOLD, GOLDEN_RATIO };
  