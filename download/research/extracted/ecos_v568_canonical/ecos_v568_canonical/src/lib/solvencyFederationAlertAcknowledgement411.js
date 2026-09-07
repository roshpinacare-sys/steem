'use strict';
/**
 * src/lib/solvencyFederationAlertAcknowledgement411.js — ECOS V411
 * (Phase P299) — Alert Acknowledgement Ledger.
 *
 * Lets an operator acknowledge V410 escalation records by their seq.
 * Idempotent: re-acking an already-acked seq is a no-op. Exposes the
 * outstanding (un-acked) set so a dashboard can show "needs attention"
 * without rederiving from raw escalation records every time. Optional
 * tier filter lets an operator ack only `warn`/`critical` rows.
 *
 * Pure, deterministic. No new npm deps (R3). Sacred read-only (R1).
 * Identifiers end in 411 (R2).
 *
 * @version 411.0.0
 */

const ALERT_ACKNOWLEDGEMENT_VERSION_411 = '411.0.0';

function createSolvencyFederationAlertAcknowledgement411(opts) {
  opts = opts || {};
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const maxAcks = Number.isFinite(opts.maxAcks)
    ? Math.max(16, opts.maxAcks | 0)
    : 4096;

  const acks = []; // { ackSeq, ts, escalationSeq, ackBy, note }
  const ackedSeqs = new Set();
  let nextAckSeq = 1;
  let totalAcks = 0;

  function ack411(input) {
    input = input || {};
    const escalationSeq = input.escalationSeq | 0;
    if (!Number.isFinite(input.escalationSeq) || escalationSeq <= 0) {
      throw new Error('escalationSeq (>0) required');
    }
    const ackBy = typeof input.ackBy === 'string' && input.ackBy.length > 0
      ? input.ackBy
      : 'unknown';
    const note = typeof input.note === 'string' ? input.note.slice(0, 256) : '';
    if (ackedSeqs.has(escalationSeq)) {
      return { ok: false, reason: 'already_acked_411', escalationSeq };
    }
    const rec = {
      ackSeq: nextAckSeq++,
      ts: now(),
      escalationSeq,
      ackBy,
      note,
    };
    acks.push(rec);
    while (acks.length > maxAcks) acks.shift();
    ackedSeqs.add(escalationSeq);
    totalAcks++;
    return { ok: true, ack: Object.assign({}, rec) };
  }

  function outstanding411(alertEscalation410, tier) {
    if (!alertEscalation410 || typeof alertEscalation410.list410 !== 'function') {
      throw new Error('alertEscalation410 required');
    }
    const all = alertEscalation410.list410(undefined, tier || null);
    return all.filter((r) => !ackedSeqs.has(r.seq))
      .map((r) => Object.assign({}, r));
  }

  function list411(limit) {
    const n = Number.isFinite(limit) ? Math.max(1, limit | 0) : acks.length;
    return acks.slice(-n).map((a) => Object.assign({}, a));
  }

  function isAcked411(escalationSeq) {
    return ackedSeqs.has(escalationSeq | 0);
  }

  function stats411() {
    return {
      acks: acks.length,
      nextAckSeq,
      totalAcks,
      ackedCount: ackedSeqs.size,
    };
  }

  return { ack411, outstanding411, list411, isAcked411, stats411 };
}

module.exports = {
  ALERT_ACKNOWLEDGEMENT_VERSION_411,
  createSolvencyFederationAlertAcknowledgement411,
};
