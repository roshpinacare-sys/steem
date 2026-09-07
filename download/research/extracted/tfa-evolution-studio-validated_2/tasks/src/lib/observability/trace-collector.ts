/**
 * TFA Evolution Studio v28 — Trace Collector
 *
 * Captures distributed traces and spans for pipeline runs.
 */

export interface TraceSpan {
  spanId: string;
  traceId: string;
  parentId?: string;
  name: string;
  startTime: string;
  endTime?: string;
  status: "ok" | "error";
}

const traces = new Map<string, TraceSpan[]>();

export function startSpan(traceId: string, name: string, parentId?: string): TraceSpan {
  const span: TraceSpan = {
    spanId: `span_${Date.now()}`,
    traceId,
    parentId,
    name,
    startTime: new Date().toISOString(),
    status: "ok",
  };
  const list = traces.get(traceId) || [];
  list.push(span);
  traces.set(traceId, list);
  return span;
}

export function endSpan(spanId: string, traceId: string, status: TraceSpan["status"] = "ok"): void {
  const list = traces.get(traceId) || [];
  const span = list.find((s) => s.spanId === spanId);
  if (span) {
    span.endTime = new Date().toISOString();
    span.status = status;
  }
}

export function getTrace(traceId: string): TraceSpan[] {
  return traces.get(traceId) || [];
}
