'use strict';
/**
 * ECOS Deterministic Reducers — V105 (Pre-work)
 * ──────────────────────────────────────────────────────────────────────────────
 * Pure functional reducers for ECOS state transitions.
 *
 * Design principles:
 *   - Pure functions: (state, event) → newState — no side effects, no DB calls
 *   - BigInt only: no float arithmetic in any financial path
 *   - Replay-safe: applying the same event sequence always yields the same state
 *   - Wrapper pattern: does NOT modify fiatLedger.js (Sacred File)
 *
 * Usage:
 *   const { ledgerReducer, initialLedgerState } = require('./deterministicReducers');
 *   const s0 = initialLedgerState();
 *   const s1 = ledgerReducer(s0, { type: 'CREDIT', accountId: 'acc_1', amountMicro: 1000n });
 *
 * Replay verification:
 *   const finalState = events.reduce(ledgerReducer, initialLedgerState());
 *   assert(finalState.balances['acc_1'] === currentDbBalance);
 *
 * ⚠️  This module is a VERIFICATION layer. The authoritative source of truth
 *     remains the Postgres database via fiatLedger.js. Use reducers for:
 *     - Replay verification (audit)
 *     - Offline simulation
 *     - Test harnesses
 *     - Future event-sourcing migration
 */

const crypto = require('node:crypto');

// ── Event types (mirror fiatLedger domain) ───────────────────────────────────

const LEDGER_EVENT = Object.freeze({
  CREDIT:        'CREDIT',
  DEBIT:         'DEBIT',
  SPLIT:         'SPLIT',         // 40/40/20 three-way split
  AUTO_FLOW:     'AUTO_FLOW',     // high-confidence auto settlement
  HITL_RESOLVED: 'HITL_RESOLVED', // human validator approved
  VOID:          'VOID',          // voidInterlock triggered
});

// ── Initial state ─────────────────────────────────────────────────────────────

/**
 * Returns a fresh, empty ledger state.
 * @returns {{ balances: Map<string, bigint>, eventCount: number, stateHash: string }}
 */
function initialLedgerState() {
  return {
    balances:   new Map(),   // accountId → BigInt balance in micro-units
    eventCount: 0,
    stateHash:  '0'.repeat(64),
  };
}

// ── State root hash ───────────────────────────────────────────────────────────

/**
 * Computes a deterministic hash of the ledger state.
 * Mirrors the logic in lib/stateRoot.js for cross-verification.
 * @param {object} state
 * @returns {string} 64-char SHA-256 hex
 */
function computeStateHash(state) {
  const sorted = [...state.balances.entries()]
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([id, bal]) => `${id}:${bal.toString()}`);
  return crypto.createHash('sha256')
    .update(sorted.join('\n'))
    .digest('hex');
}

// ── Core reducer ─────────────────────────────────────────────────────────────

/**
 * Pure ledger reducer.
 * @param {object} state - current ledger state (from initialLedgerState or prior reduce)
 * @param {object} event - { type, accountId?, amountMicro?, splits?, meta? }
 * @returns {object} new state (immutable — does not mutate input)
 */
