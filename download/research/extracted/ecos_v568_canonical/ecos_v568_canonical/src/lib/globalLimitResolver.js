'use strict';

/**
 * ECOS Global Limit Resolver — V128
 * 
 * P19 — Constructive Collaboration
 * 
 * Maps regulatory/technical LIMITS in any jurisdiction to practical ALTERNATIVES.
 * 
 * Problem: Users in restricted jurisdictions hit walls:
 *   - Can't receive direct payment in their currency
 *   - Can't share data across borders
 *   - Can't use certain AI systems
 *   - Rate limits on cross-border transactions
 * 
 * Solution: For every limit, surface at least one constructive path forward.
 * 
 * Principle: A limit is never a dead-end — it's a routing problem.
 */

// ─── LIMIT CATALOG ───────────────────────────────────────────────────────────

const LIMIT_CATALOG = {

  // ── PAYMENTS ──────────────────────────────────────────────────────────────

  'payment:no-stripe': {
    description: 'Stripe not available in this jurisdiction',
    affectedJurisdictions: ['iran', 'cuba', 'north-korea', 'syria', 'russia', 'belarus'],
    severity: 'high',
    alternatives: [
      {
        id: 'manual-rail',
        label: 'Manual Payment Rail',
        description: 'ECOS ManualRail: bank transfer, wire, or cash — always available',
        effort: 'low',
        ecosPath: 'POST /api/v1/rails/manual/deposit',
      },
      {
        id: 'credit-accumulation',
        label: 'Accumulate ECOS Credits',
        description: 'Earn ⊙ credits from validation work; redeem when rail becomes available',
        effort: 'none',
        ecosPath: 'GET /api/v1/credits/:accountId',
      },
    ],
  },

  'payment:currency-blocked': {
    description: 'Local currency not supported by default payment rails',
    affectedJurisdictions: ['venezuela', 'argentina', 'turkey', 'nigeria'],
    severity: 'medium',
    alternatives: [
      {
        id: 'usd-equivalent',
        label: 'USD-denominated Credits',
        description: 'ECOS Credits are USD-denominated internally; withdraw in USD via bank transfer',
        effort: 'low',
        ecosPath: 'POST /api/v1/rails/bank/deposit',
      },
      {
        id: 'crypto-rail-stub',
        label: 'Crypto Rail (when enabled)',
        description: 'Set ECOS_CRYPTO_ENABLED=true to activate CryptoRail as withdrawal method',
        effort: 'medium',
        ecosPath: 'GET /api/v1/rails',
      },
    ],
  },

  // ── DATA ──────────────────────────────────────────────────────────────────

  'data:cross-border-blocked': {
    description: 'Data cannot leave the jurisdiction (data residency requirement)',
    affectedJurisdictions: ['eu', 'canada', 'japan', 'india', 'brazil', 'russia', 'china'],
    severity: 'high',
    alternatives: [
      {
        id: 'pseudonymized-exchange',
        label: 'Pseudonymized Knowledge Exchange',
        description: 'Share anonymized task patterns and template learnings — no PII crosses border',
        effort: 'low',
        ecosPath: 'POST /api/v1/collaboration/sessions (mode: knowledge-exchange)',
      },
      {
        id: 'template-only-share',
        label: 'Template-Only Sharing',
        description: 'Share agent templates (logic) without sharing any task data',
        effort: 'none',
        ecosPath: 'GET /api/v1/templates/public',
      },
      {
        id: 'proxied-session',
        label: 'Bridge-Proxied Collaboration',
        description: 'GlobalBridgeNetwork routes collaboration through jurisdiction-compliant relay',
        effort: 'low',
        ecosPath: 'POST /api/v1/bridge/sessions (mode: proxied)',
      },
    ],
  },

  'data:ai-restricted': {
    description: 'AI inference not permitted on certain data types in this jurisdiction',
    affectedJurisdictions: ['eu', 'china', 'russia'],
    severity: 'medium',
    alternatives: [
      {
        id: 'human-only-validation',
        label: 'Human-Only Validation Mode',
        description: 'Route all tasks to HITL with confidence_gate threshold=1.0 (force human)',
        effort: 'low',
        ecosPath: 'CONFIDENCE_AUTO=1.01 (env override)',
      },
      {
        id: 'offline-inference',
        label: 'Offline Local Inference',
        description: 'Use EcosOfflineAdapter — runs local model, no data leaves the machine',
        effort: 'medium',
        ecosPath: 'lib/offlineInference.js + intelligenceRegistry adapter',
      },
    ],
  },

  // ── IDENTITY ──────────────────────────────────────────────────────────────

  'identity:pseudonym-required': {
    description: 'Real identity cannot be shared with counterparty across border',
    affectedJurisdictions: ['eu', 'canada', 'japan', 'india', 'brazil'],
    severity: 'low',
    alternatives: [
      {
        id: 'validator-pseudonym',
        label: 'Pseudonymous Validator Identity',
        description: 'validatorIdentity.js provides a key-derived pseudonym — real identity stays local',
        effort: 'none',
        ecosPath: 'GET /api/v1/validators/:id/identity (returns pubKey only)',
      },
      {
        id: 'trust-bond-only',
        label: 'Trust-Bond Without Identity',
        description: 'TrustBond accumulates from interactions — no name or PII required',
        effort: 'none',
        ecosPath: 'GET /api/v1/bridge/bonds/:userId',
      },
    ],
  },

  // ── COLLABORATION ──────────────────────────────────────────────────────────

  'collab:no-live-session': {
    description: 'Live real-time collaboration restricted due to cross-border AI rules',
    affectedJurisdictions: ['eu+eu', 'eu+canada', 'eu+japan', 'eu+india'],
    severity: 'low',
    alternatives: [
      {
        id: 'async-review',
        label: 'Async Peer Review',
        description: 'One party submits work → other reviews asynchronously → exchange is audited',
        effort: 'none',
        ecosPath: 'POST /api/v1/collaboration/sessions (mode: review)',
      },
      {
        id: 'template-based-collab',
        label: 'Template-Based Collaboration',
        description: 'Collaborate through shared agent templates, not live data streams',
        effort: 'none',
        ecosPath: 'POST /api/v1/workspaces/:id/templates',
      },
    ],
  },

  // ── RATE LIMITS ───────────────────────────────────────────────────────────

  'rate:deposit-limit': {
    description: 'Deposit rate limited (10/min by default)',
    affectedJurisdictions: ['all'],
    severity: 'low',
    alternatives: [
      {
        id: 'bulk-credit-purchase',
        label: 'Bulk Credit Grant',
        description: 'Operator can grant credits in bulk via admin endpoint instead of per-deposit',
        effort: 'low',
        ecosPath: 'POST /api/v1/credits/grant-free-tier',
      },
      {
        id: 'increase-rate-limit',
        label: 'Raise Rate Limit',
        description: 'Set DEPOSIT_RATE_LIMIT_MAX env var; default 10, production may need 100+',
        effort: 'low',
        ecosPath: 'scripts/check-env.js (OPS-03)',
      },
    ],
  },
};

