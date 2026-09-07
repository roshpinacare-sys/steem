/**
 * requireRank.js — ECOS V134
 * ─────────────────────────────────────────────────────────────────────────────
 * [V134-RI-04] Rank-gated API middleware.
 *
 * Usage:
 *   const gate = requireRank(rankSystem, 'CONTRIBUTOR');
 *   // in request handler:
 *   const check = gate(req, userId);
 *   if (!check.ok) return json(res, 403, { error: check.error, code: check.code });
 *
 * The userId must come from an authenticated source (JWT / API key).
 * This middleware does NOT authenticate — it only enforces rank tier.
 */

'use strict';

const TIER_ORDER = ['OBSERVER', 'MEMBER', 'CONTRIBUTOR', 'VALIDATOR', 'STEWARD', 'SOVEREIGN'];

/**
 * Returns a synchronous gate function for the given minimum tier.
 *
 * @param {import('../lib/userRankSystem').UserRankSystem} rankSystem
 * @param {string} minTier - e.g. 'CONTRIBUTOR'
 * @returns {(userId: string) => { ok: boolean, error?: string, code?: string, profile?: object }}
 */
function requireRank(rankSystem, minTier) {
  const minIdx = TIER_ORDER.indexOf(minTier);
  if (minIdx === -1) throw new Error(`requireRank: unknown tier '${minTier}'`);

  return function rankGate(userId) {
    if (!userId) {
      return { ok: false, error: 'userId is required for rank-gated endpoints', code: 'NO_USER_ID' };
    }

    const profile = rankSystem.getProfile(userId);
    const userIdx = TIER_ORDER.indexOf(profile.tier.id);

    if (userIdx < minIdx) {
      return {
        ok: false,
        error: `Rank insufficient. Required: ${minTier} (${TIER_ORDER[minIdx]}), your rank: ${profile.tier.id} (score: ${profile.score})`,
        code: 'RANK_INSUFFICIENT',
        required: minTier,
        current: profile.tier.id,
        currentScore: profile.score,
        pointsToNext: profile.progression.pointsToNext,
      };
    }

    return { ok: true, profile };
  };
}

module.exports = { requireRank, TIER_ORDER };
