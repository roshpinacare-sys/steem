/**
 * axiom-shipper.ts — Structured log shipping to Axiom.
 *
 * Registers itself as a logger subscriber and buffers records in memory.
 * Flushes to the Axiom ingest API either when the batch is full (100 records)
 * or when the flush interval fires (every 5 seconds).  A final synchronous
 * flush is attempted on process exit via `beforeExit`.
 *
 * Activation:
 *   Call `initAxiomShipper(token, dataset)` once at startup (cli.ts) when both
 *   AXIOM_TOKEN and AXIOM_DATASET are present in the validated env.
 *
 * No-op when credentials are absent — safe to call unconditionally.
 */

import { subscribeToLogs, type LogRecord } from "./logger.js";
import { fetchWithTimeout } from "../utils/fetch-timeout.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AXIOM_INGEST_URL = "https://api.axiom.co/v1/datasets/{dataset}/ingest";
const BATCH_SIZE       = 100;
const FLUSH_INTERVAL   = 5_000; // ms

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _buffer:   LogRecord[] = [];
let _token:    string      = "";
let _dataset:  string      = "";
let _timer:    ReturnType<typeof setInterval> | null = null;
let _active    = false;

// ---------------------------------------------------------------------------
// Flush
// ---------------------------------------------------------------------------

async function flush(): Promise<void> {
  if (_buffer.length === 0) return;

  const batch = _buffer.splice(0, _buffer.length);
  const url   = AXIOM_INGEST_URL.replace("{dataset}", encodeURIComponent(_dataset));

  try {
    const res = await fetchWithTimeout(
      url,
      {
        method:  "POST",
        headers: {
          "Content-Type":  "application/x-ndjson",
          Authorization:   `Bearer ${_token}`,
        },
        // Axiom expects NDJSON: one JSON object per line
        body: batch.map((r) => JSON.stringify(r)).join("\n"),
      },
      20_000,
    );
    if (!res.ok) {
      // Log to stderr directly to avoid re-entering the subscriber loop
      process.stderr.write(
        `[axiom-shipper] ingest failed: HTTP ${res.status}\n`,
      );
    }
  } catch (e: unknown) {
    process.stderr.write(
      `[axiom-shipper] network error: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    // Re-queue — best-effort; discard after one retry to prevent unbounded growth
    if (_buffer.length < BATCH_SIZE * 2) _buffer.unshift(...batch.slice(0, BATCH_SIZE));
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise the Axiom shipper.  Idempotent — safe to call multiple times.
 * Returns true if the shipper was activated, false if credentials were absent.
 */
export function initAxiomShipper(token: string, dataset: string): boolean {
  if (!token || !dataset) return false;
  if (_active) return true; // already running

  _token   = token;
  _dataset = dataset;
  _active  = true;

  // Subscribe to the in-process log bus
  subscribeToLogs((record) => {
    _buffer.push(record);
    if (_buffer.length >= BATCH_SIZE) {
      flush().catch(() => { /* swallow — already handled inside flush() */ });
    }
  });

  // Periodic flush
  _timer = setInterval(() => {
    flush().catch(() => {});
  }, FLUSH_INTERVAL);
  if (_timer.unref) _timer.unref(); // don't keep the process alive

  // Best-effort flush before process exits
  process.on("beforeExit", () => {
    // Synchronous-compatible: fire-and-forget; Node gives one tick on beforeExit
    flush().catch(() => {});
  });

  process.stderr.write(`[axiom-shipper] shipping logs to Axiom dataset "${dataset}"\n`);
  return true;
}

/**
 * Force an immediate flush (e.g. at end of run or in tests).
 */
export async function flushAxiomShipper(): Promise<void> {
  await flush();
}

/**
 * Tear down — stops the timer and resets state.  Only for tests.
 */
export function _resetAxiomShipper(): void {
  if (_timer) { clearInterval(_timer); _timer = null; }
  _buffer  = [];
  _token   = "";
  _dataset = "";
  _active  = false;
}
