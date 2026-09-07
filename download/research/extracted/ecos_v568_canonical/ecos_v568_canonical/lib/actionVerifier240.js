'use strict';
/**
 * src/lib/actionVerifier240.js — ECOS V240 (Phase P136 / Urgent Remediation #4)
 *
 * Post-action verification: implements the report's "Post-Action Verification"
 * to defeat Silent Failure / Action Hallucination ("ok:true but nothing happened").
 * A tool result is only trusted once a *physical* check confirms the effect.
 * Pure + dependency-free except Node builtins (fs/crypto); version-suffixed.
 *
 * Verify spec types:
 *   { type:'file_exists', path }
 *   { type:'file_min_size', path, minBytes }
 *   { type:'value_present', value }           // truthy / non-empty
 *   { type:'md5_equals', path, md5 }
 *   { type:'custom', check: () => boolean }    // server-internal only
 *
 * @version 240.0.0
 */

const fs = require('fs');
const crypto = require('crypto');

class VerifySpecError240 extends Error {
  constructor(msg) { super(msg); this.name = 'VerifySpecError240'; this.code = 'VERIFY_SPEC'; this.statusCode = 400; }
}

/**
 * Run one verification spec. Returns a structured result; never throws on a
 * failed *check* (only on a malformed spec).
 * @returns {{ verified:boolean, type:string, detail:string }}
 */
function verifyAction240(spec) {
  if (!spec || typeof spec !== 'object' || !spec.type) throw new VerifySpecError240('spec.type is required');
  switch (spec.type) {
    case 'file_exists': {
      if (!spec.path) throw new VerifySpecError240('file_exists requires path');
      const ok = fs.existsSync(spec.path);
      return { verified: ok, type: spec.type, detail: ok ? 'exists' : 'missing: ' + spec.path };
    }
    case 'file_min_size': {
      if (!spec.path) throw new VerifySpecError240('file_min_size requires path');
      const min = Number(spec.minBytes) || 1;
      let size = -1; try { size = fs.statSync(spec.path).size; } catch (_) {}
      const ok = size >= min;
      return { verified: ok, type: spec.type, detail: `size=${size} min=${min}` };
    }
    case 'value_present': {
      const v = spec.value;
      const ok = !(v == null || v === '' || (Array.isArray(v) && v.length === 0));
      return { verified: ok, type: spec.type, detail: ok ? 'present' : 'empty/null' };
    }
    case 'md5_equals': {
      if (!spec.path || !spec.md5) throw new VerifySpecError240('md5_equals requires path and md5');
      let got = null; try { got = crypto.createHash('md5').update(fs.readFileSync(spec.path)).digest('hex'); } catch (_) {}
      const ok = got === spec.md5;
      return { verified: ok, type: spec.type, detail: `got=${got} want=${spec.md5}` };
    }
    case 'custom': {
      if (typeof spec.check !== 'function') throw new VerifySpecError240('custom requires a check() function');
      const ok = !!spec.check();
      return { verified: ok, type: spec.type, detail: ok ? 'custom ok' : 'custom failed' };
    }
    default:
      throw new VerifySpecError240('unknown verify type: ' + spec.type);
  }
}

/**
 * Detect a silent failure: the tool claims success but the physical verify fails.
 * @param {{ok?:boolean}} toolResult
 * @param {object} spec
 * @returns {{ silentFailure:boolean, claimedOk:boolean, verified:boolean, detail:string }}
 */
function assertNotSilentFailure240(toolResult, spec) {
  const claimedOk = !!(toolResult && toolResult.ok);
  const v = verifyAction240(spec);
  return {
    silentFailure: claimedOk && !v.verified,
    claimedOk,
    verified: v.verified,
    type: v.type,
    detail: v.detail,
  };
}

module.exports = { verifyAction240, assertNotSilentFailure240, VerifySpecError240 };
