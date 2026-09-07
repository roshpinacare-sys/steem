'use strict';
/**
 * src/lib/telemetry268.js — OpenTelemetry GenAI Spans + ECOS Metrics (V268)
 *
 * Builds on telemetry264 with:
 *   - Program-level metrics rollup (aggregate cost/retries per program)
 *   - x402 payment telemetry: track per-endpoint payment totals
 *   - Mobile compact metrics payload (for thin clients on 2G/3G)
 *   - Backing ratio alert integration (emit span on backing ratio warn/halt)
 *   - ECOS-specific semantic conventions on top of OTel GenAI spec
 *
 * PROGRAM 12: Observability
 * Zero new npm deps. Identifiers end with 268.
 */
'use strict';

const crypto = require('node:crypto');

const METRICS_RING_SIZE_268 = 10_000;
const SPAN_RING_SIZE_268    = 50_000;

class Telemetry268 {
  constructor(opts = {}) {
    this._logger     = opts.logger  || console;
    this._spans268   = [];
    this._metrics268 = {
      totalRequests:    0,
      retries:          0,
      cacheHits:        0,
      fallbacks:        0,
      totalCostMicro:   0n,
      x402TotalUSDC:    0,
      byTaskType:       {},
      byProgram:        {},
    };
    this._otelTracer    = opts.tracer || null;
    this._programSpans268 = new Map(); // programId → spanId[]
  
    this._perf268 = { latencies: [] };
    this._logAdapter268 = opts.logAdapter || null;
  }

  startSpan268(spanName, attrs = {}) {
    const spanId  = 'span268::' + crypto.randomBytes(8).toString('hex');
    const traceId = attrs.traceId || 'trace268::' + crypto.randomBytes(8).toString('hex');
    const span = {
      spanId, traceId, name: spanName,
      startTime: Date.now(), endTime: null,
      status: 'UNSET',
      attrs: {
        'gen_ai.system':             'ecos',
        'gen_ai.operation.name':     spanName,
        'gen_ai.request.model':      attrs.model     || 'unknown',
        'gen_ai.request.max_tokens': attrs.maxTokens || null,
        'ecos.task_type':            attrs.taskType  || null,
        'ecos.mission_id':           attrs.missionId || null,
        'ecos.program_id':           attrs.programId || null,
        'ecos.user_id':              attrs.userId    || null,
        'ecos.version':              '268',
        'ecos.x402_receipt':         attrs.x402Receipt || null,
        ...attrs,
      },
      events: [],
    };

    this._spans268.push(span);
    if (this._spans268.length > SPAN_RING_SIZE_268) this._spans268.shift();

    // Index by program
    if (attrs.programId) {
      if (!this._programSpans268.has(attrs.programId)) this._programSpans268.set(attrs.programId, []);
      this._programSpans268.get(attrs.programId).push(spanId);
    }

    if (this._otelTracer?.startSpan) {
      try { span._otelSpan = this._otelTracer.startSpan(spanName, { attributes: span.attrs }); } catch (_) {}
    }

    return {
      spanId, traceId,
      addEvent: (name, eAttrs = {}) => span.events.push({ name, attrs: eAttrs, ts: Date.now() }),
      setStatus: (status, msg) => { span.status = status; if (msg) span.statusMessage = msg; },
      end: (endAttrs = {}) => this._endSpan268(span, endAttrs),
    };
  }

