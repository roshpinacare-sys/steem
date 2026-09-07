'use strict';
/**
 * src/lib/executionPrograms268.js — 25 Execution Programs (V268)
 *
 * V268 additions over V266:
 *   - schedulerProvider DI: external task scheduling integration
 *   - budgetProvider DI: external budget management / accounting integration
 *   - Provider interface validation at construction time
 *   - Performance telemetry: `.getPerf268()` with mission-dispatch latencies
 *   - `checkProviderHealth268()`: probe all DI providers
 *
 * PHASE C MEGA ROADMAP: 25 programs, each containing 10–30 related tasks.
 * Zero new npm deps. Identifiers end with 268.
 */
'use strict';

const crypto = require('node:crypto');

const PROGRAMS_268 = Object.freeze([
  { id: 'P01', name: 'Credit Infrastructure Hardening',    category: 'economic'  },
  { id: 'P02', name: 'Economic Invariant Enforcement',     category: 'economic'  },
  { id: 'P03', name: 'Reputation Engine',                  category: 'social'    },
  { id: 'P04', name: 'Sybil Defense Network',              category: 'security'  },
  { id: 'P05', name: 'Agent Reflection Framework',         category: 'agent'     },
  { id: 'P06', name: 'Memory Integrity Layer',             category: 'agent'     },
  { id: 'P07', name: 'Audit Chain Expansion',              category: 'audit'     },
  { id: 'P08', name: 'Collaboration Economy',              category: 'social'    },
  { id: 'P09', name: 'Energy/Tipping Network',             category: 'social'    },
  { id: 'P10', name: 'Intelligence Routing',               category: 'agent'     },
  { id: 'P11', name: 'Mobile-First UX',                    category: 'ux'        },
  { id: 'P12', name: 'Observability Platform',             category: 'infra'     },
  { id: 'P13', name: 'x402 Payment Rails',                 category: 'payments'  },
  { id: 'P14', name: 'AP2 Mandate Chain',                  category: 'payments'  },
  { id: 'P15', name: 'MCP Deep Integration',               category: 'agent'     },
  { id: 'P16', name: 'Embedded Wallet Layer',              category: 'payments'  },
  { id: 'P17', name: 'Offline-Tolerant Queue',             category: 'ux'        },
  { id: 'P18', name: 'USSD/SMS Degraded Path',             category: 'ux'        },
  { id: 'P19', name: 'Breakage & Escheat Compliance',      category: 'economic'  },
  { id: 'P20', name: 'Quadratic & Retroactive Funding',    category: 'social'    },
  { id: 'P21', name: 'Vesting & Anti-Dump Controls',       category: 'economic'  },
  { id: 'P22', name: 'Injection & Egress Security',        category: 'security'  },
  { id: 'P23', name: 'Cost-Aware SLM Cascade',             category: 'agent'     },
  { id: 'P24', name: 'Onboarding Funnel Analytics',        category: 'ux'        },
  { id: 'P25', name: 'Credit Backing Transparency',        category: 'economic'  },
]);

const PROGRAM_STATUS_268 = Object.freeze({
  PLANNED:     'planned',
  IN_PROGRESS: 'in_progress',
  COMPLETE:    'complete',
  BLOCKED:     'blocked',
});

