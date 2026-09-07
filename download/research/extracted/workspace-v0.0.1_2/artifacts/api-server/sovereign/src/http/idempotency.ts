/**
 * src/http/idempotency.ts — Idempotency-Key support for value-moving requests (v111).
 *
 * Deep-audit finding (GPT-5.5 report, confirmed in code): an API that moves μ¢ MUST allow safe
 * retries — a network timeout + client retry must not mint/transfer/release twice. Industry
 * pattern (Stripe): the client sends an `Idempotency-Key` header; the server stores the FIRST
 * response for (tenant, key, method+path) and replays it for any subsequent identical request.
 *
 * Semantics (fail-closed where it matters):
 *   • Key is REQUIRED on all state-changing methods (POST/PUT/PATCH/DELETE). Missing key → 400.
 *   • Scope: tenant + method + path + key. A different path with the same key → 422 (key reuse
 *     across endpoints is a client bug, not a replay).
 *   • Replay returns the ORIGINAL status + body + `idempotency-replayed: true` header.
 *   • Concurrent duplicate (first still in flight) → 409 (retry later) — never double-execute.
 *   • In-memory store behind an interface (pg-backed store = roadmap; same pattern as the rest).
 *   • TTL eviction so the map cannot grow unbounded.
 */
export interface IdempotencyRecord {
  status: number;
  body: unknown;
  pathKey: string;
  state: "in-flight" | "done";
  createdAt: number;
}

export interface IdempotencyStore {
  get(tenantId: string, key: string): IdempotencyRecord | undefined;
  set(tenantId: string, key: string, rec: IdempotencyRecord): void;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private map = new Map<string, IdempotencyRecord>();
  private ttlMs: number;
  private maxEntries: number;
  constructor(ttlMs: number = 24 * 60 * 60 * 1000, maxEntries = 50_000) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }
  private k(t: string, key: string) { return t + "\u0000" + key; }
  get(t: string, key: string): IdempotencyRecord | undefined {
    const rec = this.map.get(this.k(t, key));
    if (rec && Date.now() - rec.createdAt > this.ttlMs) { this.map.delete(this.k(t, key)); return undefined; }
    return rec;
  }
  set(t: string, key: string, rec: IdempotencyRecord): void {
    if (this.map.size >= this.maxEntries) {
      // evict oldest ~10% (simple, deterministic enough for an in-memory dev store)
      const cut = Math.floor(this.maxEntries / 10);
      let i = 0;
      for (const k of this.map.keys()) { this.map.delete(k); if (++i >= cut) break; }
    }
    this.map.set(this.k(t, key), rec);
  }

  /** Explicitly evict all entries whose TTL has passed (used by ReplayProtection.cleanup). */
  prune(now: number = Date.now()): void {
    for (const [k, rec] of this.map.entries()) {
      if (now - rec.createdAt > this.ttlMs) this.map.delete(k);
    }
  }
}

export type IdempotencyDecision =
  | { kind: "proceed"; finish: (status: number, body: unknown) => void; abort: () => void }
  | { kind: "replay"; status: number; body: unknown }
  | { kind: "conflict"; status: number; body: unknown };

/** Return true for HTTP methods that mutate server state (idempotency-relevant). */
export function isStateChanging(method: string): boolean {
  const m = method.toUpperCase();
  return m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE";
}

/**
 * Decide how to handle a request that carries an Idempotency-Key.
 * Returns "replay" with the stored response, "conflict" for in-flight duplicates or key misuse,
 * or "proceed" with a finish() callback the server calls with the final response.
 */
export function checkIdempotency(
  store: IdempotencyStore,
  tenantId: string,
  key: string,
  method: string,
  path: string,
): IdempotencyDecision {
  const pathKey = method.toUpperCase() + " " + path;
  const existing = store.get(tenantId, key);
  if (existing) {
    if (existing.pathKey !== pathKey) {
      return { kind: "conflict", status: 422, body: { error: "Idempotency-Key was used for a different endpoint (" + existing.pathKey + ")" } };
    }
    if (existing.state === "in-flight") {
      return { kind: "conflict", status: 409, body: { error: "a request with this Idempotency-Key is still in flight — retry shortly" } };
    }
    return { kind: "replay", status: existing.status, body: existing.body };
  }
  // reserve the key before executing (prevents concurrent double-execution)
  store.set(tenantId, key, { status: 0, body: null, pathKey, state: "in-flight", createdAt: Date.now() });
  return {
    kind: "proceed",
    finish: (status: number, body: unknown) => {
      store.set(tenantId, key, { status, body, pathKey, state: "done", createdAt: Date.now() });
    },
    abort: () => {
      // execution failed before a response existed — free the key so the client may retry
      store.set(tenantId, key, { status: 0, body: null, pathKey, state: "done", createdAt: 0 }); // createdAt 0 → instantly expired
    },
  };
}
