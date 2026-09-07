'use strict';
/**
 * identityFingerprintRegistry399.js — ECOS V399 D1
 *
 * Behavioural fingerprint registry: computes a normalised frequency-vector
 * fingerprint per actor from their enforcement event-type distribution.
 * Fingerprints are stored and compared across sessions to detect actors whose
 * behaviour pattern has changed; exposes a cosine similarity score (0–1).
 *
 * Function: createIdentityFingerprintRegistry399({ auditLog, audit })
 * Methods:
 *   computeFingerprint399(actorId, opts?)      — compute + store actor fingerprint
 *   getFingerprint399(actorId)                 — retrieve stored fingerprint
 *   compareFingerprints399(actorIdA, actorIdB) — cosine similarity between two actors
 *   listFingerprints399(opts?)                 — list all stored fingerprints
 *   clearFingerprint399(actorId)               — admin: remove stored fingerprint
 */

const IDENTITY_FINGERPRINT_REGISTRY_VERSION_399 = '399.0.0';

const EVT_FINGERPRINT_399 = 'identity_fingerprint_event_type_399';

function createIdentityFingerprintRegistry399(opts = {}) {
  const auditLog = opts.auditLog || opts.audit || null;

  // Map<actorId, { fingerprint: Map<eventType, normalizedWeight>, capturedAt, label? }>
  const fingerprintStore = new Map();

  function _appendAudit(entry) {
    if (!auditLog) return;
    if (typeof auditLog.append === 'function') auditLog.append(entry);
  }

  function _buildFreqVector(events) {
    const counts = new Map();
    let total = 0;
    for (const evt of events) {
      const t = evt.type || 'unknown';
      counts.set(t, (counts.get(t) || 0) + 1);
      total++;
    }
    if (total === 0) return new Map();
    const normalized = new Map();
    for (const [type, count] of counts) {
      normalized.set(type, count / total);
    }
    return normalized;
  }

  function _cosineSimilarity(vecA, vecB) {
    // Collect all dimensions
    const allKeys = new Set([...vecA.keys(), ...vecB.keys()]);
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (const k of allKeys) {
      const a = vecA.get(k) || 0;
      const b = vecB.get(k) || 0;
      dot   += a * b;
      normA += a * a;
      normB += b * b;
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  function _vectorToObject(vec) {
    const obj = {};
    for (const [k, v] of vec) obj[k] = v;
    return obj;
  }

  /**
   * computeFingerprint399(actorId, opts?)
   * Reads the live audit log to build a normalised event-type frequency vector
   * for the given actor, then stores it.
   *
   * opts.sinceTs  — only include events at or after this timestamp
   * opts.label    — human label for this fingerprint version
   * opts.snapshot — append audit event
   *
   * Returns { actorId, fingerprint{}, capturedAt, eventCount, version }
   */
  function computeFingerprint399(actorId, opts = {}) {
    if (!actorId || typeof actorId !== 'string') throw new Error('INVALID_ACTOR_ID');
    const now = Date.now();

    // Read events from auditLog if available
    let events = [];
    if (auditLog && typeof auditLog.getEntries === 'function') {
      events = auditLog.getEntries();
    } else if (auditLog && Array.isArray(auditLog._log)) {
      events = auditLog._log;
    }

    // Filter by actorId and optional sinceTs
    const sinceTs = typeof opts.sinceTs === 'number' ? opts.sinceTs : 0;
    const actorEvents = events.filter(e => {
      const ts = e.ts || e.timestamp || 0;
      if (ts < sinceTs) return false;
      const a = (e.data && (e.data.actorId || e.data.actor)) || e.actorId || e.actor;
      return a === actorId;
    });

    const vec = _buildFreqVector(actorEvents);
    const fingerprint = _vectorToObject(vec);

    fingerprintStore.set(actorId, {
      fingerprint: vec,
      capturedAt: now,
      label: opts.label || null,
      eventCount: actorEvents.length,
    });

    const result = {
      actorId,
      fingerprint,
      capturedAt: now,
      eventCount: actorEvents.length,
      label: opts.label || null,
      version: IDENTITY_FINGERPRINT_REGISTRY_VERSION_399,
    };

    if (opts.snapshot === true) {
      _appendAudit({ type: EVT_FINGERPRINT_399, ts: now, data: { actorId, eventCount: actorEvents.length, action: 'compute' } });
    }

    return result;
  }

  /**
   * getFingerprint399(actorId)
   * Returns the stored fingerprint for the actor, or throws FINGERPRINT_NOT_FOUND.
   */
  function getFingerprint399(actorId) {
    if (!actorId || typeof actorId !== 'string') throw new Error('INVALID_ACTOR_ID');
    if (!fingerprintStore.has(actorId)) throw new Error('FINGERPRINT_NOT_FOUND');
    const stored = fingerprintStore.get(actorId);
    return {
      actorId,
      fingerprint: _vectorToObject(stored.fingerprint),
      capturedAt: stored.capturedAt,
      eventCount: stored.eventCount,
      label: stored.label,
      version: IDENTITY_FINGERPRINT_REGISTRY_VERSION_399,
    };
  }

  /**
   * compareFingerprints399(actorIdA, actorIdB)
   * Computes cosine similarity (0–1) between two stored fingerprints.
   * Throws FINGERPRINT_NOT_FOUND if either actor has no stored fingerprint.
   */
  function compareFingerprints399(actorIdA, actorIdB) {
    if (!actorIdA || typeof actorIdA !== 'string') throw new Error('INVALID_ACTOR_ID');
    if (!actorIdB || typeof actorIdB !== 'string') throw new Error('INVALID_ACTOR_ID');
    if (!fingerprintStore.has(actorIdA)) throw new Error('FINGERPRINT_NOT_FOUND');
    if (!fingerprintStore.has(actorIdB)) throw new Error('FINGERPRINT_NOT_FOUND');

    const vecA = fingerprintStore.get(actorIdA).fingerprint;
    const vecB = fingerprintStore.get(actorIdB).fingerprint;
    const similarity = _cosineSimilarity(vecA, vecB);

    return {
      actorIdA,
      actorIdB,
      similarity: Math.round(similarity * 10000) / 10000,
      comparedAt: Date.now(),
      version: IDENTITY_FINGERPRINT_REGISTRY_VERSION_399,
    };
  }

  /**
   * listFingerprints399(opts?)
   * Lists all stored fingerprints.
   * opts.minEventCount — filter actors below this event count
   */
  function listFingerprints399(opts = {}) {
    const minEventCount = typeof opts.minEventCount === 'number' ? opts.minEventCount : 0;
    const actors = [];
    for (const [actorId, stored] of fingerprintStore) {
      if (stored.eventCount < minEventCount) continue;
      actors.push({
        actorId,
        capturedAt: stored.capturedAt,
        eventCount: stored.eventCount,
        label: stored.label,
        dimensionCount: stored.fingerprint.size,
        fingerprint: _vectorToObject(stored.fingerprint),
      });
    }
    actors.sort((a, b) => b.eventCount - a.eventCount);
    return {
      totalActors: actors.length,
      actors,
      generatedAt: Date.now(),
      version: IDENTITY_FINGERPRINT_REGISTRY_VERSION_399,
    };
  }

  /**
   * clearFingerprint399(actorId)
   * Admin: remove stored fingerprint for actor. Throws FINGERPRINT_NOT_FOUND if absent.
   */
  function clearFingerprint399(actorId) {
    if (!actorId || typeof actorId !== 'string') throw new Error('INVALID_ACTOR_ID');
    if (!fingerprintStore.has(actorId)) throw new Error('FINGERPRINT_NOT_FOUND');
    fingerprintStore.delete(actorId);
    return { actorId, cleared: true, ts: Date.now(), version: IDENTITY_FINGERPRINT_REGISTRY_VERSION_399 };
  }

  return {
    computeFingerprint399,
    getFingerprint399,
    compareFingerprints399,
    listFingerprints399,
    clearFingerprint399,
    IDENTITY_FINGERPRINT_REGISTRY_VERSION_399,
    EVT_FINGERPRINT_399,
  };
}

module.exports = {
  createIdentityFingerprintRegistry399,
  IDENTITY_FINGERPRINT_REGISTRY_VERSION_399,
  EVT_FINGERPRINT_399,
};
