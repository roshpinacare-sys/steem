'use strict';
/**
 * lib/batchIdentityEnforcer394.js — ECOS V394 (Phase P282) — Batch Identity Enforcement
 *
 * Direction 2 (V394): Accept an array of { actorId, claim, signature, action } items
 * and call the appropriate V393 enforcer for each, returning a per-item result array.
 * Useful for bulk import/migration workflows.
 *
 * Supported actions: 'credit_transfer' | 'reward_issuance'
 * Items with unknown action are rejected with code UNKNOWN_ACTION.
 *
 * Exports:
 *   createBatchIdentityEnforcer394(opts)
 *     — { batchEnforceIdentity394, stats394 }
 *
 * Pure JS, Node built-ins only (R3). All identifiers end with 394 (R2).
 * Sacred files untouched (R1). V361–V393 preserved (R6).
 *
 * @version 394.0.0
 */

const BATCH_IDENTITY_ENFORCER_VERSION_394  = '394.0.0';
const BATCH_IDENTITY_ENFORCER_SCHEMA_394   = 'ecos.sovereign.identity.batch.enforcer/v394';
const BATCH_ENFORCE_EVENT_394              = 'identity_batch_enforce_event_type_394';
const BATCH_ENFORCE_ITEM_EVENT_394         = 'identity_batch_enforce_item_event_type_394';

const SUPPORTED_ACTIONS_394 = new Set(['credit_transfer', 'reward_issuance']);
const MAX_BATCH_SIZE_394 = 500;

class BatchIdentityEnforcerError394 extends Error {
  constructor(msg, code) {
    super(msg);
    this.name = 'BatchIdentityEnforcerError394';
    this.code = code || 'BATCH_ERROR';
    this.statusCode = 400;
  }
}

/**
 * Create the batch enforcer.
 *
 * @param {object} opts
 * @param {object}   opts.enforcer          — identityCallsiteEnforcer393 instance
 *                                           (must expose enforceTransfer393, enforceReward393)
 * @param {function} [opts.audit]           — (type, payload) => void
 * @param {object}   [opts.logger]
 * @param {number}   [opts.maxBatchSize]    — max items per batch (default: 500)
 */
