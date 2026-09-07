/**
 * logger.ts — Structured JSON logger for Qodo V24.
 *
 * Replaces ad-hoc console.log/warn/error calls with a leveled, context-aware
 * logger that emits JSONL to stderr (or stdout in dev mode).  Every line
 * includes: timestamp, level, runId (when set), phase (when set), message,
 * and any extra context fields.
 *
 * Usage:
 *   import { log } from "./logger.js";
 *   log.info("phase started", { phase: "coder", prNumber: 42 });
 *   log.error("gate failed", { gate: "blast", reason: "too many files" });
 *
 * Integration with Mission Control:
 *   Structured logs are pushed to telemetry via the Telemetry service.
 *   The Mission Control LiveStream panel subscribes to the SSE stream and
 *   renders log lines in real time.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogRecord {
  ts: string;
  level: LogLevel;
  runId?: string;
  phase?: string;
  msg: string;
  [key: string]: unknown;
}

export interface LogContext {
  runId?: string;
  phase?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// In-memory subscribers (used by LiveStream SSE integration)
// ---------------------------------------------------------------------------

type Subscriber = (record: LogRecord) => void;
const subscribers = new Set<Subscriber>();

export function subscribeToLogs(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

// ---------------------------------------------------------------------------
// Core emit
// ---------------------------------------------------------------------------

// `process` is absent in the browser (EdgePrefetchServer is bundled into
// Mission Control); Vite statically replaces `process.env.NODE_ENV`, but any
// direct process.stdout/stderr access must stay behind this guard.
const HAS_PROCESS = typeof process !== "undefined" && typeof process.stdout?.write === "function";
const IS_DEV = process.env.NODE_ENV !== "production";

function emit(level: LogLevel, msg: string, ctx: LogContext = {}): void {
  const record: LogRecord = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...ctx,
  };

  const line = JSON.stringify(record);

  // Dev: colorised compact output to stdout; prod: JSONL to stderr
  if (IS_DEV) {
    const color: Record<LogLevel, string> = {
      debug: "\x1b[90m",
      info:  "\x1b[36m",
      warn:  "\x1b[33m",
      error: "\x1b[31m",
    };
    const reset = "\x1b[0m";
    const prefix = ctx.runId ? `[${ctx.runId}]` : "";
    const phase  = ctx.phase ? `(${ctx.phase})` : "";
    const pretty = `${color[level]}[${level.toUpperCase()}]${reset} ${prefix}${phase} ${msg}${
      Object.keys(ctx).filter((k) => k !== "runId" && k !== "phase").length
        ? " " + JSON.stringify(Object.fromEntries(Object.entries(ctx).filter(([k]) => k !== "runId" && k !== "phase")))
        : ""
    }`;
    if (HAS_PROCESS) process.stdout.write(pretty + "\n");
    else console.log(pretty); // eslint-disable-line no-console
  } else {
    if (HAS_PROCESS) process.stderr.write(line + "\n");
    else console.error(line); // eslint-disable-line no-console
  }

  // Notify in-memory subscribers (LiveStream panel)
  for (const sub of subscribers) {
    try { sub(record); } catch { /* subscriber errors must not crash the pipeline */ }
  }
}

// ---------------------------------------------------------------------------
// Bound logger factory
// ---------------------------------------------------------------------------

export interface Logger {
  debug(msg: string, ctx?: LogContext): void;
  info(msg: string, ctx?: LogContext): void;
  warn(msg: string, ctx?: LogContext): void;
  error(msg: string, ctx?: LogContext): void;
  child(ctx: LogContext): Logger;
}

function makeLogger(base: LogContext = {}): Logger {
  return {
    debug: (msg, ctx) => emit("debug", msg, { ...base, ...ctx }),
    info:  (msg, ctx) => emit("info",  msg, { ...base, ...ctx }),
    warn:  (msg, ctx) => emit("warn",  msg, { ...base, ...ctx }),
    error: (msg, ctx) => emit("error", msg, { ...base, ...ctx }),
    child: (ctx) => makeLogger({ ...base, ...ctx }),
  };
}

/** Root logger — use directly or call `.child({ runId, phase })` for context. */
export const log = makeLogger();
