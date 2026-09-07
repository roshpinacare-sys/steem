'use strict';
/**
 * src/lib/onboardingFlow268.js — 60-Second Chat-First Onboarding (V268)
 *
 * V268 additions over V266:
 *   - authProvider DI: external authentication service injection
 *   - cryptoWordsFilter DI validation at construction time
 *   - Performance telemetry: `.getPerf268()` with step-completion latencies
 *   - `checkProviderHealth268()`: probe authProvider and embeddedWallet readiness
 *
 * PROGRAM 11: Mobile-First UX
 * Zero new npm deps. Identifiers end with 268.
 */
'use strict';

const CRYPTO_WORDS_268 = Object.freeze([
  'wallet', 'gas', 'seed', 'seed phrase', 'ERC', 'ERC-20', 'token', 'crypto',
  'blockchain', 'on-chain', 'defi', 'web3', 'dapp', 'nft', 'metamask', 'ledger hardware',
  'private key', 'public key', 'address', 'smart contract', 'solidity', 'gwei', 'wei',
  'hash rate', 'mnemonic', 'passphrase', 'cold storage', 'hot wallet', 'DEX', 'AMM',
  'liquidity pool', 'yield farming', 'staking', 'DAO', 'airdrop', 'mint',
]);

const CHANNELS_268 = Object.freeze(['chat', 'telegram', 'mobile', 'sms', 'ussd', 'email', 'api']);

const FLOW_STEPS_268 = Object.freeze([
  { id: 'identity',     label: 'Create your account',   durationSec: 15, cryptoFree: true },
  { id: 'first_action', label: 'Try your first task',   durationSec: 30, cryptoFree: true },
  { id: 'cost_reveal',  label: 'See how credits work',  durationSec: 10, cryptoFree: true },
  { id: 'complete',     label: "You're in!",            durationSec: 5,  cryptoFree: true },
]);

const USSD_FLOW_268 = Object.freeze([
  { id: 'menu',     prompt: 'Welcome to ECOS. 1=New account, 2=Login' },
  { id: 'identity', prompt: 'Enter your name (no crypto needed):' },
  { id: 'task',     prompt: 'What do you need help with? (1=Work, 2=Earn, 3=Help)' },
  { id: 'confirm',  prompt: 'Task submitted. You will receive result via SMS.' },
]);

