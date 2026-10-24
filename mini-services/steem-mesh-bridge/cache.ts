// steem-mesh-bridge · cache.ts — idempotent-query cache with honest staleness (W49-d).
//
// key = canonicalJSON({method, params}) — object key order never splits entries.
// TTL per method class: get_dynamic_global_properties 1500ms · get_block 60000ms
// · everything else 5000ms (matched on the method's short name after the last dot,
// so condenser_api.get_block and get_block share a class).
//
// Fail-honest law: when every upstream is down, the gateway serves the last known
// value via getStale() with {stale:true, servedAt} — it NEVER fabricates fresh data.
// LRU-capped (default 512) with honest eviction counters.
export interface CacheOptions {
  maxEntries?: number;
  clock?: () => number;
}

export interface FreshHit {
  hit: true;
  value: unknown;
  ageMs: number;
}
export interface StaleHit {
  hit: true;
  stale: true;
  value: unknown;
  ageMs: number;
}
export interface CacheMiss {
  hit: false;
}

export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  evictions: number;
  staleHits: number;
  maxEntries: number;
}

/** Stable JSON: object keys sorted recursively; arrays keep order. */
export function canonicalJSON(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = sortValue(src[k]);
    return out;
  }
  return value;
}

/** TTL class for a method — matched on the short name after the last dot. */
export function ttlForMethod(method: string): number {
  const short = method.includes(".") ? method.slice(method.lastIndexOf(".") + 1) : method;
  if (short === "get_dynamic_global_properties") return 1500;
  if (short === "get_block") return 60_000;
  return 5000;
}

interface Entry {
  value: unknown;
  storedAt: number;
}

export class QueryCache {
  readonly maxEntries: number;
  private readonly clock: () => number;
  private readonly map = new Map<string, Entry>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private staleHits = 0;

  constructor(options?: CacheOptions) {
    this.maxEntries = Math.max(1, options?.maxEntries ?? 512);
    this.clock = options?.clock ?? Date.now;
  }

  key(method: string, params: unknown): string {
    return canonicalJSON({ m: method, p: params });
  }

  /** Fresh-only lookup (LRU recency bump on hit). Expired = miss. */
  get(method: string, params: unknown): FreshHit | CacheMiss {
    const k = this.key(method, params);
    const e = this.map.get(k);
    if (!e) {
      this.misses += 1;
      return { hit: false };
    }
    const now = this.clock();
    const ageMs = now - e.storedAt;
    if (ageMs >= ttlForMethod(method)) {
      this.misses += 1;
      return { hit: false };
    }
    this.hits += 1;
    // bump LRU recency
    this.map.delete(k);
    this.map.set(k, e);
    return { hit: true, value: e.value, ageMs };
  }

  /** Fail-honest lookup: returns the last known value even if long expired. */
  getStale(method: string, params: unknown): StaleHit | CacheMiss {
    const k = this.key(method, params);
    const e = this.map.get(k);
    if (!e) return { hit: false };
    this.staleHits += 1;
    const ageMs = this.clock() - e.storedAt;
    // stale reads also bump recency — the last-known-good value stays warm
    this.map.delete(k);
    this.map.set(k, e);
    return { hit: true, stale: true, value: e.value, ageMs };
  }

  set(method: string, params: unknown, value: unknown): void {
    const k = this.key(method, params);
    this.map.delete(k); // re-insert = refresh recency
    this.map.set(k, { value, storedAt: this.clock() });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.map.delete(oldest);
      this.evictions += 1;
    }
  }

  stats(): CacheStats {
    return {
      size: this.map.size,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      staleHits: this.staleHits,
      maxEntries: this.maxEntries,
    };
  }
}
