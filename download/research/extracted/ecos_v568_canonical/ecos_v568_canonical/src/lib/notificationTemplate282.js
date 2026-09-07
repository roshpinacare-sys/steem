'use strict';
/**
 * src/lib/notificationTemplate282.js — ECOS Notification Template Engine (V282)
 *
 * V282 adds notification templates and conditional alert routing on top of V281:
 *   - registerNotificationTemplate282(name, opts)  — register a named template
 *   - deregisterNotificationTemplate282(name)       — remove a template
 *   - getTemplates282()                             — list all templates
 *   - getTemplate282(name)                          — get a single template
 *   - renderTemplate282(name, context)              — render template with context
 *   - previewTemplate282(name, sampleDigest)        — preview with a sample digest
 *   - getStatus282()                                — runtime status
 *   - checkNotificationTemplateHealth282()          — health check
 *   - getPerf282()                                  — latency percentiles
 *
 * Template syntax: Mustache-style {{varName}} substitution.
 * contentType: 'json' | 'text' (default: 'text')
 *
 * Iron rules: zero new npm deps. All identifiers end in 282. Sacred files untouched.
 */

const crypto = require('node:crypto');

const TEMPLATE_VERSION_282      = '282';
const TEMPLATE_MAX_TEMPLATES_282 = 200;

class NotificationTemplate282 {
  /**
   * @param {object} opts
   * @param {object} [opts.logger]
   * @param {object} [opts.logAdapter]
   */
  constructor(opts = {}) {
    this._logger282     = opts.logger     || console;
    this._logAdapter282 = opts.logAdapter || null;

    // Template registry: Map<name, templateConfig>
    this._templates282 = new Map();

    // Perf ring buffer (last 1000 latencies)
    this._perfLatencies282 = [];
  }

  // ── Template Registry ─────────────────────────────────────────────────────

  /**
   * Register a new notification template.
   *
   * @param {string} name — unique template name
   * @param {object} opts
   * @param {string} opts.subject     — subject line template (for email/webhook title)
   * @param {string} opts.body        — body template with {{var}} placeholders
   * @param {string} [opts.contentType] — 'json' | 'text' (default: 'text')
   * @param {string} [opts.description] — human-readable description
   * @returns {{ ok, name, contentType, registeredAt, version }}
   */
  registerNotificationTemplate282(name, opts = {}) {
    const _t0 = Date.now();
    if (!name || typeof name !== 'string')
      return { ok: false, error: 'name must be a non-empty string', version: TEMPLATE_VERSION_282 };
    if (this._templates282.has(name))
      return { ok: false, error: `template '${name}' already registered`, version: TEMPLATE_VERSION_282 };
    if (this._templates282.size >= TEMPLATE_MAX_TEMPLATES_282)
      return { ok: false, error: `template limit (${TEMPLATE_MAX_TEMPLATES_282}) reached`, version: TEMPLATE_VERSION_282 };
    if (!opts.body || typeof opts.body !== 'string')
      return { ok: false, error: 'body must be a non-empty string', version: TEMPLATE_VERSION_282 };

    const contentType = opts.contentType === 'json' ? 'json' : 'text';
    const template = {
      name,
      subject:       opts.subject     || '',
      body:          opts.body,
      contentType,
      description:   opts.description || '',
      registeredAt:  new Date().toISOString(),
    };
    this._templates282.set(name, template);
    this._recordPerf282(Date.now() - _t0);
    return {
      ok:           true,
      name,
      contentType,
      registeredAt: template.registeredAt,
      version:      TEMPLATE_VERSION_282,
    };
  }

  /**
   * Remove a registered template.
   * @param {string} name
   * @returns {{ ok, name, version }}
   */
  deregisterNotificationTemplate282(name) {
    if (!this._templates282.has(name))
      return { ok: false, error: `template '${name}' not found`, version: TEMPLATE_VERSION_282 };
    this._templates282.delete(name);
    return { ok: true, name, version: TEMPLATE_VERSION_282 };
  }

