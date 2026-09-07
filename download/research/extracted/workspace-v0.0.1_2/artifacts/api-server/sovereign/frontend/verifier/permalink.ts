/**
 * frontend/verifier/permalink.ts — Compute a stable permalink slug.
 *
 * The slug is derived from the raw pasted string (before parsing) so the same
 * content always produces the same URL, regardless of whitespace normalization.
 *
 * Output: 12 lowercase hex characters — URL-safe, collision-resistant enough
 * for a display link (SHA-1 truncated, same approach as the audit engine).
 *
 * Node.js only (uses node:crypto). The browser build would substitute
 * SubtleCrypto behind the same interface; that swap is outside this module.
 */

import crypto from "crypto";

/**
 * computePermalinkSlug — SHA-1 of the trimmed input, first 12 hex chars.
 *
 * Efficiency: one hash pass, no intermediate allocations beyond the digest buffer.
 */
export function computePermalinkSlug(rawInput: string): string {
  return crypto
    .createHash("sha1")
    .update(rawInput.trim(), "utf8")
    .digest("hex")
    .slice(0, 12);
}
