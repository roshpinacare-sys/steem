// G71-2c — steem-mesh-bridge · nodes.ts
// Health-ranked Hive/Steem public-node pool with a deterministic circuit breaker
// (CLOSED → OPEN → HALF_OPEN). Failover order = health-ranked, tie-broken by url.
//
// Pure + dependency-injected: fetch and clock are injected by the caller
// (index.ts in production, tests with fakes). Zero network and zero Date.now here.
import type { Clock } from "./receipts";

export type BreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

/** G76-i — which chain a public node actually serves (measured truth: Hive
 * nodes answer STEEM-only accounts with an EMPTY result instead of an error —
 * a silent divergence that must be routable away). */
export type ChainLabel = "steem" | "hive" | "unknown";

/** Default chain labels by hostname (measured 2026-10: anyx.io serves HIVE;
 * api.steemit.com is the only STEEM node in the default set). */
export function defaultChainLabel(url: string): ChainLabel {
  try {
    const host = new URL(url).hostname;
    if (host.includes("steem")) return "steem";
    if (host.includes("hive") || host.includes("anyx") || host.includes("openhive")) return "hive";
    return "unknown";
  } catch {
    return "unknown";
  }
}

/** Minimal response surface the pool needs from an upstream call. */
export type FetchLike = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export const DEFAULT_EMA_MS = 250; // neutral seed for the latency EMA factor law
const EMA_ALPHA = 0.3; // ema = ema*(1-α) + sample*α

export interface BreakerOptions {
  /** consecutive failures that trip the breaker (deterministic threshold) */
  failureThreshold: number;
  /** ms an OPEN breaker waits before allowing a single HALF_OPEN probe */
  cooldownMs: number;
}

export interface PoolOptions {
  nodes: string[];
  fetch: FetchLike;
  clock: Clock;
  breaker?: Partial<BreakerOptions>;
  /** upstream timeout (ms) — applied via AbortSignal by the caller-side wrapper */
  timeoutMs?: number;
  /** G76-i — optional url→chain label overrides (else defaultChainLabel) */
  chainLabels?: Record<string, ChainLabel>;
}

export interface NodeSnapshot {
  url: string;
  state: BreakerState;
  chain: ChainLabel;
  health: number; // 0..100 deterministic score
  emaLatencyMs: number | null;
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  openedAt: number | null; // when the breaker opened (epoch ms)
  nextProbeAt: number | null; // openedAt + cooldownMs while OPEN
}

export type TransitionKind = "OPEN" | "HALF_OPEN" | "CLOSED" | "REOPEN";

export interface BreakerTransition {
  url: string;
  from: BreakerState;
  to: BreakerState;
  kind: TransitionKind;
  at: number;
}

interface NodeState {
  url: string;
  state: BreakerState;
  chain: ChainLabel;
  emaLatencyMs: number | null;
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  openedAt: number | null;
  probeInFlight: boolean;
}
export type { NodeState };

/**
 * Deterministic health score (pure):
 *   score = 60·successRate + 40·latencyFactor
 *   successRate  = s/(s+f), neutral 0.5 with zero observations
 *   latencyFactor = 1 with no latency data, else 1/(1+ema/1000)
 * Clamp [0,100]; integer-rounded for stable ranking.
 */
