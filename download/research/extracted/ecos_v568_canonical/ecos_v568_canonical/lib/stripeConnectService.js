'use strict';
/**
 * lib/stripeConnectService.js — ECOS V146
 * ─────────────────────────────────────────────────────────────────────────────
 * [V146-STRIPE-01] Stripe Connect Express onboarding for validators.
 *
 * Allows validators to:
 *   1. Create a Stripe Express account linked to their ECOS validator ID
 *   2. Complete KYC via Stripe-hosted onboarding URL
 *   3. Receive real payouts once onboarded
 *
 * API surface:
 *   createAccount(validatorId, email, country?) → { stripeAccountId, mock }
 *   getOnboardingUrl(stripeAccountId, returnUrl, refreshUrl) → { url, expiresAt }
 *   getAccountStatus(stripeAccountId) → { payoutsEnabled, chargesEnabled, onboardingStatus }
 *   handleAccountUpdated(event, db?) → { updated, validatorId }
 *
 * Design:
 *   - Zero new npm dependencies — uses node:https + node:querystring (same as stripeProvider.js)
 *   - STRIPE_API_KEY absent → mock mode (all methods return safe stubs)
 *   - Sacred files untouched
 *   - DB optional — falls back to in-memory registry for dev/test
 *
 * [V146-STRIPE-01]
 */

const crypto  = require('node:crypto');
const https   = require('node:https');
const qs      = require('node:querystring');

// ── Stripe API helper (mirrors stripeProvider.js pattern) ─────────────────────

