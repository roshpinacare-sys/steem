'use strict';
/**
 * src/lib/ussdSmsStateMachine268.js — USSD/SMS degraded path state machine (V268)
 *
 * V268 additions over V266:
 *   - smsGateway, ussdGateway, sessionStore interface validation at construction
 *   - Performance telemetry: `.getPerf268()` with session-input latency percentiles
 *   - `checkGatewayHealth268()`: probe gateway availability
 *
 * PROGRAM 18: USSD/SMS Degraded Path.
 * Zero new npm deps. Identifiers end with 268.
 */

const crypto = require('node:crypto');

const USSD_STATES_268 = Object.freeze({
  MENU: 'menu', IDENTITY: 'identity', TASK: 'task', CONFIRM: 'confirm', COMPLETE: 'complete', CANCELLED: 'cancelled', EXPIRED: 'expired'
});
const USSD_TIMEOUT_MS_268 = 3 * 60_000;
const USSD_MAX_RETRIES_268 = 3;

function _calcPercentiles268(arr) {
  if (!arr || arr.length === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  const p = (pct) => sorted[Math.min(Math.floor(n * pct / 100), n - 1)];
  return { p50: p(50), p95: p(95), p99: p(99), count: n };
}

class UssdSmsStateMachine268 {
  constructor(opts = {}) {
    this._logger = opts.logger || console;
    this._auditLog = opts.auditLog || null;
    this._logAdapter268 = opts.logAdapter || null;
    // V268: validate smsGateway interface
    if (opts.smsGateway !== null && opts.smsGateway !== undefined) {
      if (typeof opts.smsGateway.send !== 'function') {
        throw new Error('ussdSmsStateMachine268: smsGateway must implement send(userId, message)');
      }
    }
    this._smsGateway = opts.smsGateway || null;
    // V268: validate ussdGateway interface
    if (opts.ussdGateway !== null && opts.ussdGateway !== undefined) {
      if (typeof opts.ussdGateway.send !== 'function') {
        throw new Error('ussdSmsStateMachine268: ussdGateway must implement send(userId, message)');
      }
    }
    this._ussdGateway = opts.ussdGateway || null;
    // V268: validate sessionStore interface
    if (opts.sessionStore !== null && opts.sessionStore !== undefined) {
      if (typeof opts.sessionStore.get !== 'function' || typeof opts.sessionStore.set !== 'function') {
        throw new Error('ussdSmsStateMachine268: sessionStore must implement Map-like get/set interface');
      }
    }
    this._sessionStore = opts.sessionStore || new Map();
    this._sessions268 = this._sessionStore;
    this._stats268 = { started: 0, completed: 0, cancelled: 0, expired: 0, invalidInputs: 0 };
    // V268: perf tracking
    this._perf268 = { latencies: [] };
  }

  startSession268(userId, channel = 'ussd', meta = {}) {
    if (!userId) throw new Error('ussdSmsStateMachine268: userId required');
    const sessionId = `ussd268::${crypto.randomBytes(6).toString('hex')}`;
    const now = Date.now();
    const session = {
      sessionId,
      userId,
      channel: channel === 'sms' ? 'sms' : 'ussd',
      state: USSD_STATES_268.MENU,
      retries: 0,
      data: {},
      meta,
      startedAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      expiresAtMs: now + (meta.timeoutMs || USSD_TIMEOUT_MS_268),
      transcript: [],
    };
    this._sessionStore.set(userId, session);
    this._stats268.started++;
    this._push268(session, 'system', 'Welcome to ECOS. 1=New account, 2=Login, 0=Cancel');
    // If an external gateway is provided, send the initial message
    if (this._ussdGateway && channel === 'ussd') {
      this._ussdGateway.send(userId, this._prompt268(session));
    } else if (this._smsGateway && channel === 'sms') {
      this._smsGateway.send(userId, this._prompt268(session));
    }
    return { ok: true, sessionId, state: session.state, prompt: this._prompt268(session), compact: this.compact268(userId) };
  }

  handleInput268(userId, input = '') {
    const _t0 = Date.now();
    let s = this._sessionStore.get(userId);
    if (!s) return this.startSession268(userId, 'ussd');
    this._expireIfNeeded268(s);
    if (s.state === USSD_STATES_268.EXPIRED) return { ok: false, state: s.state, prompt: 'Session expired. Dial again to resume.' };
    const raw = String(input || '').trim();
    this._push268(s, 'user', raw);
    if (raw === '0' || raw.toLowerCase() === 'cancel') return this.cancel268(userId);

    let valid = true;
    switch (s.state) {
      case USSD_STATES_268.MENU:
        if (raw === '1' || raw === '2') s.state = USSD_STATES_268.IDENTITY; else valid = false;
        break;
      case USSD_STATES_268.IDENTITY:
        if (raw.length >= 2) { s.data.name = raw.slice(0, 80); s.state = USSD_STATES_268.TASK; } else valid = false;
        break;
      case USSD_STATES_268.TASK:
        if (raw.length >= 2 || ['1', '2', '3'].includes(raw)) { s.data.task = this._taskFromInput268(raw); s.state = USSD_STATES_268.CONFIRM; } else valid = false;
        break;
      case USSD_STATES_268.CONFIRM:
        if (raw === '1' || /^yes$/i.test(raw)) { s.state = USSD_STATES_268.COMPLETE; this._stats268.completed++; }
        else if (raw === '2') s.state = USSD_STATES_268.TASK;
        else valid = false;
        break;
      default:
        valid = false;
    }

    if (!valid) {
      s.retries++;
      this._stats268.invalidInputs++;
      if (s.retries >= USSD_MAX_RETRIES_268) return this.cancel268(userId, 'max_retries');
      this._push268(s, 'system', 'Invalid reply. Try again or send 0 to cancel.');
    } else {
      s.retries = 0;
    }
    s.updatedAt = new Date().toISOString();
    s.expiresAtMs = Date.now() + USSD_TIMEOUT_MS_268;
    const prompt = this._prompt268(s);
    this._push268(s, 'system', prompt);
    this._sessionStore.set(userId, s); // Persist updated session state
    // If an external gateway is provided, send the response
    if (this._ussdGateway && s.channel === 'ussd') {
      this._ussdGateway.send(userId, prompt);
    } else if (this._smsGateway && s.channel === 'sms') {
      this._smsGateway.send(userId, prompt);
    }
    this._recordLatency268(_t0);
    return { ok: s.state !== USSD_STATES_268.CANCELLED, sessionId: s.sessionId, state: s.state, prompt, data: s.data, compact: this.compact268(userId) };
  }

  resume268(userId) {
    const s = this._sessionStore.get(userId);
    if (!s) return this.startSession268(userId, 'ussd');
    this._expireIfNeeded268(s);
    return { ok: s.state !== USSD_STATES_268.EXPIRED, sessionId: s.sessionId, state: s.state, prompt: this._prompt268(s), compact: this.compact268(userId) };
  }

  cancel268(userId, reason = 'user_cancel') {
    const s = this._sessionStore.get(userId);
    if (!s) return { ok: false, error: 'session_not_found' };
    s.state = USSD_STATES_268.CANCELLED;
    s.cancelReason = reason;
    s.updatedAt = new Date().toISOString();
    this._stats268.cancelled++;
    this._push268(s, 'system', 'Session cancelled. Dial again to restart.');
    this._sessionStore.delete(userId);
    return { ok: true, sessionId: s.sessionId, state: s.state, reason, prompt: 'Session cancelled. Dial again to restart.' };
  }

  getSession268(userId) {
    const s = this._sessionStore.get(userId);
    if (!s) return null;
    this._expireIfNeeded268(s);
    return { ...s, expiresAtMs: undefined };
  }

  compact268(userId) {
    const s = this._sessionStore.get(userId);
    if (!s) return null;
    return { v: '268', sid: s.sessionId, uid: userId, ch: s.channel, st: s.state, r: s.retries, n: s.transcript.length };
  }

  getStats268() { return { version: '268', activeSessions: this._sessionStore.size, ...this._stats268 }; }

  /** V268: Performance telemetry */
  getPerf268() { return _calcPercentiles268(this._perf268.latencies); }

  /** V268: Check gateway health */
  checkGatewayHealth268() {
    return {
      ok: true,
      smsGateway:  this._smsGateway  ? { ok: typeof this._smsGateway.send  === 'function', type: 'external' } : { ok: true, type: 'stub' },
      ussdGateway: this._ussdGateway ? { ok: typeof this._ussdGateway.send === 'function', type: 'external' } : { ok: true, type: 'stub' },
      sessionStore: typeof this._sessionStore.get === 'function' ? { ok: true, type: 'external' } : { ok: false, type: 'unknown' },
    };
  }

  _recordLatency268(t0) {
    const ms = Date.now() - t0;
    this._perf268.latencies.push(ms);
    if (this._perf268.latencies.length > 1000) this._perf268.latencies.shift();
  }

  _expireIfNeeded268(s) {
    if (![USSD_STATES_268.COMPLETE, USSD_STATES_268.CANCELLED, USSD_STATES_268.EXPIRED].includes(s.state) && Date.now() > s.expiresAtMs) {
      s.state = USSD_STATES_268.EXPIRED;
      this._stats268.expired++;
      this._sessionStore.set(s.userId, s); // Persist expired state
    }
  }

  _prompt268(s) {
    if (s.state === USSD_STATES_268.MENU) return 'Welcome to ECOS. 1=New account, 2=Login, 0=Cancel';
    if (s.state === USSD_STATES_268.IDENTITY) return 'Enter your name. No crypto words needed.';
    if (s.state === USSD_STATES_268.TASK) return 'What do you need? 1=Work help, 2=Earn, 3=Support, or type your task.';
    if (s.state === USSD_STATES_268.CONFIRM) return `Confirm task: ${s.data.task}. 1=Send, 2=Edit, 0=Cancel`;
    if (s.state === USSD_STATES_268.COMPLETE) return 'Task submitted. You will receive the result by SMS.';
    if (s.state === USSD_STATES_268.EXPIRED) return 'Session expired. Dial again to resume.';
    return 'Session cancelled. Dial again to restart.';
  }

  _taskFromInput268(raw) {
    if (raw === '1') return 'work_help';
    if (raw === '2') return 'earn';
    if (raw === '3') return 'support';
    return raw.slice(0, 140);
  }

  _push268(s, actor, text) {
    s.transcript.push({ actor, text, ts: new Date().toISOString() });
    this._sessionStore.set(s.userId, s); // Persist updated session state after each push
  }
}

const defaultUssdSmsStateMachine268 = new UssdSmsStateMachine268();

module.exports = {
  UssdSmsStateMachine268,
  defaultUssdSmsStateMachine268,
  USSD_STATES_268,
  USSD_TIMEOUT_MS_268,
  USSD_MAX_RETRIES_268,
};
