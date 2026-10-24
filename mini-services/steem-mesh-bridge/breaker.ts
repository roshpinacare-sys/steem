// steem-mesh-bridge · breaker.ts — circuit breaker state machine (W49-d, §3 directive).
//
// Pure + deterministic: every transition is driven by an explicit `now` value —
// no Date.now(), no timers inside this module. Unit-testable in isolation and
// shared by every node in the pool (nodes.ts owns one breaker per candidate).
//
// States: closed → (failThreshold consecutive fails) → open (fast-reject)
//         open → (cooldownMs elapsed) → half-open (single probe)
//         half-open → success → closed / fail → open (fresh cooldown)
export type BreakerState = "closed" | "open" | "halfOpen";

export interface BreakerOptions {
  /** consecutive failures in closed state before opening (default 3) */
  failThreshold?: number;
  /** how long an open breaker rejects before allowing one probe (default 30000ms) */
  cooldownMs?: number;
}

export interface BreakerSnapshot {
  state: BreakerState;
  openedAt: number | null;
  consecFails: number;
}

export class CircuitBreaker {
  readonly failThreshold: number;
  readonly cooldownMs: number;
  state: BreakerState = "closed";
  openedAt: number | null = null;
  consecFails = 0;

  constructor(options?: BreakerOptions) {
    this.failThreshold = Math.max(1, options?.failThreshold ?? 3);
    this.cooldownMs = Math.max(0, options?.cooldownMs ?? 30_000);
  }

  /** True when an open breaker's cooldown has elapsed and a probe is due. Non-mutating. */
  dueForProbe(now: number): boolean {
    return this.state === "open" && this.openedAt !== null && now - this.openedAt >= this.cooldownMs;
  }

  /** Pure view: may an attempt go out right now? (closed / half-open / open-but-due) */
  canAttempt(now: number): boolean {
    if (this.state === "closed" || this.state === "halfOpen") return true;
    return this.dueForProbe(now);
  }

  /** Explicitly begin the single half-open probe (pool calls this right before the attempt). */
  beginProbe(now: number): void {
    if (this.state === "open" && this.dueForProbe(now)) this.state = "halfOpen";
  }

  recordSuccess(_now: number): void {
    this.state = "closed";
    this.openedAt = null;
    this.consecFails = 0;
  }

  recordFail(now: number): void {
    if (this.state === "halfOpen" || this.state === "open") {
      // a failed (half-open) probe — or any failure seen while open — re-opens with a FRESH cooldown
      this.state = "open";
      this.openedAt = now;
      return;
    }
    this.consecFails += 1;
    if (this.consecFails >= this.failThreshold) {
      this.state = "open";
      this.openedAt = now;
    }
  }

  snapshot(): BreakerSnapshot {
    return { state: this.state, openedAt: this.openedAt, consecFails: this.consecFails };
  }
}
