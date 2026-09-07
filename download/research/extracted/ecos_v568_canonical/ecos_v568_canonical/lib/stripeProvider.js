/**
 * ECOS Stripe Connect Provider — V110
 * -------------------------------------------
 * Provides a real Stripe Transfers API call when STRIPE_API_KEY is set,
 * or a mock payout when the key is absent.
 *
 * This is an external payout layer. fiatLedger remains internal accounting only.
 *
 * Real path (STRIPE_API_KEY set):
 *   POST https://api.stripe.com/v1/transfers
 *   amount      = Math.round(amountMicrocents / 10000)  // microcents → cents
 *   currency    = usd
 *   destination = validatorAccountId  (Stripe Connect account id)
 *   On success: returns { success: true, payoutId: response.id, mock: false, ... }
 *   On HTTP error: throws Error('StripeProvider: <message>')
 *
 * Mock path (no STRIPE_API_KEY):
 *   Returns { success: true, mock: true, payoutId: 'po_mock_...', ... }
 *
 * V109 additions (BUG-K partial fix):
 *   constructEvent(rawBody, sigHeader, secret) — verify Stripe webhook signature (HMAC-SHA256)
 *   handleDepositWebhook(event)                — process payment_intent.succeeded events
 *   handleWebhookRequest(rawBody, sigHeader)   — convenience wrapper for Express routes
 *
 * V110 additions (BUG-K-2 full fix):
 *   createPaymentIntent(clientAccountId, amountCents, currency) — create Stripe PaymentIntent
 *     Returns { paymentIntentId, clientSecret, amount, currency, mock }
 *     Frontend: stripe.confirmCardPayment(clientSecret)
 *     → Stripe fires payment_intent.succeeded webhook → V109 handler credits ledger
 *
 * Uses only Node.js built-ins (https, crypto modules). No new npm packages.
 */

'use strict';

const crypto = require('node:crypto');
const https  = require('node:https');
const qs     = require('node:querystring');

class StripeProvider {
  constructor() {
    this.apiKey         = process.env.STRIPE_API_KEY        || null;
    this.webhookSecret  = process.env.STRIPE_WEBHOOK_SECRET || null;

    // Warn if key is set but looks wrong
    if (this.apiKey && !this.apiKey.startsWith('sk_')) {
      console.warn(
        '[StripeProvider] WARNING: STRIPE_API_KEY is set but does not ' +
        'start with "sk_". Live payouts will likely fail. ' +
        'Expected format: sk_live_... or sk_test_...'
      );
    }
  }

  /**
   * Create an external payout to a validator's connected Stripe account.
   * @param {string} validatorAccountId   — Stripe Connect account id
   * @param {bigint|number|string} amountMicrocents
   * @returns {Promise<{success: boolean, payoutId: string, amount: string, mock: boolean, currency: string, timestamp: string}>}
   */
  async createPayout(validatorAccountId, amountMicrocents) {
    if (!validatorAccountId) {
      throw new TypeError('StripeProvider.createPayout: validatorAccountId required');
    }
    const amt = BigInt(amountMicrocents);
    if (amt <= 0n) {
      throw new RangeError('StripeProvider.createPayout: amount must be > 0');
    }

    // ── Mock path (no API key) ────────────────────────────────────────────────
    if (!this.apiKey) {
      const payoutId = 'po_mock_' + crypto.randomBytes(12).toString('hex');
      return {
        success: true,
        payoutId,
        amount: amt.toString(),
        currency: 'usd',
        mock: true,
        timestamp: new Date().toISOString(),
      };
    }

    // ── Real path — POST https://api.stripe.com/v1/transfers ─────────────────
    const amountCents = Math.round(Number(amt) / 10000); // microcents → cents
    const body = qs.stringify({
      amount:      amountCents,
      currency:    'usd',
      destination: validatorAccountId,
    });

    const response = await this._httpsPost(
      'api.stripe.com',
      '/v1/transfers',
      body,
      {
        'Authorization':  `Bearer ${this.apiKey}`,
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      }
    );

    if (!response.id) {
      const errMsg = (response.error && response.error.message) || JSON.stringify(response);
      throw new Error('StripeProvider: ' + errMsg);
    }

    return {
      success:   true,
      payoutId:  response.id,
      amount:    amt.toString(),
      currency:  'usd',
      mock:      false,
      timestamp: new Date().toISOString(),
    };
  }

  // ── [V110] PaymentIntent creation (BUG-K-2) ───────────────────────────────────

