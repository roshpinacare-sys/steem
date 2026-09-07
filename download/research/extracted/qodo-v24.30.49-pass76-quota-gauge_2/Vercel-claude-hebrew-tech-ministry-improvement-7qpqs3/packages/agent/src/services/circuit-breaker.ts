/**
 * circuit-breaker.ts
 *
 * A generic circuit-breaker that wraps any async operation and prevents
 * cascading failures when a downstream service is unavailable.
 *
 * States
 * ──────
 *  CLOSED   — normal operation; failures are counted.
 *  OPEN     — fast-fail for resetTimeoutMs; no calls reach the service.
 *  HALF_OPEN — one probe call is allowed through; on success → CLOSED,
 *              on failure → OPEN again with a new timeout.
 */

import { log } from "./logger.js";

export type CBState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit. Default: 5 */
  failureThreshold?: number;
  /** Milliseconds to wait in OPEN state before moving to HALF_OPEN. Default: 30_000 */
  resetTimeoutMs?: number;
  /** Label used in log messages. Default: "circuit-breaker" */
  name?: string;
}

export class CircuitBreakerOpenError extends Error {
  constructor(name: string) {
    super(`[${name}] Circuit is OPEN — call rejected`);
    this.name = "CircuitBreakerOpenError";
  }
}

export class CircuitBreaker {
  private state: CBState = "CLOSED";
  private failures = 0;
  private openedAt = 0;

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly name: string;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.resetTimeoutMs   = opts.resetTimeoutMs   ?? 30_000;
    this.name             = opts.name             ?? "circuit-breaker";
  }

  get currentState(): CBState {
    return this.state;
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "OPEN") {
      if (Date.now() - this.openedAt >= this.resetTimeoutMs) {
        this.state = "HALF_OPEN";
        log.info(`circuit OPEN → HALF_OPEN (probe)`, { breaker: this.name });
      } else {
        throw new CircuitBreakerOpenError(this.name);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err: unknown) {
      this.onFailure(err);
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state === "HALF_OPEN") {
      log.info(`circuit HALF_OPEN → CLOSED (probe succeeded)`, { breaker: this.name });
    }
    this.state = "CLOSED";
    this.failures = 0;
  }

  private onFailure(err: unknown): void {
    this.failures++;
    const msg = err instanceof Error ? err.message : String(err);
    if (this.state === "HALF_OPEN") {
      log.warn(`circuit probe failed — re-opening`, { breaker: this.name, error: msg });
      this.trip();
    } else if (this.failures >= this.failureThreshold) {
      log.warn(`circuit failure threshold reached — opening`, { breaker: this.name, failures: this.failures, error: msg });
      this.trip();
    }
  }

  private trip(): void {
    this.state    = "OPEN";
    this.openedAt = Date.now();
  }

  /** Force-reset for testing. */
  reset(): void {
    this.state    = "CLOSED";
    this.failures = 0;
    this.openedAt = 0;
  }
}
