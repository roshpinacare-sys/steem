// steem-mesh-bridge · nodes.ts — health-ranked failover pool of public Steem/Hive
// nodes (W49-d, §3 directive: kill the external-RPC single-point-of-failure).
//
// Laws:
//  · Boot measures every candidate (real probe RPC); only reachable nodes stay
//    active — drops are kept and reported honestly in /status.
//  · Ranking is deterministic: eligible (reachable + breaker-allowed) nodes first,
//    ordered by EWMA latency ascending, ties broken by candidate order. Unknown
//    latency (never measured) ranks last.
//  · Circuit breaker per node (breaker.ts): 3 consecutive fails → open (fast
//    reject) → 30s cooldown → single half-open probe → recovery or re-open.
//  · Fetch + clock are injected — zero network possible in tests.
import { CircuitBreaker } from "./breaker";

export interface NodeCandidate {
  name: string;
  url: string;
}

export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

export interface AttemptRecord {
  node: string;
  url: string;
  ms: number;
  error: string;
}

export interface CallOutcome {
  result: unknown;
  node: string;
  url: string;
  ms: number;
  attempts: AttemptRecord[];
}

export interface PoolOptions {
  fetchImpl?: FetchImpl;
  clock?: () => number;
  /** per-attempt upstream timeout in ms (default 2000) */
  timeoutMs?: number;
  /** EWMA smoothing factor (default 0.3) */
  ewmaAlpha?: number;
  breaker?: { failThreshold?: number; cooldownMs?: number };
  /** RPC used by measure() at boot (default condenser_api.get_dynamic_global_properties) */
  probeMethod?: string;
}

export class UpstreamError extends Error {
  code: "all-upstreams-failed" | "no-upstream-available";
  attempts: AttemptRecord[];
  constructor(code: "all-upstreams-failed" | "no-upstream-available", attempts: AttemptRecord[], message?: string) {
    super(message ?? code);
    this.name = "UpstreamError";
    this.code = code;
    this.attempts = attempts;
  }
}

