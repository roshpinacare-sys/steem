'use strict';
/**
 * src/lib/sovereignCredentials400.js — ECOS V400 (Phase P288) — Sovereign Credentials
 *
 * THE V400 MILESTONE (chosen from the research, critically filtered):
 *   The research proposed a full re-platform to Arweave/AO. That is a multi-month
 *   rewrite that would shatter a stable foundation two weeks before the pilot — and
 *   the research itself scopes AO to "Mirror Mode (V400–V410): anchor hashes only."
 *   The REAL, grounded, applicable-now thread is its #1 identity recommendation:
 *   W3C **DIDs + Verifiable Credentials** on top of the existing key-derived identity.
 *
 * This turns a V391 ed25519 identity into a globally-interoperable sovereign identity:
 *   • toDidKey400        — a standards-compliant `did:key:z6Mk…` (multicodec ed25519
 *     + base58btc multibase) derived from the SAME key V391 already uses.
 *   • didDocument400     — the resolvable DID document (verificationMethod/auth).
 *   • issueCredential400 — a W3C Verifiable Credential signed with ed25519 (so a
 *     user's reputation/rank/credit-standing becomes a portable, signed claim).
 *   • verifyCredential400 — INDEPENDENT verification: recompute the canonical form,
 *     verify the signature against the issuer's did:key. No ECOS trust required
 *     (same philosophy as the V372 portable proof).
 *   • presentSelectively400 — honest selective disclosure: each subject field is
 *     individually signed at issue time, so the holder can present only chosen fields
 *     with still-valid per-field proofs (privacy / data-minimisation).
 *
 * Pure JS, Node built-in crypto only (ed25519 + sha256) — NO new npm deps (R3/R6).
 * Version-suffixed (…400). Read-only over sacred.
 *
 * @version 400.0.0
 */

const crypto = require('crypto');

const SC_VERSION_400 = '400.0.0';
const ED25519_MULTICODEC_400 = Buffer.from([0xed, 0x01]); // multicodec prefix for ed25519-pub
const VC_CONTEXT_400 = ['https://www.w3.org/ns/credentials/v2', 'https://ecos.dev/credentials/v1'];

class CredentialError400 extends Error {
  constructor(msg, code) { super(msg); this.name = 'CredentialError400'; this.code = code || 'CREDENTIAL_ERROR'; this.statusCode = 400; }
}

