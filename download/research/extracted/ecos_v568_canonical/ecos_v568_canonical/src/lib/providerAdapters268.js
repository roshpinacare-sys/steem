'use strict';
/**
 * src/lib/providerAdapters268.js — Provider Adapter Scaffolds & Validators (V268)
 *
 * Extends providerAdapters267 with:
 *   1. 6 new provider contracts (hitlGate, sandboxExec, intelligenceRegistry,
 *      vectorMemory, db, snapshotEngine) — total 20 contracts
 *   2. logAdapter contract — structured logging DI for all modules
 *   3. All 267 contracts preserved verbatim
 *   4. New stubs for 6 added contracts + logAdapter
 *   5. validateAllProviders268() supports all 21 provider types
 *
 * Zero new npm deps. Identifiers end with 268.
 */

// ── Interface Contracts ──────────────────────────────────────────────────────

const PROVIDER_CONTRACTS_268 = Object.freeze({
  // ── Inherited from V267 (14 contracts) ────────────────────────────────────
  settlementProvider: {
    required: ['settleX402'],
    optional: ['getBalance', 'healthCheck'],
    description: 'x402 settlement backend (Stripe, Base, USDC, etc.)',
  },
  custodyProvider: {
    required: ['createWallet', 'linkExternal'],
    optional: ['getWallet', 'signTransaction'],
    description: 'Embedded wallet custody backend (Privy, Dynamic, etc.)',
  },
  mcpServerRegistry: {
    required: ['get', 'set'],
    optional: ['delete', 'has', 'keys'],
    description: 'Map-like registry for MCP server descriptors',
  },
  toolExecutor: {
    required: [],
    optional: [],
    description: 'Async function(toolId, input, opts) => output for MCP tool execution',
    isFunction: true,
  },
  persistenceAdapter: {
    required: ['loadBloomState', 'saveBloomState'],
    optional: ['clearBloomState'],
    description: 'Persistent storage adapter for Bloom filter state',
  },
  smsGateway: {
    required: ['send'],
    optional: ['getStatus', 'health'],
    description: "SMS send gateway (Twilio, Africa's Talking, etc.)",
  },
  ussdGateway: {
    required: ['send'],
    optional: ['getSession', 'endSession'],
    description: 'USSD push gateway',
  },
  sessionStore: {
    required: ['get', 'set'],
    optional: ['delete', 'has', 'clear'],
    description: 'Map-like session persistence store',
  },
  antiDumpProvider: {
    required: ['evaluateDumpRisk'],
    optional: ['getHistory', 'reset'],
    description: 'Anti-dump risk evaluation provider for splits',
  },
  vestingProvider: {
    required: ['validateVesting'],
    optional: ['createVestingSchedule', 'getVestedAmount', 'getVestingStatus'],
    description: 'Vesting schedule management provider',
  },
  authProvider: {
    required: ['verifyUser'],
    optional: ['createUser', 'revokeUser', 'getUser'],
    description: 'External authentication provider (Privy, Firebase Auth, Supabase Auth)',
  },
  cryptoWordsFilter: {
    required: ['check'],
    optional: ['addWord', 'getWordList'],
    description: 'Crypto terminology filter for onboarding UX',
  },
  schedulerProvider: {
    required: ['schedule', 'cancel'],
    optional: ['getSchedule', 'listScheduled', 'pauseAll'],
    description: 'External task/mission scheduler (BullMQ, Temporal, etc.)',
  },
  budgetProvider: {
    required: ['checkBudget', 'debitBudget'],
    optional: ['getBudget', 'creditBudget', 'getBudgetHistory'],
    description: 'Program budget enforcement provider',
  },

  // ── New in V268 (6 contracts) ──────────────────────────────────────────────

  hitlGate: {
    required: ['escalate'],
    optional: ['getStatus', 'resolveEscalation'],
    description: 'Human-in-the-loop escalation gateway for reflectionLoop',
  },
  sandboxExec: {
    required: ['run'],
    optional: ['getCapabilities'],
    description: 'Sandboxed code execution provider for reflectionLoop',
  },
  intelligenceRegistry: {
    required: ['get'],
    optional: ['list', 'getAvailable'],
    description: 'Model registry for costAwareRouter (haiku/sonnet/opus lookup)',
  },
  vectorMemory: {
    required: ['search'],
    optional: ['add', 'delete'],
    description: 'Semantic search memory provider for costAwareRouter',
  },
  db: {
    required: ['query'],
    optional: ['transaction'],
    description: 'Database adapter for creditReserve (async query(sql,params) => rows)',
  },
  snapshotEngine: {
    required: ['save', 'load'],
    optional: ['list', 'delete'],
    description: 'State snapshot provider for metacognition strategies',
  },

  // ── Structured Logging (V268 cross-cutting) ────────────────────────────────

  logAdapter: {
    required: ['info', 'warn', 'error'],
    optional: ['debug', 'setContext'],
    description: 'Structured logging adapter (Datadog, Winston, Pino, console, etc.)',
  },
});

