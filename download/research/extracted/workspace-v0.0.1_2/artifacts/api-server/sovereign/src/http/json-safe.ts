/**
 * src/http/json-safe.ts — BigInt-safe JSON serialization helper for HTTP adapters.
 *
 * The sovereign kernel uses BigInt μ¢ for all money fields. JSON.stringify throws
 * on BigInt by default, so every HTTP adapter (Node http, Express, future others)
 * must run response bodies through this helper before emitting JSON.
 *
 * v28 (B.6.3): now also carries the inline `passport` field added to ledger
 * mint/withdraw/transfer responses. The passport's `ledgerEffect.amount` is
 * the only BigInt inside the passport itself, but the kernel already
 * pre-stringifies it (see lib/passport/passport.ts), so this helper is a
 * defensive net for any future BigInt that lands inside a response body.
 *
 * Pure, zero-dep, deterministic. Same input → same output (no Date.now etc.).
 */
export function bigIntSafe<T = unknown>(body: T): unknown {
  return JSON.parse(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}