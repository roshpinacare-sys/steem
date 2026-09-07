'use strict';
  /**
   * lib/keyRotationManifestDiff380.js — ECOS V380 (Phase P268)
   *
   * DIRECTION 2: Key rotation repo diff.
   *
   * diffKeyRotationManifests380(manifestA, manifestB) is a pure function that
   * reports which key IDs were added, removed, or unchanged between two V378
   * manifests persisted by snapshotKeyRotationRepo379 — giving operators an
   * audit diff for any key rotation.
   *
   * Exports:
   *   KEY_DIFF_VERSION_380
   *   KEY_DIFF_SCHEMA_380
   *   diffKeyRotationManifests380(manifestA, manifestB, opts)
   *     — pure; returns { ok, schema, version, activeKeyChanged, added,
   *         removed, unchanged, identical }
   *
   * Endpoint: POST /api/v1/missions/proof-index/snapshot/key-rotation/manifest/diff [V380-T02]
   *
   * Pure (R3 no new npm deps). All new identifiers end with 380 (R2).
   * Sacred untouched (R1). V361..V379 preserved (R6).
   *
   * @version 380.0.0
   */

  const KEY_DIFF_VERSION_380 = '380.0.0';
  const KEY_DIFF_SCHEMA_380  = 'ecos.integrity.mission.proof.index.snapshot.signing.key.rotation.diff/v380';

  /**
   * Diff two V378 key rotation manifests.
   *
   * @param {object} manifestA  — older manifest (from buildSnapshotKeyManifest378)
   * @param {object} manifestB  — newer manifest
   * @param {{ includeUnchanged?: boolean }} [opts]
   * @returns {{
   *   ok: boolean,
   *   schema: string,
   *   version: string,
   *   activeKeyChanged: boolean,
   *   activeKeyBefore: string|null,
   *   activeKeyAfter: string|null,
   *   added: string[],
   *   removed: string[],
   *   unchanged: string[],
   *   identical: boolean,
   *   diffTs: string,
   * }}
   */
  function diffKeyRotationManifests380(manifestA, manifestB, opts) {
    const o = opts || {};

    if (!manifestA || typeof manifestA !== 'object') {
      return {
        ok: false, error: 'manifestA is required',
        schema: KEY_DIFF_SCHEMA_380, version: KEY_DIFF_VERSION_380,
        activeKeyChanged: false, activeKeyBefore: null, activeKeyAfter: null,
        added: [], removed: [], unchanged: [], identical: false,
        diffTs: new Date().toISOString(),
      };
    }
    if (!manifestB || typeof manifestB !== 'object') {
      return {
        ok: false, error: 'manifestB is required',
        schema: KEY_DIFF_SCHEMA_380, version: KEY_DIFF_VERSION_380,
        activeKeyChanged: false, activeKeyBefore: null, activeKeyAfter: null,
        added: [], removed: [], unchanged: [], identical: false,
        diffTs: new Date().toISOString(),
      };
    }

    // Build full key ID sets (activeKeyId + previousKeyIds)
    function allKeyIds(m) {
      const ids = new Set();
      if (m.activeKeyId) ids.add(m.activeKeyId);
      if (Array.isArray(m.previousKeyIds)) m.previousKeyIds.forEach(k => ids.add(k));
      return ids;
    }

    const setA = allKeyIds(manifestA);
    const setB = allKeyIds(manifestB);

    const added     = [...setB].filter(k => !setA.has(k));
    const removed   = [...setA].filter(k => !setB.has(k));
    const unchanged = [...setA].filter(k =>  setB.has(k));

    const activeKeyBefore = manifestA.activeKeyId || null;
    const activeKeyAfter  = manifestB.activeKeyId || null;
    const activeKeyChanged = activeKeyBefore !== activeKeyAfter;

    const identical = added.length === 0 && removed.length === 0 && !activeKeyChanged;

    return {
      ok: true,
      schema:  KEY_DIFF_SCHEMA_380,
      version: KEY_DIFF_VERSION_380,
      activeKeyChanged,
      activeKeyBefore,
      activeKeyAfter,
      added,
      removed,
      unchanged: o.includeUnchanged !== false ? unchanged : [],
      identical,
      diffTs: new Date().toISOString(),
    };
  }

  module.exports = {
    KEY_DIFF_VERSION_380,
    KEY_DIFF_SCHEMA_380,
    diffKeyRotationManifests380,
  };
  