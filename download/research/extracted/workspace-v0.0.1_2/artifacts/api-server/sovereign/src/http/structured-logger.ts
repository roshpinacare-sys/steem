/**
 * src/http/structured-logger.ts — unified structured logging for sovereign HTTP.
 *
 * One JSON log line per request. Zero external dependencies.
 * Fields: ts, level, reqId, tenantId, method, path, status, durationMs, error?
 */

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  ts: string;
  level: LogLevel;
  reqId?: string;
  tenantId?: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  error?: string;
}

export type LogSink = (entry: LogEntry) => void;

/** Default sink: one JSON line to stdout. */
export function defaultSink(entry: LogEntry): void {
  console.log(JSON.stringify(entry));
}

export class StructuredLogger {
  private sink: LogSink;
  constructor(sink?: LogSink) {
    this.sink = sink ?? defaultSink;
  }
  log(entry: LogEntry): void {
    this.sink(entry);
  }
}

export interface LogContext {
  start: number;
  reqId?: string;
  tenantId?: string;
  method: string;
  path: string;
}

/** Capture the start of a request for later logging. */
export function beginLog(req: any): LogContext {
  return {
    start: Date.now(),
    reqId: req?._requestId,
    tenantId: req?._tenantId,
    method: req?.method ?? "GET",
    path: req?.url ?? req?.pattern ?? "/",
  };
}

/** Finalise a request log and optionally emit it via a logger. */
export function endLog(
  ctx: LogContext,
  status: number,
  opts: { error?: string; logger?: StructuredLogger } = {},
): LogEntry {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level: opts.error ? "error" : "info",
    method: ctx.method,
    path: ctx.path,
    status,
    durationMs: Date.now() - ctx.start,
  };
  if (ctx.reqId) entry.reqId = ctx.reqId;
  if (ctx.tenantId) entry.tenantId = ctx.tenantId;
  if (opts.error) entry.error = opts.error;
  opts.logger?.log(entry);
  return entry;
}
