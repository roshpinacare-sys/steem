'use strict';

/**
 * lib/smtpEmailProvider.js — ECOS V145
 * ──────────────────────────────────────────────────────────────────────────────
 * [V145-SMTP-01] Real email delivery for emailVerificationService.
 *
 * Supports two providers — both zero extra npm dependencies:
 *
 *   Provider 1: Resend API  (RESEND_API_KEY env var)
 *     Uses Node.js built-in https.request to call https://api.resend.com/emails
 *     Preferred: simpler setup, great free tier (3k emails/month)
 *
 *   Provider 2: SMTP  (SMTP_DSN env var)
 *     Pure Node.js TCP/TLS socket SMTP implementation.
 *     Supports: STARTTLS (port 587), TLS (port 465), plain (port 25 / testing).
 *     SMTP_DSN format: smtps://user:pass@host:465
 *                   or smtp://user:pass@host:587
 *                   or smtp://host:25 (no auth, relay / testing)
 *
 * Integration with emailVerificationService:
 *   const { smtpEmailProvider } = require('./smtpEmailProvider');
 *   emailVerificationService.setDeliverFn(smtpEmailProvider.deliver.bind(smtpEmailProvider));
 *
 * Delivery function signature (matches emailVerificationService contract):
 *   deliver(userId, type, rawToken, expiresAtISO, meta)
 *   meta = { email, displayName, baseUrl }
 *
 * EMAIL_FROM env var sets the sender (default: noreply@ecos.ai)
 * ECOS_BASE_URL env var used to build token links (default: http://localhost:3000)
 *
 * [V145-SMTP-01] Initial implementation — zero new npm deps.
 */

const https   = require('node:https');
const http    = require('node:http');
const net     = require('node:net');
const tls     = require('node:tls');
const crypto  = require('node:crypto');

// ── Config helpers ────────────────────────────────────────────────────────────

function getEnv(name, def = null) {
  return process.env[name] || def;
}

function parseDsn(dsn) {
  // smtps://user:pass@host:465  OR  smtp://user:pass@host:587  OR  smtp://host:25
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    return {
      secure:   u.protocol === 'smtps:',
      host:     u.hostname,
      port:     parseInt(u.port) || (u.protocol === 'smtps:' ? 465 : 587),
      user:     u.username ? decodeURIComponent(u.username) : null,
      pass:     u.password ? decodeURIComponent(u.password) : null,
    };
  } catch (_) {
    return null;
  }
}

// ── Email templates ───────────────────────────────────────────────────────────

function buildEmailContent(type, rawToken, expiresAtISO, meta) {
  const base        = (meta.baseUrl || getEnv('ECOS_BASE_URL', 'http://localhost:3000')).replace(/\/$/, '');
  const displayName = meta.displayName || 'there';
  const expires     = new Date(expiresAtISO).toLocaleString('en-US', { timeZone: 'UTC', timeZoneName: 'short' });

  if (type === 'verify_email') {
    const link = `${base}/verify-email?token=${encodeURIComponent(rawToken)}`;
    return {
      subject: 'Verify your ECOS email address',
      text:    `Hi ${displayName},\n\nPlease verify your email address by clicking the link below:\n\n${link}\n\nThis link expires at ${expires}.\n\nIf you didn't create an ECOS account, you can safely ignore this email.\n\n— ECOS`,
      html:    `<p>Hi ${displayName},</p><p>Please verify your email address by clicking the link below:</p><p><a href="${link}">${link}</a></p><p>This link expires at <strong>${expires}</strong>.</p><p><small>If you didn't create an ECOS account, you can safely ignore this email.</small></p><p>— ECOS</p>`,
    };
  }

  if (type === 'reset_password') {
    const link = `${base}/reset-password?token=${encodeURIComponent(rawToken)}`;
    return {
      subject: 'Reset your ECOS password',
      text:    `Hi ${displayName},\n\nYou requested a password reset. Click the link below to set a new password:\n\n${link}\n\nThis link expires at ${expires}.\n\nIf you didn't request a password reset, please ignore this email. Your password has not been changed.\n\n— ECOS`,
      html:    `<p>Hi ${displayName},</p><p>You requested a password reset. Click the link below:</p><p><a href="${link}">${link}</a></p><p>This link expires at <strong>${expires}</strong>.</p><p><small>If you didn't request a password reset, your password has not been changed.</small></p><p>— ECOS</p>`,
    };
  }

  return {
    subject: `ECOS: ${type}`,
    text:    `Token: ${rawToken}\nExpires: ${expires}`,
    html:    `<p>Token: <code>${rawToken}</code><br>Expires: ${expires}</p>`,
  };
}

// ── Resend API provider ───────────────────────────────────────────────────────

