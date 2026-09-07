/**
 * lib/referralEngine210.js — ECOS V210
 * Referral Network Royalties: tracks referral trees and propagates micro-royalties up the chain.
 * Research: Product-led growth (Dropbox +3900%, Airbnb double-sided) — referrals compound.
 */
'use strict';

const REFERRAL_REWARD_CREDITS_210  = 25;    // credits both parties earn on first action
const REFERRAL_ROYALTY_PCT_210     = 0.02;  // 2% of referee earnings propagate to referrer
const REFERRAL_CHAIN_DEPTH_210     = 3;     // max levels up the chain for royalty propagation
const REFERRAL_CHAIN_DECAY_210     = 0.50;  // each level up earns 50% of level below
const MAX_REFERRALS_210            = 100_000;
const REFERRAL_CODE_LENGTH_210     = 8;

class ReferralError210 extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ReferralError210';
    this.code = code || 'REFERRAL_ERROR_210';
    this.statusCode = 400;
  }
}

// _referralMap210: userId → { userId, referralCode, referredBy, referredAt, activated, activatedAt }
const _referralMap210      = new Map();
// _referralEarnings210: userId → { totalEarned, royaltiesFromNetwork, referralBonuses, history[] }
const _referralEarnings210 = new Map();

function _generateCode210(userId) {
  const base = Buffer.from(userId + Date.now().toString()).toString('base64')
    .replace(/[^A-Z0-9]/gi, '')
    .toUpperCase()
    .substring(0, REFERRAL_CODE_LENGTH_210);
  return base.padEnd(REFERRAL_CODE_LENGTH_210, 'X');
}

/**
 * registerReferral210 — register a new user with an optional referral code.
 */
function registerReferral210(params) {
  if (!params || typeof params !== 'object') throw new ReferralError210('params required');
  const { userId, referralCode } = params;

  if (!userId) throw new ReferralError210('userId required');
  if (_referralMap210.has(userId)) throw new ReferralError210(`User ${userId} already registered`, 'ALREADY_REGISTERED_210');
  if (_referralMap210.size >= MAX_REFERRALS_210) throw new ReferralError210('Referral store full');

  // Find referrer from code
  let referredBy = null;
  if (referralCode) {
    for (const [uid, r] of _referralMap210) {
      if (r.referralCode === referralCode) { referredBy = uid; break; }
    }
    if (!referredBy) throw new ReferralError210(`Referral code ${referralCode} not found`, 'CODE_NOT_FOUND_210');
    if (referredBy === userId) throw new ReferralError210('Cannot use own referral code', 'SELF_REFERRAL_210');
  }

  const myCode = _generateCode210(userId);
  const entry = {
    userId,
    referralCode: myCode,
    referredBy,
    referredAt:  new Date().toISOString(),
    activated:   false,
    activatedAt: null,
    bonusPaid:   false,
  };
  _referralMap210.set(userId, entry);
  _referralEarnings210.set(userId, { totalEarned: 0, royaltiesFromNetwork: 0, referralBonuses: 0, history: [] });

  return { ok: true, entry: { ...entry }, hasReferrer: !!referredBy };
}

/**
 * activateReferral210 — called when user completes first action; pays both-party bonus.
 */
function activateReferral210(userId) {
  if (!userId) throw new ReferralError210('userId required');
  const entry = _referralMap210.get(userId);
  if (!entry) {
    const e = new ReferralError210(`User ${userId} not found`, 'USER_NOT_FOUND_210');
    e.statusCode = 404; throw e;
  }
  if (entry.activated) throw new ReferralError210('Referral already activated', 'ALREADY_ACTIVATED_210');

  entry.activated   = true;
  entry.activatedAt = new Date().toISOString();
  entry.bonusPaid   = !!entry.referredBy;

  const rewards = [];
  if (entry.referredBy) {
    // Credit referee (this user)
    const refEarnings = _referralEarnings210.get(userId);
    if (refEarnings) {
      refEarnings.referralBonuses += REFERRAL_REWARD_CREDITS_210;
      refEarnings.totalEarned     += REFERRAL_REWARD_CREDITS_210;
      refEarnings.history.push({ type: 'referral_bonus', credits: REFERRAL_REWARD_CREDITS_210, ts: entry.activatedAt });
    }
    rewards.push({ userId, credits: REFERRAL_REWARD_CREDITS_210, type: 'referee_bonus' });

    // Credit referrer
    const referrerEarnings = _referralEarnings210.get(entry.referredBy);
    if (referrerEarnings) {
      referrerEarnings.referralBonuses += REFERRAL_REWARD_CREDITS_210;
      referrerEarnings.totalEarned     += REFERRAL_REWARD_CREDITS_210;
      referrerEarnings.history.push({ type: 'referral_bonus_from_referee', from: userId, credits: REFERRAL_REWARD_CREDITS_210, ts: entry.activatedAt });
    }
    rewards.push({ userId: entry.referredBy, credits: REFERRAL_REWARD_CREDITS_210, type: 'referrer_bonus' });
  }

  return { ok: true, activated: true, bonusPaid: entry.bonusPaid, rewards };
}

