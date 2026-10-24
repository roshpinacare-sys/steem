// G71-2c — steem-mesh-bridge · cache.ts
// Idempotent-query cache with per-method-class TTL and honest stale semantics.
//  · volatile methods (broadcast / anything owner-authority mutating) are NEVER cached
//  · fresh hit → {hit:true, stale:false}
//  · expired-but-held value → {hit:true, stale:true} — honest flag, caller decides
//  · deterministic eviction under the entries cap
//
// Zero-slop law holds: clean production surface. Zero Date.now — clock is injected.
import type { Clock } from "./receipts";
import { canonicalJson } from "./receipts";

export type MethodClass = "volatile" | "dynamic" | "stable" | "default";

export interface TtlTable {
  dynamicMs: number;
  stableMs: number;
  defaultMs: number;
}

/** Deterministic canonical cache key: canonicalJson([method, normalizedParams]). */
export function canonicalKey(method: string, params: unknown): string {
  const normalized = params === undefined ? [] : params;
  return canonicalJson([method, normalized]);
}

/** Methods that mutate chain state or carry owner authority — never cached, never replayed. */
const VOLATILE_METHODS = new Set<string>([
  "broadcast_block",
  "broadcast_transaction",
  "broadcast_transaction_synchronous",
  "broadcast_transaction_with_callback",
  "broadcast_transaction2",
  "network_broadcast_api.broadcast_block",
  "network_broadcast_api.broadcast_transaction",
  "network_broadcast_api.broadcast_transaction_synchronous",
  "condenser_api.broadcast_block",
  "condenser_api.broadcast_transaction",
  "condenser_api.broadcast_transaction_synchronous",
  "condenser_api.broadcast_transaction_with_callback",
  "chain_api.broadcast_block",
  "chain_api.broadcast_transaction",
]);

/** Ordered prefix rules — first match wins (deterministic). */
const CLASS_RULES: ReadonlyArray<{ prefix: string; cls: MethodClass }> = [
  // volatile: explicit list first, then the broadcast substring law
  // dynamic: state that moves every block / market movement / account mutation
  { prefix: "condenser_api.get_dynamic_global_properties", cls: "dynamic" },
  { prefix: "database_api.get_dynamic_global_properties", cls: "dynamic" },
  { prefix: "condenser_api.get_block", cls: "dynamic" },
  { prefix: "database_api.get_block", cls: "dynamic" },
  { prefix: "condenser_api.get_ops_in_block", cls: "dynamic" },
  { prefix: "condenser_api.get_account_history", cls: "dynamic" },
  { prefix: "condenser_api.get_order_book", cls: "dynamic" },
  { prefix: "condenser_api.get_trade_history", cls: "dynamic" },
  { prefix: "condenser_api.get_ticker", cls: "dynamic" },
  { prefix: "condenser_api.get_volume", cls: "dynamic" },
  { prefix: "condenser_api.get_recent_trades", cls: "dynamic" },
  { prefix: "condenser_api.get_market_history", cls: "dynamic" },
  { prefix: "market_history_api.", cls: "dynamic" },
  // stable first for the specific slow-changing aggregate, then the dynamic account family
  { prefix: "condenser_api.get_account_count", cls: "stable" },
  { prefix: "condenser_api.get_accounts", cls: "dynamic" },
  { prefix: "condenser_api.get_account", cls: "dynamic" },
  { prefix: "database_api.list_accounts", cls: "dynamic" },
  { prefix: "database_api.find_accounts", cls: "dynamic" },
  { prefix: "database_api.list_witnesses", cls: "dynamic" },
  { prefix: "condenser_api.get_witnesses_by_vote", cls: "dynamic" },
  { prefix: "condenser_api.get_proposals", cls: "dynamic" },
  { prefix: "database_api.list_proposals", cls: "dynamic" },
  { prefix: "database_api.find_proposals", cls: "dynamic" },
  { prefix: "condenser_api.get_feed_history", cls: "dynamic" },
  { prefix: "condenser_api.get_current_median_history_price", cls: "dynamic" },
  // stable: chain facts that are effectively immutable
  { prefix: "condenser_api.get_chain_properties", cls: "stable" },
  { prefix: "database_api.get_chain_properties", cls: "stable" },
  { prefix: "condenser_api.get_config", cls: "stable" },
  { prefix: "condenser_api.get_hardfork_version", cls: "stable" },
  { prefix: "condenser_api.get_next_scheduled_hardfork", cls: "stable" },
  { prefix: "condenser_api.get_witness_schedule", cls: "stable" },
  { prefix: "condenser_api.get_reward_fund", cls: "stable" },
];

