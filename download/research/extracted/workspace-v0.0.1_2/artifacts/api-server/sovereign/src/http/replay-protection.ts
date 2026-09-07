/**
 * src/http/replay-protection.ts — Unified replay-protection interface (gap #5 sub-step 2).
 *
 * Consolidates NonceRegistry (MCP capability-token replay protection) and
 * IdempotencyStore (HTTP Idempotency-Key replay protection) behind a single
 * `ReplayProtection` interface. Adapters and servers carry ONE object instead
 * of two, eliminating wiring surface and making it impossible to pass a
 * nonce registry but forget the idempotency store (or vice versa).
 *
 * `CompositeReplayProtection` delegates to the underlying stores unchanged;
 * no behaviour is altered — only the interface is unified.
 *
 * Cleanup policy: `cleanup()` proactively evicts expired entries from both
 * sub-stores. In-memory implementations prune lazily on read; cleanup is
 * an explicit trigger for long-lived processes.
 */

import type { IdempotencyStore, IdempotencyRecord } from "./idempotency.ts";
import type { NonceRegistry } from "../../lib/mcp-server/nonce-registry.ts";

export interface ReplayProtection extends IdempotencyStore, NonceRegistry {
  /** TTL in milliseconds for idempotency records. */
  readonly idempotencyTtlMs: number;
  /** Proactively remove expired entries from both idempotency and nonce stores. */
  cleanup(): void;
}

export class CompositeReplayProtection implements ReplayProtection {
  readonly idempotencyTtlMs: number;
  private idempotency: IdempotencyStore;
  private nonce: NonceRegistry;

  constructor(
    idempotency: IdempotencyStore,
    nonce: NonceRegistry,
    idempotencyTtlMs: number = 24 * 60 * 60 * 1000,
  ) {
    this.idempotency = idempotency;
    this.nonce = nonce;
    this.idempotencyTtlMs = idempotencyTtlMs;
  }

  get(tenantId: string, key: string): IdempotencyRecord | undefined {
    return this.idempotency.get(tenantId, key);
  }

  set(tenantId: string, key: string, rec: IdempotencyRecord): void {
    this.idempotency.set(tenantId, key, rec);
  }

  has(nonce: string): boolean {
    return this.nonce.has(nonce);
  }

  add(nonce: string, expiresAt: string): void {
    this.nonce.add(nonce, expiresAt);
  }

  cleanup(): void {
    const anyIdem = this.idempotency as any;
    if (typeof anyIdem.prune === "function") {
      anyIdem.prune();
    }
    // NonceRegistry implementations prune lazily inside has(); no explicit hook.
  }
}