function stripePost(path, params, apiKey) {
  return new Promise((resolve, reject) => {
    const body = qs.stringify(params);
    const opts = {
      hostname: 'api.stripe.com',
      port:     443,
      path,
      method:   'POST',
      headers:  {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'Stripe-Version': '2024-06-20',
      },
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', d => { raw += d; });
      res.on('end', () => {
        try {
          const obj = JSON.parse(raw);
          if (res.statusCode >= 400) {
            const msg = obj?.error?.message || `HTTP ${res.statusCode}`;
            const err = new Error(`StripeConnect: ${msg}`);
            err.stripeCode = obj?.error?.code;
            err.statusCode = res.statusCode;
            reject(err);
          } else {
            resolve(obj);
          }
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function stripeGet(path, apiKey) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.stripe.com',
      port:     443,
      path,
      method:   'GET',
      headers:  {
        'Authorization': `Bearer ${apiKey}`,
        'Stripe-Version': '2024-06-20',
      },
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', d => { raw += d; });
      res.on('end', () => {
        try {
          const obj = JSON.parse(raw);
          if (res.statusCode >= 400) {
            const msg = obj?.error?.message || `HTTP ${res.statusCode}`;
            const err = new Error(`StripeConnect: ${msg}`);
            err.stripeCode = obj?.error?.code;
            err.statusCode = res.statusCode;
            reject(err);
          } else { resolve(obj); }
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ── Onboarding status normalisation ──────────────────────────────────────────

function deriveOnboardingStatus(acct) {
  if (!acct) return 'pending';
  if (acct.payouts_enabled && acct.charges_enabled) return 'onboarded';
  if (acct.requirements?.disabled_reason) return 'restricted';
  if (acct.details_submitted) return 'in_review';
  return 'pending';
}

// ── StripeConnectService ──────────────────────────────────────────────────────

class StripeConnectService {
  constructor() {
    this._apiKey = null;
    this._db     = null;
    this._logger = console;
    // In-memory store for dev/test (when no DB)
    this._accounts = new Map(); // validatorId → { stripeAccountId, onboardingStatus, payoutsEnabled, chargesEnabled }
  }

  /** Call once at startup. */
  init({ apiKey, db, logger } = {}) {
    this._apiKey  = apiKey  || process.env.STRIPE_API_KEY || null;
    this._db      = db      || null;
    this._logger  = logger  || console;
    if (this._apiKey) {
      this._logger.info && this._logger.info({ component: 'stripeConnect' }, '[V146] Stripe Connect: live mode');
    } else {
      this._logger.warn && this._logger.warn({ component: 'stripeConnect' }, '[V146] Stripe Connect: mock mode (no STRIPE_API_KEY)');
    }
  }

  get _isMock() { return !this._apiKey; }

  // ── createAccount ──────────────────────────────────────────────────────────

  /**
   * Create a Stripe Connect Express account for a validator.
   *
   * @param {string} validatorId  — 'validator::...'
   * @param {string} email        — validator's email (pre-fills Stripe form)
   * @param {string} [country]    — ISO 3166-1 alpha-2 (default: 'IL' — Israel-friendly)
   * @returns {Promise<{ stripeAccountId:string, mock:boolean }>}
   */
  async createAccount(validatorId, email, country = 'IL') {
    if (!validatorId || !email) throw new TypeError('validatorId and email are required');

    // Check if already exists
    const existing = await this._getAccountRecord(validatorId);
    if (existing) {
      return { stripeAccountId: existing.stripeAccountId, mock: this._isMock, alreadyExists: true };
    }

    if (this._isMock) {
      const mockId = `acct_mock_${crypto.randomBytes(8).toString('hex')}`;
      await this._saveAccountRecord(validatorId, {
        stripeAccountId:  mockId,
        onboardingStatus: 'pending',
        payoutsEnabled:   false,
        chargesEnabled:   false,
        country,
        email,
        mock: true,
      });
      return { stripeAccountId: mockId, mock: true };
    }

    const acct = await stripePost('/v1/accounts', {
      type:                    'express',
      email,
      country,
      'capabilities[card_payments][requested]':  'true',
      'capabilities[transfers][requested]':       'true',
      'metadata[ecos_validator_id]':              validatorId,
      'settings[payouts][schedule][interval]':    'weekly',
    }, this._apiKey);

    await this._saveAccountRecord(validatorId, {
      stripeAccountId:  acct.id,
      onboardingStatus: deriveOnboardingStatus(acct),
      payoutsEnabled:   acct.payouts_enabled  || false,
      chargesEnabled:   acct.charges_enabled  || false,
      country:          acct.country          || country,
      email,
      mock: false,
    });

    this._logger.info && this._logger.info({ component: 'stripeConnect', validatorId, stripeAccountId: acct.id }, '[V146] Stripe Connect account created');
    return { stripeAccountId: acct.id, mock: false };
  }

  // ── getOnboardingUrl ───────────────────────────────────────────────────────

  /**
   * Generate a Stripe-hosted onboarding URL (expires after ~1 use / few mins).
   *
   * @param {string} stripeAccountId  — 'acct_...'
   * @param {string} returnUrl        — Where Stripe redirects on completion
   * @param {string} refreshUrl       — Where Stripe redirects if link expires
   * @returns {Promise<{ url:string, expiresAt:number, mock:boolean }>}
   */
  async getOnboardingUrl(stripeAccountId, returnUrl, refreshUrl) {
    if (!stripeAccountId) throw new TypeError('stripeAccountId is required');

    if (this._isMock) {
      return {
        url:       `https://connect.stripe.com/mock_onboarding/${stripeAccountId}`,
        expiresAt: Math.floor(Date.now() / 1000) + 1800, // 30 min mock
        mock:      true,
      };
    }

    const link = await stripePost('/v1/account_links', {
      account:    stripeAccountId,
      type:       'account_onboarding',
      return_url: returnUrl,
      refresh_url: refreshUrl,
    }, this._apiKey);

    return { url: link.url, expiresAt: link.expires_at, mock: false };
  }

  // ── getAccountStatus ───────────────────────────────────────────────────────

  /**
   * Retrieve real-time status of a Stripe Connect account.
   *
   * @param {string} stripeAccountId
   * @returns {Promise<{ payoutsEnabled, chargesEnabled, onboardingStatus, requirements, mock }>}
   */
  async getAccountStatus(stripeAccountId) {
    if (!stripeAccountId) throw new TypeError('stripeAccountId is required');

    if (this._isMock) {
      return {
        payoutsEnabled:   false,
        chargesEnabled:   false,
        onboardingStatus: 'pending',
        requirements:     {},
        mock:             true,
      };
    }

    const acct = await stripeGet(`/v1/accounts/${encodeURIComponent(stripeAccountId)}`, this._apiKey);
    return {
      payoutsEnabled:   acct.payouts_enabled  || false,
      chargesEnabled:   acct.charges_enabled  || false,
      onboardingStatus: deriveOnboardingStatus(acct),
      requirements:     acct.requirements     || {},
      detailsSubmitted: acct.details_submitted || false,
      mock:             false,
    };
  }

  // ── getStatusByValidatorId ─────────────────────────────────────────────────

  /**
   * Get onboarding status for a validator by their ECOS validator ID.
   * Combines local DB record (fast) with optional live Stripe check.
   */
  async getStatusByValidatorId(validatorId, { liveCheck = false } = {}) {
    const record = await this._getAccountRecord(validatorId);
    if (!record) return null;

    if (liveCheck && !this._isMock) {
      try {
        const live = await this.getAccountStatus(record.stripeAccountId);
        // Update local record if status changed
        if (live.onboardingStatus !== record.onboardingStatus) {
          await this._updateAccountStatus(validatorId, live);
        }
        return { ...record, ...live };
      } catch (e) {
        this._logger.warn && this._logger.warn({ component: 'stripeConnect', err: e.message }, '[V146] Live status check failed, returning cached');
      }
    }

    return record;
  }

  // ── handleAccountUpdated ───────────────────────────────────────────────────

  /**
   * Process a Stripe `account.updated` webhook event.
   * Called from the existing Stripe webhook handler in ecos-api-server.js.
   *
   * @param {object} event — Stripe Event object (already verified)
   * @returns {{ updated:boolean, validatorId:string|null }}
   */
  async handleAccountUpdated(event) {
    const acct = event?.data?.object;
    if (!acct?.id) return { updated: false, validatorId: null };

    const stripeAccountId = acct.id;
    const validatorId     = acct.metadata?.ecos_validator_id || null;

    const newStatus = {
      onboardingStatus: deriveOnboardingStatus(acct),
      payoutsEnabled:   acct.payouts_enabled  || false,
      chargesEnabled:   acct.charges_enabled  || false,
    };

    // Update by stripeAccountId (even if we don't know validatorId — DB lookup)
    if (this._db) {
      try {
        await this._db.query(
          `UPDATE stripe_validator_accounts
             SET onboarding_status = $1,
                 payouts_enabled   = $2,
                 charges_enabled   = $3,
                 updated_at        = NOW()
           WHERE stripe_account_id = $4`,
          [newStatus.onboardingStatus, newStatus.payoutsEnabled, newStatus.chargesEnabled, stripeAccountId]
        );
      } catch (e) {
        this._logger.warn && this._logger.warn({ component: 'stripeConnect', err: e.message }, '[V146] DB update failed for account.updated');
      }
    } else if (validatorId && this._accounts.has(validatorId)) {
      const existing = this._accounts.get(validatorId);
      this._accounts.set(validatorId, { ...existing, ...newStatus });
    }

    this._logger.info && this._logger.info(
      { component: 'stripeConnect', stripeAccountId, validatorId, onboardingStatus: newStatus.onboardingStatus },
      '[V146] account.updated processed'
    );

    return { updated: true, validatorId };
  }

  // ── Internal DB helpers ────────────────────────────────────────────────────

  async _getAccountRecord(validatorId) {
    if (this._db) {
      try {
        const { rows } = await this._db.query(
          'SELECT validator_id, stripe_account_id, onboarding_status, payouts_enabled, charges_enabled, country FROM stripe_validator_accounts WHERE validator_id = $1',
          [validatorId]
        );
        if (!rows.length) return null;
        const r = rows[0];
        return {
          validatorId:      r.validator_id,
          stripeAccountId:  r.stripe_account_id,
          onboardingStatus: r.onboarding_status,
          payoutsEnabled:   r.payouts_enabled,
          chargesEnabled:   r.charges_enabled,
          country:          r.country,
        };
      } catch { return null; }
    }
    return this._accounts.get(validatorId) || null;
  }

  async _saveAccountRecord(validatorId, record) {
    if (this._db) {
      try {
        await this._db.query(
          `INSERT INTO stripe_validator_accounts
             (validator_id, stripe_account_id, onboarding_status, payouts_enabled, charges_enabled, country)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (validator_id) DO UPDATE
             SET stripe_account_id = EXCLUDED.stripe_account_id,
                 onboarding_status = EXCLUDED.onboarding_status,
                 updated_at        = NOW()`,
          [validatorId, record.stripeAccountId, record.onboardingStatus, record.payoutsEnabled, record.chargesEnabled, record.country || 'IL']
        );
      } catch (e) {
        this._logger.warn && this._logger.warn({ component: 'stripeConnect', err: e.message }, '[V146] DB save failed');
      }
    } else {
      this._accounts.set(validatorId, record);
    }
  }

  async _updateAccountStatus(validatorId, status) {
    if (this._db) {
      try {
        await this._db.query(
          `UPDATE stripe_validator_accounts
             SET onboarding_status = $1, payouts_enabled = $2, charges_enabled = $3, updated_at = NOW()
           WHERE validator_id = $4`,
          [status.onboardingStatus, status.payoutsEnabled, status.chargesEnabled, validatorId]
        );
      } catch { /* non-fatal */ }
    } else {
      const existing = this._accounts.get(validatorId) || {};
      this._accounts.set(validatorId, { ...existing, ...status });
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const defaultStripeConnectService = new StripeConnectService();

module.exports = { StripeConnectService, defaultStripeConnectService, deriveOnboardingStatus };
