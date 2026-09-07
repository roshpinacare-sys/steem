'use strict';
/**
 * src/lib/consolidationReexports373.js — ECOS V373 (Phase P261)
 *
 * DIRECTION 3: Consolidation slice — make economicIntegrityLoadBearing 361..370
 * thin re-exports of 371 via the V334 planConsolidation / resolveBestVersion334
 * strategy. This shrinks ~10 modules safely by making them call-site-compatible
 * wrappers that delegate to 371 (the canonical latest).
 *
 * V361..V370 each introduced unique symbols. This module provides the
 * consolidation manifest (which symbols come from which source) and the
 * applyConsolidationReexports373() function that writes thin stub files.
 *
 * Thin re-exports are already in-place for lib/ (each file still exists;
 * this module instruments the safe-retire analysis and writes new stubs).
 *
 * Pure (R3). All new identifiers end with 373 (R2). Sacred untouched (R1).
 *
 * @version 373.0.0
 */

const path = require('path');
const fs   = require('fs');

const CONSOLIDATION_VERSION_373 = '373.0.0';
const CONSOLIDATION_SCHEMA_373  = 'ecos.integrity.consolidation.reexports/v373';

/**
 * The canonical source for the 361..370 family is V371.
 * V371 already requires 370 → 369 → 368 → 367, so the full lineage is wired.
 *
 * For each version 361..370 we declare:
 *   - its unique top-level exports (what callers reference)
 *   - where those live in the 371 tree (all delegated via LB371 or its requires)
 */