// ─── RESOLVER ────────────────────────────────────────────────────────────────

class GlobalLimitResolver {

  /**
   * Find limits that apply to a given context.
   */
  findLimits({ jurisdiction, category } = {}) {
    return Object.entries(LIMIT_CATALOG)
      .filter(([id, limit]) => {
        const catMatch = !category || id.startsWith(category + ':');
        const jurMatch = !jurisdiction || 
          limit.affectedJurisdictions.includes(jurisdiction) ||
          limit.affectedJurisdictions.includes('all');
        return catMatch && jurMatch;
      })
      .map(([id, limit]) => ({ id, ...limit }));
  }

  /**
   * Get alternatives for a specific limit.
   */
  resolve(limitId) {
    const limit = LIMIT_CATALOG[limitId];
    if (!limit) return null;
    return { id: limitId, ...limit };
  }

  /**
   * Given a jurisdiction pair, return all cross-border limits + alternatives.
   */
  crossBorderAnalysis(jurisdictionA, jurisdictionB) {
    const jA = jurisdictionA.toLowerCase();
    const jB = jurisdictionB.toLowerCase();

    const limits = Object.entries(LIMIT_CATALOG)
      .filter(([, limit]) =>
        limit.affectedJurisdictions.includes(jA) ||
        limit.affectedJurisdictions.includes(jB) ||
        limit.affectedJurisdictions.includes(`${jA}+${jB}`) ||
        limit.affectedJurisdictions.includes(`${jB}+${jA}`)
      )
      .map(([id, limit]) => ({ id, ...limit }));

    const alternatives = limits.flatMap(l => l.alternatives);
    const maxSeverity = limits.some(l => l.severity === 'high') ? 'high'
      : limits.some(l => l.severity === 'medium') ? 'medium' : 'low';

    return {
      jurisdictions: [jA, jB],
      limitsFound: limits.length,
      maxSeverity,
      limits,
      allAlternatives: alternatives,
      canCollaborate: true,   // always — we always find a path
    };
  }

  catalog() {
    return Object.entries(LIMIT_CATALOG).map(([id, limit]) => ({
      id,
      description: limit.description,
      severity: limit.severity,
      alternativeCount: limit.alternatives.length,
    }));
  }
}

const globalLimitResolver = new GlobalLimitResolver();

module.exports = {
  GlobalLimitResolver,
  globalLimitResolver,
  LIMIT_CATALOG,
};