function ledgerReducer(state, event) {
  if (!event || !event.type) {
    throw new TypeError('ledgerReducer: event must have a type field');
  }

  // Clone balances map (shallow — BigInt values are immutable primitives)
  const balances = new Map(state.balances);

  switch (event.type) {

    case LEDGER_EVENT.CREDIT: {
      const { accountId, amountMicro } = event;
      if (!accountId) throw new TypeError('CREDIT event requires accountId');
      const amount = BigInt(amountMicro);
      if (amount < 0n) throw new RangeError('CREDIT amount must be non-negative');
      balances.set(accountId, (balances.get(accountId) ?? 0n) + amount);
      break;
    }

    case LEDGER_EVENT.DEBIT: {
      const { accountId, amountMicro } = event;
      if (!accountId) throw new TypeError('DEBIT event requires accountId');
      const amount = BigInt(amountMicro);
      if (amount < 0n) throw new RangeError('DEBIT amount must be non-negative');
      const current = balances.get(accountId) ?? 0n;
      if (current - amount < 0n) throw new RangeError(`DEBIT would make ${accountId} negative`);
      balances.set(accountId, current - amount);
      break;
    }

    case LEDGER_EVENT.SPLIT:
    case LEDGER_EVENT.AUTO_FLOW:
    case LEDGER_EVENT.HITL_RESOLVED: {
      // splits: [{ accountId, amountMicro }, ...]
      const { splits } = event;
      if (!Array.isArray(splits) || splits.length === 0) {
        throw new TypeError('SPLIT/AUTO_FLOW/HITL_RESOLVED event requires splits array');
      }
      for (const { accountId, amountMicro } of splits) {
        const amount = BigInt(amountMicro);
        balances.set(accountId, (balances.get(accountId) ?? 0n) + amount);
      }
      break;
    }

    case LEDGER_EVENT.VOID: {
      // VOID reverses previous splits — use negative amounts in splits[]
      const { splits } = event;
      if (!Array.isArray(splits)) throw new TypeError('VOID event requires splits array');
      for (const { accountId, amountMicro } of splits) {
        const amount = BigInt(amountMicro);
        const current = balances.get(accountId) ?? 0n;
        balances.set(accountId, current - amount);
      }
      break;
    }

    default:
      // Unknown event types are ignored (forward compatibility)
      return state;
  }

  const newState = { balances, eventCount: state.eventCount + 1, stateHash: '' };
  newState.stateHash = computeStateHash(newState);
  return newState;
}

// ── Batch replay ──────────────────────────────────────────────────────────────

/**
 * Replays an array of events from initial state (or a given starting state).
 * @param {object[]} events
 * @param {object} [fromState]  - starting state; defaults to initialLedgerState()
 * @returns {object}  final state after all events applied
 */
function replayEvents(events, fromState = null) {
  const start = fromState ?? initialLedgerState();
  return events.reduce(ledgerReducer, start);
}

/**
 * Verifies that replaying a set of events from initial state produces a
 * state whose hash matches the expected hash.
 * @param {object[]} events
 * @param {string}   expectedHash - SHA-256 hex from stateRoot.calculateStateRoot()
 * @returns {{ ok: boolean, computedHash: string, expectedHash: string }}
 */
function verifyReplay(events, expectedHash) {
  const finalState = replayEvents(events);
  return {
    ok: finalState.stateHash === expectedHash,
    computedHash: finalState.stateHash,
    expectedHash,
  };
}

// ── Agent execution reducer ───────────────────────────────────────────────────

/**
 * Pure reducer for agent execution journal entries.
 * Builds a deterministic run summary from journal entries.
 * @param {object} state - { runs: Map, completedSteps: number, failedSteps: number }
 * @param {object} entry - ExecutionJournal entry
 * @returns {object} new state
 */
function journalReducer(state, entry) {
  const runs = new Map(state.runs);

  switch (entry.type) {
    case 'run_start':
      runs.set(entry.runId, { status: 'RUNNING', steps: new Map(), startedAt: entry.ts });
      break;
    case 'step_complete': {
      const run = runs.get(entry.runId);
      if (run) {
        const steps = new Map(run.steps);
        steps.set(entry.stepId, 'completed');
        runs.set(entry.runId, { ...run, steps });
      }
      break;
    }
    case 'step_fail': {
      const run = runs.get(entry.runId);
      if (run) {
        const steps = new Map(run.steps);
        steps.set(entry.stepId, 'failed');
        runs.set(entry.runId, { ...run, steps });
      }
      break;
    }
    case 'run_complete': {
      const run = runs.get(entry.runId);
      if (run) runs.set(entry.runId, { ...run, status: 'COMPLETED', completedAt: entry.ts });
      break;
    }
    case 'run_fail': {
      const run = runs.get(entry.runId);
      if (run) runs.set(entry.runId, { ...run, status: 'FAILED', failedAt: entry.ts });
      break;
    }
    default:
      return state;
  }

  let completedSteps = 0;
  let failedSteps    = 0;
  for (const run of runs.values()) {
    for (const s of run.steps.values()) {
      if (s === 'completed') completedSteps++;
      if (s === 'failed') failedSteps++;
    }
  }

  return { runs, completedSteps, failedSteps };
}

function initialJournalState() {
  return { runs: new Map(), completedSteps: 0, failedSteps: 0 };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  LEDGER_EVENT,
  initialLedgerState,
  ledgerReducer,
  replayEvents,
  verifyReplay,
  computeStateHash,
  journalReducer,
  initialJournalState,
};