// ── base58btc (Bitcoin alphabet) — small, pure, dependency-free ───────────────
const _B58_400 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function _b58encode400(buf) {
  let digits = [0];
  for (let i = 0; i < buf.length; i++) {
    let carry = buf[i];
    for (let j = 0; j < digits.length; j++) { carry += digits[j] << 8; digits[j] = carry % 58; carry = (carry / 58) | 0; }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let str = '';
  for (let k = 0; k < buf.length && buf[k] === 0; k++) str += '1';        // leading zero bytes
  for (let q = digits.length - 1; q >= 0; q--) str += _B58_400[digits[q]];
  return str;
}
function _b58decode400(str) {
  let bytes = [0];
  for (let i = 0; i < str.length; i++) {
    const val = _B58_400.indexOf(str[i]);
    if (val < 0) throw new CredentialError400('bad base58 char', 'BAD_B58');
    let carry = val;
    for (let j = 0; j < bytes.length; j++) { carry += bytes[j] * 58; bytes[j] = carry & 0xff; carry >>= 8; }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (let k = 0; k < str.length && str[k] === '1'; k++) bytes.push(0);
  return Buffer.from(bytes.reverse());
}

// ── canonical JSON (stable key order) ─────────────────────────────────────────
function _canon400(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(_canon400).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + _canon400(v[k])).join(',') + '}';
}
const _sha256hex = (b) => crypto.createHash('sha256').update(b).digest('hex');
function _rawPubFromKeyObject(pub) { return Buffer.from(pub.export({ format: 'jwk' }).x, 'base64url'); }
function _keyObjectFromRaw(rawHexOrBuf) {
  const raw = Buffer.isBuffer(rawHexOrBuf) ? rawHexOrBuf : Buffer.from(rawHexOrBuf, 'hex');
  return crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' });
}

/** Standards-compliant did:key from a raw ed25519 public key (multicodec + base58btc multibase). */
function toDidKey400(rawPubkey) {
  const raw = Buffer.isBuffer(rawPubkey) ? rawPubkey : Buffer.from(rawPubkey, 'hex');
  if (raw.length !== 32) throw new CredentialError400('ed25519 pubkey must be 32 bytes', 'BAD_PUBKEY');
  const mc = Buffer.concat([ED25519_MULTICODEC_400, raw]);
  return 'did:key:z' + _b58encode400(mc);
}
/** Recover the raw ed25519 public key from a did:key (for verification). */
function pubkeyFromDidKey400(did) {
  if (typeof did !== 'string' || !did.startsWith('did:key:z')) throw new CredentialError400('not a did:key', 'BAD_DID');
  const mc = _b58decode400(did.slice('did:key:z'.length));
  if (mc[0] !== 0xed || mc[1] !== 0x01) throw new CredentialError400('not an ed25519 did:key', 'BAD_DID_CODEC');
  return mc.slice(2);
}
/** Resolvable DID document for a did:key. */
function didDocument400(did) {
  const raw = pubkeyFromDidKey400(did);
  const vmId = did + '#' + did.slice('did:key:z'.length);
  return {
    '@context': ['https://www.w3.org/ns/did/v1'],
    id: did,
    verificationMethod: [{ id: vmId, type: 'Ed25519VerificationKey2020', controller: did, publicKeyMultibase: 'z' + _b58encode400(Buffer.concat([ED25519_MULTICODEC_400, raw])) }],
    authentication: [vmId], assertionMethod: [vmId],
  };
}

// ── Verifiable Credentials ────────────────────────────────────────────────────
function _signOver400(obj, privateKey) { return crypto.sign(null, Buffer.from(_canon400(obj), 'utf8'), privateKey).toString('hex'); }
function _verifyOver400(obj, sigHex, rawPub) {
  return crypto.verify(null, Buffer.from(_canon400(obj), 'utf8'), _keyObjectFromRaw(rawPub), Buffer.from(sigHex, 'hex'));
}

/**
 * Issue a W3C Verifiable Credential signed with the issuer's ed25519 key.
 * Each credentialSubject field is ALSO signed individually (fieldProofs) to enable
 * honest selective disclosure later.
 * @param {{ issuerDid, subjectDid, type?, claims:object, privateKey, issuanceDate? }} p
 */
function issueCredential400(p = {}) {
  if (!p.issuerDid || !p.subjectDid || !p.claims || !p.privateKey) throw new CredentialError400('issuerDid, subjectDid, claims, privateKey required', 'BAD_ARGS');
  const credentialSubject = Object.assign({ id: p.subjectDid }, p.claims);
  const vc = {
    '@context': VC_CONTEXT_400,
    type: ['VerifiableCredential'].concat(p.type ? [p.type] : []),
    issuer: p.issuerDid,
    issuanceDate: p.issuanceDate || new Date().toISOString(),
    credentialSubject,
  };
  // per-field proofs (over issuer|subject|field|value) → enable selective disclosure
  const fieldProofs = {};
  for (const k of Object.keys(p.claims)) {
    fieldProofs[k] = _signOver400({ iss: p.issuerDid, sub: p.subjectDid, k, v: p.claims[k] }, p.privateKey);
  }
  // top-level proof binds the whole credential
  const proofless = Object.assign({}, vc);
  vc.proof = {
    type: 'Ed25519Signature2020', created: vc.issuanceDate,
    verificationMethod: p.issuerDid + '#' + p.issuerDid.slice('did:key:z'.length),
    proofPurpose: 'assertionMethod',
    proofValue: _signOver400(proofless, p.privateKey),
    fieldProofs,
  };
  return vc;
}

/** Independently verify a VC: recompute canonical form, verify against the issuer did:key. */
function verifyCredential400(vc) {
  try {
    if (!vc || !vc.proof || !vc.issuer || !vc.credentialSubject) return { valid: false, reason: 'malformed credential' };
    const rawPub = pubkeyFromDidKey400(vc.issuer);
    const { proof, ...proofless } = vc;
    const ok = _verifyOver400(proofless, proof.proofValue, rawPub);
    return { valid: ok, issuer: vc.issuer, subject: vc.credentialSubject.id, reason: ok ? null : 'signature mismatch' };
  } catch (e) { return { valid: false, reason: e.message }; }
}

/**
 * Honest selective disclosure: produce a presentation revealing ONLY the chosen
 * fields, each with its still-valid per-field proof from the original VC.
 */
function presentSelectively400(vc, fields) {
  if (!vc || !vc.proof || !vc.proof.fieldProofs) throw new CredentialError400('vc has no field proofs', 'NO_FIELD_PROOFS');
  const disclosed = {}, proofs = {};
  for (const f of (fields || [])) {
    if (!(f in vc.credentialSubject)) throw new CredentialError400('unknown field: ' + f, 'UNKNOWN_FIELD');
    if (!(f in vc.proof.fieldProofs)) throw new CredentialError400('no proof for field: ' + f, 'NO_PROOF');
    disclosed[f] = vc.credentialSubject[f]; proofs[f] = vc.proof.fieldProofs[f];
  }
  return { issuer: vc.issuer, subject: vc.credentialSubject.id, disclosed, fieldProofs: proofs, type: 'SelectiveDisclosurePresentation' };
}
/** Verify a selective-disclosure presentation field-by-field against the issuer did:key. */
function verifyPresentation400(pres) {
  try {
    const rawPub = pubkeyFromDidKey400(pres.issuer);
    for (const k of Object.keys(pres.disclosed)) {
      const ok = _verifyOver400({ iss: pres.issuer, sub: pres.subject, k, v: pres.disclosed[k] }, pres.fieldProofs[k], rawPub);
      if (!ok) return { valid: false, reason: 'field proof failed: ' + k };
    }
    return { valid: true, issuer: pres.issuer, subject: pres.subject, fields: Object.keys(pres.disclosed) };
  } catch (e) { return { valid: false, reason: e.message }; }
}

module.exports = {
  SC_VERSION_400, VC_CONTEXT_400, CredentialError400,
  toDidKey400, pubkeyFromDidKey400, didDocument400,
  issueCredential400, verifyCredential400, presentSelectively400, verifyPresentation400,
  _b58encode400, _b58decode400, _canon400,
};
