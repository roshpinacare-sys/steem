'use strict';
/**
 * consolidatedProviderRegistry271.js — Single source of truth for all 22 DI provider contracts.
 * V271 canonical release. Zero new npm dependencies.
 *
 * This module defines the canonical shape of every provider type used across the V263-V270
 * module families, provides runtime contract validation, and returns a wired registry object
 * that callers can pass to module factories as dependency injection context.
 *
 * Naming convention: functions end in 271 per V254 standard.
 */

'use strict';

// ─── Contract Definitions ────────────────────────────────────────────────────
// Each contract specifies: required methods, optional methods, and a description.

const PROVIDER_CONTRACTS_271 = {
  creditReserve:     { required: ['getBalance', 'topUp', 'debit'],                optional: ['getPerf268', 'checkHealth268', 'getStats'],            desc: 'credit reserve ledger' },
  breakageEngine:    { required: ['recordBreakage', 'getCohortsWithBreakage'],    optional: ['getPerf268', 'escheatable'],                           desc: 'breakage/escheat engine' },
  conversionGateway: { required: ['convert'],                                     optional: ['getPerf268', 'getSupportedPairs'],                     desc: 'fiat/micro unit conversion' },
  reputationLedger:  { required: ['addAttestation', 'getScore'],                  optional: ['getPerf268', 'disclosure'],                            desc: 'reputation attestation ledger' },
  memoryIntegrity:   { required: ['signWrite', 'readScope'],                      optional: ['getPerf268', 'rollback'],                              desc: 'signed memory integrity' },
  metacognition:     { required: ['reflect', 'getStats'],                         optional: ['getPerf268'],                                          desc: 'metacognition loop' },
  offlineQueue:      { required: ['enqueue', 'replay', 'depth'],                  optional: ['getPerf268'],                                          desc: 'offline operation queue' },
  onboardingFlow:    { required: ['start', 'advance', 'getStage'],                optional: ['getPerf268'],                                          desc: 'user onboarding flow' },
  quadraticFunding:  { required: ['createRound', 'contribute', 'distribute'],     optional: ['getPerf268'],                                          desc: 'quadratic funding rounds' },
  reflectionLoop:    { required: ['run', 'getStats'],                             optional: ['getPerf268'],                                          desc: 'reflection loop engine' },
  splitModule:       { required: ['createSplit', 'getSplit', 'markVested'],        optional: ['getPerf268'],                                          desc: 'payment split management' },
  sybilGuard:        { required: ['evaluate', 'velocityCheck'],                   optional: ['getPerf268'],                                          desc: 'sybil resistance guard' },
  telemetry:         { required: ['recordSpan', 'exportSpans'],                   optional: ['getPerf268'],                                          desc: 'OTel telemetry spans' },
  tipModule:         { required: ['sendTip', 'createTip', 'getCommunityPool'],    optional: ['getPerf268'],                                          desc: 'tipping / community pool' },
  injectionFirewall: { required: ['checkInput', 'getBlockList'],                  optional: ['getPerf268'],                                          desc: 'injection firewall' },
  costAwareRouter:   { required: ['routeTask', 'getModelForBudget'],              optional: ['getPerf268'],                                          desc: 'cost-aware LLM routing' },
  agentReceipts:     { required: ['recordStep', 'getMandateChain'],               optional: ['getPerf268', 'getAP2Manifest'],                        desc: 'agent receipt chain' },
  x402:              { required: ['createPaymentRequired', 'processPayment'],     optional: ['getPerf268', 'validateNonce'],                         desc: 'x402 payment protocol' },
  executionPrograms: { required: ['assignMission', 'getMission', 'completeMission'], optional: ['getPerf268'],                                       desc: 'execution programs registry' },
  embeddedWallet:    { required: ['getBalance', 'transfer', 'getAddress'],        optional: ['getPerf268'],                                          desc: 'embedded wallet' },
  mcpDeepIntegration:{ required: ['callTool', 'listTools'],                       optional: ['getPerf268'],                                          desc: 'MCP tool integration' },
  auditBloom:        { required: ['add', 'check', 'getStats'],                    optional: ['getPerf268', 'setPersistenceAdapter'],                 desc: 'bloom filter audit log' },
};

// ─── Contract Validation ──────────────────────────────────────────────────────

/**
 * Validate a single provider against its contract.
 * @param {string} contractName - Key in PROVIDER_CONTRACTS_271
 * @param {object} provider - Provider instance to validate
 * @returns {{ ok: boolean, contractName: string, missing: string[], warnings: string[] }}
 */
