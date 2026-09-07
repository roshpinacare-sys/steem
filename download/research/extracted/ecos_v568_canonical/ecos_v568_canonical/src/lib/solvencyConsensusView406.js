'use strict';
/**
 * src/lib/solvencyConsensusView406.js — ECOS V406 (Phase P294) —
 * Cross-Operator Consensus View.
 *
 * Combines the local V405 bulletin (latest entry) with the latest accepted
 * peer digests (V406 ingest) into a single consensus snapshot. Each peer
 * contributes its lastSeq, firstSeq, count, and digest. The local node's
 * latest bulletin entry is reported alongside. A simple agreement metric
 * counts how many peers (plus local) report a matching latest liabilityRoot,
 * which is a coarse but verifiable cross-operator solvency consensus signal.
 *
 * Pure, deterministic. No new npm deps (R3). Sacred read-only (R1).
 * Identifiers end in 406 (R2).
 *
 * @version 406.0.0
 */

const crypto = require('crypto');

const CONSENSUS_VIEW_VERSION_406 = '406.0.0';
const _sha406 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSolvencyConsensusView406(opts) {
  opts = opts || {};
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const board = opts.board;        // V405 bulletin board
  const ingest = opts.ingest;      // V406 peer digest ingest
  const registry = opts.registry;  // V406 federation registry
  if (!board || typeof board.latest405 !== 'function') throw new Error('board (V405) required');
  if (!ingest || typeof ingest.listLatest406 !== 'function') throw new Error('ingest (V406) required');
  if (!registry || typeof registry.size406 !== 'function') throw new Error('registry (V406) required');

  function snapshot406() {
    const local = board.latest405();
    const localRoot = local ? local.liabilityRoot : null;
    const peers = ingest.listLatest406();
    const peerDetails = peers.map(p => {
      // Pull the actual stored body to inspect its last entry's liabilityRoot.
      const rec = ingest.latestForPeer406(p.operatorId);
      const lastEntry = rec && rec.body && Array.isArray(rec.body.entries) && rec.body.entries.length
        ? rec.body.entries[rec.body.entries.length - 1] : null;
      return {
        operatorId: p.operatorId,
        digest: p.digest,
        receivedAt: p.receivedAt,
        lastSeq: p.lastSeq,
        count: p.count,
        peerLastLiabilityRoot: lastEntry ? lastEntry.liabilityRoot : null,
        peerLastSolvent: lastEntry ? lastEntry.solvent === true : null,
        agreesWithLocal: !!(localRoot && lastEntry && lastEntry.liabilityRoot === localRoot),
      };
    });
    const totalPeers = registry.size406();
    const peersWithDigest = peerDetails.length;
    const agreeingPeers = peerDetails.filter(p => p.agreesWithLocal).length;
    const participants = peersWithDigest + (local ? 1 : 0);
    const agreeingTotal = agreeingPeers + (local ? 1 : 0);
    const fingerprintBody = JSON.stringify({
      localRoot, peers: peerDetails.map(p => ({ id: p.operatorId, root: p.peerLastLiabilityRoot, seq: p.lastSeq })),
    });
    return {
      ecosVersion: 'V406',
      ts: now(),
      local: local ? {
        seq: local.seq, entryHash: local.entryHash, liabilityRoot: local.liabilityRoot,
        solvent: local.solvent === true, witnessed: local.witnessed === true,
      } : null,
      totalPeers,
      peersWithDigest,
      participants,
      agreeingPeers,
      agreeingTotal,
      consensusRatio: participants > 0 ? agreeingTotal / participants : 0,
      consensusFingerprint: _sha406('cons406|' + fingerprintBody),
      peers: peerDetails,
    };
  }

  function agreementForRoot406(liabilityRoot) {
    if (!liabilityRoot) return { agree: 0, considered: 0 };
    const peers = ingest.listLatest406();
    let agree = 0, considered = 0;
    for (const p of peers) {
      const rec = ingest.latestForPeer406(p.operatorId);
      const last = rec && rec.body && Array.isArray(rec.body.entries) && rec.body.entries.length
        ? rec.body.entries[rec.body.entries.length - 1] : null;
      if (!last) continue;
      considered++;
      if (last.liabilityRoot === liabilityRoot) agree++;
    }
    const local = board.latest405();
    if (local) {
      considered++;
      if (local.liabilityRoot === liabilityRoot) agree++;
    }
    return { agree, considered, ratio: considered > 0 ? agree / considered : 0 };
  }

  return { snapshot406, agreementForRoot406 };
}

module.exports = {
  CONSENSUS_VIEW_VERSION_406,
  createSolvencyConsensusView406,
};
