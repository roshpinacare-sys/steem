/**
 * payoutNotifier.js — ECOS V148
 * ─────────────────────────────────────────────────────────────────────────────
 * [V148-PN-01] Payout & Task Email Notification System
 *
 * Sends transactional emails for:
 *   - new_task_available  → validator receives email when a new HITL task arrives
 *   - payout_received     → validator receives email when payout is completed
 *   - task_approved       → client receives email when their task was approved
 *   - task_rejected       → client receives email when their task was rejected
 *
 * Architecture:
 *   - Thin orchestrator: delegates to smtpEmailProvider.deliver() for actual send
 *   - User email lookup: provided via setEmailLookupFn() (injected at startup)
 *   - All sends are fire-and-forget (non-fatal) — never blocks a financial tx
 *   - NotificationPrefs checked via setPrefs() injection (opt-out respected)
 *   - In-memory delivery log (last 500 entries) accessible via getLog()
 *
 * Sacred files: fiatLedger.js, auditLog.js — NOT modified.
 */

'use strict';

const MAX_LOG = 500;

// ─────────────────────────────────────────────────────────────────────────────
// Email templates
// ─────────────────────────────────────────────────────────────────────────────
const TEMPLATES = {
  new_task_available: {
    subject: (ctx) => `[ECOS] New validation task available — ${ctx.taskType || 'Task'}`,
    text: (ctx) => [
      `Hello ${ctx.validatorName || 'Validator'},`,
      '',
      'A new task is waiting for your validation in ECOS.',
      '',
      `Task ID   : ${ctx.taskId}`,
      `Type      : ${ctx.taskType || 'Standard'}`,
      `Priority  : ${ctx.priority || 'Normal'}`,
      `Reward    : ${ctx.rewardDisplay || 'per your validator tier'}`,
      '',
      'Log in to your validator dashboard to review and approve or reject the task.',
      '',
      `Dashboard : ${ctx.baseUrl || 'https://app.ecos.ai'}/validator`,
      '',
      '— ECOS Platform',
    ].join('\n'),
    html: (ctx) => `
      <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px">
        <h2 style="color:#1d4ed8;margin-bottom:8px">New Task Available</h2>
        <p style="color:#374151">Hello <strong>${ctx.validatorName || 'Validator'}</strong>,</p>
        <p style="color:#374151">A new task is waiting for your validation in ECOS.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f9fafb;border-radius:8px;overflow:hidden">
          <tr><td style="padding:10px 16px;color:#6b7280;font-size:13px">Task ID</td><td style="padding:10px 16px;font-weight:600;color:#111827">${ctx.taskId}</td></tr>
          <tr style="background:#fff"><td style="padding:10px 16px;color:#6b7280;font-size:13px">Type</td><td style="padding:10px 16px;color:#111827">${ctx.taskType || 'Standard'}</td></tr>
          <tr><td style="padding:10px 16px;color:#6b7280;font-size:13px">Priority</td><td style="padding:10px 16px;color:#111827">${ctx.priority || 'Normal'}</td></tr>
          <tr style="background:#fff"><td style="padding:10px 16px;color:#6b7280;font-size:13px">Reward</td><td style="padding:10px 16px;color:#059669;font-weight:600">${ctx.rewardDisplay || 'Tier-based'}</td></tr>
        </table>
        <a href="${ctx.baseUrl || 'https://app.ecos.ai'}/validator" style="display:inline-block;background:#1d4ed8;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin-top:8px">Review Task →</a>
        <p style="color:#9ca3af;font-size:12px;margin-top:24px">ECOS Platform · Unsubscribe via notification preferences</p>
      </div>`,
  },

  payout_received: {
    subject: (ctx) => `[ECOS] Payout received — ${ctx.amountDisplay}`,
    text: (ctx) => [
      `Hello ${ctx.validatorName || 'Validator'},`,
      '',
      'Your payout has been processed successfully.',
      '',
      `Amount    : ${ctx.amountDisplay}`,
      `Task ID   : ${ctx.taskId || 'N/A'}`,
      `Method    : ${ctx.method || 'Stripe Connect'}`,
      `Reference : ${ctx.refId || 'N/A'}`,
      `Timestamp : ${ctx.timestamp || new Date().toISOString()}`,
      '',
      'Funds will appear in your connected bank account within 1–3 business days.',
      '',
      `Earnings  : ${ctx.baseUrl || 'https://app.ecos.ai'}/validator`,
      '',
      '— ECOS Platform',
    ].join('\n'),
    html: (ctx) => `
      <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px">
        <h2 style="color:#059669;margin-bottom:8px">💸 Payout Received</h2>
        <p style="color:#374151">Hello <strong>${ctx.validatorName || 'Validator'}</strong>,</p>
        <p style="color:#374151">Your payout has been processed successfully.</p>
        <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:20px;margin:16px 0;text-align:center">
          <div style="font-size:36px;font-weight:700;color:#059669">${ctx.amountDisplay}</div>
          <div style="color:#6b7280;font-size:13px;margin-top:4px">${ctx.method || 'Stripe Connect'}</div>
        </div>
        <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;overflow:hidden">
          <tr><td style="padding:10px 16px;color:#6b7280;font-size:13px">Task ID</td><td style="padding:10px 16px;color:#111827">${ctx.taskId || 'N/A'}</td></tr>
          <tr style="background:#fff"><td style="padding:10px 16px;color:#6b7280;font-size:13px">Reference</td><td style="padding:10px 16px;color:#111827">${ctx.refId || 'N/A'}</td></tr>
          <tr><td style="padding:10px 16px;color:#6b7280;font-size:13px">Time</td><td style="padding:10px 16px;color:#111827">${ctx.timestamp || new Date().toISOString()}</td></tr>
        </table>
        <p style="color:#6b7280;font-size:13px;margin-top:16px">Funds appear in your bank within 1–3 business days.</p>
        <a href="${ctx.baseUrl || 'https://app.ecos.ai'}/validator" style="display:inline-block;background:#059669;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin-top:8px">View Earnings →</a>
        <p style="color:#9ca3af;font-size:12px;margin-top:24px">ECOS Platform · Unsubscribe via notification preferences</p>
      </div>`,
  },

  task_approved: {
    subject: (ctx) => `[ECOS] Your task was approved ✓`,
    text: (ctx) => [
      `Hello,`,
      '',
      `Your task has been reviewed and approved by a validator.`,
      '',
      `Task ID   : ${ctx.taskId}`,
      `Approved  : ${ctx.timestamp || new Date().toISOString()}`,
      `Validator : ${ctx.validatorDisplay || 'Verified validator'}`,
      '',
      '— ECOS Platform',
    ].join('\n'),
    html: (ctx) => `
      <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px">
        <h2 style="color:#059669">✓ Task Approved</h2>
        <p style="color:#374151">Your task <strong>${ctx.taskId}</strong> has been reviewed and approved.</p>
        <p style="color:#9ca3af;font-size:12px;margin-top:24px">ECOS Platform</p>
      </div>`,
  },

  task_rejected: {
    subject: (ctx) => `[ECOS] Your task requires attention`,
    text: (ctx) => [
      `Hello,`,
      '',
      `Your task has been reviewed. The validator returned it for revision.`,
      '',
      `Task ID   : ${ctx.taskId}`,
      `Reason    : ${ctx.reason || 'See dashboard for details'}`,
      '',
      '— ECOS Platform',
    ].join('\n'),
    html: (ctx) => `
      <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px">
        <h2 style="color:#dc2626">Task Needs Revision</h2>
        <p style="color:#374151">Task <strong>${ctx.taskId}</strong> was returned for revision.</p>
        <p style="color:#374151"><strong>Reason:</strong> ${ctx.reason || 'See your dashboard for details.'}</p>
        <p style="color:#9ca3af;font-size:12px;margin-top:24px">ECOS Platform</p>
      </div>`,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
class PayoutNotifier {
  /**
   * @param {object} opts
   * @param {object} [opts.smtpProvider] - smtpEmailProvider instance
   * @param {object} [opts.prefs]        - NotificationPrefs instance
   * @param {object} [opts.logger]
   * @param {string} [opts.baseUrl]      - e.g. 'https://app.ecos.ai'
   */
  constructor(opts = {}) {
    this._smtp    = opts.smtpProvider || null;
    this._prefs   = opts.prefs        || null;
    this._logger  = opts.logger       || console;
    this._baseUrl = opts.baseUrl      || process.env.ECOS_BASE_URL || '';
    this._log     = []; // { ts, type, userId, to, ok, err? }
    // email lookup fn: async (userId) => string|null
    this._emailLookupFn = null;
  }

  /** Inject async email lookup (userId → email). Called at startup. */
  setEmailLookupFn(fn) { this._emailLookupFn = fn; }

  /** Replace smtp provider after startup (e.g. when initFromEnv succeeds). */
  setSmtpProvider(p) { this._smtp = p; }

  /** Delivery log (last MAX_LOG entries). */
  getLog(limit = 50) {
    return this._log.slice(-Math.min(limit, MAX_LOG));
  }

  /**
   * Fire-and-forget send for any template type.
   * Never throws — all errors are logged.
   */
  send(type, userId, ctx = {}) {
    this._sendAsync(type, userId, ctx).catch(err => {
      this._logger.warn && this._logger.warn({ err: err.message, type, userId }, '[V148-PN] send error');
    });
  }

  async _sendAsync(type, userId, ctx) {
    const tpl = TEMPLATES[type];
    if (!tpl) {
      this._logger.warn && this._logger.warn({ type }, '[V148-PN] unknown template type');
      return;
    }

    // Check prefs — is this type muted?
    if (this._prefs && this._prefs.isMuted && this._prefs.isMuted(userId, `email_${type}`)) {
      this._logEntry({ type, userId, to: null, ok: true, skipped: true, reason: 'muted' });
      return;
    }

    // Resolve email
    let to = ctx.email || null;
    if (!to && this._emailLookupFn) {
      try { to = await this._emailLookupFn(userId); } catch (_) {}
    }

    if (!to) {
      this._logEntry({ type, userId, to: null, ok: false, err: 'no_email' });
      return;
    }

    if (!this._smtp) {
      // Dev fallback — log to stdout
      this._logger.info && this._logger.info(
        { type, userId, to, subject: tpl.subject({ ...ctx, baseUrl: this._baseUrl }) },
        '[V148-PN] DEV email (no SMTP configured)'
      );
      this._logEntry({ type, userId, to, ok: true, dev: true });
      return;
    }

    const fullCtx = { ...ctx, baseUrl: this._baseUrl };
    try {
      await this._smtp.send({
        from:    process.env.EMAIL_FROM || 'noreply@ecos.ai',
        to,
        subject: tpl.subject(fullCtx),
        text:    tpl.text(fullCtx),
        html:    tpl.html(fullCtx),
      });
      this._logEntry({ type, userId, to, ok: true });
      this._logger.info && this._logger.info({ type, userId, to }, '[V148-PN] email sent');
    } catch (err) {
      this._logEntry({ type, userId, to, ok: false, err: err.message });
      this._logger.warn && this._logger.warn({ err: err.message, type, userId }, '[V148-PN] send failed (non-fatal)');
    }
  }

  _logEntry(entry) {
    this._log.push({ ts: Date.now(), ...entry });
    if (this._log.length > MAX_LOG) this._log.shift();
  }

  /** Convenience methods */
  notifyNewTask(validatorId, ctx)   { this.send('new_task_available', validatorId, ctx); }
  notifyPayout(validatorId, ctx)    { this.send('payout_received',    validatorId, ctx); }
  notifyApproved(clientId, ctx)     { this.send('task_approved',      clientId,    ctx); }
  notifyRejected(clientId, ctx)     { this.send('task_rejected',      clientId,    ctx); }

  /** Stats */
  stats() {
    const sent  = this._log.filter(e => e.ok && !e.skipped && !e.dev).length;
    const dev   = this._log.filter(e => e.dev).length;
    const fail  = this._log.filter(e => !e.ok).length;
    const skip  = this._log.filter(e => e.skipped).length;
    const total = this._log.length;
    const byType = {};
    for (const e of this._log) {
      byType[e.type] = (byType[e.type] || 0) + 1;
    }
    return { total, sent, dev, fail, skip, byType };
  }

  static get TEMPLATE_TYPES() { return Object.keys(TEMPLATES); }
}

// Singleton
let _instance = null;
function getPayoutNotifier(opts) {
  if (!_instance && opts) _instance = new PayoutNotifier(opts);
  return _instance;
}

module.exports = { PayoutNotifier, getPayoutNotifier, TEMPLATES };
