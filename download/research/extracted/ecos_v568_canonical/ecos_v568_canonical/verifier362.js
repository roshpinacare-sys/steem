'use strict';
/**
 * verifier362.js — ECOS V362 portable external-attestation verifier.
 *
 * Single-file, zero-dependency (only Node's built-in `crypto`). Drop this
 * file into any Node 18+ project to independently verify an attestation
 * envelope emitted by `GET /api/v1/integrity/export` (V361/V362).
 *
 * Usage:
 *   const { verifyEnvelope362 } = require('./verifier362.js');
 *   const r = verifyEnvelope362(envelope);
 *   if (!r.valid) throw new Error('attestation invalid: ' + r.reason);
 *   if (r.envelope.failClosed) throw new Error('compromised');
 *
 * CLI:
 *   node verifier362.js path/to/envelope.json
 *   cat envelope.json | node verifier362.js -
 *
 * What it checks (per V361 verification recipe):
 *   1. Strips `envelopeHash`, canonicalises remainder (sorted keys, UTF-8).
 *   2. Recomputes sha256 hex and compares with the supplied `envelopeHash`.
 *   3. Reports `failClosed` / `overallIntegrity === 'compromised'` so the
 *      caller halts any economic action that depended on the envelope.
 *
 * What it does NOT do:
 *   - It does NOT re-execute the V360 internal proof (that requires the
 *     ledger + audit chain). It verifies that the envelope was not tampered
 *     in transit and surfaces the verdict the issuer recorded.
 *
 * @version 362.0.0
 */

const crypto = require('crypto');

const VERIFIER_VERSION_362 = '362.0.0';
const ACCEPTED_SCHEMAS_362 = Object.freeze(['ecos.integrity.attestation/v361']);

function _stableStringify362(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(_stableStringify362).join(',') + ']';
  const keys = Object.keys(value).sort();
  const parts = keys.map(function (k) { return JSON.stringify(k) + ':' + _stableStringify362(value[k]); });
  return '{' + parts.join(',') + '}';
}

function _sha256Hex362(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Verify a V361/V362 attestation envelope.
 *
 * @param {object} envelope - parsed JSON envelope.
 * @returns {{valid:boolean, reason:string, envelope:object,
 *            expectedEnvelopeHash:string, providedEnvelopeHash:string|null,
 *            schemaAccepted:boolean, compromised:boolean,
 *            verifierVersion:string}}
 */
function verifyEnvelope362(envelope) {
  const base = {
    valid: false,
    reason: '',
    envelope: envelope || null,
    expectedEnvelopeHash: null,
    providedEnvelopeHash: null,
    schemaAccepted: false,
    compromised: false,
    verifierVersion: VERIFIER_VERSION_362,
  };
  if (!envelope || typeof envelope !== 'object') {
    base.reason = 'envelope must be a JSON object';
    return base;
  }
  base.providedEnvelopeHash = envelope.envelopeHash || null;
  if (!base.providedEnvelopeHash || typeof base.providedEnvelopeHash !== 'string') {
    base.reason = 'envelope.envelopeHash is missing';
    return base;
  }
  base.schemaAccepted = ACCEPTED_SCHEMAS_362.indexOf(envelope.schema) !== -1;
  if (!base.schemaAccepted) {
    base.reason = 'unsupported envelope.schema: ' + envelope.schema;
    return base;
  }
  // Strip envelopeHash, canonicalise, recompute.
  const clone = Object.assign({}, envelope);
  delete clone.envelopeHash;
  const canonical = _stableStringify362(clone);
  base.expectedEnvelopeHash = _sha256Hex362(canonical);
  if (base.expectedEnvelopeHash !== base.providedEnvelopeHash) {
    base.reason = 'envelopeHash mismatch — envelope tampered in transit';
    return base;
  }
  base.compromised = (envelope.failClosed === true) || (envelope.overallIntegrity === 'compromised');
  base.valid = true;
  base.reason = base.compromised
    ? 'signature valid, but issuer reports compromised — halt'
    : 'signature valid, integrity ' + (envelope.overallIntegrity || 'unknown');
  return base;
}

module.exports = {
  VERIFIER_VERSION_362,
  ACCEPTED_SCHEMAS_362,
  verifyEnvelope362,
  _stableStringify362,
  _sha256Hex362,
};

// ── CLI ───────────────────────────────────────────────────────────────────
if (require.main === module) {
  (async function () {
    const fs = require('fs');
    const arg = process.argv[2];
    if (!arg) {
      process.stderr.write('usage: node verifier362.js <envelope.json | ->\n');
      process.exit(2);
    }
    let raw;
    try {
      raw = (arg === '-')
        ? fs.readFileSync(0, 'utf8')
        : fs.readFileSync(arg, 'utf8');
    } catch (e) { process.stderr.write('read failed: ' + e.message + '\n'); process.exit(2); }
    let env;
    try { env = JSON.parse(raw); if (env && env.envelope && !env.envelopeHash) env = env.envelope; }
    catch (e) { process.stderr.write('parse failed: ' + e.message + '\n'); process.exit(2); }
    const r = verifyEnvelope362(env);
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    process.exit(r.valid && !r.compromised ? 0 : 1);
  })();
}
