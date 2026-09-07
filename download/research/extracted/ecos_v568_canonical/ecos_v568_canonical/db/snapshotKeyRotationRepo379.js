'use strict';
  /**
   * db/snapshotKeyRotationRepo379.js — ECOS V379 (Phase P267)
   *
   * DIRECTION 2: Key rotation manifest persistence.
   *
   * A file-backed (or ephemeral) repo for the V378 snapshot signing key
   * rotation manifest, so active/previous keys survive restarts.
   * Mirrors the V366 persistent subscriber repo and V370 rotation
   * transcript repo patterns.
   *
   * Exports:
   *   ROTATION_REPO_VERSION_379          — '379.0.0'
   *   ROTATION_REPO_SCHEMA_379           — schema tag
   *   createSnapshotKeyRotationRepo379(opts)
   *     — returns { schema, version, save(manifest), load(), reset(), ephemeral, filePath }
   *
   * Endpoint: GET /api/v1/missions/proof-index/snapshot/key-rotation/manifest [V379-T02]
   *
   * Pure (R3 — no new npm deps; node fs/path only). All new identifiers end
   * with 379 (R2). Sacred untouched (R1). V361..V378 preserved (R6).
   *
   * @version 379.0.0
   */

  const fs   = require('fs');
  const path = require('path');

  const ROTATION_REPO_VERSION_379 = '379.0.0';
  const ROTATION_REPO_SCHEMA_379  = 'ecos.integrity.mission.proof.index.snapshot.signing.rotation.repo/v379';

  const DEFAULT_ROTATION_REPO_FILE_379 = 'data/snapshotKeyRotationManifest379.json';

  // ── file helpers ──────────────────────────────────────────────────────────────

  function _atomicWrite379(filePath, payload) {
    const dir = path.dirname(filePath);
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    const tmp = filePath + '.tmp.' + process.pid + '.' + Date.now();
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  }

  function _safeRead379(filePath) {
    try {
      const txt = fs.readFileSync(filePath, 'utf8');
      const obj = JSON.parse(txt);
      if (obj && typeof obj === 'object') return obj;
    } catch (_) {}
    return null;
  }

  // ── createSnapshotKeyRotationRepo379 ─────────────────────────────────────────

  /**
   * Create a file-backed (or ephemeral) repo for the V378 snapshot signing
   * key rotation manifest. Stores the most-recently saved manifest and
   * exposes load/save operations.
   *
   * @param {{
   *   filePath?: string,
   *   ephemeral?: boolean,
   * }} [opts]
   * @returns {{
   *   schema: string,
   *   version: string,
   *   ephemeral: boolean,
   *   filePath: string|null,
   *   save(manifest: object): void,
   *   load(): object|null,
   *   reset(): void,
   * }}
   */
  function createSnapshotKeyRotationRepo379(opts) {
    const o        = opts || {};
    const ephemeral = !!o.ephemeral;
    const filePath  = ephemeral
      ? null
      : path.resolve(
          o.filePath ||
          process.env.ECOS_SNAPSHOT_KEY_ROTATION_REPO_FILE_379 ||
          DEFAULT_ROTATION_REPO_FILE_379
        );

    // In-memory cache
    let cached = ephemeral ? null : _safeRead379(filePath);

    return {
      schema:    ROTATION_REPO_SCHEMA_379,
      version:   ROTATION_REPO_VERSION_379,
      ephemeral,
      filePath,

      /**
       * Persist the manifest (writes to disk if not ephemeral).
       * @param {object} manifest  — result of buildSnapshotKeyManifest378
       */
      save(manifest) {
        if (!manifest || typeof manifest !== 'object') {
          throw new Error('manifest must be an object');
        }
        const stored = {
          schema:     ROTATION_REPO_SCHEMA_379,
          version:    ROTATION_REPO_VERSION_379,
          savedAt:    new Date().toISOString(),
          manifest,
        };
        cached = stored;
        if (filePath) _atomicWrite379(filePath, stored);
      },

      /**
       * Load the current persisted manifest (from cache; reads disk once on startup).
       * @returns {object|null}
       */
      load() {
        return cached ? (cached.manifest || cached) : null;
      },

      /** Reset the store (removes file if present). */
      reset() {
        cached = null;
        if (filePath) {
          try { fs.unlinkSync(filePath); } catch (_) {}
        }
      },
    };
  }

  module.exports = {
    ROTATION_REPO_VERSION_379,
    ROTATION_REPO_SCHEMA_379,
    createSnapshotKeyRotationRepo379,
  };
  