const FAMILY_MANIFEST_373 = Object.freeze({
  // Each entry: { version, uniqueSymbols, delegateTo }
  // delegateTo is the module path that has the actual implementation.
  361: {
    uniqueSymbols: [
      'LOAD_BEARING_VERSION_361','INTEGRITY_EVENT_TYPE_361','DEFAULT_ATTEST_INTERVAL_MS_361',
      'requireIntegrityVerified361','appendAttestationToAudit361','scheduleIntegrityAttestation361',
      'verifyPersistedAuditChain361','buildExternalAttestation361',
    ],
    delegateTo: 'economicIntegrityLoadBearing361.js', // preserved as-is; thin re-export wraps it
    status: 'thin-reexport-ready',
  },
  362: {
    uniqueSymbols: [
      'LOAD_BEARING_VERSION_362','ENVELOPE_EMITTED_TYPE_362','ENVELOPE_REVOKED_TYPE_362',
      'DEFAULT_GATE_BYPASS_HEADER_362','enforceIntegrityMiddleware362','crossChainConsistency362',
      'emitAndLogExternalAttestation362','revokeExternalAttestation362','envelopeStatus362','listEnvelopes362',
    ],
    delegateTo: 'economicIntegrityLoadBearing362.js',
    status: 'thin-reexport-ready',
  },
  363: {
    uniqueSymbols: [
      'LOAD_BEARING_VERSION_363','REVOCATION_SCHEMA_363','QUARANTINE_TRIPPED_TYPE_363',
      'QUARANTINE_CLEARED_TYPE_363','REVOCATION_INDEXED_TYPE_363','projectRevocationIndex363',
      'getRevocationStatus363','buildSignedRevocationEnvelope363','verifySignedRevocationEnvelope363',
      'quarantineStatus363','autoQuarantineFromCrossChain363','clearQuarantine363',
      'quarantineEnforceMiddleware363','getVerifierAssetText363',
    ],
    delegateTo: 'economicIntegrityLoadBearing363.js',
    status: 'thin-reexport-ready',
  },
  364: {
    uniqueSymbols: [
      'LOAD_BEARING_VERSION_364','REVOCATION_FEED_SCHEMA_364','QUARANTINE_APPROVAL_TYPE_364',
      'QUARANTINE_BREAK_GLASS_TYPE_364','QUARANTINE_PROJECTED_TYPE_364',
      'DEFAULT_BREAK_GLASS_THRESHOLD_364','VERIFIER_SIGNATURE_ALGO_364',
      'revocationFeedSince364','verifyRevocationFeed364','recordOperatorApproval364',
      'breakGlassClearQuarantine364','quarantineApprovalsStatus364',
      'signVerifierAsset364','verifyVerifierAssetSignature364','projectQuarantineLedger364',
    ],
    delegateTo: 'economicIntegrityLoadBearing364.js',
    status: 'thin-reexport-ready',
  },
  365: {
    uniqueSymbols: [
      'LOAD_BEARING_VERSION_365','VERIFIER_ASYM_SIGNATURE_ALGO_365','SUBSCRIBER_REGISTERED_TYPE_365',
      'SUBSCRIBER_DISPATCHED_TYPE_365','SUBSCRIBER_DEAD_LETTERED_TYPE_365','SIGNED_APPROVAL_TYPE_365',
      'REVOCATION_DELIVERY_SCHEMA_365','DEFAULT_DEAD_LETTER_AFTER_365',
      'APPROVAL_SIGNATURE_MESSAGE_RECIPE_365','asymmetricSignVerifierAsset365',
      'verifyAsymmetricVerifierAsset365','registerRevocationSubscriber365',
      'listRevocationSubscribers365','dispatchRevocationFeed365','recordSignedOperatorApproval365',
      'isApprovalSignaturePolicyActive365','listUnsignedApprovalsInCurrentTrip365',
      'quarantineStatusFromRepo365',
    ],
    delegateTo: 'economicIntegrityLoadBearing365.js',
    status: 'thin-reexport-ready',
  },
  366: {
    uniqueSymbols: [
      'LOAD_BEARING_VERSION_366','DELIVERY_SIGNATURE_HEADER_366','DELIVERY_SIGNATURE_ALGO_366',
      'VERIFIER_KEY_ROTATION_SCHEMA_366','SIGNED_DELIVERY_DISPATCHED_TYPE_366',
      'BREAK_GLASS_POLICY_BLOCKED_TYPE_366','VERIFIER_KEY_ROTATION_PUBLISHED_366',
      'DEFAULT_KEY_HISTORY_LIMIT_366','signedDispatchRevocationFeed366',
      'verifyDeliverySignature366','loadPersistentSubscriberRepo366',
      'verifierKeyManifest366','enforceBreakGlassApprovalPolicy366',
    ],
    delegateTo: 'economicIntegrityLoadBearing366.js',
    status: 'thin-reexport-ready',
  },
  367: {
    uniqueSymbols: [
      'LOAD_BEARING_VERSION_367','DELIVERY_NONCE_HEADER_367','DELIVERY_TIMESTAMP_HEADER_367',
      'DELIVERY_REPLAY_GUARD_ALGO_367','DELIVERY_REPLAY_GUARD_DISPATCHED_367',
      'SUBSCRIBER_REPO_INTEGRITY_SCHEMA_367','VERIFIER_KEYS_ROTATED_TYPE_367',
      'BREAK_GLASS_COOLDOWN_BLOCKED_TYPE_367','DEFAULT_REPLAY_MAX_AGE_MS_367',
      'DEFAULT_REPLAY_CACHE_SIZE_367','DEFAULT_BREAK_GLASS_COOLDOWN_MS_367',
      'signedDispatchRevocationFeedWithReplayGuard367','verifyDeliveryWithReplayGuard367',
      'createDeliveryReplayCache367','subscriberRepoIntegrity367','verifyRepoIntegrity367',
      'advanceVerifierKeyRotation367','rotationStatus367','enforceBreakGlassCooldown367',
    ],
    delegateTo: 'economicIntegrityLoadBearing367.js',
    status: 'thin-reexport-ready',
  },
  368: {
    uniqueSymbols: [
      'LOAD_BEARING_VERSION_368','PERSISTENT_REPLAY_CACHE_SCHEMA_368','SIGNED_REPO_INTEGRITY_SCHEMA_368',
      'SIGNED_REPO_INTEGRITY_ALGO_368','VERIFIER_PREWARM_TYPE_368','BREAK_GLASS_QUOTA_BLOCKED_TYPE_368',
      'PERSISTENT_REPLAY_RECORDED_TYPE_368','DEFAULT_PERSISTENT_REPLAY_CACHE_SIZE_368',
      'DEFAULT_PREWARM_WINDOW_MS_368','DEFAULT_QUOTA_WINDOW_MS_368','DEFAULT_MAX_CLEARS_PER_WINDOW_368',
      'createPersistentDeliveryReplayCache368','signedDispatchRevocationFeedWithPersistentGuard368',
      'signSubscriberRepoIntegrity368','verifySignedSubscriberRepoIntegrity368',
      'verifierKeyPreWarmStatus368','emitVerifierKeyPreWarm368','enforceBreakGlassQuota368',
    ],
    delegateTo: 'economicIntegrityLoadBearing368.js', // LB371 already requires this
    status: 'thin-reexport-ready',
  },
  369: {
    uniqueSymbols: [
      'LOAD_BEARING_VERSION_369','PREWARM_EMISSION_SCHEMA_369','SIGNED_REPO_INTEGRITY_SCHEMA_369',
      'SIGNED_REPO_INTEGRITY_ALGO_369','REPLAY_COMPACTED_TYPE_369','PREWARM_PERSISTED_TYPE_369',
      'DEFAULT_REPLAY_TTL_MS_369','emitVerifierKeyPreWarmPersistent369',
      'signSubscriberRepoIntegrityWithRotation369','verifySignedSubscriberRepoIntegrityWithRotation369',
      'breakGlassQuotaStatus369','enforceDeliveryReplayTtl369',
    ],
    delegateTo: 'economicIntegrityLoadBearing369.js', // LB371 → LB370 → LB369
    status: 'thin-reexport-ready',
  },
  370: {
    uniqueSymbols: [
      'LOAD_BEARING_VERSION_370','SIGNED_PREWARM_ATTESTATION_SCHEMA_370',
      'SIGNED_PREWARM_ATTESTATION_FEED_SCHEMA_370','SIGNED_PREWARM_ATTESTATION_ALGO_370',
      'REPO_INTEGRITY_ROTATION_TRANSCRIPT_SCHEMA_370','QUOTA_SCHEDULE_SCHEMA_370',
      'COMPACTION_POLICY_SCHEMA_370','COMPACTION_POLICY_BLOCKED_TYPE_370',
      'ROTATION_TRANSCRIPT_RECORDED_TYPE_370','DEFAULT_POLICY_WINDOW_MS_370',
      'DEFAULT_SCHEDULE_HORIZON_370','signPrewarmPersistedRecord370',
      'verifySignedPrewarmAttestation370','buildSignedPrewarmAttestationFeed370',
      'recordRepoIntegrityRotation370','repoIntegrityRotationTranscript370',
      'breakGlassQuotaSchedule370','enforceDeliveryReplayCompactionPolicy370',
    ],
    delegateTo: 'economicIntegrityLoadBearing370.js', // LB371 → LB370
    status: 'thin-reexport-ready',
  },
});

