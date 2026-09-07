'use strict';
/**
 * src/lib/proofOfSolvency403.js — ECOS V403 (Phase P291) — Proof-of-Solvency
 *
 * THE POST-FTX STANDARD the boss research named: proof of SOLVENCY = proof of
 * reserves + proof of liabilities, where liabilities are committed via a MERKLE-SUM
 * tree so every user can independently verify (a) their balance is included in the
 * published total, and (b) the sums are conserved up the tree — which prevents an
 * operator from hiding liabilities or using negative balances to fake solvency
 * (the attack that snapshot "proof of reserves" alone misses).
 *
 * Because ECOS's ledger is append-only, this can be produced CONTINUOUSLY (not just
 * a point-in-time snapshot), and the attestation is content-addressed like the V360
 * integrity proof and V372 portable proof — anyone can re-verify offline.
 *
 *   buildLiabilityTree403   — Merkle-sum tree over {userId, balanceMicro}.
 *   inclusionProof403       — a user's Merkle path (siblings with their sums).
 *   verifyInclusion403      — PURE: re-derive the root from a leaf + path, confirm
 *                             the user's balance is included and sums are conserved.
 *   assessSolvency403       — {totalLiabilities, reserve, solvent, surplus, root, hash}.
 *
 * Pure JS, Node built-in crypto (sha256) — NO new npm deps (R3/R6). Read-only over
 * the sacred ledger/reserve. Version-suffixed (…403).
 *
 * @version 403.0.0
 */

const crypto = require('crypto');

const SOLVENCY_VERSION_403 = '403.0.0';
const _sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function _big403(v) { try { return typeof v === 'bigint' ? v : BigInt(v); } catch (_) { throw new Error('balance must be integer μ¢'); } }

// Leaf and node hashing for a Merkle-SUM tree. Each node carries {hash, sum}.
function _leaf403(userId, balanceMicro) {
  const sum = _big403(balanceMicro);
  if (sum < 0n) throw new Error('negative balance not allowed in liability tree'); // anti-hiding
  return { hash: _sha('leaf|' + String(userId) + '|' + sum.toString()), sum, userId: String(userId) };
}
function _node403(left, right) {
  const sum = left.sum + right.sum;
  return { hash: _sha('node|' + left.hash + '|' + left.sum.toString() + '|' + right.hash + '|' + right.sum.toString()), sum };
}

/**
 * Build a Merkle-sum tree over user balances. Deterministic (sorts by userId).
 * @param {Array<{userId, balanceMicro}>} balances
 * @returns {{ root, totalLiabilities, leafCount, levels }}
 */
function buildLiabilityTree403(balances) {
  if (!Array.isArray(balances) || balances.length === 0) {
    const empty = { hash: _sha('empty'), sum: 0n };
    return { root: empty.hash, totalLiabilities: '0', leafCount: 0, levels: [[empty]] };
  }
  const sorted = balances.slice().sort((a, b) => String(a.userId) < String(b.userId) ? -1 : 1);
  let level = sorted.map(b => _leaf403(b.userId, b.balanceMicro));
  const levels = [level];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) next.push(_node403(level[i], level[i + 1]));
      else next.push(level[i]); // odd one promoted (carry hash+sum up unchanged)
    }
    levels.push(next); level = next;
  }
  return { root: level[0].hash, totalLiabilities: level[0].sum.toString(), leafCount: sorted.length, levels };
}

/**
 * Build an inclusion proof for a user: the sibling {hash, sum, side} at each level,
 * so the user can re-derive the root and confirm their balance is in the total.
 */
function inclusionProof403(balances, userId) {
  const sorted = balances.slice().sort((a, b) => String(a.userId) < String(b.userId) ? -1 : 1);
  let idx = sorted.findIndex(b => String(b.userId) === String(userId));
  if (idx < 0) return null;
  const { levels } = buildLiabilityTree403(balances);
  const target = sorted[idx];
  const path = [];
  for (let l = 0; l < levels.length - 1; l++) {
    const level = levels[l];
    const isRight = idx % 2 === 1;
    const sibIdx = isRight ? idx - 1 : idx + 1;
    if (sibIdx < level.length) {
      const sib = level[sibIdx];
      path.push({ hash: sib.hash, sum: sib.sum.toString(), side: isRight ? 'left' : 'right' });
    } else {
      path.push({ promoted: true }); // odd node promoted, no sibling at this level
    }
    idx = Math.floor(idx / 2);
  }
  return { userId: String(userId), balanceMicro: _big403(target.balanceMicro).toString(), path };
}

/**
 * PURE verifier: re-derive the root from the user's leaf + path, and confirm the
 * running sum includes the user's balance and is conserved at each step.
 */
function verifyInclusion403(proof, expectedRoot) {
  try {
    if (!proof || !proof.userId || proof.balanceMicro == null) return { valid: false, reason: 'malformed proof' };
    let node = _leaf403(proof.userId, proof.balanceMicro);
    for (const step of (proof.path || [])) {
      if (step.promoted) continue; // promoted odd node — hash/sum unchanged
      const sib = { hash: step.hash, sum: _big403(step.sum) };
      if (sib.sum < 0n) return { valid: false, reason: 'negative sibling sum (tampered)' };
      node = step.side === 'left' ? _node403(sib, node) : _node403(node, sib);
    }
    const valid = node.hash === expectedRoot;
    return { valid, reason: valid ? null : 'derived root does not match published root', includedBalance: proof.balanceMicro };
  } catch (e) { return { valid: false, reason: e.message }; }
}

/**
 * Full solvency assessment: liabilities (Merkle-sum root + total) vs reserve.
 * @param {{ balances:Array, reserveMicro?, reserveStatus? }} ctx
 */
function assessSolvency403(ctx = {}) {
  const balances = Array.isArray(ctx.balances) ? ctx.balances : [];
  const tree = buildLiabilityTree403(balances);
  const totalLiabilities = _big403(tree.totalLiabilities);

  // Resolve reserve in μ¢ (accept explicit reserveMicro, or {reserveBalance} status).
  let reserveMicro = null;
  if (ctx.reserveMicro != null) reserveMicro = _big403(ctx.reserveMicro);
  else if (ctx.reserveStatus && ctx.reserveStatus.reserveBalance != null) reserveMicro = _big403(ctx.reserveStatus.reserveBalance);

  const known = reserveMicro != null;
  const solvent = known ? reserveMicro >= totalLiabilities : null; // fail-closed: unknown reserve ⇒ not provably solvent
  const surplus = known ? (reserveMicro - totalLiabilities).toString() : null;

  const body = {
    version: SOLVENCY_VERSION_403,
    generatedAt: new Date().toISOString(),
    liabilityRoot: tree.root,
    totalLiabilities: totalLiabilities.toString(),
    leafCount: tree.leafCount,
    reserveMicro: known ? reserveMicro.toString() : null,
    solvent,
    surplusMicro: surplus,
    method: 'merkle-sum-liabilities + reserve-attestation',
    recipe: {
      leaf: "sha256('leaf|'+userId+'|'+balanceMicro)",
      node: "sha256('node|'+L.hash+'|'+L.sum+'|'+R.hash+'|'+R.sum); sum=L.sum+R.sum",
      verify: 're-derive root from your leaf+path; confirm root matches and sums are conserved & non-negative',
      solvency: 'reserveMicro >= totalLiabilities',
    },
  };
  body.attestationHash = _sha(JSON.stringify(body));
  return body;
}

module.exports = {
  SOLVENCY_VERSION_403,
  buildLiabilityTree403, inclusionProof403, verifyInclusion403, assessSolvency403,
  _leaf403, _node403,
};