function _calcPercentiles268(arr) {
  if (!arr || arr.length === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  const p = (pct) => sorted[Math.min(Math.floor(n * pct / 100), n - 1)];
  return { p50: p(50), p95: p(95), p99: p(99), count: n };
}

class ExecutionProgramRegistry268 {
  constructor(opts = {}) {
    this._logger        = opts.logger        || console;
    this._auditLog      = opts.auditLog      || null;
    this._logAdapter268 = opts.logAdapter || null;
    this._agentReceipts = opts.agentReceipts || null;
    this._costRouter    = opts.costRouter    || null;
    this._memIntegrity  = opts.memIntegrity  || null;
    this._metacog       = opts.metacognition || null;

    // V268: schedulerProvider DI
    if (opts.schedulerProvider !== null && opts.schedulerProvider !== undefined) {
      if (typeof opts.schedulerProvider.schedule !== 'function') {
        throw new Error('executionPrograms268: schedulerProvider must implement schedule(missionId, task, opts)');
      }
      if (typeof opts.schedulerProvider.cancel !== 'function') {
        throw new Error('executionPrograms268: schedulerProvider must implement cancel(missionId)');
      }
    }
    this._schedulerProvider = opts.schedulerProvider || null;

    // V268: budgetProvider DI
    if (opts.budgetProvider !== null && opts.budgetProvider !== undefined) {
      if (typeof opts.budgetProvider.checkBudget !== 'function') {
        throw new Error('executionPrograms268: budgetProvider must implement checkBudget(programId, amountMicro)');
      }
      if (typeof opts.budgetProvider.debitBudget !== 'function') {
        throw new Error('executionPrograms268: budgetProvider must implement debitBudget(programId, amountMicro, meta)');
      }
    }
    this._budgetProvider = opts.budgetProvider || null;

    // Initialize program registry
    this._registry268 = new Map();
    for (const p of PROGRAMS_268) {
      this._registry268.set(p.id, {
        ...p,
        status:   PROGRAM_STATUS_268.PLANNED,
        missions: [],
        budget:   { cap: null, spent: 0n },
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        metadata: {},
      });
    }
    // V268: perf tracking
    this._perf268 = { latencies: [] };
  }

  /**
   * Start a program execution.
   */
  startProgram268(programId, opts = {}) {
    const _t0 = Date.now();
    const program = this._registry268.get(programId);
    if (!program) throw new Error(`executionPrograms268: unknown program ${programId}`);
    if (program.status === PROGRAM_STATUS_268.IN_PROGRESS)
      return { ok: false, error: 'already_in_progress' };

    program.status    = PROGRAM_STATUS_268.IN_PROGRESS;
    program.startedAt = new Date().toISOString();
    if (opts.budgetMicro) program.budget.cap = BigInt(opts.budgetMicro);
    if (opts.metadata) Object.assign(program.metadata, opts.metadata);

    // V268: use budgetProvider if available
    if (this._budgetProvider && program.budget.cap) {
      try { this._budgetProvider.checkBudget(programId, program.budget.cap); } catch (err) {
        return { ok: false, error: `budgetProvider.checkBudget failed: ${err.message}` };
      }
    }
    // Legacy: set cost router budget
    if (this._costRouter?.setProgramBudget268 && program.budget.cap) {
      this._costRouter.setProgramBudget268(programId, program.budget.cap);
    }

    this._log268('PROGRAM_START', { programId, name: program.name, budget: program.budget.cap?.toString() });
    this._recordLatency268(_t0);
    return { ok: true, programId, name: program.name, status: program.status };
  }

  /**
   * Register a mission under a program.
   */
  addMission268(programId, missionId, description = '') {
    const _t0 = Date.now();
    const program = this._registry268.get(programId);
    if (!program) throw new Error(`executionPrograms268: unknown program ${programId}`);
    program.missions.push({ missionId, description, addedAt: new Date().toISOString() });

    // V268: use schedulerProvider if available
    if (this._schedulerProvider) {
      try { this._schedulerProvider.schedule(missionId, { programId, description }, {}); } catch (_) {}
    }

    // Register in agentReceipts
    if (this._agentReceipts?.initReceipt268) {
      try { this._agentReceipts.initReceipt268(missionId, { programId, description }); } catch (_) {}
    }

    this._recordLatency268(_t0);
    return { ok: true, programId, missionId };
  }

  /**
   * Mark a program complete.
   */
  completeProgram268(programId, summary = {}) {
    const program = this._registry268.get(programId);
    if (!program) throw new Error(`executionPrograms268: unknown program ${programId}`);
    program.status      = PROGRAM_STATUS_268.COMPLETE;
    program.completedAt = new Date().toISOString();
    program.summary     = summary;

    // V268: debit budget on completion if budgetProvider present
    if (this._budgetProvider && program.budget.spent > 0n) {
      try { this._budgetProvider.debitBudget(programId, program.budget.spent, { reason: 'program_complete' }); } catch (_) {}
    }

    this._log268('PROGRAM_COMPLETE', { programId, missionCount: program.missions.length });
    return { ok: true, programId, completedAt: program.completedAt };
  }

  blockProgram268(programId, reason) {
    const program = this._registry268.get(programId);
    if (!program) throw new Error(`executionPrograms268: unknown program ${programId}`);
    program.status      = PROGRAM_STATUS_268.BLOCKED;
    program.blockReason = reason;
    // V268: cancel scheduled tasks on block
    if (this._schedulerProvider) {
      for (const m of program.missions) {
        try { this._schedulerProvider.cancel(m.missionId); } catch (_) {}
      }
    }
    return { ok: true, programId, status: 'blocked', reason };
  }

  getProgram268(programId) {
    const p = this._registry268.get(programId);
    if (!p) return null;
    return {
      ...p,
      budget: { cap: p.budget.cap?.toString() || null, spent: p.budget.spent.toString() },
    };
  }

  listPrograms268(filter = {}) {
    const results = [];
    for (const [, p] of this._registry268) {
      if (filter.category && p.category !== filter.category) continue;
      if (filter.status && p.status !== filter.status) continue;
      results.push({
        id: p.id, name: p.name, category: p.category, status: p.status,
        missionCount: p.missions.length,
        budget: { cap: p.budget.cap?.toString() || null, spent: p.budget.spent.toString() },
        startedAt: p.startedAt,
        completedAt: p.completedAt,
      });
    }
    return results;
  }

  getDashboard268() {
    const byStatus = {};
    const byCategory = {};
    for (const [, p] of this._registry268) {
      byStatus[p.status] = (byStatus[p.status] || 0) + 1;
      byCategory[p.category] = (byCategory[p.category] || 0) + 1;
    }
    return {
      version: '268',
      totalPrograms: this._registry268.size,
      byStatus,
      byCategory,
      programs: PROGRAMS_268,
    };
  }

  /** V268: Performance telemetry */
  getPerf268() { return _calcPercentiles268(this._perf268.latencies); }

  /** V268: Check all DI provider health */
  checkProviderHealth268() {
    return {
      ok: true,
      schedulerProvider: this._schedulerProvider
        ? { ok: typeof this._schedulerProvider.schedule === 'function' && typeof this._schedulerProvider.cancel === 'function', type: 'external' }
        : { ok: true, type: 'stub' },
      budgetProvider: this._budgetProvider
        ? { ok: typeof this._budgetProvider.checkBudget === 'function' && typeof this._budgetProvider.debitBudget === 'function', type: 'external' }
        : { ok: true, type: 'stub' },
      costRouter: this._costRouter ? { ok: true, type: 'external' } : { ok: true, type: 'stub' },
    };
  }

  _recordLatency268(t0) {
    const ms = Date.now() - t0;
    this._perf268.latencies.push(ms);
    if (this._perf268.latencies.length > 1000) this._perf268.latencies.shift();
  }

  _log268(event, data) {
    const entry = { event, ...data, ts: new Date().toISOString(), _v: '268' };
    if (this._auditLog?.append) { try { this._auditLog.append(entry); } catch (_) {} }
  }
}

const defaultExecutionProgramRegistry268 = new ExecutionProgramRegistry268();

module.exports = {
  ExecutionProgramRegistry268,
  defaultExecutionProgramRegistry268,
  PROGRAMS_268,
  PROGRAM_STATUS_268,
};
