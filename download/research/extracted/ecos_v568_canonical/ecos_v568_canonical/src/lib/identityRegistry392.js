'use strict';
/**
 * lib/identityRegistry392.js — ECOS V392 (Phase P280) — Persisted Identity Registry
 *
 * Direction 4 (V392): Persist the sovereign identity registry to db/ alongside the
 * audit log so identities survive restart. Extend the V372 commitment to cover the
 * identity action log.
 *
 * This module wraps the SovereignIdentityVM391 in-memory registry with:
 *   • File-backed persistence (JSON, same pattern as persistedCursorRegistry382)
 *     written to ECOS_IDENTITY_REGISTRY_DIR (default: /tmp)
 *   • load() on start — identities survive server restarts
 *   • flush() on every state transition — deterministic durability
 *   • V372 proof extension: records a 'identity_action_log_commitment_event_type_392'
 *     audit entry after each flush so the identity log is covered by the portable proof
 *
 * Exports:
 *   createPersistedIdentityRegistry392(opts)
 *     — { vm, load, flush, stats392, IDENTITY_REGISTRY_VERSION_392 }
 *
 * Pure JS, Node built-ins only (R3). All identifiers end with 392 (R2).
 * Sacred files untouched (R1). V361–V391 preserved (R6).
 *
 * @version 392.0.0
 */

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const IDENTITY_REGISTRY_VERSION_392             = '392.0.0';
const IDENTITY_REGISTRY_SCHEMA_392              = 'ecos.sovereign.identity.registry.persisted/v392';
const IDENTITY_REGISTRY_COMMIT_EVENT_TYPE_392   = 'identity_action_log_commitment_event_type_392';
const IDENTITY_REGISTRY_LOAD_EVENT_TYPE_392     = 'identity_registry_load_event_type_392';

const DEFAULT_REGISTRY_FILE_392 = path.join(
  (typeof process !== 'undefined' && process.env.ECOS_IDENTITY_REGISTRY_DIR) || '/tmp',
  'ecos_identity_registry_392.json'
);

class IdentityRegistryError392 extends Error {
  constructor(msg, code) {
    super(msg);
    this.name = 'IdentityRegistryError392';
    this.code = code || 'REGISTRY_ERROR';
  }
}

/**
 * Create a persisted identity registry wrapping a SovereignIdentityVM391.
 *
 * @param {object} opts
 * @param {object}   opts.identityVM   — SovereignIdentityVM391 instance (required)
 * @param {string}   [opts.filePath]   — path to JSON persist file
 * @param {boolean}  [opts.ephemeral]  — if true, no file I/O (for tests)
 * @param {function} [opts.audit]      — (type, payload) => void (sacred audit log)
 * @param {object}   [opts.logger]
 * @returns {{ vm, load, flush, stats392, IDENTITY_REGISTRY_VERSION_392 }}
 */
