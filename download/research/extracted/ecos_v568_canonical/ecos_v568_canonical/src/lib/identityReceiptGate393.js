'use strict';
/**
 * lib/identityReceiptGate393.js — ECOS V393 (Phase P281) — Identity-Gated Receipt Creation
 *
 * Direction 2 (V393): Require a signed V391 identity claim before agentReceipts268 creates
 * a receipt. Attach the actorId to the receipt record for audit-chain provenance.
 *
 * Pre-V393, any caller that knew a missionId/agentId could trigger receipt creation.
 * V393 closes this by wrapping the receipt-creation call with identity verification,
 * writing the actorId onto the receipt's provenance field so the audit trail knows
 * cryptographically who triggered each receipt.
 *
 * Exports:
 *   createIdentityReceiptGate393(opts)
 *     — { createGatedReceipt393, getReceiptProvenance393, stats393 }
 *
 * Pure JS, Node built-ins only (R3). All identifiers end with 393 (R2).
 * Sacred files untouched (R1). V361–V392 preserved (R6).
 *
 * @version 393.0.0
 */

const IDENTITY_RECEIPT_GATE_VERSION_393       = '393.0.0';
const IDENTITY_RECEIPT_GATE_SCHEMA_393        = 'ecos.sovereign.identity.receipt.gate/v393';
const IDENTITY_RECEIPT_GATE_CREATE_EVENT_393  = 'identity_receipt_create_event_type_393';
const IDENTITY_RECEIPT_GATE_REJECT_EVENT_393  = 'identity_receipt_reject_event_type_393';

class IdentityReceiptGateError393 extends Error {
  constructor(msg, code) {
    super(msg);
    this.name  = 'IdentityReceiptGateError393';
    this.code  = code || 'RECEIPT_GATE_ERROR';
    this.statusCode = 403;
  }
}

/**
 * Wrap receipt creation with mandatory identity gate.
 *
 * @param {object} opts
 * @param {object}   opts.gate              — identityEconomyGate392 instance
 * @param {object}   opts.receipts          — agentReceipts (any version) instance with a create/add method
 * @param {function} [opts.audit]           — (type, payload) => void
 * @param {object}   [opts.logger]
 */
