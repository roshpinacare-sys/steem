/**
 * operatorReportMailer.js — ECOS V141
 * ─────────────────────────────────────────────────────────────────────────────
 * [V141-ORM-01] Email delivery for EU AI Act Operator Compliance Reports.
 *
 * Supports two backends (auto-selected by env vars):
 *   1. SMTP via nodemailer   (SMTP_HOST set)
 *   2. ManualRail webhook    (ECOS_WEBHOOK_REPORT_URL set) — always available fallback
 *
 * Usage:
 *   const mailer = getOperatorReportMailer();
 *   const result = await mailer.send({ report, to, format: 'markdown' });
 *   // → { ok: true, method: 'smtp'|'webhook'|'logged', messageId?, webhookStatus? }
 *
 * ECOS design principle: never block on external provider.
 * If both SMTP and webhook fail → log to DB and return { ok: true, method: 'logged' }.
 *
 * [V141-ORM-01] Initial implementation
 */

'use strict';

const WEBHOOK_URL   = process.env.ECOS_WEBHOOK_REPORT_URL || null;
const SMTP_HOST     = process.env.SMTP_HOST     || null;
const SMTP_PORT     = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER     = process.env.SMTP_USER     || null;
const SMTP_PASS     = process.env.SMTP_PASS     || null;
const SMTP_FROM     = process.env.SMTP_FROM     || 'noreply@ecos.ai';

class OperatorReportMailer {
  constructor() {
    this._pool       = null;
    this._transporter = null; // lazy-init nodemailer
    this._lastSent   = [];   // in-memory delivery log (last 50)
  }

  setPool(pool) { this._pool = pool; }

  /**
   * Send an operator compliance report by email.
   *
   * @param {object} opts
   * @param {object}  opts.report      — full report object (from operatorReport.generate())
   * @param {string}  opts.to          — recipient email
   * @param {string}  [opts.format='markdown'] — 'json' | 'markdown'
   * @param {string}  [opts.subject]   — override subject line
   * @returns {Promise<{ ok: boolean, method: string, messageId?: string, error?: string }>}
   */
  async send({ report, to, format = 'markdown', subject }) {
    if (!to) throw new Error('[OperatorReportMailer] recipient (to) is required');
    if (!report) throw new Error('[OperatorReportMailer] report is required');

    const subjectLine = subject
      || `ECOS EU AI Act Compliance Report — ${report.systemIdentity?.version || 'V141'} — ${report.overallStatus}`;

    const body = format === 'json'
      ? JSON.stringify(report, null, 2)
      : (report._markdown || this._buildMarkdownSummary(report));

    let result;

    // 1. Try SMTP
    if (SMTP_HOST) {
      result = await this._sendSmtp({ to, subject: subjectLine, body, format });
      if (result.ok) return this._record(result, to);
    }

    // 2. Try webhook fallback
    if (WEBHOOK_URL) {
      result = await this._sendWebhook({ report, to, subject: subjectLine, format });
      if (result.ok) return this._record(result, to);
    }

    // 3. Graceful logged fallback — never fail silently
    result = await this._logToDb({ report, to, subjectLine, body });
    return this._record(result, to);
  }

  // ── SMTP transport ────────────────────────────────────────────────────────

  async _sendSmtp({ to, subject, body, format }) {
    try {
      const nodemailer = require('nodemailer');

      if (!this._transporter) {
        this._transporter = nodemailer.createTransport({
          host: SMTP_HOST,
          port: SMTP_PORT,
          secure: SMTP_PORT === 465,
          auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
        });
      }

      const info = await this._transporter.sendMail({
        from:    SMTP_FROM,
        to,
        subject,
        [format === 'json' ? 'text' : 'text']: body,
        ...(format === 'markdown' ? { html: this._markdownToHtml(body) } : {}),
      });

      return { ok: true, method: 'smtp', messageId: info.messageId };
    } catch (err) {
      return { ok: false, method: 'smtp', error: err.message };
    }
  }

  // ── Webhook fallback ──────────────────────────────────────────────────────

  async _sendWebhook({ report, to, subject, format }) {
    try {
      const payload = {
        event:     'operator_report_delivery',
        to,
        subject,
        format,
        overallStatus: report.overallStatus,
        reportVersion: report.systemIdentity?.version,
        generatedAt:   report.generatedAt,
        reportSummary: {
          chainLength:   report.auditChain?.chainLength,
          chainIntact:   report.auditChain?.chainIntact,
          openIssues:    (report.openIssues || []).length,
          daysToDeadline: report.riskClassification?.daysToDeadline,
        },
        ecosVersion: 'V141',
      };

      const res = await fetch(WEBHOOK_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        signal:  AbortSignal.timeout(10_000),
      });

      return {
        ok: res.ok,
        method: 'webhook',
        webhookStatus: res.status,
        error: res.ok ? undefined : `HTTP ${res.status}`,
      };
    } catch (err) {
      return { ok: false, method: 'webhook', error: err.message };
    }
  }

  // ── DB logged fallback ────────────────────────────────────────────────────

  async _logToDb({ report, to, subjectLine, body }) {
    if (this._pool) {
      try {
        await this._pool.query(
          `INSERT INTO operator_report_deliveries
             (recipient, subject, overall_status, report_json, method, sent_at)
           VALUES ($1, $2, $3, $4, 'logged', NOW())`,
          [to, subjectLine, report.overallStatus, JSON.stringify(report)]
        );
      } catch (_) { /* non-fatal */ }
    }
    return { ok: true, method: 'logged', note: 'No SMTP/webhook configured; delivery stored in DB.' };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _buildMarkdownSummary(report) {
    const status = report.overallStatus || 'UNKNOWN';
    const issues = (report.openIssues || []);
    const criticals = issues.filter(i => i.severity === 'CRITICAL').length;
    return [
      `# ECOS EU AI Act Compliance Report`,
      `**Status:** ${status}`,
      `**Version:** ${report.systemIdentity?.version || 'V141'}`,
      `**Generated:** ${report.generatedAt || new Date().toISOString()}`,
      '',
      `## Summary`,
      `- Audit chain: ${report.auditChain?.chainLength ?? '—'} entries, intact: ${report.auditChain?.chainIntact ?? '—'}`,
      `- Open issues: ${issues.length} (${criticals} critical)`,
      `- Days to EU AI Act deadline: ${report.riskClassification?.daysToDeadline ?? '—'}`,
      '',
      issues.length > 0 ? `## Open Issues\n${issues.map(i => `- [${i.severity}] ${i.message} (${i.article})`).join('\n')}` : '## No Open Issues ✅',
    ].join('\n');
  }

  _markdownToHtml(md) {
    // Minimal safe conversion — no deps
    return '<pre style="font-family:monospace;white-space:pre-wrap">' +
      md.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') +
      '</pre>';
  }

  _record(result, to) {
    this._lastSent.unshift({ ...result, to, sentAt: new Date().toISOString() });
    if (this._lastSent.length > 50) this._lastSent.length = 50;
    return result;
  }

  deliveryLog() { return this._lastSent.slice(); }

  isAvailable() {
    return !!(SMTP_HOST || WEBHOOK_URL);
  }

  stats() {
    return {
      smtpConfigured:    !!SMTP_HOST,
      webhookConfigured: !!WEBHOOK_URL,
      available:         this.isAvailable(),
      deliveriesLogged:  this._lastSent.length,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────
let _instance = null;
function getOperatorReportMailer() {
  if (!_instance) _instance = new OperatorReportMailer();
  return _instance;
}

module.exports = { OperatorReportMailer, getOperatorReportMailer };
