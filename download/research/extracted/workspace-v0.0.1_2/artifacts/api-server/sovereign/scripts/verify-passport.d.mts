/**
 * scripts/verify-passport.d.mts — type declarations for the standalone verifier (verify-passport.mjs).
 * The verifier stays plain .mjs ON PURPOSE: it must run anywhere with `node verify-passport.mjs`
 * (no TS, no build) — that is the product promise. This .d.mts gives the TS kernel
 * (lib/passport-client) typed access without changing the runtime file.
 */
export interface VerifyKeys {
  hmacSecret?: string;
  publicKeyPem?: string;
  auditHmacSecret?: string;
  auditPublicKeyPem?: string;
}
export interface VerifyResult {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; detail?: string }>;
  errors: string[];
}
export function canonicalStringify(value: unknown): string;
export function verifyPassport(passport: unknown, keys?: VerifyKeys, opts?: Record<string, unknown>): VerifyResult;