/**
 * propagateRoyalty210 — when a user earns, propagate a micro-royalty up the referral chain.
 */
function propagateRoyalty210(userId, earningCredits) {
  if (!userId) throw new ReferralError210('userId required');
  if (typeof earningCredits !== 'number' || earningCredits <= 0) throw new ReferralError210('earningCredits must be positive');

  const propagated = [];
  let currentUser = userId;
  let royaltyPool = earningCredits * REFERRAL_ROYALTY_PCT_210;

  for (let depth = 0; depth < REFERRAL_CHAIN_DEPTH_210; depth++) {
    const entry = _referralMap210.get(currentUser);
    if (!entry || !entry.referredBy) break;

    const referrerId = entry.referredBy;
    const levelRoyalty = royaltyPool * Math.pow(REFERRAL_CHAIN_DECAY_210, depth);
    if (levelRoyalty < 0.01) break; // below 1 cent, stop propagating

    const referrerEarnings = _referralEarnings210.get(referrerId);
    if (referrerEarnings) {
      referrerEarnings.royaltiesFromNetwork += levelRoyalty;
      referrerEarnings.totalEarned          += levelRoyalty;
      referrerEarnings.history.push({
        type: 'network_royalty', from: currentUser, depth: depth + 1,
        credits: +levelRoyalty.toFixed(4), ts: new Date().toISOString(),
      });
    }
    propagated.push({ referrerId, depth: depth + 1, credits: +levelRoyalty.toFixed(4) });
    currentUser = referrerId;
  }

  return { ok: true, sourceUser: userId, earningCredits, propagated, totalPropagated: propagated.length };
}

/**
 * getReferralTree210 — get the referral chain (upward ancestry) for a user.
 */
function getReferralTree210(userId) {
  if (!userId) throw new ReferralError210('userId required');
  if (!_referralMap210.has(userId)) {
    const e = new ReferralError210(`User ${userId} not found`, 'USER_NOT_FOUND_210');
    e.statusCode = 404; throw e;
  }

  const chain = [];
  let current = userId;
  for (let depth = 0; depth < REFERRAL_CHAIN_DEPTH_210 + 2; depth++) {
    const entry = _referralMap210.get(current);
    if (!entry) break;
    chain.push({ ...entry, depth });
    if (!entry.referredBy) break;
    current = entry.referredBy;
  }

  // Count direct referees
  const directReferees = [..._referralMap210.values()].filter(r => r.referredBy === userId);

  return {
    ok: true, userId,
    chain,
    directRefereeCount: directReferees.length,
    directReferees: directReferees.map(r => ({ userId: r.userId, activated: r.activated, activatedAt: r.activatedAt })),
    chainDepth: chain.length - 1,
  };
}

/**
 * getReferralEarnings210 — earnings summary for a user's referral activity.
 */
function getReferralEarnings210(userId) {
  if (!userId) throw new ReferralError210('userId required');
  const earnings = _referralEarnings210.get(userId);
  if (!earnings) {
    const e = new ReferralError210(`User ${userId} not found`, 'USER_NOT_FOUND_210');
    e.statusCode = 404; throw e;
  }
  return { ok: true, userId, ...earnings };
}

module.exports = {
  registerReferral210,
  activateReferral210,
  propagateRoyalty210,
  getReferralTree210,
  getReferralEarnings210,
  ReferralError210,
  REFERRAL_REWARD_CREDITS_210,
  REFERRAL_ROYALTY_PCT_210,
  REFERRAL_CHAIN_DEPTH_210,
  REFERRAL_CHAIN_DECAY_210,
  _referralMap210,
  _referralEarnings210,
};
