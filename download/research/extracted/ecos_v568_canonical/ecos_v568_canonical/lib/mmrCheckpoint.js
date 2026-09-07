/**
 * mmrCheckpoint.js — ECOS V124
 * ==============================
 * Signed MMR checkpoint for external audit.
 *
 * Produces a tamper-evident snapshot of the MMR root at a point in time,
 * signed with the server's HMAC key (CHECKPOINT_HMAC_KEY env var, falls
 * back to JWT_SECRET).
 *
 * Checkpoint format:
 *   {
 *     root:       <hex64 bagged MMR root>,
 *     leafCount:  <int>,
 *     timestamp:  <ISO8601>,
 *     serverId:   <agentId>,
 *     ecosVersion: 'V124',
 *     signature:  <HMAC-SHA256 hex of canonical message>
 *   }
 *
 * Canonical message = JSON.stringify({ root, leafCount, timestamp, serverId, ecosVersion })
 * (keys sorted alphabetically for determinism)
 *
 * [V124-P15-01] Initial implementation
 */

'use strict';

const crypto = require('node:crypto');

/**
 * Generate a signed checkpoint from the current MMR state.
 *
 * @param {MerkleMountainRange} mmr   — current MMR singleton
 * @param {string}              serverId — agent identity (from lib/agentIdentity.js)
 * @param {object}              opts
 * @param {string}   [opts.hmacKey]   — signing key (default: CHECKPOINT_HMAC_KEY || JWT_SECRET)
 * @param {string}   [opts.version]   — ecosystem version tag (default 'V124')
 * @returns {{ root, leafCount, timestamp, serverId, ecosVersion, signature, canonical }}
 */
function generateCheckpoint(mmr, serverId, opts = {}) {
  const hmacKey = opts.hmacKey
    || process.env.CHECKPOINT_HMAC_KEY
    || process.env.JWT_SECRET
    || 'ecos-checkpoint-dev-key';

  const ecosVersion = opts.version || 'V124';

  const root      = mmr.getRoot ? mmr.getRoot() : (mmr._root || null);
  const leafCount = mmr._size   !== undefined ? mmr._size : (mmr._leafHashes ? mmr._leafHashes.length : 0);
  const timestamp = new Date().toISOString();

  // Canonical message — alphabetically sorted keys for determinism
  const payload = { ecosVersion, leafCount, root, serverId, timestamp };
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());

  const signature = crypto
    .createHmac('sha256', hmacKey)
    .update(canonical)
    .digest('hex');

  return { root, leafCount, timestamp, serverId, ecosVersion, signature, canonical };
}

/**
 * Verify a checkpoint signature.
 *
 * @param {object} checkpoint — as returned by generateCheckpoint()
 * @param {object} opts
 * @param {string} [opts.hmacKey] — signing key
 * @returns {{ valid: boolean, reason?: string }}
 */
function verifyCheckpoint(checkpoint, opts = {}) {
  try {
    const hmacKey = opts.hmacKey
      || process.env.CHECKPOINT_HMAC_KEY
      || process.env.JWT_SECRET
      || 'ecos-checkpoint-dev-key';

    const { root, leafCount, timestamp, serverId, ecosVersion, signature, canonical } = checkpoint;
    if (!canonical || !signature) return { valid: false, reason: 'missing canonical or signature' };

    const expected = crypto
      .createHmac('sha256', hmacKey)
      .update(canonical)
      .digest('hex');

    // Constant-time compare
    if (expected.length !== signature.length) return { valid: false, reason: 'length mismatch' };
    const valid = crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signature,  'hex')
    );
    return valid ? { valid: true } : { valid: false, reason: 'signature mismatch' };
  } catch (err) {
    return { valid: false, reason: err.message };
  }
}

module.exports = { generateCheckpoint, verifyCheckpoint };