class ResendProvider {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  /** @returns {Promise<{ ok: boolean, messageId?: string, error?: string }>} */
  async send({ from, to, subject, text, html }) {
    const body = JSON.stringify({ from, to: [to], subject, text, html });

    return new Promise((resolve) => {
      const req = https.request({
        hostname: 'api.resend.com',
        path:     '/emails',
        method:   'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type':  'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      }, (res) => {
        let raw = '';
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => {
          try {
            const data = JSON.parse(raw);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve({ ok: true, messageId: data.id });
            } else {
              resolve({ ok: false, error: data.message || data.name || `HTTP ${res.statusCode}` });
            }
          } catch (_) {
            resolve({ ok: false, error: `HTTP ${res.statusCode}: ${raw.slice(0, 100)}` });
          }
        });
      });

      req.on('error', (err) => resolve({ ok: false, error: err.message }));
      req.write(body);
      req.end();
    });
  }
}

// ── Pure-Node SMTP provider ───────────────────────────────────────────────────

class SmtpProvider {
  constructor(config) {
    // config: { host, port, secure, user, pass }
    this.config = config;
  }

  /** @returns {Promise<{ ok: boolean, messageId?: string, error?: string }>} */
  send({ from, to, subject, text, html }) {
    return new Promise((resolve) => {
      const { host, port, secure, user, pass } = this.config;
      const msgId = `<${Date.now()}.${crypto.randomBytes(8).toString('hex')}@ecos>`;

      const mime  = _buildMime({ from, to, subject, text, html, msgId });
      const lines = [];
      let   sock  = null;
      let   state = 'connect';

      const send = (line) => { sock.write(line + '\r\n'); };

      const onLine = (line) => {
        const code = parseInt(line.slice(0, 3));

        if (state === 'connect') {
          if (code === 220) {
            state = 'ehlo';
            send(`EHLO ecos`);
          } else {
            finish(false, `unexpected greeting: ${line}`);
          }
          return;
        }

        if (state === 'ehlo') {
          // Multi-line EHLO — wait for final line (no dash after code)
          lines.push(line);
          if (line[3] === ' ' || line[3] === undefined) {
            // EHLO done
            if (!secure && lines.some(l => l.includes('STARTTLS'))) {
              state = 'starttls';
              send('STARTTLS');
            } else if (user && pass) {
              state = 'auth';
              const b64 = Buffer.from(`\x00${user}\x00${pass}`).toString('base64');
              send(`AUTH PLAIN ${b64}`);
            } else {
              state = 'mail_from';
              send(`MAIL FROM:<${from}>`);
            }
          }
          return;
        }

        if (state === 'starttls') {
          if (code === 220) {
            // Upgrade to TLS
            const tlsSock = tls.connect({ socket: sock, servername: host }, () => {
              sock = tlsSock;
              sock.on('data', onData);
              state = 'ehlo_after_tls';
              lines.length = 0;
              send('EHLO ecos');
            });
            tlsSock.on('error', (err) => finish(false, `TLS: ${err.message}`));
          } else {
            finish(false, `STARTTLS rejected: ${line}`);
          }
          return;
        }

        if (state === 'ehlo_after_tls') {
          lines.push(line);
          if (line[3] === ' ' || line[3] === undefined) {
            if (user && pass) {
              state = 'auth';
              const b64 = Buffer.from(`\x00${user}\x00${pass}`).toString('base64');
              send(`AUTH PLAIN ${b64}`);
            } else {
              state = 'mail_from';
              send(`MAIL FROM:<${from}>`);
            }
          }
          return;
        }

        if (state === 'auth') {
          if (code === 235) {
            state = 'mail_from';
            send(`MAIL FROM:<${from}>`);
          } else {
            finish(false, `AUTH failed: ${line}`);
          }
          return;
        }

        if (state === 'mail_from') {
          if (code === 250) {
            state = 'rcpt_to';
            send(`RCPT TO:<${to}>`);
          } else {
            finish(false, `MAIL FROM rejected: ${line}`);
          }
          return;
        }

        if (state === 'rcpt_to') {
          if (code === 250) {
            state = 'data';
            send('DATA');
          } else {
            finish(false, `RCPT TO rejected: ${line}`);
          }
          return;
        }

        if (state === 'data') {
          if (code === 354) {
            state = 'body';
            sock.write(mime + '\r\n.\r\n');
          } else {
            finish(false, `DATA rejected: ${line}`);
          }
          return;
        }

        if (state === 'body') {
          if (code === 250) {
            state = 'quit';
            send('QUIT');
          } else {
            finish(false, `message rejected: ${line}`);
          }
          return;
        }

        if (state === 'quit') {
          sock.destroy();
          finish(true, null, msgId);
        }
      };

      let buf = '';
      const onData = (chunk) => {
        buf += chunk.toString();
        const parts = buf.split('\r\n');
        buf = parts.pop();
        for (const line of parts) {
          if (line) onLine(line);
        }
      };

      function finish(ok, error, messageId) {
        try { sock.destroy(); } catch (_) {}
        resolve(ok ? { ok: true, messageId } : { ok: false, error });
      }

      // Connect
      if (secure) {
        sock = tls.connect({ host, port, servername: host }, () => {
          sock.on('data', onData);
        });
      } else {
        sock = net.connect({ host, port }, () => {
          sock.on('data', onData);
        });
      }
      sock.on('error', (err) => finish(false, err.message));
      sock.setTimeout(15000, () => finish(false, 'SMTP timeout'));
    });
  }
}