  /**
   * List all registered templates.
   * @returns {{ ok, templates, total, version }}
   */
  getTemplates282() {
    const templates = [];
    for (const t of this._templates282.values()) {
      templates.push({ ...t });
    }
    return { ok: true, templates, total: templates.length, version: TEMPLATE_VERSION_282 };
  }

  /**
   * Get a single template by name.
   * @param {string} name
   * @returns {{ ok, template?, error?, version }}
   */
  getTemplate282(name) {
    const t = this._templates282.get(name);
    if (!t) return { ok: false, error: `template '${name}' not found`, version: TEMPLATE_VERSION_282 };
    return { ok: true, template: { ...t }, version: TEMPLATE_VERSION_282 };
  }

  /**
   * Render a template with a context object.
   * Substitutes {{key}} with context[key]. Unknown keys → empty string.
   *
   * @param {string} name    — template name
   * @param {object} context — key-value substitution map
   * @returns {{ ok, name, subject, body, contentType, version } | { ok, error, version }}
   */
  renderTemplate282(name, context = {}) {
    const _t0 = Date.now();
    const t = this._templates282.get(name);
    if (!t) {
      this._recordPerf282(Date.now() - _t0);
      return { ok: false, error: `template '${name}' not found`, version: TEMPLATE_VERSION_282 };
    }
    const render = (str) => str.replace(/\{\{(\w+)\}\}/g, (_, key) =>
      context[key] !== undefined ? String(context[key]) : ''
    );
    const rendered = {
      ok:          true,
      name,
      subject:     render(t.subject),
      body:        render(t.body),
      contentType: t.contentType,
      version:     TEMPLATE_VERSION_282,
    };
    this._recordPerf282(Date.now() - _t0);
    return rendered;
  }

  /**
   * Preview a template with a sample digest object.
   * Flattens top-level digest fields into the context.
   *
   * @param {string} name         — template name
   * @param {object} sampleDigest — digest-shaped object
   * @returns {{ ok, name, subject, body, contentType, sampleContext, version }}
   */
  previewTemplate282(name, sampleDigest = {}) {
    const context = _digestToContext282(sampleDigest);
    const rendered = this.renderTemplate282(name, context);
    if (!rendered.ok) return rendered;
    return { ...rendered, sampleContext: context };
  }

  /**
   * Runtime status.
   */
  getStatus282() {
    return {
      ok:              true,
      version:         TEMPLATE_VERSION_282,
      templateCount:   this._templates282.size,
    };
  }

  /**
   * Health check.
   */
  checkNotificationTemplateHealth282() {
    return {
      ok:            true,
      version:       TEMPLATE_VERSION_282,
      templateCount: this._templates282.size,
    };
  }

  /**
   * Perf percentiles from the ring buffer.
   */
  getPerf282() {
    const lats = this._perfLatencies282.slice().sort((a, b) => a - b);
    const count = lats.length;
    if (!count) return { p50: 0, p95: 0, p99: 0, count: 0 };
    const p = (pct) => lats[Math.floor((pct / 100) * count)] || 0;
    return { p50: p(50), p95: p(95), p99: p(99), count };
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _recordPerf282(latencyMs) {
    this._perfLatencies282.push(latencyMs);
    if (this._perfLatencies282.length > 1000) this._perfLatencies282.shift();
  }
}

/**
 * Flatten a digest object into a flat context for template substitution.
 * E.g. digest.totalAlerts → context.totalAlerts
 *      digest.period      → context.period
 */
function _digestToContext282(digest = {}) {
  const ctx = {};
  for (const [k, v] of Object.entries(digest)) {
    if (v !== null && v !== undefined && typeof v !== 'object') {
      ctx[k] = v;
    }
  }
  // Computed helpers
  ctx.ts        = ctx.ts        || new Date().toISOString();
  ctx.version   = ctx.version   || '282';
  ctx.breached  = ctx.breached  ?? 0;
  ctx.totalAlerts = ctx.totalAlerts ?? 0;
  ctx.period    = ctx.period    || 'scheduled';
  return ctx;
}

module.exports = { NotificationTemplate282, TEMPLATE_VERSION_282, _digestToContext282 };