// ── Validator ────────────────────────────────────────────────────────────────

function validateProvider268(name, impl) {
  const contract = PROVIDER_CONTRACTS_268[name];
  if (!contract) return { ok: false, errors: [`Unknown provider type: ${name}`], warnings: [] };

  if (contract.isFunction) {
    if (typeof impl !== 'function')
      return { ok: false, errors: [`${name}: expected a function`], warnings: [] };
    return { ok: true, errors: [], warnings: [] };
  }

  if (!impl || typeof impl !== 'object')
    return { ok: false, errors: [`${name}: expected an object`], warnings: [] };

  const errors = [];
  const warnings = [];

  for (const method of contract.required) {
    if (typeof impl[method] !== 'function')
      errors.push(`${name}: missing required method "${method}"`);
  }
  for (const method of contract.optional) {
    if (impl[method] !== undefined && typeof impl[method] !== 'function')
      warnings.push(`${name}: optional "${method}" is defined but not a function`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

function validateAllProviders268(opts = {}) {
  const results = {};
  const allErrors = [];
  const allWarnings = [];

  for (const [name, contract] of Object.entries(PROVIDER_CONTRACTS_268)) {
    if (!(name in opts)) continue;
    const r = validateProvider268(name, opts[name]);
    results[name] = r;
    allErrors.push(...r.errors);
    allWarnings.push(...r.warnings);
  }

  return { ok: allErrors.length === 0, results, allErrors, allWarnings };
}

function createAdapterScaffold268(type) {
  const contract = PROVIDER_CONTRACTS_268[type];
  if (!contract) throw new Error(`createAdapterScaffold268: unknown type "${type}"`);
  if (contract.isFunction) return async () => ({ ok: true, output: null });

  const scaffold = {};
  const allMethods = [...(contract.required || []), ...(contract.optional || [])];
  for (const method of allMethods) {
    scaffold[method] = () => { throw new Error(`${type}.${method}: not implemented`); };
  }
  return scaffold;
}

// ── Stubs ────────────────────────────────────────────────────────────────────

function createSettlementProviderStub268(opts = {}) {
  const log = opts.logger || (() => {});
  return {
    settleX402: async (from, to, amountMicro, resource, facilitator) => {
      log(`[stub] settleX402 from=${from} amount=${amountMicro}`);
      return { ok: true, txId: 'stub-tx-268-' + Math.random().toString(36).slice(2) };
    },
    getBalance: async (address) => ({ ok: true, balanceUSDC: 1000, address }),
    healthCheck: async () => ({ ok: true, type: 'stub' }),
  };
}

function createCustodyProviderStub268(opts = {}) {
  const log = opts.logger || (() => {});
  const _wallets = new Map();
  return {
    createWallet: (userId, provider, identity, wOpts) => {
      log(`[stub] createWallet userId=${userId}`);
      const w = { walletId: 'stub-wallet-268-' + userId, walletAddress: '0xSTUB' + userId.slice(0, 6), provider: provider || 'stub', type: 'eoa' };
      _wallets.set(userId, w);
      return w;
    },
    linkExternal: (userId, externalAddress, wOpts) => {
      log(`[stub] linkExternal userId=${userId} addr=${externalAddress}`);
      const w = { walletId: 'stub-linked-268-' + userId, walletAddress: externalAddress, provider: 'external', type: 'linked' };
      _wallets.set(userId + ':ext', w);
      return w;
    },
    getWallet: (userId) => _wallets.get(userId) || null,
    signTransaction: async (walletId, tx) => ({ ok: true, txId: 'stub-sig-268' }),
  };
}

function createPersistenceAdapterStub268(opts = {}) {
  let _state = null;
  return {
    loadBloomState: () => _state || { bitsetBase64: '', exactKeys: [], events: [] },
    saveBloomState: (state) => { _state = state; },
    clearBloomState: () => { _state = null; },
  };
}

function createGatewayStub268(type = 'sms') {
  const _msgs = [];
  return {
    send: (userId, message) => { _msgs.push({ userId, message, ts: Date.now() }); return { ok: true }; },
    getStatus: (userId) => ({ ok: true, messages: _msgs.filter(m => m.userId === userId) }),
    health: () => ({ ok: true, type: 'stub', pending: _msgs.length }),
    _msgs,
  };
}

function createSessionStoreStub268() {
  const _map = new Map();
  return {
    get: (key) => _map.get(key),
    set: (key, val) => { _map.set(key, val); },
    delete: (key) => _map.delete(key),
    has: (key) => _map.has(key),
    clear: () => _map.clear(),
    _map,
  };
}

function createAntiDumpProviderStub268() {
  return {
    evaluateDumpRisk: (splitId, amountMicro, policy, totalDistributed, meta) => ({
      blocked: false, reason: null, score: 0, policy: policy || 'none',
    }),
    getHistory: (splitId) => [],
    reset: (splitId) => ({ ok: true }),
  };
}

function createVestingProviderStub268() {
  const _schedules = new Map();
  return {
    validateVesting: (vestingDays, enforceVesting) => ({ ok: true }),
    createVestingSchedule: (splitId, opts) => ({ ok: true, scheduleId: 'vest-268-' + splitId }),
    getVestedAmount: (splitId, amountMicro) => ({
      vestedAmount: amountMicro,
    }),
    getVestingStatus: (splitId) => ({
      vestedPct: 100, cliff: false, startDate: new Date().toISOString(),
    }),
    _schedules,
  };
}

function createAuthProviderStub268(opts = {}) {
  const allowAll = opts.allowAll !== false;
  return {
    verifyUser: async (userId, meta) => {
      if (!allowAll) throw new Error('authProvider stub: verification rejected');
      return { ok: true, userId, verified: true };
    },
    createUser: async (userId, meta) => ({ ok: true, userId }),
    revokeUser: async (userId) => ({ ok: true }),
    getUser: async (userId) => ({ ok: true, userId }),
  };
}

function createCryptoWordsFilterStub268(opts = {}) {
  const _blocked = new Set(opts.blockedWords || ['blockchain', 'crypto', 'nft', 'token', 'wallet']);
  return {
    check: (text) => {
      const lower = text.toLowerCase();
      for (const word of _blocked) {
        if (lower.includes(word)) return { blocked: true, word };
      }
      return { blocked: false };
    },
    addWord: (word) => { _blocked.add(word.toLowerCase()); return { ok: true }; },
    getWordList: () => [..._blocked],
  };
}

function createSchedulerProviderStub268() {
  const _scheduled = new Map();
  return {
    schedule: (missionId, task, sopts) => { _scheduled.set(missionId, { task, sopts, ts: Date.now() }); return { ok: true }; },
    cancel: (missionId) => { _scheduled.delete(missionId); return { ok: true }; },
    getSchedule: (missionId) => _scheduled.get(missionId) || null,
    listScheduled: () => [..._scheduled.keys()],
    pauseAll: () => { _scheduled.clear(); return { ok: true }; },
    _scheduled,
  };
}

function createBudgetProviderStub268(opts = {}) {
  const _limit = opts.budgetLimit || 1_000_000_000n;
  const _spent = new Map();
  return {
    checkBudget: (programId, amountMicro) => {
      const am = typeof amountMicro === 'bigint' ? amountMicro : BigInt(amountMicro || 0);
      const spent = _spent.get(programId) || 0n;
      if (spent + am > _limit) throw new Error(`budgetProvider stub: budget exceeded for ${programId}`);
      return { ok: true };
    },
    debitBudget: (programId, amountMicro, meta) => {
      const am = typeof amountMicro === 'bigint' ? amountMicro : BigInt(amountMicro || 0);
      _spent.set(programId, (_spent.get(programId) || 0n) + am);
      return { ok: true };
    },
    getBudget: (programId) => ({ ok: true, limit: _limit, spent: _spent.get(programId) || 0n }),
    _spent,
  };
}

// ── New V268 stubs ─────────────────────────────────────────────────────────

function createHitlGateStub268(opts = {}) {
  const autoApprove = opts.autoApprove !== false;
  const _escalations = [];
  return {
    escalate: async (taskId, output, context) => {
      const rec = { taskId, output, context, ts: Date.now(), approved: autoApprove, feedback: autoApprove ? null : 'rejected by stub' };
      _escalations.push(rec);
      return { approved: rec.approved, feedback: rec.feedback };
    },
    getStatus: (taskId) => _escalations.find(e => e.taskId === taskId) || null,
    resolveEscalation: (taskId, approved, feedback) => {
      const e = _escalations.find(x => x.taskId === taskId);
      if (e) { e.approved = approved; e.feedback = feedback; }
      return { ok: true };
    },
    _escalations,
  };
}

function createSandboxExecStub268(opts = {}) {
  return {
    run: async (code, input, sopts) => ({ ok: true, output: `[stub] executed ${code ? code.slice(0, 20) : 'empty'}`, errors: [] }),
    getCapabilities: () => ({ sandboxed: true, type: 'stub', languages: ['js'] }),
  };
}

function createIntelligenceRegistryStub268(opts = {}) {
  const _models = new Map([
    ['haiku',  { model: 'claude-haiku-stub',  estimatedCostPerToken: 0.000001, tier: 'fast'    }],
    ['sonnet', { model: 'claude-sonnet-stub', estimatedCostPerToken: 0.000003, tier: 'balanced'}],
    ['opus',   { model: 'claude-opus-stub',   estimatedCostPerToken: 0.000015, tier: 'quality' }],
  ]);
  return {
    get: (modelId) => _models.get(modelId) || null,
    list: () => [..._models.entries()].map(([id, m]) => ({ id, ...m })),
    getAvailable: () => [..._models.keys()],
  };
}

function createVectorMemoryStub268() {
  const _docs = [];
  return {
    search: async (query, sopts) => {
      const limit = (sopts && sopts.limit) || 5;
      return _docs.slice(0, limit).map(d => ({ content: d.content, score: 0.9 }));
    },
    add: async (doc) => { _docs.push(doc); return { ok: true, id: 'vm-268-' + _docs.length }; },
    delete: async (id) => { return { ok: true }; },
    _docs,
  };
}

function createDbStub268() {
  const _store = new Map();
  return {
    query: async (sql, params) => {
      // Simple stub: returns empty rows or synthetic rows for SELECT
      if (sql && sql.trim().toUpperCase().startsWith('SELECT')) return [];
      return { rowsAffected: 1 };
    },
    transaction: async (fn) => fn({ query: async (sql, params) => [] }),
  };
}

function createSnapshotEngineStub268() {
  const _snapshots = new Map();
  return {
    save: (key, data) => { _snapshots.set(key, JSON.parse(JSON.stringify(data))); return { ok: true }; },
    load: (key) => _snapshots.get(key) || null,
    list: () => [..._snapshots.keys()],
    delete: (key) => { _snapshots.delete(key); return { ok: true }; },
    _snapshots,
  };
}

function createLogAdapterStub268(opts = {}) {
  const prefix = opts.prefix || '[ecos268]';
  const silent = opts.silent || false;
  let _ctx = {};
  return {
    info:  (msg, ctx = {}) => { if (!silent) console.log(JSON.stringify({ level: 'info',  msg, ...(_ctx), ...(ctx) })); },
    warn:  (msg, ctx = {}) => { if (!silent) console.warn(JSON.stringify({ level: 'warn',  msg, ...(_ctx), ...(ctx) })); },
    error: (msg, ctx = {}) => { if (!silent) console.error(JSON.stringify({ level: 'error', msg, ...(_ctx), ...(ctx) })); },
    debug: (msg, ctx = {}) => { /* no-op in default stub */ },
    setContext: (ctx = {}) => { _ctx = { ..._ctx, ...ctx }; },
  };
}

// ── createAllStubs268 ─────────────────────────────────────────────────────

function createAllStubs268(opts = {}) {
  return {
    settlementProvider:   createSettlementProviderStub268(opts),
    custodyProvider:      createCustodyProviderStub268(opts),
    mcpServerRegistry:    new Map(),
    toolExecutor:         async (toolId, input, topts) => ({ ok: true, output: `stub-exec:${toolId}` }),
    persistenceAdapter:   createPersistenceAdapterStub268(opts),
    smsGateway:           createGatewayStub268('sms'),
    ussdGateway:          createGatewayStub268('ussd'),
    sessionStore:         createSessionStoreStub268(),
    antiDumpProvider:     createAntiDumpProviderStub268(),
    vestingProvider:      createVestingProviderStub268(),
    authProvider:         createAuthProviderStub268(opts),
    cryptoWordsFilter:    createCryptoWordsFilterStub268(opts),
    schedulerProvider:    createSchedulerProviderStub268(),
    budgetProvider:       createBudgetProviderStub268(opts),
    // V268 new
    hitlGate:             createHitlGateStub268(opts),
    sandboxExec:          createSandboxExecStub268(opts),
    intelligenceRegistry: createIntelligenceRegistryStub268(opts),
    vectorMemory:         createVectorMemoryStub268(),
    db:                   createDbStub268(),
    snapshotEngine:       createSnapshotEngineStub268(),
    logAdapter:           createLogAdapterStub268(opts),
  };
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  PROVIDER_CONTRACTS_268,
  validateProvider268,
  validateAllProviders268,
  createAdapterScaffold268,
  createAllStubs268,
  // individual stubs
  createSettlementProviderStub268,
  createCustodyProviderStub268,
  createPersistenceAdapterStub268,
  createGatewayStub268,
  createSessionStoreStub268,
  createAntiDumpProviderStub268,
  createVestingProviderStub268,
  createAuthProviderStub268,
  createCryptoWordsFilterStub268,
  createSchedulerProviderStub268,
  createBudgetProviderStub268,
  // V268 new stubs
  createHitlGateStub268,
  createSandboxExecStub268,
  createIntelligenceRegistryStub268,
  createVectorMemoryStub268,
  createDbStub268,
  createSnapshotEngineStub268,
  createLogAdapterStub268,
};