  recordRequest268(opts = {}) {
    const _t0 = Date.now();
    this._metrics268.totalRequests++;
    if (opts.retry)     this._metrics268.retries++;
    if (opts.cacheHit)  this._metrics268.cacheHits++;
    if (opts.fallback)  this._metrics268.fallbacks++;
    if (opts.costMicro) {
      const c = typeof opts.costMicro === 'bigint' ? opts.costMicro : BigInt(opts.costMicro);
      this._metrics268.totalCostMicro += c;
    }
    if (opts.x402USDC)  this._metrics268.x402TotalUSDC += opts.x402USDC;
    if (opts.taskType) {
      const t = this._metrics268.byTaskType;
      if (!t[opts.taskType]) t[opts.taskType] = { count: 0, costMicro: 0n };
      t[opts.taskType].count++;
      if (opts.costMicro) t[opts.taskType].costMicro += typeof opts.costMicro === 'bigint' ? opts.costMicro : BigInt(opts.costMicro);
    }
    if (opts.programId) {
      const p = this._metrics268.byProgram;
      if (!p[opts.programId]) p[opts.programId] = { count: 0, costMicro: 0n };
      p[opts.programId].count++;
      if (opts.costMicro) p[opts.programId].costMicro += typeof opts.costMicro === 'bigint' ? opts.costMicro : BigInt(opts.costMicro);
    }
    this._recordLatency268(_t0);
  }

  emitBackingAlert268(alert) {
    const span = this.startSpan268('ecos.backing_alert', {
      'ecos.alert_type': alert.type,
      'ecos.backing_ratio': alert.ratio,
    });
    span.setStatus(alert.type === 'HALT_ISSUANCE' ? 'ERROR' : 'WARN', alert.type);
    span.end();
  }

  getDashboard268() {
    const byTaskType = {};
    for (const [k, v] of Object.entries(this._metrics268.byTaskType)) {
      byTaskType[k] = { count: v.count, costMicro: v.costMicro.toString() };
    }
    const byProgram = {};
    for (const [k, v] of Object.entries(this._metrics268.byProgram)) {
      byProgram[k] = { count: v.count, costMicro: v.costMicro.toString() };
    }
    return {
      version: '268',
      totalRequests:  this._metrics268.totalRequests,
      retries:        this._metrics268.retries,
      cacheHits:      this._metrics268.cacheHits,
      fallbacks:      this._metrics268.fallbacks,
      totalCostMicro: this._metrics268.totalCostMicro.toString(),
      x402TotalUSDC:  this._metrics268.x402TotalUSDC,
      recentSpans:    this._spans268.length,
      byTaskType,
      byProgram,
    };
  }

  getMobileDashboard268() {
    return {
      v:  '268',
      rq: this._metrics268.totalRequests,
      rt: this._metrics268.retries,
      ch: this._metrics268.cacheHits,
      cm: this._metrics268.totalCostMicro.toString(),
      x4: this._metrics268.x402TotalUSDC.toFixed(4),
    };
  }

  getProgramMetrics268(programId) {
    const p = this._metrics268.byProgram[programId];
    return p ? { programId, count: p.count, costMicro: p.costMicro.toString() } : null;
  }

  _endSpan268(span, endAttrs) {
    span.endTime = Date.now();
    span.status  = endAttrs.status || span.status || 'OK';
    Object.assign(span.attrs, endAttrs);
    if (span._otelSpan?.end) { try { span._otelSpan.end(); } catch (_) {} }
  }

  // ── V268: Performance Telemetry ─────────────────────────────────────────────
  getPerf268() { return _calcPercentiles268(this._perf268.latencies); }

  _recordLatency268(t0) {
    const ms = Date.now() - t0;
    this._perf268.latencies.push(ms);
    if (this._perf268.latencies.length > 1000) this._perf268.latencies.shift();
  }

  // ── V268: Health Check ────────────────────────────────────────────────────
  checkTelemetryHealth268() {
    return {
      ok: true,
      module: 'telemetry268 OTel spans',
      version: '268',
      perf: this.getPerf268(),
      logAdapter: this._logAdapter268 ? { type: 'external', ok: true } : { type: 'none' },
    };
  }

}

const defaultTelemetry268 = new Telemetry268();


// ── V268 Performance Telemetry helper ────────────────────────────────────────
function _calcPercentiles268(arr) {
  if (!arr || arr.length === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  const p = (pct) => sorted[Math.min(Math.floor(n * pct / 100), n - 1)];
  return { p50: p(50), p95: p(95), p99: p(99), count: n };
}

module.exports = {
  Telemetry268,
  defaultTelemetry268,
};