function createPersistedIdentityRegistry392(opts = {}) {
  if (!opts.identityVM || typeof opts.identityVM.execute !== 'function') {
    throw new IdentityRegistryError392(
      'createPersistedIdentityRegistry392: opts.identityVM required',
      'BAD_CONFIG'
    );
  }

  const vm        = opts.identityVM;
  const filePath  = opts.ephemeral ? null : (opts.filePath || DEFAULT_REGISTRY_FILE_392);
  const audit     = typeof opts.audit === 'function' ? opts.audit : null;
  const ephemeral = !!opts.ephemeral || !filePath;

  const _stats392 = {
    loads: 0, flushes: 0, loadedIdentities: 0, flushErrors: 0, loadErrors: 0,
    commitments: 0,
  };

  /**
   * Serialise the VM's in-memory registry to JSON.
   * We export what the VM exposes via its registry Map.
   */
  function _serialise392() {
    const entries = [];
    if (vm.registry && vm.registry instanceof Map) {
      for (const [id, val] of vm.registry.entries()) {
        // val is either 'REVOKED' (string) or { ownerPubkey, lastNonce, ... }
        entries.push({ id, state: val === 'REVOKED' ? 'REVOKED' : { ...val } });
      }
    }
    return {
      schema: IDENTITY_REGISTRY_SCHEMA_392,
      version: IDENTITY_REGISTRY_VERSION_392,
      flushedAt: new Date().toISOString(),
      count: entries.length,
      entries,
    };
  }

  /**
   * Re-hydrate the VM registry from a persisted JSON blob.
   * We directly restore the Map entries — this is safe because the VM
   * constructor already sets up the registry as a plain Map.
   */
  function _deserialise392(data) {
    if (!data || !Array.isArray(data.entries)) return 0;
    let loaded = 0;
    for (const { id, state } of data.entries) {
      if (!id) continue;
      vm.registry.set(id, state === 'REVOKED' ? 'REVOKED' : state);
      loaded++;
    }
    return loaded;
  }

  /**
   * Load registry from disk. Called on server start.
   * @returns {{ ok: boolean, loaded: number, source: string }}
   */
  function load() {
    _stats392.loads++;
    if (ephemeral) return { ok: true, loaded: 0, source: 'ephemeral' };
    try {
      if (!fs.existsSync(filePath)) return { ok: true, loaded: 0, source: 'no-file' };
      const raw  = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);
      const loaded = _deserialise392(data);
      _stats392.loadedIdentities += loaded;
      if (audit) {
        try {
          audit(IDENTITY_REGISTRY_LOAD_EVENT_TYPE_392, { loaded, filePath, ts: new Date().toISOString() });
        } catch (_) {}
      }
      return { ok: true, loaded, source: filePath };
    } catch (e) {
      _stats392.loadErrors++;
      return { ok: false, loaded: 0, source: filePath, error: e.message };
    }
  }

  /**
   * Flush registry to disk and append a V372-compatible commitment to the audit log.
   * @returns {{ ok: boolean, written: number, commitmentHash: string }}
   */
  function flush() {
    _stats392.flushes++;
    const payload = _serialise392();
    const payloadStr = JSON.stringify(payload, null, 2);

    // Compute sha256 commitment over the registry snapshot
    const commitmentHash = crypto.createHash('sha256').update(payloadStr, 'utf8').digest('hex');

    if (!ephemeral && filePath) {
      try {
        fs.writeFileSync(filePath, payloadStr, 'utf8');
      } catch (e) {
        _stats392.flushErrors++;
        // Audit the error but don't throw — flush failure is non-fatal per V392 rules
        if (audit) {
          try { audit('identity_registry_flush_error_392', { error: e.message, ts: new Date().toISOString() }); } catch (_) {}
        }
        return { ok: false, written: 0, commitmentHash, error: e.message };
      }
    }

    // V372 commitment: extend the portable proof to cover the identity action log
    _stats392.commitments++;
    if (audit) {
      try {
        audit(IDENTITY_REGISTRY_COMMIT_EVENT_TYPE_392, {
          commitmentHash,
          schema: IDENTITY_REGISTRY_SCHEMA_392,
          count: payload.count,
          flushedAt: payload.flushedAt,
          filePath: filePath || 'ephemeral',
        });
      } catch (_) {}
    }

    return { ok: true, written: payload.count, commitmentHash };
  }

  function stats392() {
    return {
      ..._stats392,
      registrySize: vm.registry ? vm.registry.size : 0,
      filePath: filePath || 'ephemeral',
      version: IDENTITY_REGISTRY_VERSION_392,
    };
  }

  return {
    vm,
    load,
    flush,
    stats392,
    IDENTITY_REGISTRY_VERSION_392,
    IDENTITY_REGISTRY_SCHEMA_392,
    IDENTITY_REGISTRY_COMMIT_EVENT_TYPE_392,
  };
}

module.exports = {
  createPersistedIdentityRegistry392,
  IDENTITY_REGISTRY_VERSION_392,
  IDENTITY_REGISTRY_SCHEMA_392,
  IDENTITY_REGISTRY_COMMIT_EVENT_TYPE_392,
  IDENTITY_REGISTRY_LOAD_EVENT_TYPE_392,
  IdentityRegistryError392,
};
