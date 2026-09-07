import { describe, it, expect } from 'vitest';
import {
  LEDGER_EVENT,
  initialLedgerState,
  ledgerReducer,
  replayEvents,
  verifyReplay,
  computeStateHash,
  journalReducer,
  initialJournalState,
} from '../lib/deterministicReducers.js';

describe('initialLedgerState', () => {
  it('returns empty balances map', () => {
    const s = initialLedgerState();
    expect(s.balances.size).toBe(0);
    expect(s.eventCount).toBe(0);
  });

  it('stateHash is null hash for empty state', () => {
    const s = initialLedgerState();
    expect(s.stateHash).toBe('0'.repeat(64));
  });
});

describe('ledgerReducer — CREDIT', () => {
  it('credits an account', () => {
    const s0 = initialLedgerState();
    const s1 = ledgerReducer(s0, { type: LEDGER_EVENT.CREDIT, accountId: 'acc_1', amountMicro: 1000n });
    expect(s1.balances.get('acc_1')).toBe(1000n);
    expect(s1.eventCount).toBe(1);
  });

  it('accumulates multiple credits', () => {
    const s0 = initialLedgerState();
    const s1 = ledgerReducer(s0, { type: LEDGER_EVENT.CREDIT, accountId: 'acc_1', amountMicro: 500n });
    const s2 = ledgerReducer(s1, { type: LEDGER_EVENT.CREDIT, accountId: 'acc_1', amountMicro: 300n });
    expect(s2.balances.get('acc_1')).toBe(800n);
  });

  it('does not mutate prior state', () => {
    const s0 = initialLedgerState();
    const s1 = ledgerReducer(s0, { type: LEDGER_EVENT.CREDIT, accountId: 'acc_1', amountMicro: 100n });
    expect(s0.balances.size).toBe(0);
    expect(s1.balances.size).toBe(1);
  });

  it('rejects negative credit amount', () => {
    const s0 = initialLedgerState();
    expect(() => ledgerReducer(s0, { type: LEDGER_EVENT.CREDIT, accountId: 'acc_1', amountMicro: -1n }))
      .toThrow('non-negative');
  });
});

describe('ledgerReducer — DEBIT', () => {
  it('debits an account', () => {
    const s0 = initialLedgerState();
    const s1 = ledgerReducer(s0, { type: LEDGER_EVENT.CREDIT, accountId: 'acc_1', amountMicro: 1000n });
    const s2 = ledgerReducer(s1, { type: LEDGER_EVENT.DEBIT,  accountId: 'acc_1', amountMicro: 400n });
    expect(s2.balances.get('acc_1')).toBe(600n);
  });

  it('rejects debit that would go negative', () => {
    const s0 = initialLedgerState();
    const s1 = ledgerReducer(s0, { type: LEDGER_EVENT.CREDIT, accountId: 'acc_1', amountMicro: 100n });
    expect(() => ledgerReducer(s1, { type: LEDGER_EVENT.DEBIT, accountId: 'acc_1', amountMicro: 200n }))
      .toThrow('negative');
  });
});

describe('ledgerReducer — SPLIT / AUTO_FLOW', () => {
  it('applies splits across multiple accounts', () => {
    const s0 = initialLedgerState();
    const s1 = ledgerReducer(s0, {
      type: LEDGER_EVENT.AUTO_FLOW,
      splits: [
        { accountId: 'platform',  amountMicro: 800n },
        { accountId: 'validator', amountMicro: 0n   },
        { accountId: 'insurance', amountMicro: 200n },
      ],
    });
    expect(s1.balances.get('platform')).toBe(800n);
    expect(s1.balances.get('insurance')).toBe(200n);
  });
});

describe('replayEvents', () => {
  it('replays sequence to correct final state', () => {
    const events = [
      { type: LEDGER_EVENT.CREDIT, accountId: 'acc_1', amountMicro: 1000n },
      { type: LEDGER_EVENT.CREDIT, accountId: 'acc_2', amountMicro: 500n  },
      { type: LEDGER_EVENT.DEBIT,  accountId: 'acc_1', amountMicro: 200n  },
    ];
    const final = replayEvents(events);
    expect(final.balances.get('acc_1')).toBe(800n);
    expect(final.balances.get('acc_2')).toBe(500n);
    expect(final.eventCount).toBe(3);
  });

  it('empty events returns initial state', () => {
    const final = replayEvents([]);
    expect(final.balances.size).toBe(0);
    expect(final.eventCount).toBe(0);
  });
});

describe('verifyReplay', () => {
  it('ok:true when hash matches', () => {
    const events = [
      { type: LEDGER_EVENT.CREDIT, accountId: 'acc_1', amountMicro: 1000n },
    ];
    const final = replayEvents(events);
    const result = verifyReplay(events, final.stateHash);
    expect(result.ok).toBe(true);
  });

  it('ok:false when hash does not match', () => {
    const events = [
      { type: LEDGER_EVENT.CREDIT, accountId: 'acc_1', amountMicro: 1000n },
    ];
    const result = verifyReplay(events, '0'.repeat(64));
    expect(result.ok).toBe(false);
  });
});

describe('computeStateHash', () => {
  it('is deterministic', () => {
    const s = replayEvents([
      { type: LEDGER_EVENT.CREDIT, accountId: 'acc_1', amountMicro: 500n },
    ]);
    expect(computeStateHash(s)).toBe(computeStateHash(s));
  });

  it('differs when balances differ', () => {
    const s1 = replayEvents([{ type: LEDGER_EVENT.CREDIT, accountId: 'acc_1', amountMicro: 100n }]);
    const s2 = replayEvents([{ type: LEDGER_EVENT.CREDIT, accountId: 'acc_1', amountMicro: 200n }]);
    expect(computeStateHash(s1)).not.toBe(computeStateHash(s2));
  });
});

describe('journalReducer', () => {
  it('tracks run lifecycle', () => {
    const entries = [
      { type: 'run_start',     runId: 'run_1', ts: '2026-01-01T00:00:00Z' },
      { type: 'step_complete', runId: 'run_1', stepId: 'step_a', ts: '2026-01-01T00:00:01Z' },
      { type: 'step_fail',     runId: 'run_1', stepId: 'step_b', ts: '2026-01-01T00:00:02Z' },
      { type: 'run_complete',  runId: 'run_1', ts: '2026-01-01T00:00:03Z' },
    ];
    const final = entries.reduce(journalReducer, initialJournalState());
    expect(final.runs.get('run_1').status).toBe('COMPLETED');
    expect(final.completedSteps).toBe(1);
    expect(final.failedSteps).toBe(1);
  });
});