export function healthScore(n: {
  state: BreakerState;
  emaLatencyMs: number | null;
  successCount: number;
  failureCount: number;
}): number {
  const total = n.successCount + n.failureCount;
  const successRate = total === 0 ? 0.5 : n.successCount / total;
  const latencyFactor =
    n.emaLatencyMs === null ? 1 : 1 / (1 + n.emaLatencyMs / 1000);
  const raw = 60 * successRate + 40 * latencyFactor;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

export class NodePool {
  private readonly nodes = new Map<string, NodeState>();
  private readonly fetch: FetchLike;
  private readonly clock: Clock;
  private readonly breaker: BreakerOptions;
  private readonly timeoutMs: number;
  private transitions: BreakerTransition[] = [];

  constructor(opts: PoolOptions) {
    if (!Array.isArray(opts.nodes) || opts.nodes.length === 0) {
      throw new Error("NodePool: at least one node url is required (fail-closed)");
    }
    for (const url of opts.nodes) {
      if (typeof url !== "string" || !url.startsWith("https://")) {
        throw new Error("NodePool: node urls must be https:// — got " + JSON.stringify(url));
      }
      if (!this.nodes.has(url)) {
        this.nodes.set(url, {
          url,
          state: "CLOSED",
          chain: opts.chainLabels?.[url] ?? defaultChainLabel(url),
          emaLatencyMs: null,
          successCount: 0,
          failureCount: 0,
          consecutiveFailures: 0,
          openedAt: null,
          probeInFlight: false,
        });
      }
    }
    this.fetch = opts.fetch;
    this.clock = opts.clock;
    this.breaker = {
      failureThreshold: Math.max(1, opts.breaker?.failureThreshold ?? 3),
      cooldownMs: Math.max(0, opts.breaker?.cooldownMs ?? 30_000),
    };
    this.timeoutMs = Math.max(1, opts.timeoutMs ?? 6_000);
  }

  get timeout(): number {
    return this.timeoutMs;
  }

  get breakerOptions(): BreakerOptions {
    return { ...this.breaker };
  }

  private transition(n: NodeState, to: BreakerState, kind: TransitionKind): void {
    const from = n.state;
    n.state = to;
    if (to === "OPEN") n.openedAt = this.clock();
    if (to === "CLOSED") n.openedAt = null;
    this.transitions.push({ url: n.url, from, to, kind, at: this.clock() });
  }

  /** Records an upstream success; closes an OPEN/HALF_OPEN breaker. */
  reportSuccess(url: string, latencyMs: number, _now?: number): void {
    const n = this.nodes.get(url);
    if (!n) return; // unknown urls are ignored — no invented nodes
    n.successCount++;
    n.consecutiveFailures = 0;
    n.emaLatencyMs =
      n.emaLatencyMs === null ? latencyMs : n.emaLatencyMs * (1 - EMA_ALPHA) + latencyMs * EMA_ALPHA;
    n.probeInFlight = false;
    if (n.state !== "CLOSED") this.transition(n, "CLOSED", "CLOSED");
  }

  /** Records an upstream failure; trips the breaker on the deterministic threshold. */
  reportFailure(url: string, _now?: number): void {
    const n = this.nodes.get(url);
    if (!n) return;
    n.failureCount++;
    n.consecutiveFailures++;
    n.probeInFlight = false;
    if (n.state === "HALF_OPEN") {
      this.transition(n, "OPEN", "REOPEN");
      return;
    }
    if (n.state === "CLOSED" && n.consecutiveFailures >= this.breaker.failureThreshold) {
      this.transition(n, "OPEN", "OPEN");
    }
  }

  /** Marks the single HALF_OPEN probe as in-flight (single-probe law). */
  beginProbe(url: string): void {
    const n = this.nodes.get(url);
    if (n && n.state === "HALF_OPEN") n.probeInFlight = true;
  }

  /**
   * Evaluates deterministic OPEN→HALF_OPEN transitions, then returns the
   * eligible nodes in failover order: CLOSED first, then HALF_OPEN probes,
   * health score descending, url ascending as the final tie-break.
   *
   * G76-i chain pinning: when a chain context is declared (preferChain) and at
   * least one eligible node SERVES that chain, nodes known to serve a DIFFERENT
   * chain are excluded — an empty-result from a wrong-chain node is silent
   * divergence, not an error the failover plane can judge. Unlabeled (unknown)
   * nodes stay eligible as fallback. With no same-chain eligible node the full
   * eligible set is used (never an invented empty pool).
   */
  rank(now: number = this.clock(), preferChain?: ChainLabel): NodeState[] {
    for (const n of this.nodes.values()) {
      if (
        n.state === "OPEN" &&
        n.openedAt !== null &&
        now - n.openedAt >= this.breaker.cooldownMs
      ) {
        this.transition(n, "HALF_OPEN", "HALF_OPEN");
      }
    }
    const eligible = [...this.nodes.values()].filter(
      (n) => n.state === "CLOSED" || (n.state === "HALF_OPEN" && !n.probeInFlight),
    );
    const pool =
      preferChain && eligible.some((n) => n.chain === preferChain)
        ? eligible.filter((n) => n.chain === preferChain || n.chain === "unknown")
        : eligible;
    const priority = (n: NodeState) => (n.state === "CLOSED" ? 0 : 1);
    return pool.sort((a, b) => {
      const p = priority(a) - priority(b);
      if (p !== 0) return p;
      const h = healthScore(b) - healthScore(a);
      if (h !== 0) return h;
      return a.url < b.url ? -1 : a.url > b.url ? 1 : 0;
    });
  }

  drainTransitions(): BreakerTransition[] {
    const out = this.transitions;
    this.transitions = [];
    return out;
  }

  snapshot(now: number = this.clock()): NodeSnapshot[] {
    // evaluation without ranking side-effects beyond breaker transitions
    for (const n of this.nodes.values()) {
      if (
        n.state === "OPEN" &&
        n.openedAt !== null &&
        now - n.openedAt >= this.breaker.cooldownMs
      ) {
        this.transition(n, "HALF_OPEN", "HALF_OPEN");
      }
    }
    return [...this.nodes.values()]
      .sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0))
      .map((n) => ({
        url: n.url,
        state: n.state,
        chain: n.chain,
        health: healthScore(n),
        emaLatencyMs: n.emaLatencyMs,
        successCount: n.successCount,
        failureCount: n.failureCount,
        consecutiveFailures: n.consecutiveFailures,
        openedAt: n.openedAt,
        nextProbeAt: n.state === "OPEN" && n.openedAt !== null ? n.openedAt + this.breaker.cooldownMs : null,
      }));
  }

  counts(now: number = this.clock()): {
    total: number;
    closed: number;
    open: number;
    halfOpen: number;
    eligible: number;
  } {
    const snap = this.snapshot(now);
    return {
      total: snap.length,
      closed: snap.filter((n) => n.state === "CLOSED").length,
      open: snap.filter((n) => n.state === "OPEN").length,
      halfOpen: snap.filter((n) => n.state === "HALF_OPEN").length,
      eligible: snap.filter((n) => n.state === "CLOSED" || n.state === "HALF_OPEN").length,
    };
  }

  healthyCount(now: number = this.clock()): number {
    return this.snapshot(now).filter((n) => n.state === "CLOSED").length;
  }

  /**
   * Calls the upstream node with the exact JSON-RPC envelope and a timeout signal.
   * Returns parsed JSON or throws (throw = failure for the breaker).
   */
  async callRaw(
    url: string,
    envelope: unknown,
  ): Promise<{ ok: true; json: unknown } | { ok: false; error: string }> {
    const started = this.clock();
    try {
      const res = await this.fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(envelope),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const text = await res.text();
      const latency = Math.max(0, this.clock() - started);
      if (!res.ok) {
        this.reportFailure(url);
        return { ok: false, error: `http ${res.status} from ${url}` };
      }
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        this.reportFailure(url);
        return { ok: false, error: `invalid json from ${url}` };
      }
      this.reportSuccess(url, latency);
      return { ok: true, json };
    } catch (err) {
      this.reportFailure(url);
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `${url}: ${msg}` };
    }
  }
}