  /**
   * Create a Stripe PaymentIntent and return its client_secret to the frontend.
   *
   * Full checkout flow:
   *   1. Frontend calls POST /api/v1/payments/stripe/create-intent
   *   2. Server calls this method → returns { paymentIntentId, clientSecret }
   *   3. Frontend calls stripe.confirmCardPayment(clientSecret)
   *   4. Stripe fires payment_intent.succeeded webhook
   *   5. V109 webhook handler verifies + credits fiatLedger
   *
   * The metadata.client_account_id is embedded in the PaymentIntent so the
   * V109 webhook handler can map the payment back to an internal account.
   *
   * @param {string}        clientAccountId  — internal ECOS account to credit on success
   * @param {number}        amountCents      — amount in Stripe cents (integer)
   * @param {string}        [currency='usd']
   * @returns {Promise<{
   *   success: boolean,
   *   paymentIntentId: string,
   *   clientSecret: string|null,
   *   amount: number,
   *   currency: string,
   *   mock: boolean,
   *   timestamp: string
   * }>}
   */
  async createPaymentIntent(clientAccountId, amountCents, currency = 'usd') {
    if (!clientAccountId) {
      throw new TypeError('StripeProvider.createPaymentIntent: clientAccountId required');
    }
    const cents = Math.round(Number(amountCents));
    if (!Number.isFinite(cents) || cents <= 0) {
      throw new RangeError('StripeProvider.createPaymentIntent: amountCents must be a positive integer');
    }

    // ── Mock path (no API key) ────────────────────────────────────────────────
    if (!this.apiKey) {
      const mockId = 'pi_mock_' + crypto.randomBytes(12).toString('hex');
      return {
        success:         true,
        paymentIntentId: mockId,
        clientSecret:    mockId + '_secret_mock',
        amount:          cents,
        currency:        currency || 'usd',
        mock:            true,
        timestamp:       new Date().toISOString(),
      };
    }

    // ── Real path — POST https://api.stripe.com/v1/payment_intents ──────────
    const body = qs.stringify({
      amount:                          cents,
      currency:                        currency || 'usd',
      'metadata[client_account_id]':   clientAccountId,
      // automatic_payment_methods enables the Payment Element without listing
      // individual methods — simplest integration path
      'automatic_payment_methods[enabled]': 'true',
    });

    const response = await this._httpsPost(
      'api.stripe.com',
      '/v1/payment_intents',
      body,
      {
        'Authorization':  `Bearer ${this.apiKey}`,
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      }
    );

    if (!response.id) {
      const errMsg = (response.error && response.error.message) || JSON.stringify(response);
      throw new Error('StripeProvider: ' + errMsg);
    }

    return {
      success:         true,
      paymentIntentId: response.id,
      clientSecret:    response.client_secret || null,
      amount:          response.amount ?? cents,
      currency:        response.currency || currency,
      mock:            false,
      timestamp:       new Date().toISOString(),
    };
  }

  // ── [V109] Webhook handling ───────────────────────────────────────────────────

  /**
   * Verify and parse a Stripe webhook event.
   *
   * Implements the Stripe signature verification protocol:
   *   1. Parse t= and v1= values from the Stripe-Signature header.
   *   2. Build the signed payload: "<t>.<rawBody>"
   *   3. Compute HMAC-SHA256 over signed payload with STRIPE_WEBHOOK_SECRET.
   *   4. Constant-time compare against each v1 signature in the header.
   *   5. Reject if timestamp is >300s stale (replay-attack prevention).
   *
   * @param {Buffer|string} rawBody    — raw request body (before JSON.parse)
   * @param {string}        sigHeader  — Stripe-Signature header value
   * @param {string}        [secret]   — webhook signing secret (overrides env var)
   * @returns {{ ok: boolean, event?: object, error?: string }}
   */
  constructEvent(rawBody, sigHeader, secret) {
    const signingSecret = secret || this.webhookSecret;
    if (!signingSecret) {
      return { ok: false, error: 'STRIPE_WEBHOOK_SECRET not set — cannot verify webhook' };
    }
    if (!rawBody) {
      return { ok: false, error: 'rawBody required for webhook signature verification' };
    }
    if (!sigHeader) {
      return { ok: false, error: 'Stripe-Signature header missing' };
    }

    // Parse t= and v1= from header
    const parts = sigHeader.split(',');
    let timestamp = null;
    const signatures = [];
    for (const part of parts) {
      const [k, v] = part.trim().split('=');
      if (k === 't')  timestamp = v;
      if (k === 'v1') signatures.push(v);
    }

    if (!timestamp || signatures.length === 0) {
      return { ok: false, error: 'Malformed Stripe-Signature header' };
    }

    // Replay-attack guard: reject if >300s old
    const ts = parseInt(timestamp, 10);
    const age = Math.abs(Math.floor(Date.now() / 1000) - ts);
    if (age > 300) {
      return { ok: false, error: `Webhook timestamp too old (${age}s > 300s)` };
    }

    // Compute expected signature
    const rawBodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
    const signedPayload = `${timestamp}.${rawBodyStr}`;
    const expectedSig  = crypto
      .createHmac('sha256', signingSecret)
      .update(signedPayload, 'utf8')
      .digest('hex');

    // Constant-time comparison against each v1 signature
    const expectedBuf = Buffer.from(expectedSig, 'hex');
    let verified = false;
    for (const sig of signatures) {
      try {
        const sigBuf = Buffer.from(sig, 'hex');
        if (sigBuf.length === expectedBuf.length &&
            crypto.timingSafeEqual(expectedBuf, sigBuf)) {
          verified = true;
          break;
        }
      } catch { /* length mismatch — skip */ }
    }

    if (!verified) {
      return { ok: false, error: 'Stripe webhook signature verification failed' };
    }

    // Parse the event body
    let event;
    try {
      event = JSON.parse(rawBodyStr);
    } catch {
      return { ok: false, error: 'Webhook body is not valid JSON' };
    }

    return { ok: true, event };
  }