function createIdentityReceiptGate393(opts = {}) {
  if (!opts.gate || typeof opts.gate.requireIdentityAuth392 !== 'function') {
    throw new IdentityReceiptGateError393(
      'identityReceiptGate393: opts.gate must expose requireIdentityAuth392()',
      'BAD_CONFIG'
    );
  }
  if (!opts.receipts || (typeof opts.receipts.create !== 'function' && typeof opts.receipts.add !== 'function')) {
    throw new IdentityReceiptGateError393(
      'identityReceiptGate393: opts.receipts must expose create() or add()',
      'BAD_CONFIG'
    );
  }

  const gate     = opts.gate;
  const receipts = opts.receipts;
  const audit    = typeof opts.audit === 'function' ? opts.audit : null;

  // Provenance index: receiptId → { actorId, ts, authResult }
  const _provenanceIndex393 = new Map();

  const _stats393 = {
    receiptsCreated: 0,
    receiptsRejected: 0,
  };

  /**
   * Create a receipt only after verifying the actor's sovereign identity.
   * The actorId is stamped onto the receipt for audit-chain provenance.
   *
   * @param {string} actorId           — sovereign identity id (key-derived, V391)
   * @param {object} claim             — signed V391 identity claim
   * @param {string|Buffer} signature  — claim signature
   * @param {object} receiptData       — the receipt payload to create
   * @param {string} [rawPubkey]       — raw ed25519 pubkey hex
   * @returns {{ ok: true, receipt, actorId, provenanceId }}
   */
  function createGatedReceipt393(actorId, claim, signature, receiptData, rawPubkey) {
    if (!actorId || typeof actorId !== 'string') {
      throw new IdentityReceiptGateError393('actorId required for receipt creation', 'NO_ACTOR_ID');
    }
    if (!claim || !signature) {
      throw new IdentityReceiptGateError393(
        'receipt creation requires a signed V391 identity claim',
        'IDENTITY_REQUIRED'
      );
    }
    if (!receiptData || typeof receiptData !== 'object') {
      throw new IdentityReceiptGateError393('receiptData object required', 'BAD_RECEIPT_DATA');
    }

    // 1. Gate: verify identity
    let authResult;
    try {
      authResult = gate.requireIdentityAuth392(actorId, claim, signature, rawPubkey, 'receipt_creation');
    } catch (e) {
      _stats393.receiptsRejected++;
      if (audit) {
        try {
          audit(IDENTITY_RECEIPT_GATE_REJECT_EVENT_393, {
            actorId, reason: e.code || e.message, ts: new Date().toISOString(),
          });
        } catch (_) {}
      }
      throw e;
    }

    // 2. Stamp actorId onto receipt data for provenance
    const stampedData = {
      ...receiptData,
      _identityProvenance393: {
        actorId,
        sovereignIdVersion: 'V391',
        gatedBy: 'identityReceiptGate393',
        ts: new Date().toISOString(),
      },
    };

    // 3. Create the receipt via the underlying receipts module
    let receipt;
    try {
      if (typeof receipts.create === 'function') {
        receipt = receipts.create(stampedData);
      } else {
        receipt = receipts.add(stampedData);
      }
    } catch (e) {
      _stats393.receiptsRejected++;
      throw new IdentityReceiptGateError393(`receipt creation failed: ${e.message}`, 'CREATE_FAILED');
    }

    // 4. Index provenance
    const provenanceId = (receipt && (receipt.id || receipt.receiptId || receipt._id)) ||
      `prov393_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    _provenanceIndex393.set(provenanceId, {
      actorId,
      ts:         new Date().toISOString(),
      authResult: { ok: authResult.ok, actorId: authResult.actorId },
    });

    _stats393.receiptsCreated++;
    if (audit) {
      try {
        audit(IDENTITY_RECEIPT_GATE_CREATE_EVENT_393, {
          actorId, provenanceId, ts: new Date().toISOString(),
        });
      } catch (_) {}
    }

    return { ok: true, receipt, actorId, provenanceId };
  }

  /**
   * Retrieve the identity provenance record for a previously gated receipt.
   *
   * @param {string} provenanceId
   * @returns {{ ok: true, provenance } | { ok: false, error }}
   */
  function getReceiptProvenance393(provenanceId) {
    if (!provenanceId || typeof provenanceId !== 'string') {
      throw new IdentityReceiptGateError393('provenanceId required', 'NO_PROVENANCE_ID');
    }
    const p = _provenanceIndex393.get(provenanceId);
    if (!p) return { ok: false, error: 'not found', provenanceId };
    return { ok: true, provenanceId, provenance: p };
  }

  function stats393() {
    return {
      ..._stats393,
      provenanceIndexSize: _provenanceIndex393.size,
      version: IDENTITY_RECEIPT_GATE_VERSION_393,
    };
  }

  return {
    createGatedReceipt393,
    getReceiptProvenance393,
    stats393,
    IDENTITY_RECEIPT_GATE_VERSION_393,
    IDENTITY_RECEIPT_GATE_CREATE_EVENT_393,
    IDENTITY_RECEIPT_GATE_REJECT_EVENT_393,
  };
}

module.exports = {
  createIdentityReceiptGate393,
  IDENTITY_RECEIPT_GATE_VERSION_393,
  IDENTITY_RECEIPT_GATE_SCHEMA_393,
  IDENTITY_RECEIPT_GATE_CREATE_EVENT_393,
  IDENTITY_RECEIPT_GATE_REJECT_EVENT_393,
  IdentityReceiptGateError393,
};
