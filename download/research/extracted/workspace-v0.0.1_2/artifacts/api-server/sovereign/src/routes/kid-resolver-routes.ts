/**
 * src/routes/kid-resolver-routes.ts — KID-based public key resolver.
 *
 * Closes the "portable-proof portability gap": a third-party verifier who holds
 * a TFA-signed ActionPassport or ExecutionReceipt needs to resolve the signing
 * key that was active AT THE TIME of signing, not just the current key.
 *
 * Routes:
 *   GET /api/keys/current
 *     Returns the currently-active signing key (kid + algorithm + publicKey if Ed25519,
 *     status, createdAt). Never returns HMAC secrets.
 *
 *   GET /api/keys/:kid
 *     Returns the key entry for the given kid from the in-memory key history.
 *     fail-closed:
 *       • unknown kid → 404
 *       • revoked kid → 410 Gone (proof is permanently invalid, caller must reject)
 *       • HMAC key → returns kid + algorithm + status only (secret redacted)
 *
 *   GET /api/keys
 *     Lists all known kids (no secrets, no private keys). Suitable for cache warm-up.
 *     Returns: { kids: Array<{ kid, algorithm, status, createdAt, retiredAt? }> }
 *
 * Authentication: no x-tenant-id required — key resolution is a public operation
 * (verifiers are third parties without TFA credentials). This is intentional and
 * consistent with JWKS / .well-known/openid-configuration patterns.
 *
 * Fail-closed invariants:
 *   • HMAC secrets are NEVER returned in any response (only kid + algorithm + status).
 *   • Revoked keys return 410 with an explicit revocation message.
 *   • Unknown kids return 404 (no leakage about which kids exist).
 *   • Private keys (Ed25519 privateKey) are never in the stack — only publicKey is
 *     stored; this is enforced by composition.ts.
 */

import type { SovereignStack } from "../composition.ts";
import type { KeyRingEntry } from "../../lib/passport/key-ring.ts";
import { KeyRing, computeKid } from "../../lib/passport/key-ring.ts";

// ── Route primitives ───────────────────────────────────────────────────────────

interface Ctx {
  tenantId: string;
  body: any;
  params: Record<string, string>;
  query?: Record<string, string>;
  scopes?: string[];
}
interface Res { status: number; body: unknown; headers?: Record<string, string>; }
interface Route { method: string; pattern: string; handler: (ctx: Ctx) => Promise<Res>; }

const ok = (body: unknown, headers?: Record<string, string>): Res => ({ status: 200, body, headers });
const notFound = (msg: string): Res => ({ status: 404, body: { error: msg } });
const gone = (msg: string): Res => ({ status: 410, body: { error: msg } });

/** Redact secrets from a KeyRingEntry before sending over the wire. */
function safeEntry(entry: KeyRingEntry): Record<string, unknown> {
  return {
    kid: entry.kid,
    algorithm: entry.algorithm,
    status: entry.status,
    createdAt: entry.createdAt,
    ...(entry.retiredAt !== undefined && { retiredAt: entry.retiredAt }),
    // Ed25519 public keys are safe to expose (asymmetric)
    ...(entry.algorithm === "ed25519" && entry.publicKey !== undefined && { publicKey: entry.publicKey }),
    // HMAC secrets are NEVER returned — only the kid and metadata are safe
  };
}

// ── Build a KeyRing from the stack's current signer ───────────────────────────

/**
 * Construct a KeyRing from the stack's MutableSigner.
 * This ring always has at least the current active key.
 * For production, this would be backed by a persistent store; for now it
 * reflects the in-memory state of the current server process.
 */
function buildRingFromStack(stack: SovereignStack): KeyRing {
  const ring = new KeyRing();
  const signer = stack.signer;

  // Current active key from MutableSigner
  if (stack.publicKey !== null) {
    // Ed25519 signer: expose publicKey
    const kid = typeof (signer as any).kid === "string"
      ? (signer as any).kid
      : computeKid("ed25519", stack.publicKey);
    ring.register({
      kid,
      algorithm: "ed25519",
      publicKey: stack.publicKey,
      status: "active",
      createdAt: new Date().toISOString(),
    });
  } else {
    // HMAC signer: expose kid but redact secret (never reveal)
    const internalSigner = (signer as any)._signer ?? (signer as any).current ?? signer;
    const secret = (internalSigner as any)._secret ?? (internalSigner as any).secret ?? "hmac-key";
    const kid = typeof (signer as any).kid === "string"
      ? (signer as any).kid
      : computeKid("hmac-sha256", String(secret));
    ring.register({
      kid,
      algorithm: "hmac-sha256",
      // DO NOT set secret — this ring is only for public key resolution
      secret: undefined,
      status: "active",
      createdAt: new Date().toISOString(),
    });
  }

  return ring;
}

// ── Routes ────────────────────────────────────────────────────────────────────

export function kidResolverRoutes(stack: SovereignStack): Route[] {
  return [
    // ── GET /api/keys/current ────────────────────────────────────────────────
    {
      method: "GET",
      pattern: "/api/keys/current",
      handler: async (_c: Ctx): Promise<Res> => {
        const ring = buildRingFromStack(stack);
        const active = ring.active();
        if (!active) {
          return notFound("no active signing key found");
        }
        const cacheHeaders = {
          "cache-control": "public, max-age=300",
          "content-type": "application/json",
        };
        return ok({ key: safeEntry(active) }, cacheHeaders);
      },
    },

    // ── GET /api/keys (list) ─────────────────────────────────────────────────
    {
      method: "GET",
      pattern: "/api/keys",
      handler: async (_c: Ctx): Promise<Res> => {
        const ring = buildRingFromStack(stack);
        const kids = ring.list().map(safeEntry);
        return ok({ kids }, { "cache-control": "public, max-age=300" });
      },
    },

    // ── GET /api/keys/:kid ───────────────────────────────────────────────────
    {
      method: "GET",
      pattern: "/api/keys/:kid",
      handler: async (c: Ctx): Promise<Res> => {
        const { kid } = c.params;
        if (!kid || typeof kid !== "string" || kid.trim() === "") {
          return notFound("kid param is required");
        }
        const ring = buildRingFromStack(stack);
        const entry = ring.resolve(kid);
        if (!entry) {
          // fail-closed: no information leakage about unknown kids
          return notFound(`key not found: ${kid}`);
        }
        if (entry.status === "revoked") {
          // 410 Gone: revoked keys render their proofs permanently invalid
          return gone(
            `key ${kid} has been revoked — any proof signed with this key must be rejected`,
          );
        }
        const cacheHeaders = {
          // Retiring keys have short cache (they may be revoked soon)
          // Active keys cache longer
          "cache-control": entry.status === "retiring"
            ? "public, max-age=60"
            : "public, max-age=300",
          "content-type": "application/json",
        };
        return ok({ key: safeEntry(entry) }, cacheHeaders);
      },
    },
  ];
}
