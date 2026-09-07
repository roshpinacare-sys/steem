/**
 * OpenTelemetry Tracer — thin wrapper around the OTel SDK.
 * Exports traces via OTLP/HTTP (Honeycomb, Grafana Tempo, Jaeger, etc.).
 * Falls back to no-op when OTEL_EXPORTER_OTLP_ENDPOINT is not set.
 */

import { fetchWithTimeout } from "../utils/fetch-timeout.js";

export interface SpanContext {
  traceId: string;
  spanId: string;
  name: string;
  startTime: number;
}

export interface FinishedSpan extends SpanContext {
  endTime: number;
  durationMs: number;
  status: 'OK' | 'ERROR';
  attributes: Record<string, string | number | boolean>;
  errorMessage?: string;
}

export interface OtelEnv {
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;
  OTEL_SERVICE_NAME?: string;
}

// Lightweight in-process tracer (no SDK dependency required at runtime).
// Swap for @opentelemetry/sdk-node when the dependency is available.
class QodoTracer {
  private spans: FinishedSpan[] = [];
  private endpoint: string;
  private serviceName: string;

  constructor(env: OtelEnv = process.env as OtelEnv) {
    this.endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '';
    this.serviceName = env.OTEL_SERVICE_NAME ?? 'qodo-agent';
  }

  startSpan(name: string, attributes: Record<string, string | number | boolean> = {}): SpanContext & { attributes: Record<string, string | number | boolean> } {
    const traceId = this.randomHex(16);
    const spanId = this.randomHex(8);
    return { traceId, spanId, name, startTime: Date.now(), attributes };
  }

  endSpan(
    ctx: SpanContext & { attributes: Record<string, string | number | boolean> },
    status: 'OK' | 'ERROR' = 'OK',
    errorMessage?: string,
  ): FinishedSpan {
    const endTime = Date.now();
    const span: FinishedSpan = {
      ...ctx,
      endTime,
      durationMs: endTime - ctx.startTime,
      status,
      attributes: { ...ctx.attributes, 'service.name': this.serviceName },
      errorMessage,
    };
    this.spans.push(span);
    if (this.endpoint) {
      this.exportSpan(span).catch(() => { /* best-effort */ });
    }
    return span;
  }

  async withSpan<T>(
    name: string,
    fn: (ctx: SpanContext) => Promise<T>,
    attributes: Record<string, string | number | boolean> = {},
  ): Promise<T> {
    const ctx = this.startSpan(name, attributes);
    try {
      const result = await fn(ctx);
      this.endSpan(ctx, 'OK');
      return result;
    } catch (err) {
      this.endSpan(ctx, 'ERROR', String(err));
      throw err;
    }
  }

  getSpans(): FinishedSpan[] {
    return [...this.spans];
  }

  private async exportSpan(span: FinishedSpan): Promise<void> {
    const body = {
      resourceSpans: [{
        resource: { attributes: [{ key: 'service.name', value: { stringValue: this.serviceName } }] },
        scopeSpans: [{
          scope: { name: 'qodo-agent' },
          spans: [{
            traceId: span.traceId,
            spanId: span.spanId,
            name: span.name,
            startTimeUnixNano: String(span.startTime * 1_000_000),
            endTimeUnixNano: String(span.endTime * 1_000_000),
            status: { code: span.status === 'OK' ? 1 : 2 },
            attributes: Object.entries(span.attributes).map(([k, v]) => ({
              key: k,
              value: typeof v === 'number'
                ? { intValue: v }
                : typeof v === 'boolean'
                  ? { boolValue: v }
                  : { stringValue: String(v) },
            })),
          }],
        }],
      }],
    };
    await fetchWithTimeout(
      `${this.endpoint}/v1/traces`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      20_000,
    );
  }

  private randomHex(bytes: number): string {
    return Array.from({ length: bytes * 2 }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join('');
  }
}

export const tracer = new QodoTracer();

/** Create a tracer instance using the supplied environment values.
 *  Useful for testing and for environments that validate env before boot. */
export function createTracer(env: OtelEnv): QodoTracer {
  return new QodoTracer(env);
}
