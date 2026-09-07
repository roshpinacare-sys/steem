// @tfa/passport-client — TypeScript declarations.
// Zero external dependencies. These types are self-contained (no imports
// from the TFA kernel) so the package can be published standalone.

/** Result of a single verification check. */
export interface CheckResult {
  name: string;
  status: "pass" | "fail" | "skipped";
  message?: string;
}

/** Overall verification result. */
export interface VerifyResult {
  ok: boolean;
  checks: CheckResult[];
}

/** Keys supplied to verify signatures (verify-what-you-can). */
export interface VerifyKeys {
  hmacSecret?: Buffer | string;
  publicKey?: string;
  auditHmacSecret?: Buffer | string;
  auditPublicKey?: string;
}

/** Options for strict mode. */
export interface VerifyOptions {
  strict?: boolean;
}

/**
 * Verify an ActionPassport.
 * @param passport - Parsed passport JSON.
 * @param keys - Optional signature verification keys.
 * @param opts - Optional strict mode flag.
 * @returns Verification result with per-check details.
 */
export function verifyPassport(
  passport: unknown,
  keys?: VerifyKeys,
  opts?: VerifyOptions,
): VerifyResult;

/**
 * Canonical JSON stringifier — matches lib/passport/passport.ts exactly.
 * Object keys sorted, arrays preserve order, primitives via JSON.stringify.
 */
export function canonicalStringify(value: unknown): string;
