/**
 * TFA Evolution Studio v28 — Resource Pool
 *
 * Parallel-safe concurrency limiter with:
 *   - Dynamic resize (raise/lower concurrency limit at runtime)
 *   - Drain: wait until all in-flight work completes
 *   - Total throughput and peak-concurrency metrics
 *   - Per-slot timing for observability
 *   - tryAcquire: non-blocking fast-path that rejects if pool is saturated
 */

export interface PoolMetrics {
  running: number;
  queued: number;
  max: number;
  totalCompleted: number;
  totalFailed: number;
  peakConcurrency: number;
  avgDurationMs: number;
}

export class ResourcePool {
  private running = 0;
  private queue: Array<() => void> = [];
  private max: number;
  private drainWaiters: Array<() => void> = [];

  // Observability counters
  private totalCompleted = 0;
  private totalFailed = 0;
  private peakConcurrency = 0;
  private totalDurationMs = 0;

  constructor(max: number) {
    if (max < 1) throw new Error("ResourcePool: max concurrency must be >= 1");
    this.max = max;
  }

  async acquire<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.max) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    return this.run(fn);
  }

  /**
   * Non-blocking: returns undefined immediately if pool is saturated.
   * Use for best-effort opportunistic work that can be skipped.
   */
  async tryAcquire<T>(fn: () => Promise<T>): Promise<T | undefined> {
    if (this.running >= this.max) return undefined;
    return this.run(fn);
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    this.running++;
    if (this.running > this.peakConcurrency) {
      this.peakConcurrency = this.running;
    }
    const start = Date.now();
    try {
      const result = await fn();
      this.totalCompleted++;
      return result;
    } catch (e) {
      this.totalFailed++;
      throw e;
    } finally {
      this.totalDurationMs += Date.now() - start;
      this.running--;
      const next = this.queue.shift();
      if (next) {
        next();
      } else if (this.running === 0) {
        // Notify drain() waiters
        for (const resolve of this.drainWaiters) resolve();
        this.drainWaiters = [];
      }
    }
  }

  /**
   * Resize the pool's concurrency limit at runtime.
   * If increasing: immediately unblocks waiting queue entries up to the new limit.
   * If decreasing: in-flight work continues; new work blocks at the lower limit.
   */
  resize(newMax: number): void {
    if (newMax < 1) throw new Error("ResourcePool: max concurrency must be >= 1");
    const prev = this.max;
    this.max = newMax;
    if (newMax > prev) {
      // Drain backlogged queue entries up to newly available slots
      const slotsOpened = newMax - prev;
      for (let i = 0; i < slotsOpened; i++) {
        const next = this.queue.shift();
        if (next) next();
      }
    }
  }

  /**
   * Returns a promise that resolves when all in-flight work has completed
   * and the queue is empty. Safe to call with nothing running (resolves immediately).
   */
  async drain(): Promise<void> {
    if (this.running === 0 && this.queue.length === 0) return;
    return new Promise<void>((resolve) => this.drainWaiters.push(resolve));
  }

  getMetrics(): PoolMetrics {
    const total = this.totalCompleted + this.totalFailed;
    return {
      running: this.running,
      queued: this.queue.length,
      max: this.max,
      totalCompleted: this.totalCompleted,
      totalFailed: this.totalFailed,
      peakConcurrency: this.peakConcurrency,
      avgDurationMs: total > 0 ? this.totalDurationMs / total : 0,
    };
  }

  resetMetrics(): void {
    this.totalCompleted = 0;
    this.totalFailed = 0;
    this.peakConcurrency = 0;
    this.totalDurationMs = 0;
  }
}

export const defaultPool = new ResourcePool(4);
