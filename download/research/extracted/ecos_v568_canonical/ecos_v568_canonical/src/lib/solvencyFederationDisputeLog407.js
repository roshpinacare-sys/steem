'use strict';
/**
 * src/lib/solvencyFederationDisputeLog407.js — ECOS V407 (Phase P295) —
 * Federation Dispute Log.
 *
 * Captures append-only dispute records for peers whose latest reported
 * liabilityRoot disagrees with the local node. Each record is content-
 * addressed and timestamped so a later auditor can reconstruct exactly
 * when and against whom a disagreement was observed.
 *
 * Pure, deterministic. No new npm deps (R3). Sacred read-only (R1).
 * Identifiers end in 407 (R2).
 *
 * @version 407.0.0
 */

const crypto = require('crypto');

const DISPUTE_LOG_VERSION_407 = '407.0.0';
const _sha407 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSolvencyFederationDisputeLog407(opts) {
  opts = opts || {};
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const maxDisputes = Number.isFinite(opts.maxDisputes) ? Math.max(64, opts.maxDisputes | 0) : 4096;

  const disputes = []; // { id, operatorId, localRoot, peerRoot, ts, hash }
  let nextId = 1;

  function recordDispute407({ operatorId, localRoot, peerRoot }) {
    if (!operatorId) throw new Error('operatorId required');
    if (!localRoot || !peerRoot) throw new Error('localRoot and peerRoot required');
    if (localRoot === peerRoot) {
      return { ok: false, code: 'NOT_A_DISPUTE_407', reason: 'roots match' };
    }
    const ts = now();
    const id = nextId++;
    const hash = _sha407('dispute407|' + id + '|' + operatorId + '|' + localRoot + '|' + peerRoot + '|' + ts);
    const rec = { id, operatorId, localRoot, peerRoot, ts, hash };
    disputes.push(rec);
    while (disputes.length > maxDisputes) disputes.shift();
    return { ok: true, dispute: Object.assign({}, rec) };
  }

  function scanSnapshot407(snapshot) {
    if (!snapshot || !snapshot.local) return { recorded: 0 };
    const localRoot = snapshot.local.liabilityRoot;
    if (!localRoot || !Array.isArray(snapshot.peers)) return { recorded: 0 };
    let recorded = 0;
    for (const p of snapshot.peers) {
      if (p && p.peerLastLiabilityRoot && p.peerLastLiabilityRoot !== localRoot) {
        const r = recordDispute407({
          operatorId: p.operatorId, localRoot, peerRoot: p.peerLastLiabilityRoot,
        });
        if (r.ok) recorded++;
      }
    }
    return { recorded };
  }

  function listDisputes407(limit) {
    const n = Number.isFinite(limit) ? Math.max(1, limit | 0) : disputes.length;
    return disputes.slice(-n).map(d => Object.assign({}, d));
  }

  function listForPeer407(operatorId, limit) {
    const filtered = disputes.filter(d => d.operatorId === operatorId);
    const n = Number.isFinite(limit) ? Math.max(1, limit | 0) : filtered.length;
    return filtered.slice(-n).map(d => Object.assign({}, d));
  }

  function stats407() {
    const perPeer = {};
    for (const d of disputes) {
      perPeer[d.operatorId] = (perPeer[d.operatorId] || 0) + 1;
    }
    return { total: disputes.length, perPeer };
  }

  return { recordDispute407, scanSnapshot407, listDisputes407, listForPeer407, stats407 };
}

module.exports = {
  DISPUTE_LOG_VERSION_407,
  createSolvencyFederationDisputeLog407,
};
