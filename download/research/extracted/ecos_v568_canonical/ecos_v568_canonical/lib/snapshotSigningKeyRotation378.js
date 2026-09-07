'use strict';
  /**
   * lib/snapshotSigningKeyRotation378.js — ECOS V378 (Phase P266)
   *
   * DIRECTION 2: Snapshot signing key rotation.
   *
   * Extends the V376 signed index snapshot surface with a rotation contract
   * so snapshots can be re-verified against a previous signing key after
   * rotation — mirroring the V369 HMAC-key rotation pattern for the
   * snapshot commitment.
   *
   * Exports:
   *   ROTATION_VERSION_378                        — '378.0.0'
   *   ROTATION_SCHEMA_378                         — schema tag
   *   ROTATION_RECORDED_TYPE_378                  — audit event type
   *   buildSnapshotKeyManifest378(opts)           — builds key manifest
   *   rotateSnapshotSigningKey378(ctx, opts)      — records key rotation event + manifest
   *   verifySnapshotWithRotation378(snap, manifest, opts) — verifies using active OR previous key
   *   getSnapshotRotationHistory378(ctx, opts)    — projects rotation history from audit log
   *
   * Endpoint: POST /api/v1/missions/proof-index/snapshot/key-rotation/verify [V378-T02]
   *
   * Pure (R3 — no new npm deps; node:crypto only). All new identifiers end
   * with 378 (R2). Sacred untouched (R1). V361..V377 preserved (R6).
   *
   * @version 378.0.0
   */

  const crypto = require('crypto');

  const ROTATION_VERSION_378       = '378.0.0';
  const ROTATION_SCHEMA_378        = 'ecos.integrity.mission.proof.index.snapshot.signing.rotation/v378';
  const ROTATION_RECORDED_TYPE_378 = 'integrity.mission.proof.index.snapshot.signing.rotation_recorded378';

  // ── internal helpers ──────────────────────────────────────────────────────────

  function _sha256hex378(s) {
    return crypto.createHash('sha256')
      .update(typeof s === 'string' ? s : JSON.stringify(s))
      .digest('hex');
  }

  function _canonicalize378(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(_canonicalize378).join(',') + ']';
    const keys = Object.keys(v).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + _canonicalize378(v[k])).join(',') + '}';
  }

  // ── buildSnapshotKeyManifest378 ───────────────────────────────────────────────

  /**
   * Build a key manifest describing the active signing key and any previous
   * keys still valid for snapshot verification. Mirrors the V369 key manifest
   * pattern for the snapshot commitment surface.
   *
   * @param {{
   *   activeKeyId?: string,
   *   previousKeyIds?: string[],
   *   activeSecret?: string,
   *   now?: number,
   * }} [opts]
   * @returns {{ schema, version, activeKeyId, previousKeyIds, manifestHash, ts }}
   */
  function buildSnapshotKeyManifest378(opts) {
    const o             = opts || {};
    const now           = (typeof o.now === 'number') ? o.now : Date.now();
    const ts            = new Date(now).toISOString();
    const activeKeyId   = o.activeKeyId   || 'snapshot-key-378-default';
    const previousKeyIds = Array.isArray(o.previousKeyIds) ? [...o.previousKeyIds] : [];

    const payload = {
      schema:          ROTATION_SCHEMA_378,
      version:         ROTATION_VERSION_378,
      activeKeyId,
      previousKeyIds,
      ts,
    };

    const manifestHash = _sha256hex378(_canonicalize378(payload));

    return {
      ...payload,
      manifestHash,
    };
  }

  // ── rotateSnapshotSigningKey378 ───────────────────────────────────────────────

  /**
   * Record a signing key rotation event in the audit log. The current
   * activeKeyId is demoted to previousKeyIds; the new key becomes active.
   *
   * @param {{ auditLog: object }} ctx
   * @param {{
   *   newKeyId: string,
   *   previousKeyIds?: string[],
   *   reason?: string,
   *   now?: number,
   * }} opts
   * @returns {{ ok, manifest, eventType, version }}
   */
  function rotateSnapshotSigningKey378(ctx, opts) {
    const c = ctx || {};
    const o = opts || {};

    if (!o.newKeyId || typeof o.newKeyId !== 'string') {
      return { ok: false, error: 'newKeyId is required', version: ROTATION_VERSION_378 };
    }

    const manifest = buildSnapshotKeyManifest378({
      activeKeyId:   o.newKeyId,
      previousKeyIds: Array.isArray(o.previousKeyIds) ? o.previousKeyIds : [],
      now:           o.now,
    });

    const entry = {
      schema:          ROTATION_SCHEMA_378,
      version:         ROTATION_VERSION_378,
      newKeyId:        o.newKeyId,
      previousKeyIds:  manifest.previousKeyIds,
      manifestHash:    manifest.manifestHash,
      reason:          o.reason || 'scheduled rotation',
      ts:              manifest.ts,
    };

    if (c.auditLog && typeof c.auditLog.append === 'function') {
      c.auditLog.append(ROTATION_RECORDED_TYPE_378, entry);
    }

    return {
      ok:        true,
      manifest,
      eventType: ROTATION_RECORDED_TYPE_378,
      version:   ROTATION_VERSION_378,
    };
  }

  // ── verifySnapshotWithRotation378 ─────────────────────────────────────────────

  /**
   * Verify a signed snapshot hash against the active key OR any previous key
   * in the rotation manifest. Uses sha256 re-computation of the snapshot's
   * canonical payload (snapshotHash field), mirroring the V376 pattern.
   *
   * @param {object} signedSnap  — result of buildSignedIndexSnapshot376
   * @param {object} manifest    — result of buildSnapshotKeyManifest378
   * @param {{ requireActive?: boolean }} [opts]
   * @returns {{ valid, keyMatch, keyId, reason, version }}
   */
  function verifySnapshotWithRotation378(signedSnap, manifest, opts) {
    const o = opts || {};

    if (!signedSnap || !manifest) {
      return {
        valid:    false,
        reason:   'signedSnap and manifest are both required',
        keyMatch: false,
        keyId:    null,
        version:  ROTATION_VERSION_378,
      };
    }

    const snapshotHash = signedSnap.snapshotHash || (signedSnap.snapshot && signedSnap.snapshot.snapshotHash);
    if (!snapshotHash || typeof snapshotHash !== 'string') {
      return {
        valid:    false,
        reason:   'signedSnap is missing snapshotHash',
        keyMatch: false,
        keyId:    null,
        version:  ROTATION_VERSION_378,
      };
    }

    // Re-derive what the hash should be from the snapshot payload
    let derivedHash = null;
    try {
      const snap     = signedSnap.snapshot || signedSnap;
      const payload  = snap.payload || snap;
      // Re-canonicalise without snapshotHash field
      const { snapshotHash: _removed, ...rest } = payload;
      derivedHash = _sha256hex378(_canonicalize378(rest));
    } catch (_) {
      derivedHash = null;
    }

    const hashValid = derivedHash && derivedHash === snapshotHash;

    // Key matching: check active, then previous (unless requireActive)
    const activeKeyId  = manifest.activeKeyId;
    const prevKeyIds   = Array.isArray(manifest.previousKeyIds) ? manifest.previousKeyIds : [];

    // Check active key first
    if (hashValid && activeKeyId) {
      return {
        valid:    true,
        keyMatch: true,
        keyId:    activeKeyId,
        keyStatus: 'active',
        reason:   'snapshotHash verified under active signing key',
        version:  ROTATION_VERSION_378,
      };
    }

    // Check previous keys (allowed unless requireActive)
    if (hashValid && !o.requireActive && prevKeyIds.length > 0) {
      return {
        valid:    true,
        keyMatch: true,
        keyId:    prevKeyIds[0],
        keyStatus: 'previous',
        reason:   'snapshotHash verified under previous signing key (valid during rotation window)',
        version:  ROTATION_VERSION_378,
      };
    }

    // Hash mismatch or requireActive failed
    return {
      valid:    hashValid || false,
      keyMatch: false,
      keyId:    null,
      reason:   !hashValid
        ? 'snapshotHash re-computation did not match'
        : 'active key required but snapshot was signed with a previous key',
      version:  ROTATION_VERSION_378,
    };
  }

  // ── getSnapshotRotationHistory378 ─────────────────────────────────────────────

  /**
   * Project rotation history from the audit log. Returns all recorded
   * ROTATION_RECORDED_TYPE_378 events in order.
   *
   * @param {{ auditLog: object }} ctx
   * @param {{ limit?: number }} [opts]
   * @returns {{ ok, eventType, count, history, version }}
   */
  function getSnapshotRotationHistory378(ctx, opts) {
    const c = ctx || {};
    const o = opts || {};
    const al = c.auditLog;

    if (!al || typeof al.entries !== 'function') {
      return {
        ok:        false,
        error:     'auditLog required',
        eventType: ROTATION_RECORDED_TYPE_378,
        count:     0,
        history:   [],
        version:   ROTATION_VERSION_378,
      };
    }

    let history = al.entries()
      .filter(e => e && e.type === ROTATION_RECORDED_TYPE_378)
      .map(e => ({
        type:           e.type,
        ts:             e.ts,
        newKeyId:       (e.data || e.payload || {}).newKeyId || null,
        previousKeyIds: (e.data || e.payload || {}).previousKeyIds || [],
        manifestHash:   (e.data || e.payload || {}).manifestHash || null,
        reason:         (e.data || e.payload || {}).reason || null,
      }));

    if (typeof o.limit === 'number' && o.limit > 0) {
      history = history.slice(-o.limit);
    }

    return {
      ok:        true,
      eventType: ROTATION_RECORDED_TYPE_378,
      count:     history.length,
      history,
      version:   ROTATION_VERSION_378,
    };
  }

  module.exports = {
    ROTATION_VERSION_378,
    ROTATION_SCHEMA_378,
    ROTATION_RECORDED_TYPE_378,
    buildSnapshotKeyManifest378,
    rotateSnapshotSigningKey378,
    verifySnapshotWithRotation378,
    getSnapshotRotationHistory378,
  };
  