function _buildMime({ from, to, subject, text, html, msgId }) {
  const boundary = 'ecos_' + crypto.randomBytes(8).toString('hex');
  const date     = new Date().toUTCString();
  const b64html  = Buffer.from(html || '').toString('base64');
  const b64text  = Buffer.from(text || '').toString('base64');

  return [
    `Message-ID: ${msgId}`,
    `Date: ${date}`,
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64text,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64html,
    '',
    `--${boundary}--`,
  ].join('\r\n');
}

// ── SmtpEmailProvider (facade) ────────────────────────────────────────────────

class SmtpEmailProvider {
  constructor() {
    this._provider = null;
    this._from     = null;
    this._ready    = false;
  }

  /**
   * Initialize from environment variables.
   * Call once at server startup.
   *
   * Reads:
   *   RESEND_API_KEY  — use Resend (preferred)
   *   SMTP_DSN        — use SMTP (fallback)
   *   EMAIL_FROM      — sender address (default: noreply@ecos.ai)
   *
   * @returns {{ provider: 'resend'|'smtp'|null, from: string }}
   */
  initFromEnv() {
    this._from = getEnv('EMAIL_FROM', 'ECOS <noreply@ecos.ai>');

    const resendKey = getEnv('RESEND_API_KEY');
    if (resendKey) {
      this._provider = new ResendProvider(resendKey);
      this._ready    = true;
      return { provider: 'resend', from: this._from };
    }

    const smtpDsn = getEnv('SMTP_DSN');
    if (smtpDsn) {
      const config = parseDsn(smtpDsn);
      if (config) {
        this._provider = new SmtpProvider(config);
        this._ready    = true;
        return { provider: 'smtp', from: this._from };
      }
    }

    this._ready = false;
    return { provider: null, from: this._from };
  }

  /**
   * Inject a provider directly (for testing).
   * @param {object} provider — must have .send({ from, to, subject, text, html })
   * @param {string} from
   */
  setProvider(provider, from = 'ECOS <noreply@ecos.ai>') {
    this._provider = provider;
    this._from     = from;
    this._ready    = true;
  }

  get ready() { return this._ready; }
  get providerName() {
    if (this._provider instanceof ResendProvider) return 'resend';
    if (this._provider instanceof SmtpProvider)   return 'smtp';
    return 'none';
  }

  /**
   * Delivery function — compatible with emailVerificationService.setDeliverFn().
   *
   * @param {string} userId
   * @param {'verify_email'|'reset_password'} type
   * @param {string} rawToken
   * @param {string} expiresAtISO
   * @param {object} meta — { email, displayName, baseUrl }
   */
  async deliver(userId, type, rawToken, expiresAtISO, meta = {}) {
    if (!this._ready || !this._provider) {
      // Graceful fallback — dev stdout log (same as default deliver in emailVerificationService)
      console.log(`[smtpEmailProvider] NOT CONFIGURED — token for ${userId} (${type}): ${rawToken}`); // eslint-disable-line no-console
      return;
    }

    const toEmail = meta.email;
    if (!toEmail) {
      console.warn(`[smtpEmailProvider] no email address for userId=${userId}, type=${type}`); // eslint-disable-line no-console
      return;
    }

    const { subject, text, html } = buildEmailContent(type, rawToken, expiresAtISO, meta);

    try {
      const result = await this._provider.send({
        from:    this._from,
        to:      toEmail,
        subject,
        text,
        html,
      });

      if (result.ok) {
        // Log success (non-sensitive)
        console.info(`[smtpEmailProvider] delivered type=${type} to=${toEmail} msgId=${result.messageId || 'n/a'}`); // eslint-disable-line no-console
      } else {
        console.error(`[smtpEmailProvider] delivery failed type=${type} to=${toEmail}: ${result.error}`); // eslint-disable-line no-console
      }
    } catch (err) {
      console.error(`[smtpEmailProvider] unexpected error type=${type}: ${err.message}`); // eslint-disable-line no-console
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const smtpEmailProvider = new SmtpEmailProvider();

module.exports = {
  SmtpEmailProvider,
  ResendProvider,
  SmtpProvider,
  smtpEmailProvider,
};