interface PoolNode {
  candidate: NodeCandidate;
  reachable: boolean;
  ewmaMs: number | null;
  breaker: CircuitBreaker;
  lastError: string | null;
  /** true while the single half-open probe is in flight — hidden from rankings */
  probeActive: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class NodePool {
  readonly candidates: NodeCandidate[];
  readonly timeoutMs: number;
  readonly ewmaAlpha: number;
  readonly probeMethod: string;
  readonly failThreshold: number;
  readonly cooldownMs: number;
  private readonly fetchImpl: FetchImpl;
  private readonly clock: () => number;
  private readonly nodes = new Map<string, PoolNode>();
  private dropped: { name: string; url: string; error: string }[] = [];
  private rpcId = 0;

  constructor(candidates: NodeCandidate[], options?: PoolOptions) {
    this.candidates = candidates;
    this.fetchImpl = options?.fetchImpl ?? ((url, init) => fetch(url, init));
    this.clock = options?.clock ?? Date.now;
    this.timeoutMs = Math.max(1, options?.timeoutMs ?? 2000);
    this.ewmaAlpha = Math.min(1, Math.max(0.01, options?.ewmaAlpha ?? 0.3));
    this.probeMethod = options?.probeMethod ?? "condenser_api.get_dynamic_global_properties";
    this.failThreshold = Math.max(1, options?.breaker?.failThreshold ?? 3);
    this.cooldownMs = Math.max(0, options?.breaker?.cooldownMs ?? 30_000);
    for (const c of candidates) {
      // candidates start reachable (boot measure() is what demotes the dead ones)
      this.nodes.set(c.name, {
        candidate: c,
        reachable: true,
        ewmaMs: null,
        breaker: new CircuitBreaker({ failThreshold: this.failThreshold, cooldownMs: this.cooldownMs }),
        lastError: null,
        probeActive: false,
      });
    }
  }

  private envelope(method: string, params: unknown): string {
    this.rpcId += 1;
    return JSON.stringify({ jsonrpc: "2.0", method, params, id: this.rpcId });
  }

  private async attempt(url: string, method: string, params: unknown): Promise<unknown> {
    const body = this.envelope(method, params);
    const init: RequestInit = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    };
    // real-socket abort in production; injected test fetches may ignore it —
    // the race below is what deterministically enforces the deadline everywhere.
    if (typeof AbortSignal !== "undefined" && typeof (AbortSignal as any).timeout === "function") {
      init.signal = AbortSignal.timeout(this.timeoutMs);
    }
    const work = (async () => {
      const res = await this.fetchImpl(url, init);
      if (!res.ok) throw new Error(`http-${res.status}`);
      return await res.json();
    })();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout-after-${this.timeoutMs}ms`)), this.timeoutMs);
    });
    try {
      return await Promise.race([work, deadline]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private recordSuccess(n: PoolNode, ms: number): void {
    n.ewmaMs = n.ewmaMs === null ? ms : this.ewmaAlpha * ms + (1 - this.ewmaAlpha) * n.ewmaMs;
    n.breaker.recordSuccess(this.clock());
    n.lastError = null;
  }

  private recordFail(n: PoolNode, error: string, now: number): void {
    n.breaker.recordFail(now);
    n.lastError = error;
  }

  /** Boot census: fire a cheap idempotent probe at every candidate. Keep the reachable. */
  async measure(): Promise<{ kept: string[]; dropped: { name: string; url: string; error: string }[] }> {
    this.dropped = [];
    const results = await Promise.all(
      this.candidates.map(async (c) => {
        const n = this.nodes.get(c.name)!;
        const t0 = this.clock();
        try {
          await this.attempt(c.url, this.probeMethod, []);
          n.reachable = true;
          this.recordSuccess(n, Math.max(0, this.clock() - t0));
          return null;
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          n.reachable = false;
          n.probeActive = false;
          n.breaker.recordFail(this.clock());
          n.lastError = error;
          this.dropped.push({ name: c.name, url: c.url, error });
          return { name: c.name, url: c.url, error };
        }
      }),
    );
    const drops = results.filter((r): r is { name: string; url: string; error: string } => r !== null);
    return {
      kept: this.candidates.filter((c) => this.nodes.get(c.name)!.reachable).map((c) => c.name),
      dropped: drops,
    };
  }

  /** Deterministic ranking of nodes eligible to serve right now. */
  rank(): PoolNode[] {
    const now = this.clock();
    const eligible: PoolNode[] = [];
    for (const c of this.candidates) {
      const n = this.nodes.get(c.name)!;
      if (!n.reachable || n.probeActive) continue;
      if (!n.breaker.canAttempt(now)) continue; // open breaker → fast-reject
      eligible.push(n);
    }
    return eligible.sort((a, b) => {
      const la = a.ewmaMs ?? Number.MAX_SAFE_INTEGER;
      const lb = b.ewmaMs ?? Number.MAX_SAFE_INTEGER;
      if (la !== lb) return la - lb;
      return this.candidates.indexOf(a.candidate) - this.candidates.indexOf(b.candidate);
    });
  }

  /** Failover loop: try ranked nodes in order until one serves or all fail. */
  async call(method: string, params: unknown): Promise<CallOutcome> {
    const now = this.clock();
    const ordered = this.rank();
    if (ordered.length === 0) throw new UpstreamError("no-upstream-available", []);
    const attempts: AttemptRecord[] = [];
    for (const n of ordered) {
      const t0 = this.clock();
      const wasProbe = n.breaker.dueForProbe(now) || n.breaker.state === "halfOpen";
      if (wasProbe) {
        n.probeActive = true;
        n.breaker.beginProbe(this.clock());
      }
      try {
        const result = await this.attempt(n.candidate.url, method, params);
        this.recordSuccess(n, Math.max(0, this.clock() - t0));
        return { result, node: n.candidate.name, url: n.candidate.url, ms: Math.max(0, this.clock() - t0), attempts };
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        this.recordFail(n, error, this.clock());
        attempts.push({ node: n.candidate.name, url: n.candidate.url, ms: Math.max(0, this.clock() - t0), error });
      } finally {
        n.probeActive = false;
      }
    }
    throw new UpstreamError("all-upstreams-failed", attempts);
  }

  health(): {
    name: string; url: string; reachable: boolean; healthy: boolean;
    breakerState: string; ewmaMs: number | null; consecFails: number; lastError: string | null;
  }[] {
    return this.candidates.map((c) => {
      const n = this.nodes.get(c.name)!;
      const snap = n.breaker.snapshot();
      return {
        name: c.name,
        url: c.url,
        reachable: n.reachable,
        healthy: snap.state !== "open",
        breakerState: snap.state,
        ewmaMs: n.ewmaMs,
        consecFails: snap.consecFails,
        lastError: n.lastError,
      };
    });
  }

  status(): {
    candidates: NodeCandidate[];
    active: string[];
    dropped: { name: string; url: string; error: string }[];
    nodes: ReturnType<NodePool["health"]>;
    limits: { failThreshold: number; cooldownMs: number; timeoutMs: number; ewmaAlpha: number };
  } {
    return {
      candidates: this.candidates,
      active: this.candidates.filter((c) => this.nodes.get(c.name)!.reachable).map((c) => c.name),
      dropped: this.dropped,
      nodes: this.health(),
      limits: { failThreshold: this.failThreshold, cooldownMs: this.cooldownMs, timeoutMs: this.timeoutMs, ewmaAlpha: this.ewmaAlpha },
    };
  }
}
