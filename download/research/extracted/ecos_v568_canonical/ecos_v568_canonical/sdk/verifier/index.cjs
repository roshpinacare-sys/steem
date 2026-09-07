'use strict';
/**
 * @ecos/verifier — CJS entry
 * Wraps verifier373.js for npm consumers.
 * @version 374.0.0
 */
const v373 = require('../../verifier373.js');
const {
  verifyPortableProof373,
  VERIFIER_SDK_VERSION_373,
  ACCEPTED_SCHEMAS_373,
  _sha256Hex373,
  _canon373,
} = v373;

/** Convenience alias — verifyPortableProof373 is the canonical export. */
const verifyPortableProof = verifyPortableProof373;

const SDK_VERSION_374 = '374.0.0';

module.exports = {
  // Primary export
  verifyPortableProof,
  // V373 originals (backwards compat)
  verifyPortableProof373,
  VERIFIER_SDK_VERSION_373,
  ACCEPTED_SCHEMAS_373,
  SDK_VERSION_374,
  // Internal helpers (for custom hashFn/canonicalize override)
  _sha256Hex373,
  _canon373,
};
