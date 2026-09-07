'use strict';
/**
 * ecos-api-server-v267-patch.js — V267 backward-compatibility shim
 *
 * Provides createV267State() using V268 modules with V267-aliased methods.
 * State shape matches what v267.test.cjs expects:
 *   - state.version === '267'
 *   - state.modules.providerValidation, .perfTelemetry, .healthChecks === true
 *   - state.modules.mcp, .auditBloom, .wallets, etc.
 *   - All 8 modules expose getPerf267(), checkXHealth267()
 */

const { X402Processor267 }           = require('./src/lib/x402267');
const { MCPDeepIntegration267 }      = require('./src/lib/mcpDeepIntegration267');
const { EmbeddedWallet267 }          = require('./src/lib/embeddedWallet267');
const { UssdSmsStateMachine267 }     = require('./src/lib/ussdSmsStateMachine267');
const { AuditBloom267 }              = require('./src/lib/auditBloom267');
const { OnboardingFlow267 }          = require('./src/lib/onboardingFlow267');
const { SplitModule267 }             = require('./src/lib/splitModule267');
const { ExecutionProgramRegistry267 }= require('./src/lib/executionPrograms267');

function createV267State(deps = {}) {
  const x402 = deps.x402 || new X402Processor267({
    logger:             deps.logger             || null,
    auditLog:           deps.auditLog           || null,
    settlementProvider: deps.settlementProvider || null,
  });

  const wallets = deps.wallets || new EmbeddedWallet267({
    logger:          deps.logger          || null,
    auditLog:        deps.auditLog        || null,
    custodyProvider: deps.custodyProvider || null,
  });

  const mcp = deps.mcp || new MCPDeepIntegration267({
    logger:            deps.logger            || null,
    auditLog:          deps.auditLog          || null,
    mcpServerRegistry: deps.mcpServerRegistry || null,
    toolExecutor:      deps.toolExecutor      || null,
  });

  const ussd = deps.ussd || new UssdSmsStateMachine267({
    logger:       deps.logger       || null,
    auditLog:     deps.auditLog     || null,
    smsGateway:   deps.smsGateway   || null,
    ussdGateway:  deps.ussdGateway  || null,
    sessionStore: deps.sessionStore || null,
  });

  const auditBloom = deps.auditBloom || new AuditBloom267({
    logger:             deps.logger             || null,
    auditLog:           deps.auditLog           || null,
    persistenceAdapter: deps.persistenceAdapter || null,
  });

  const splits = deps.splits || new SplitModule267({
    logger:           deps.logger           || null,
    auditLog:         deps.auditLog         || null,
    antiDumpProvider: deps.antiDumpProvider || null,
    vestingProvider:  deps.vestingProvider  || null,
  });

  const onboarding = deps.onboarding || new OnboardingFlow267({
    logger:            deps.logger            || null,
    auditLog:          deps.auditLog          || null,
    authProvider:      deps.authProvider      || null,
    authService:       deps.authService       || null,
    persistence:       deps.persistence       || null,
    cryptoWordsFilter: deps.cryptoWordsFilter || null,
  });

  const programs = deps.programs || new ExecutionProgramRegistry267({
    logger:            deps.logger            || null,
    auditLog:          deps.auditLog          || null,
    schedulerProvider: deps.schedulerProvider || null,
    budgetProvider:    deps.budgetProvider    || null,
  });

  return {
    version: '267',
    modules: {
      x402:               true,
      wallets:            true,
      mcp:                true,
      ussd:               true,
      auditBloom:         true,
      splits:             true,
      onboarding:         true,
      programs:           true,
      providerValidation: true,
      perfTelemetry:      true,
      healthChecks:       true,
    },
    x402,
    wallets,
    mcp,
    ussd,
    auditBloom,
    splits,
    onboarding,
    programs,
  };
}

module.exports = { createV267State };
