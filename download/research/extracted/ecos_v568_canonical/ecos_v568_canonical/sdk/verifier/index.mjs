/**
 * @ecos/verifier — ESM entry
 * @version 374.0.0
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const cjs = require('./index.cjs');

export const verifyPortableProof        = cjs.verifyPortableProof;
export const verifyPortableProof373     = cjs.verifyPortableProof373;
export const VERIFIER_SDK_VERSION_373   = cjs.VERIFIER_SDK_VERSION_373;
export const ACCEPTED_SCHEMAS_373       = cjs.ACCEPTED_SCHEMAS_373;
export const SDK_VERSION_374            = cjs.SDK_VERSION_374;
export const _sha256Hex373              = cjs._sha256Hex373;
export const _canon373                  = cjs._canon373;
export default cjs;