/** Deterministic method classification. Broadcast-family = volatile, always. */
export function methodClass(method: string): MethodClass {
  if (VOLATILE_METHODS.has(method) || /broadcast/i.test(method)) return "volatile";
  for (const rule of CLASS_RULES) {
    if (method.startsWith(rule.prefix)) return rule.cls;
  }
  return "default";
}

export function ttlFor(method: string, ttls: TtlTable): number {
  switch (methodClass(method)) {
    case "volatile":
      return 0; // never cached
    case "dynamic":
      return ttls.dynamicMs;
    case "stable":
      return ttls.stableMs;
    default:
      return ttls.defaultMs;
  }
}

interface CacheEntry {
  key: string;
  method: string;
  value: unknown;
  cachedAt: number;
  expiresAt: number;
}

export interface CacheOptions {
  clock: Clock;
  ttls?: Partial<TtlTable>;
  maxEntries?: number;
}

export interface CacheStats {
  entries: number;
  hits: number;
  misses: number;
  staleServes: number;
  evictions: number;
  volatileRejects: number;
  maxEntries: number;
}

export type GetResult =
  | { hit: false }
  | { hit: true; value: unknown; stale: boolean; cachedAt: number };

/**
 * Honest idempotent-query cache. Expired-but-held values survive for stale
 * serving (the gateway flags them, it never invents data). Volatile methods
 * are rejected at set() — fail-closed idempotence.
 */
export class RpcCache {
  private entries = new Map<string, CacheEntry>();
  private readonly clock: Clock;
  private readonly ttls: TtlTable;
  private readonly maxEntries: number;
  private hits = 0;
  private misses = 0;
  private staleServes = 0;
  private evictions = 0;
  private volatileRejects = 0;

  constructor(opts: CacheOptions) {
    this.clock = opts.clock;
    this.ttls = {
      dynamicMs: opts.ttls?.dynamicMs ?? 3_000,
      stableMs: opts.ttls?.stableMs ?? 30_000,
      defaultMs: opts.ttls?.defaultMs ?? 5_000,
    };
    this.maxEntries = Math.max(1, opts.maxEntries ?? 5_000);
  }

  get ttlTable(): TtlTable {
    return { ...this.ttls };
  }

  /** Stores a value unless the method is volatile. Returns true iff stored. */
  set(method: string, params: unknown, value: unknown, now: number = this.clock()): boolean {
    const ttl = ttlFor(method, this.ttls);
    if (ttl <= 0 || methodClass(method) === "volatile") {
      this.volatileRejects++;
      return false; // volatile law: never cached
    }
    const key = canonicalKey(method, params);
    this.entries.set(key, {
      key,
      method,
      value,
      cachedAt: now,
      expiresAt: now + ttl,
    });
    this.evictIfNeeded(now);
    return true;
  }

  /**
   * Fresh hit → stale:false. Expired-but-held → stale:true (honest flag,
   * value unchanged). Absent → miss. Hit/stale counters measured honestly.
   */
  get(method: string, params: unknown, now: number = this.clock()): GetResult {
    const key = canonicalKey(method, params);
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses++;
      return { hit: false };
    }
    if (now < entry.expiresAt) {
      this.hits++;
      return { hit: true, value: entry.value, stale: false, cachedAt: entry.cachedAt };
    }
    this.staleServes++;
    return { hit: true, value: entry.value, stale: true, cachedAt: entry.cachedAt };
  }

  /**
   * Deterministic eviction: expired entries first (oldest expiry), then the
   * entry with the smallest expiry; ties broken by cachedAt then key.
   */
  private evictIfNeeded(now: number): void {
    while (this.entries.size > this.maxEntries) {
      let victim: CacheEntry | null = null;
      for (const e of this.entries.values()) {
        const expired = e.expiresAt <= now;
        const victimExpired = victim !== null && victim.expiresAt <= now;
        if (victim === null) {
          victim = e;
          continue;
        }
        const better =
          (expired && !victimExpired) ||
          (expired === victimExpired && e.expiresAt < victim.expiresAt) ||
          (expired === victimExpired && e.expiresAt === victim.expiresAt && e.cachedAt < victim.cachedAt) ||
          (expired === victimExpired && e.expiresAt === victim.expiresAt && e.cachedAt === victim.cachedAt && e.key < victim.key);
        if (better) victim = e;
      }
      if (victim === null) break;
      this.entries.delete(victim.key);
      this.evictions++;
    }
  }

  stats(): CacheStats {
    return {
      entries: this.entries.size,
      hits: this.hits,
      misses: this.misses,
      staleServes: this.staleServes,
      evictions: this.evictions,
      volatileRejects: this.volatileRejects,
      maxEntries: this.maxEntries,
    };
  }
}
