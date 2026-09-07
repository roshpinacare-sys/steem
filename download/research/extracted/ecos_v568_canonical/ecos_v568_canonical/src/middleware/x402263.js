'use strict';
/**
 * src/middleware/x402263.js — x402 Payment Header Middleware (V263)
 *
 * Stub implementation of Coinbase x402 V2 micropayment protocol.
 * Per research: "x402: per-request micropayment protocol where each HTTP request
 * carries payment in the header." Enables machine-to-machine payments
 * without subscriptions or API keys.
 *
 * x402 V2 flow:
 *   1. Client sends X-PAYMENT header (base64-encoded PaymentPayload)
 *   2. Server validates and records intent in agentReceipts263
 *   3. On success, server returns X-PAYMENT-RESPONSE header
 *
 * Zero new npm deps. Identifiers end with 263.
 */
const crypto = require('node:crypto');

const X402_HEADER_263          = 'x-payment';
const X402_RESPONSE_HEADER_263 = 'x-payment-response';
const X402_VERSION_263         = '2';
const X402_NETWORK_263         = 'base'; // Coinbase L2

/**
 * Parse an x402 payment header.
 * @param {string} headerValue — base64-encoded JSON PaymentPayload
 */
function parseX402Header263(headerValue) {
  try {
    const decoded = Buffer.from(headerValue, 'base64').toString('utf8');
    const payload = JSON.parse(decoded);
    return {
      ok: true,
      version:   payload.version || X402_VERSION_263,
      network:   payload.network || X402_NETWORK_263,
      payerAddr: payload.from,
      payeeAddr: payload.to,
      amountUSDC: payload.amount,
      resourceId: payload.resource,
      nonce:     payload.nonce,
      signature: payload.signature,
    };
  } catch (err) {
    return { ok: false, error: 'Invalid x402 payment header: ' + err.message };
  }
}

/**
 * Build an x402 payment response header.
 */
function buildX402Response263(status, receiptId) {
  return Buffer.from(JSON.stringify({
    status,  // 'accepted' | 'rejected' | 'insufficient'
    receiptId,
    version: X402_VERSION_263,
    network: X402_NETWORK_263,
    respondedAt: new Date().toISOString(),
  })).toString('base64');
}

/**
 * Express middleware: parse x402 payment header if present.
 * Attaches parsed payment to req.x402Payment263.
 * If endpoint requires payment and no header → responds 402.
 *
 * @param {object} opts
 * @param {boolean} opts.required — if true, 402 when no payment header
 * @param {object}  opts.agentReceipts — agentReceipts263 instance
 */
function x402Middleware263(opts = {}) {
  return (req, res, next) => {
    const header = req.headers[X402_HEADER_263];

    if (!header) {
      if (opts.required) {
        res.set(X402_RESPONSE_HEADER_263, buildX402Response263('required', null));
        return res.status(402).json({
          error:    'Payment required',
          protocol: 'x402-v2',
          version:  X402_VERSION_263,
          network:  X402_NETWORK_263,
          endpoint: req.path,
        });
      }
      return next();
    }

    const payment = parseX402Header263(header);
    if (!payment.ok) {
      res.set(X402_RESPONSE_HEADER_263, buildX402Response263('rejected', null));
      return res.status(400).json({ error: payment.error });
    }

    // Attach to request for downstream handlers
    req.x402Payment263 = payment;

    // Record payment intent in agentReceipts if missionId present
    if (opts.agentReceipts && req.x402Payment263.resourceId) {
      try {
        const missionId = req.x402Payment263.resourceId;
        if (opts.agentReceipts.getReceipt263(missionId)) {
          opts.agentReceipts.emitX402Intent263(missionId, {
            tool:       req.path,
            amountUSDC: payment.amountUSDC,
            payee:      payment.payeeAddr,
            purpose:    'api_request',
          });
        }
      } catch (_) {}
    }

    const receiptId = 'x402rcpt263::' + crypto.randomBytes(6).toString('hex');
    res.set(X402_RESPONSE_HEADER_263, buildX402Response263('accepted', receiptId));
    next();
  };
}

module.exports = { x402Middleware263, parseX402Header263, buildX402Response263, X402_HEADER_263, X402_NETWORK_263 };