  /**
   * Process a verified Stripe webhook event.
   * Handles payment_intent.succeeded → deposit credit mapping.
   *
   * Returns a structured action descriptor for the caller to apply to fiatLedger.
   * Does NOT touch fiatLedger directly (that would couple this module to sacred files).
   *
   * @param {object} event  — verified Stripe event object
   * @returns {{
   *   handled: boolean,
   *   action?: 'deposit'|'payment_failed'|'refund',
   *   accountId?: string,
   *   amountMicrocents?: bigint,
   *   currency?: string,
   *   stripeEventId?: string,
   *   paymentIntentId?: string,
   *   reason?: string
   * }}
   */
  handleDepositWebhook(event) {
    if (!event || !event.type) {
      return { handled: false, reason: 'Event missing type' };
    }

    switch (event.type) {
      case 'payment_intent.succeeded': {
        const pi = event.data && event.data.object;
        if (!pi) return { handled: false, reason: 'payment_intent data missing' };

        const amountCents       = pi.amount_received ?? pi.amount ?? 0;
        const currency          = pi.currency || 'usd';
        const clientAccountId   = (pi.metadata && pi.metadata.client_account_id) || null;
        const amountMicrocents  = BigInt(Math.round(amountCents * 10000)); // cents → microcents

        if (!clientAccountId) {
          return {
            handled: false,
            reason:  'payment_intent.succeeded: metadata.client_account_id missing — cannot credit ledger',
            stripeEventId:   event.id,
            paymentIntentId: pi.id,
          };
        }

        return {
          handled:         true,
          action:          'deposit',
          accountId:       clientAccountId,
          amountMicrocents,
          currency,
          stripeEventId:   event.id,
          paymentIntentId: pi.id,
        };
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data && event.data.object;
        return {
          handled:  true,
          action:   'payment_failed',
          reason:   pi?.last_payment_error?.message || 'Payment failed',
          stripeEventId: event.id,
        };
      }

      case 'charge.refunded': {
        const charge = event.data && event.data.object;
        // [V110-P8-05] Provide clientAccountId for debit routing
        const clientAccountId = (charge && charge.metadata && charge.metadata.client_account_id) || null;
        return {
          handled:          true,
          action:           'refund',
          amountRefunded:   charge ? BigInt(Math.round((charge.amount_refunded || 0) * 10000)) : 0n,
          accountId:        clientAccountId,
          stripeEventId:    event.id,
        };
      }

      default:
        return { handled: false, reason: `Unhandled event type: ${event.type}` };
    }
  }

  /**
   * Convenience wrapper for Express route handlers.
   * Verifies the webhook, parses the event, and calls handleDepositWebhook().
   *
   * @param {Buffer|string} rawBody
   * @param {string}        sigHeader
   * @param {string}        [secret]
   * @returns {{ ok: boolean, action?: object, error?: string }}
   */
  handleWebhookRequest(rawBody, sigHeader, secret) {
    const { ok, event, error } = this.constructEvent(rawBody, sigHeader, secret);
    if (!ok) return { ok: false, error };
    const action = this.handleDepositWebhook(event);
    return { ok: true, action };
  }

  // ── Private helper — Node.js https POST ──────────────────────────────────────

  /**
   * Make an HTTPS POST request and return the parsed JSON response.
   * Rejects with Error('StripeProvider: <message>') on network or non-2xx.
   * @param {string} hostname
   * @param {string} path
   * @param {string} body  — URL-encoded body string
   * @param {object} headers
   * @returns {Promise<object>}  — parsed JSON body
   */
  _httpsPost(hostname, path, body, headers) {
    return new Promise((resolve, reject) => {
      const req = https.request(
        { hostname, path, method: 'POST', headers },
        (res) => {
          let raw = '';
          res.on('data', (chunk) => { raw += chunk; });
          res.on('end', () => {
            let parsed;
            try {
              parsed = JSON.parse(raw);
            } catch {
              return reject(new Error('StripeProvider: invalid JSON response'));
            }
            if (res.statusCode < 200 || res.statusCode >= 300) {
              const msg = (parsed.error && parsed.error.message) || `HTTP ${res.statusCode}`;
              return reject(new Error('StripeProvider: ' + msg));
            }
            resolve(parsed);
          });
        }
      );
      req.on('error', (err) => {
        reject(new Error('StripeProvider: ' + err.message));
      });
      req.write(body);
      req.end();
    });
  }
}

const defaultStripeProvider = new StripeProvider();

module.exports = {
  StripeProvider,
  defaultStripeProvider,
};