function createBatchIdentityEnforcer394(opts = {}) {
  if (!opts.enforcer ||
      typeof opts.enforcer.enforceTransfer393  !== 'function' ||
      typeof opts.enforcer.enforceReward393    !== 'function') {
    throw new BatchIdentityEnforcerError394(
      'batchIdentityEnforcer394: opts.enforcer must expose enforceTransfer393 and enforceReward393',
      'BAD_CONFIG'
    );
  }

  const enforcer = opts.enforcer;
  const audit    = typeof opts.audit === 'function' ? opts.audit : null;
  const maxSize  = Number.isFinite(opts.maxBatchSize) && opts.maxBatchSize > 0
    ? opts.maxBatchSize : MAX_BATCH_SIZE_394;

  const _stats394 = {
    batchesProcessed: 0,
    itemsProcessed:   0,
    itemsSucceeded:   0,
    itemsFailed:      0,
  };

  /**
   * Process a batch of identity enforcement items.
   *
   * @param {Array<{actorId: string, claim: object|null, signature: string|null, action: string, rawPubkey?: string}>} items
   * @param {object} [batchOpts]
   * @param {boolean} [batchOpts.continueOnError]  — if false (default), stop on first failure
   * @param {string}  [batchOpts.batchId]          — optional caller-supplied batch id for tracing
   * @returns {{
   *   batchId: string,
   *   processedAt: string,
   *   total: number,
   *   succeeded: number,
   *   failed: number,
   *   results: Array<{ index: number, actorId: string, action: string, ok: boolean, result?: object, error?: string, code?: string }>
   * }}
   */
  function batchEnforceIdentity394(items, batchOpts = {}) {
    if (!Array.isArray(items)) {
      throw new BatchIdentityEnforcerError394('items must be an array', 'BAD_INPUT');
    }
    if (items.length === 0) {
      throw new BatchIdentityEnforcerError394('items array must not be empty', 'EMPTY_BATCH');
    }
    if (items.length > maxSize) {
      throw new BatchIdentityEnforcerError394(
        `batch size ${items.length} exceeds maximum ${maxSize}`,
        'BATCH_TOO_LARGE'
      );
    }

    const continueOnError = batchOpts.continueOnError !== false; // default: true (process all)
    const batchId = batchOpts.batchId || ('batch394_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
    const processedAt = new Date().toISOString();

    _stats394.batchesProcessed++;

    const results = [];
    let succeeded = 0;
    let failed    = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i] || {};
      const { actorId, claim = null, signature = null, action, rawPubkey } = item;

      _stats394.itemsProcessed++;

      // validate action
      if (!action || !SUPPORTED_ACTIONS_394.has(action)) {
        failed++;
        _stats394.itemsFailed++;
        const itemResult = {
          index: i, actorId: actorId || null, action: action || null,
          ok: false, error: `unknown action '${action}'; supported: ${[...SUPPORTED_ACTIONS_394].join(', ')}`,
          code: 'UNKNOWN_ACTION',
        };
        results.push(itemResult);
        if (audit) {
          try {
            audit(BATCH_ENFORCE_ITEM_EVENT_394, { batchId, index: i, actorId, action, ok: false, code: 'UNKNOWN_ACTION', ts: new Date().toISOString() });
          } catch (_) {}
        }
        if (!continueOnError) break;
        continue;
      }

      try {
        let enforceResult;
        if (action === 'credit_transfer') {
          enforceResult = enforcer.enforceTransfer393(actorId, claim, signature, rawPubkey);
        } else {
          enforceResult = enforcer.enforceReward393(actorId, claim, signature, rawPubkey);
        }
        succeeded++;
        _stats394.itemsSucceeded++;
        const itemResult = { index: i, actorId, action, ok: true, result: enforceResult };
        results.push(itemResult);
        if (audit) {
          try {
            audit(BATCH_ENFORCE_ITEM_EVENT_394, {
              batchId, index: i, actorId, action, ok: true,
              bypassed: !!(enforceResult && enforceResult.bypassed), ts: new Date().toISOString(),
            });
          } catch (_) {}
        }
      } catch (e) {
        failed++;
        _stats394.itemsFailed++;
        const itemResult = {
          index: i, actorId, action, ok: false,
          error: e.message, code: e.code || 'ENFORCE_ERROR',
        };
        results.push(itemResult);
        if (audit) {
          try {
            audit(BATCH_ENFORCE_ITEM_EVENT_394, {
              batchId, index: i, actorId, action, ok: false, code: e.code || 'ENFORCE_ERROR', ts: new Date().toISOString(),
            });
          } catch (_) {}
        }
        if (!continueOnError) break;
      }
    }

    if (audit) {
      try {
        audit(BATCH_ENFORCE_EVENT_394, {
          batchId, processedAt, total: items.length, succeeded, failed,
          continueOnError, ts: new Date().toISOString(),
        });
      } catch (_) {}
    }

    return { batchId, processedAt, total: items.length, succeeded, failed, results };
  }

  function stats394() {
    return {
      ..._stats394,
      maxBatchSize:  maxSize,
      version:       BATCH_IDENTITY_ENFORCER_VERSION_394,
    };
  }

  return {
    batchEnforceIdentity394,
    stats394,
    BATCH_IDENTITY_ENFORCER_VERSION_394,
    BATCH_ENFORCE_EVENT_394,
    BATCH_ENFORCE_ITEM_EVENT_394,
    SUPPORTED_ACTIONS_394: [...SUPPORTED_ACTIONS_394],
  };
}

module.exports = {
  createBatchIdentityEnforcer394,
  BATCH_IDENTITY_ENFORCER_VERSION_394,
  BATCH_IDENTITY_ENFORCER_SCHEMA_394,
  BATCH_ENFORCE_EVENT_394,
  BATCH_ENFORCE_ITEM_EVENT_394,
  MAX_BATCH_SIZE_394,
  SUPPORTED_ACTIONS_394: ['credit_transfer', 'reward_issuance'],
  BatchIdentityEnforcerError394,
};