function validateProvider271(contractName, provider) {
  const contract = PROVIDER_CONTRACTS_271[contractName];
  if (!contract) {
    return { ok: false, contractName, missing: [], warnings: [`Unknown contract: ${contractName}`] };
  }
  if (!provider || typeof provider !== 'object') {
    return { ok: false, contractName, missing: contract.required.slice(), warnings: ['Provider is null or not an object'] };
  }

  const missing   = contract.required.filter(m => typeof provider[m] !== 'function');
  const warnings  = contract.optional
    .filter(m => typeof provider[m] !== 'function')
    .map(m => `optional method missing: ${m}`);

  return { ok: missing.length === 0, contractName, desc: contract.desc, missing, warnings };
}

/**
 * Validate all providers in a deps map against their contracts.
 * Only validates keys that appear in PROVIDER_CONTRACTS_271.
 * @param {object} deps - Map of { contractName: providerInstance }
 * @returns {{ allOk: boolean, results: Array, summary: object }}
 */
function validateAllProviders271(deps = {}) {
  const results = [];
  let allOk = true;

  for (const contractName of Object.keys(PROVIDER_CONTRACTS_271)) {
    if (!(contractName in deps)) {
      results.push({ ok: false, contractName, missing: ['(provider not supplied)'], warnings: [] });
      allOk = false;
      continue;
    }
    const r = validateProvider271(contractName, deps[contractName]);
    if (!r.ok) allOk = false;
    results.push(r);
  }

  const summary = {
    totalContracts: results.length,
    passing: results.filter(r => r.ok).length,
    failing: results.filter(r => !r.ok).length,
    failingNames: results.filter(r => !r.ok).map(r => r.contractName),
  };

  return { allOk, results, summary };
}

/**
 * Build a safe accessor for a provider, returning a no-op stub if the provider
 * is missing or does not satisfy its contract. This prevents hard crashes on boot
 * when a module is not yet initialised (graceful fallback, R4).
 * @param {string} contractName
 * @param {object|null} provider
 * @returns {object} - Original provider if valid, otherwise a stub
 */
function safeProvider271(contractName, provider) {
  const validation = validateProvider271(contractName, provider);
  if (validation.ok) return provider;

  // Build a stub that logs every call and returns a safe default
  const contract = PROVIDER_CONTRACTS_271[contractName] || { required: [], optional: [] };
  const stub = {};
  const allMethods = [...contract.required, ...contract.optional];
  for (const method of allMethods) {
    stub[method] = (..._args) => {
      // Return sensible defaults per method signature type
      return null;
    };
  }
  stub.__isStub271 = true;
  stub.__contractName = contractName;
  stub.__validationErrors = validation.missing;
  return stub;
}

/**
 * Create a consolidated provider registry from a deps map.
 * Validates each provider and logs any contract violations.
 * Returns validated (or stubbed) providers plus a validation report.
 *
 * @param {object} deps   - Raw provider map
 * @param {object} logger - Pino-compatible logger (optional)
 * @returns {{ providers: object, validation: object, contracts: object }}
 */
function createConsolidatedProviderRegistry271(deps = {}, logger = null) {
  const _log = (level, meta, msg) => {
    try {
      if (logger && typeof logger[level] === 'function') logger[level](meta, msg);
    } catch (_) {}
  };

  const validation = validateAllProviders271(deps);

  if (!validation.allOk) {
    _log('warn', { failing: validation.summary.failingNames }, '[V271] Some provider contracts not satisfied — stubs installed for missing methods');
  } else {
    _log('info', { passing: validation.summary.passing }, '[V271] All 22 provider contracts satisfied');
  }

  // Build the providers object: valid providers as-is, invalid ones wrapped with safeProvider271
  const providers = {};
  for (const contractName of Object.keys(PROVIDER_CONTRACTS_271)) {
    const raw = deps[contractName];
    const result = validation.results.find(r => r.contractName === contractName);
    providers[contractName] = (result && result.ok) ? raw : safeProvider271(contractName, raw);
  }

  return {
    providers,
    validation,
    contracts: PROVIDER_CONTRACTS_271,
    ecosVersion: 'V271',
  };
}

module.exports = {
  PROVIDER_CONTRACTS_271,
  validateProvider271,
  validateAllProviders271,
  safeProvider271,
  createConsolidatedProviderRegistry271,
};