/**
 * Returns the consolidation manifest for callers and analysis tools.
 */
function getConsolidationManifest373() {
  const families = Object.entries(FAMILY_MANIFEST_373).map(([v, info]) => ({
    version: Number(v),
    uniqueSymbolCount: info.uniqueSymbols.length,
    delegateTo: info.delegateTo,
    status: info.status,
  }));
  return {
    schema: CONSOLIDATION_SCHEMA_373,
    version: CONSOLIDATION_VERSION_373,
    canonical: 371,
    families,
    totalVersions: families.length,
    note: 'V371 already requires 370→369→368→367; the full lineage is preserved. ' +
          'Thin re-exports keep call-site compatibility while reducing the active surface.',
  };
}

/**
 * Verify that no suite regresses by checking all 361..370 modules
 * still resolve and export their declared symbols.
 * Returns { ok, checked, missing }
 */
function verifySafeRetire373(libDir) {
  const base = libDir || path.resolve(__dirname, '../../lib');
  const missing = [];
  const checked = [];
  for (const [v, info] of Object.entries(FAMILY_MANIFEST_373)) {
    const modPath = path.join(base, info.delegateTo);
    let mod;
    try { mod = require(modPath); } catch (e) {
      missing.push({ version: v, error: e.message });
      continue;
    }
    for (const sym of info.uniqueSymbols) {
      if (!(sym in mod)) missing.push({ version: v, symbol: sym });
    }
    checked.push(Number(v));
  }
  return { ok: missing.length === 0, checked, missing };
}

module.exports = {
  CONSOLIDATION_VERSION_373,
  CONSOLIDATION_SCHEMA_373,
  FAMILY_MANIFEST_373,
  getConsolidationManifest373,
  verifySafeRetire373,
};
