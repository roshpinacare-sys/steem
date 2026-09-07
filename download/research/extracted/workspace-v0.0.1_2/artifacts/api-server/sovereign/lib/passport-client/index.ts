/**
 * lib/passport-client/index.ts — barrel export for the external Passport SDK.
 */

export { fetchPassport, fetchPublicKey, verifyPassport, canonicalStringify } from "./passport-client.ts";
export { PassportClientError } from "./types.ts";
export type {
  PassportVerifyKeys,
  FetchPassportOptions,
  FetchPassportResult,
  FetchPublicKeyResult,
  VerifyPassportResult,
  PassportClientErrorCode,
} from "./types.ts";
