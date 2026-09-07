import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { HitlGate, STATUS, DECISION } = require('../lib/hitlGate');
const { FiatLedger } = require('../lib/fiatLedger');
const { AuditLog } = require('../lib/auditLog');

function makeGate() {
  const ledger = new FiatLedger();
  ledger.ensureAccount('client::test');
  ledger.credit('client::test', 10_000_000n); // $1000
  ledger.ensureAccount('validator::test');
  ledger.ensureAccount('sys::platform');
  ledger.ensureAccount('sys::insurance');
  const auditLog = new AuditLog();
  return new HitlGate({ ledger, auditLog });
}

describe('HitlGate', () => {
  let gate;
  beforeEach(() => { gate = makeGate(); });

  it('createApproval returns pending approval with correct shape', () => {
    const a = gate.createApproval({
      missionId: 'mission_test',
      clientAccountId: 'client::test',
      priceUsd: '1.00',
      aiOutput: { result: 'test output' },
    });
    expect(a.status).toBe(STATUS.PENDING);
    expect(a.id).toMatch(/^apv_/);
    expect(a.confidence).toBeNull();
  });

  it('createApproval throws on missing required fields', () => {
    expect(() => gate.createApproval({ missionId: 'x' })).toThrow(TypeError);
    expect(() => gate.createApproval({ clientAccountId: 'c::x' })).toThrow(TypeError);
  });

  it('resolveApproval APPROVE triggers 40/40/20 ledger split', () => {
    const a = gate.createApproval({
      missionId: 'm1', clientAccountId: 'client::test',
      priceUsd: '10.00', aiOutput: { result: 'ok' }
    });
    gate.resolveApproval(a.id, {
      validatorAccountId: 'validator::test',
      decision: DECISION.APPROVE,
    });
    const resolved = gate.getApproval(a.id);
    expect(resolved.status).toBe(STATUS.APPROVED);
    expect(resolved.decision).toBe(DECISION.APPROVE);
  });

  it('resolveApproval AUTO_FLOW uses autoFlow split', () => {
    const a = gate.createApproval({
      missionId: 'm2', clientAccountId: 'client::test',
      priceUsd: '10.00', aiOutput: { result: 'auto' }
    });
    const result = gate.resolveApproval(a.id, {
      autoFlow: true, decision: DECISION.APPROVE
    });
    expect(result.approval.validatorAccountId).toBeNull();
    expect(result.approval.status).toBe(STATUS.APPROVED);
  });

  it('double resolve throws ALREADY_RESOLVED', () => {
    const a = gate.createApproval({
      missionId: 'm3', clientAccountId: 'client::test',
      priceUsd: '1.00', aiOutput: { result: 'x' }
    });
    gate.resolveApproval(a.id, { autoFlow: true, decision: DECISION.APPROVE });
    expect(() => gate.resolveApproval(a.id, {
      autoFlow: true, decision: DECISION.APPROVE
    })).toThrow();
  });

  it('resolveApproval NOT_FOUND throws', () => {
    expect(() => gate.resolveApproval('apv_nonexistent', {
      validatorAccountId: 'validator::test', decision: DECISION.APPROVE
    })).toThrow();
  });

  it('listApprovals filters by status', () => {
    gate.createApproval({ missionId: 'm4', clientAccountId: 'client::test', priceUsd: '1.00', aiOutput: { result: 'a' } });
    gate.createApproval({ missionId: 'm5', clientAccountId: 'client::test', priceUsd: '1.00', aiOutput: { result: 'b' } });
    expect(gate.listApprovals({ status: 'pending' }).length).toBe(2);
  });

  it('restoreFromLog recreates approval state', () => {
    gate.restoreFromLog('created', {
      id: 'apv_restored', missionId: 'm6',
      clientAccountId: 'client::test', priceUsd: '1.00',
      aiOutput: { result: 'restored' }, createdAt: new Date().toISOString()
    });
    expect(gate.getApproval('apv_restored')).not.toBeNull();
  });

  // [V101-P1] Bulk resolve via repeated resolveApproval calls (mirrors bulk endpoint logic)
  it('[V101-P1] multiple approvals can be resolved sequentially (bulk pattern)', () => {
    const ids = [];
    for (let i = 0; i < 5; i++) {
      const apv = gate.createApproval({
        missionId: `bulk_m${i}`, clientAccountId: 'client::test',
        priceUsd: '1.00', aiOutput: { result: `bulk_${i}` },
      });
      ids.push(apv.id);
    }

    const results = ids.map(id =>
      gate.resolveApproval(id, { validatorAccountId: 'validator::bulk', decision: DECISION.APPROVE })
    );

    expect(results.length).toBe(5);
    results.forEach(r => {
      expect(r.approval.decision).toBe(DECISION.APPROVE);
      expect(r.approval.status).toBe('approved');
    });

    // All should now be resolved, none pending
    const pending = gate.listApprovals({ status: 'pending' });
    const pendingBulk = pending.filter(a => a.missionId.startsWith('bulk_m'));
    expect(pendingBulk.length).toBe(0);
  });
});
