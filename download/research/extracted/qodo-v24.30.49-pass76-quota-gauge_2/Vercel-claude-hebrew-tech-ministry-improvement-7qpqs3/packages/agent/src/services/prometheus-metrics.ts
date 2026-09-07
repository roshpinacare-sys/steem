/**
 * Prometheus Metrics — exposes a /metrics endpoint in text-exposition format.
 * Tracks: run latency histogram, error rate counter, token usage counter,
 * active runs gauge, cost gauge.
 */

// ── Types ──────────────────────────────────────────────────────────────────

interface Counter {
  name: string;
  help: string;
  labels: Record<string, string>;
  value: number;
}

interface Gauge {
  name: string;
  help: string;
  labels: Record<string, string>;
  value: number;
}

interface HistogramBucket {
  le: number;
  count: number;
}

interface Histogram {
  name: string;
  help: string;
  labels: Record<string, string>;
  buckets: HistogramBucket[];
  sum: number;
  count: number;
}

// ── Registry ───────────────────────────────────────────────────────────────

class MetricsRegistry {
  private counters = new Map<string, Counter>();
  private gauges = new Map<string, Gauge>();
  private histograms = new Map<string, Histogram>();

  // Boundaries for run-duration histogram (seconds)
  private readonly LATENCY_BUCKETS = [5, 15, 30, 60, 120, 300, 600, 900];

  constructor() {
    this.initDefaults();
  }

  private initDefaults(): void {
    this.ensureHistogram('qodo_run_duration_seconds', 'Duration of agent runs in seconds');
    this.ensureCounter('qodo_runs_total', 'Total agent runs', { status: 'success' });
    this.ensureCounter('qodo_runs_total', 'Total agent runs', { status: 'failure' });
    this.ensureCounter('qodo_tokens_used_total', 'Total LLM tokens consumed', { model: 'total' });
    this.ensureGauge('qodo_active_runs', 'Number of currently active runs', {});
    this.ensureGauge('qodo_run_cost_usd', 'Cost of last run in USD', {});
    this.ensureCounter('qodo_cve_found_total', 'Total CVEs found', { severity: 'critical' });
    this.ensureCounter('qodo_cve_found_total', 'Total CVEs found', { severity: 'high' });
    this.ensureCounter('qodo_license_violations_total', 'Total license violations found', { reason: 'denied' });
  }

  private escapeLabelValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  }

  private labelKey(labels: Record<string, string>): string {
    return Object.entries(labels).sort().map(([k, v]) => `${k}="${this.escapeLabelValue(v)}"`).join(',');
  }

  private metricKey(name: string, labels: Record<string, string>): string {
    return `${name}{${this.labelKey(labels)}}`;
  }

  private ensureCounter(name: string, help: string, labels: Record<string, string>): void {
    const key = this.metricKey(name, labels);
    if (!this.counters.has(key)) {
      this.counters.set(key, { name, help, labels, value: 0 });
    }
  }

  private ensureGauge(name: string, help: string, labels: Record<string, string>): void {
    const key = this.metricKey(name, labels);
    if (!this.gauges.has(key)) {
      this.gauges.set(key, { name, help, labels, value: 0 });
    }
  }

  private ensureHistogram(name: string, help: string): void {
    if (!this.histograms.has(name)) {
      this.histograms.set(name, {
        name,
        help,
        labels: {},
        buckets: this.LATENCY_BUCKETS.map((le) => ({ le, count: 0 })),
        sum: 0,
        count: 0,
      });
    }
  }

  incCounter(name: string, labels: Record<string, string> = {}, by = 1): void {
    const key = this.metricKey(name, labels);
    this.ensureCounter(name, name, labels);
    const c = this.counters.get(key)!;
    c.value += by;
  }

  setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.metricKey(name, labels);
    this.ensureGauge(name, name, labels);
    this.gauges.get(key)!.value = value;
  }

  observeHistogram(name: string, valueSeconds: number): void {
    this.ensureHistogram(name, name);
    const h = this.histograms.get(name)!;
    h.sum += valueSeconds;
    h.count++;
    for (const bucket of h.buckets) {
      if (valueSeconds <= bucket.le) bucket.count++;
    }
  }

  // ── Public helpers ─────────────────────────────────────────────────────

  recordRunSuccess(durationMs: number, costUsd: number): void {
    this.incCounter('qodo_runs_total', { status: 'success' });
    this.observeHistogram('qodo_run_duration_seconds', durationMs / 1000);
    this.setGauge('qodo_run_cost_usd', costUsd);
  }

  recordRunFailure(durationMs: number): void {
    this.incCounter('qodo_runs_total', { status: 'failure' });
    this.observeHistogram('qodo_run_duration_seconds', durationMs / 1000);
  }

  recordTokens(model: string, tokens: number): void {
    this.incCounter('qodo_tokens_used_total', { model }, tokens);
  }

  setActiveRuns(count: number): void {
    this.setGauge('qodo_active_runs', count);
  }

  recordCve(severity: 'critical' | 'high'): void {
    this.incCounter('qodo_cve_found_total', { severity });
  }

  recordLicenseViolation(reason: 'denied' | 'unknown'): void {
    this.incCounter('qodo_license_violations_total', { reason });
  }

  // ── Text exposition ────────────────────────────────────────────────────

  exposition(): string {
    const lines: string[] = [];

    // Counters
    const counterNames = new Set([...this.counters.values()].map((c) => c.name));
    for (const name of counterNames) {
      const entries = [...this.counters.values()].filter((c) => c.name === name);
      lines.push(`# HELP ${name} ${entries[0].help}`);
      lines.push(`# TYPE ${name} counter`);
      for (const c of entries) {
        const lbl = Object.entries(c.labels).map(([k, v]) => `${k}="${this.escapeLabelValue(v)}"`).join(',');
        lines.push(`${name}{${lbl}} ${c.value}`);
      }
    }

    // Gauges
    const gaugeNames = new Set([...this.gauges.values()].map((g) => g.name));
    for (const name of gaugeNames) {
      const entries = [...this.gauges.values()].filter((g) => g.name === name);
      lines.push(`# HELP ${name} ${entries[0].help}`);
      lines.push(`# TYPE ${name} gauge`);
      for (const g of entries) {
        const lbl = Object.entries(g.labels).map(([k, v]) => `${k}="${this.escapeLabelValue(v)}"`).join(',');
        lines.push(`${name}{${lbl}} ${g.value}`);
      }
    }

    // Histograms
    for (const h of this.histograms.values()) {
      lines.push(`# HELP ${h.name} ${h.help}`);
      lines.push(`# TYPE ${h.name} histogram`);
      for (const b of h.buckets) {
        lines.push(`${h.name}_bucket{le="${this.escapeLabelValue(String(b.le))}"} ${b.count}`);
      }
      lines.push(`${h.name}_bucket{le="+Inf"} ${h.count}`);
      lines.push(`${h.name}_sum ${h.sum}`);
      lines.push(`${h.name}_count ${h.count}`);
    }

    return lines.join('\n') + '\n';
  }
}

// Named export of class for tests that need isolated instances
export { MetricsRegistry };
// Singleton for production use
export const metrics = new MetricsRegistry();