function _calcPercentiles268(arr) {
  if (!arr || arr.length === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  const p = (pct) => sorted[Math.min(Math.floor(n * pct / 100), n - 1)];
  return { p50: p(50), p95: p(95), p99: p(99), count: n };
}

class OnboardingFlow268 {
  constructor(opts = {}) {
    this._logger          = opts.logger          || console;
    this._auditLog        = opts.auditLog        || null;
    this._logAdapter268   = opts.logAdapter      || null;
    // V268: authProvider DI — external auth service (e.g., Privy, Firebase Auth)
    if (opts.authProvider !== null && opts.authProvider !== undefined) {
      if (typeof opts.authProvider.verifyUser !== 'function') {
        throw new Error('onboardingFlow268: authProvider must implement verifyUser(userId, meta)');
      }
    }
    this._authProvider    = opts.authProvider    || null;
    this._authService     = opts.authService     || null; // legacy compat
    this._onboardEngine   = opts.onboardingEngine || null;
    this._agentReceipts   = opts.agentReceipts   || null;
    this._reputationLedger = opts.reputationLedger || null;
    this._embeddedWallet  = opts.embeddedWallet || null;
    this._persistence     = opts.persistence || null;
    // V268: cryptoWordsFilter DI validation
    if (opts.cryptoWordsFilter !== null && opts.cryptoWordsFilter !== undefined) {
      if (typeof opts.cryptoWordsFilter.check !== 'function') {
        throw new Error('onboardingFlow268: cryptoWordsFilter must implement check(text)');
      }
    }
    this._cryptoWordsFilter = opts.cryptoWordsFilter || null;
    this._sessions268     = new Map();
    this._events268       = [];
    this._stats268        = { started: 0, completed: 0, byChannel: {}, dropoffs: {}, walletsCreated: 0 };
    // V268: perf tracking
    this._perf268 = { latencies: [] };
  }

  startFlow268(userId, channel = 'chat', meta = {}) {
    if (!CHANNELS_268.includes(channel)) channel = 'chat';

    const session = {
      userId, channel,
      currentStep: 0,
      startedAt:   Date.now(),
      completedAt: null,
      steps:       FLOW_STEPS_268.map(s => ({ ...s, completedAt: null, skipped: false })),
      telegramId:  meta.telegramId || null,
      email:       meta.email      || null,
      ussdPath:    channel === 'ussd' ? [...USSD_FLOW_268] : null,
      fastPath:    !!(meta.telegramId || meta.email), // pre-authenticated
      walletId:    null,
      metadata:    meta,
      events:      [],
    };

    if (this._embeddedWallet?.createWallet268 && (meta.email || meta.telegramId || channel !== 'api')) {
      try {
        const walletRes = this._embeddedWallet.createWallet268(userId, meta.telegramId ? 'telegram' : 'email', meta.email || meta.telegramId || userId);
        session.walletId = walletRes.wallet?.walletId || null;
        this._stats268.walletsCreated++;
      } catch (_) {}
    }

    this._sessions268.set(userId, session);
    this._recordEvent268(userId, 'started', { channel, fastPath: session.fastPath });
    this._persist268(userId);
    this._stats268.started++;
    this._stats268.byChannel[channel] = (this._stats268.byChannel[channel] || 0) + 1;

    const currentStep = FLOW_STEPS_268[0];

    // Fast path: Telegram/email pre-auth skips identity step
    if (session.fastPath) {
      session.steps[0].completedAt = new Date().toISOString();
      session.currentStep = 1;
      this._recordEvent268(userId, 'fast_path_identity', { channel });
      this._persist268(userId);
      return {
        ok: true, userId, channel,
        fastPath: true,
        currentStep: FLOW_STEPS_268[1],
        message: this._getStepMessage268(FLOW_STEPS_268[1], channel),
        estimatedSecLeft: FLOW_STEPS_268.slice(1).reduce((s, st) => s + st.durationSec, 0),
      };
    }

    return {
      ok: true, userId, channel,
      currentStep,
      message: this._getStepMessage268(currentStep, channel),
      estimatedSecLeft: FLOW_STEPS_268.reduce((s, st) => s + st.durationSec, 0),
      noCryptoWords: true,
    };
  }

  async completeStep268(userId, stepId, data = {}) {
    const _t0 = Date.now();
    const session = this._sessions268.get(userId);
    if (!session) throw new Error(`onboardingFlow268: no session for ${userId}`);

    const stepIdx = session.steps.findIndex(s => s.id === stepId);
    if (stepIdx === -1) throw new Error(`onboardingFlow268: unknown step ${stepId}`);
    if (session.steps[stepIdx].completedAt) return { ok: true, already: true };

    // V268: use injected cryptoWordsFilter if available, else built-in list
    const inputRaw  = JSON.stringify(data);          // preserve original case for external filter
    const inputText = inputRaw.toLowerCase();        // lowercased for built-in list comparison
    if (this._cryptoWordsFilter) {
      const filterResult = this._cryptoWordsFilter.check(inputRaw);
      if (filterResult && filterResult.blocked) {
        return { ok: false, error: `Please avoid crypto terms. We keep it simple — no ${filterResult.word || 'crypto'} needed.` };
      }
    } else {
      for (const word of CRYPTO_WORDS_268) {
        if (inputText.includes(word.toLowerCase())) {
          return { ok: false, error: `Please avoid crypto terms. We keep it simple — no ${word} needed.` };
        }
      }
    }

    // V268: use authProvider.verifyUser if available on identity step
    if (stepId === 'identity' && this._authProvider) {
      try {
        await this._authProvider.verifyUser(userId, data);
      } catch (err) {
        return { ok: false, error: `Auth verification failed: ${err.message}` };
      }
    }

    session.steps[stepIdx].completedAt = new Date().toISOString();
    session.currentStep = Math.max(session.currentStep, stepIdx + 1);
    this._recordEvent268(userId, 'step_completed', { stepId, stepIdx });
    this._persist268(userId);

    // Check if all steps done
    const allDone = session.steps.every(s => s.completedAt || s.skipped);
    if (allDone) {
      session.completedAt = new Date().toISOString();
      this._stats268.completed++;
      const elapsedSec = (Date.now() - session.startedAt) / 1000;

      if (this._reputationLedger?.systemAttest268) {
        try { this._reputationLedger.systemAttest268(userId, 'onboarding', { elapsedSec, channel: session.channel }); } catch (_) {}
      }

      this._recordEvent268(userId, 'completed', { elapsedSec });
      this._persist268(userId);
      this._recordLatency268(_t0);
      return {
        ok: true, complete: true, userId,
        elapsedSec: Math.round(elapsedSec),
        under60sec: elapsedSec < 60,
        message: "You're in! Here's how credits work: you earn them by doing useful tasks, spend them for AI help.",
      };
    }

    const nextStep = session.steps[session.currentStep];
    this._recordLatency268(_t0);
    return {
      ok: true, userId, stepId,
      nextStep: nextStep || null,
      message: nextStep ? this._getStepMessage268(nextStep, session.channel) : null,
      progress: `${session.currentStep}/${FLOW_STEPS_268.length}`,
    };
  }

  getFlow268(userId) {
    const s = this._sessions268.get(userId);
    if (!s) return null;
    const elapsed = Math.round((Date.now() - s.startedAt) / 1000);
    return {
      userId: s.userId,
      channel: s.channel,
      currentStepIndex: s.currentStep,
      steps: s.steps,
      elapsed,
      complete: !!s.completedAt,
      fastPath: s.fastPath,
    };
  }

  getUSSDMenu268(userId, input = '') {
    if (!this._sessions268.get(userId)) this.startFlow268(userId, 'ussd');
    const session = this._sessions268.get(userId);
    const path = session?.ussdPath || USSD_FLOW_268;
    const idx = Math.min(session?.currentStep || 0, path.length - 1);
    return { prompt: path[idx]?.prompt || 'Welcome to ECOS.', input, state: session?.currentStep || 0 };
  }

  markDropoff268(userId, reason = 'unknown') {
    const s = this._sessions268.get(userId);
    if (!s || s.completedAt) return { ok: false, error: 'session_not_active' };
    const step = s.steps[s.currentStep]?.id || 'unknown';
    this._stats268.dropoffs[step] = (this._stats268.dropoffs[step] || 0) + 1;
    this._recordEvent268(userId, 'dropoff', { step, reason });
    this._persist268(userId);
    return { ok: true, userId, step, reason };
  }

  getFunnel268() {
    const totals = Object.fromEntries(FLOW_STEPS_268.map(step => [step.id, 0]));
    for (const s of this._sessions268.values()) {
      for (const step of s.steps) if (step.completedAt || step.skipped) totals[step.id]++;
    }
    return { version: '268', started: this._stats268.started, completed: this._stats268.completed, byChannel: this._stats268.byChannel, stepCompletions: totals, dropoffs: this._stats268.dropoffs, walletsCreated: this._stats268.walletsCreated };
  }

  exportState268() {
    return { version: '268', sessions: Array.from(this._sessions268.entries()), events: this._events268.slice(-2000), stats: this._stats268 };
  }

  importState268(snapshot = {}) {
    if (snapshot.version && snapshot.version !== '268') throw new Error('onboardingFlow268: incompatible snapshot version');
    this._sessions268 = new Map(snapshot.sessions || []);
    this._events268 = Array.isArray(snapshot.events) ? snapshot.events : [];
    this._stats268 = snapshot.stats || this._stats268;
    return { ok: true, sessions: this._sessions268.size, events: this._events268.length };
  }

  getStats268() {
    return {
      version: '268',
      ...this._stats268,
      activeSessions: this._sessions268.size,
      completionRate: this._stats268.started > 0
        ? Math.round((this._stats268.completed / this._stats268.started) * 100) / 100
        : 0,
    };
  }

  /** V268: Performance telemetry */
  getPerf268() { return _calcPercentiles268(this._perf268.latencies); }

  /** V268: Check provider health (authProvider, embeddedWallet, cryptoWordsFilter) */
  checkProviderHealth268() {
    return {
      ok: true,
      authProvider: this._authProvider
        ? { ok: typeof this._authProvider.verifyUser === 'function', type: 'external' }
        : { ok: true, type: 'stub' },
      embeddedWallet: this._embeddedWallet
        ? { ok: typeof this._embeddedWallet.createWallet268 === 'function', type: 'external' }
        : { ok: true, type: 'stub' },
      cryptoWordsFilter: this._cryptoWordsFilter
        ? { ok: typeof this._cryptoWordsFilter.check === 'function', type: 'external' }
        : { ok: true, type: 'built-in' },
    };
  }

  _recordLatency268(t0) {
    const ms = Date.now() - t0;
    this._perf268.latencies.push(ms);
    if (this._perf268.latencies.length > 1000) this._perf268.latencies.shift();
  }

  _recordEvent268(userId, event, data = {}) {
    const s = this._sessions268.get(userId);
    const rec = { userId, event, data, ts: new Date().toISOString(), step: s?.steps?.[s.currentStep]?.id || null };
    if (s?.events) s.events.push(rec);
    this._events268.push(rec);
    if (this._events268.length > 10_000) this._events268.shift();
  }

  _persist268(userId) {
    if (!this._persistence) return;
    const s = this._sessions268.get(userId);
    try {
      if (typeof this._persistence.set === 'function') this._persistence.set(`onboarding268:${userId}`, JSON.stringify(s));
      else if (typeof this._persistence.write === 'function') this._persistence.write(userId, s);
    } catch (_) {}
  }

  _getStepMessage268(step, channel) {
    const isUSSD = channel === 'ussd' || channel === 'sms';
    if (!step) return null;
    const msgs = {
      identity:     isUSSD ? 'Reply with your name.' : "Let's create your account. Just your email or Telegram handle — no wallet needed.",
      first_action: isUSSD ? 'Reply with your task (e.g. "translate this").' : "Try your first task. Type what you need help with — for free.",
      cost_reveal:  isUSSD ? 'Each task costs 1 credit. Reply 1 to continue.' : "Credits are simple: 1 credit = 1 task. You earn credits by completing tasks or topping up.",
      complete:     isUSSD ? "You're in! Tasks will arrive via SMS." : "You're in! Type any task to continue.",
    };
    return msgs[step.id] || step.label;
  }
}

module.exports = {
  OnboardingFlow268,
  CRYPTO_WORDS_268,
  CHANNELS_268,
  FLOW_STEPS_268,
  USSD_FLOW_268,
};
