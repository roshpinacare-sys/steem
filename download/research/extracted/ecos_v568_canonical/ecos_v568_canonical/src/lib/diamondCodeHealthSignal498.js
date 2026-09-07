'use strict';
/**
 * src/lib/diamondCodeHealthSignal498.js — ECOS V498 (Phase P377) — Diamond Code-Health Signal
 *
 * CONNECTION > ADDITION. The Diamond (V453 operator + V462 foresight) reasons over ECONOMIC
 * health (solvency, circuit breaker, chat) but is BLIND to CODE health — even though we built
 * the registry/bridge (V463/V495/V496) and orphan manifest (V497) that measure exactly that.
 * So the autonomous operator can protect users' money but can't see the system rotting under it.
 *
 * This wires the self-awareness layer INTO the Diamond's cognition, without touching the
 * sacred-adjacent assessSystem453: it gathers technical-debt signals, ENRICHES a V453 cognition
 * with a code-health concern, and proposes BOUNDED cleanup actions that flow through the V437
 * orchestrator (proposal-only — chain flattening needs a human; nothing auto-executes).
 *
 *   gatherCodeHealth498   — chains, honest-retirable, archived-orphans → one debt snapshot + score.
 *   augmentCognition498   — append a code-health concern to a V453 cognition (re-ranked, bounded
 *                           so debt NEVER outranks a solvency/safety emergency).
 *   proposeCleanup498     — bounded, explained governance proposals (flatten chain / archive
 *                           orphans), in the V453 decision format → run through the orchestrator.
 *
 * Reuses bridge496 + manifest497 (no reinvention). Pure JS, no new deps (R3/R6).
 * Read-only over sacred. Version-suffixed (…498).
 *
 * @version 498.0.0
 */

const CODE_HEALTH_VERSION_498 = '498.0.0';
let _Bridge498 = null, _Manifest498 = null;
try { _Bridge498 = require('./registryConsolidationBridge496.js'); } catch (_) {}
try { _Manifest498 = require('./orphanArchiveManifest497.js'); } catch (_) {}

const SEV_RANK_498 = { CRITICAL: 3, HIGH: 2, MEDIUM: 1, INFO: 0 };

class CodeHealthError498 extends Error {
  constructor(msg, code) { super(msg); this.name = 'CodeHealthError498'; this.code = code || 'CODE_HEALTH_ERROR'; this.statusCode = 400; }
}

function _num498(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }

/**
 * Gather a technical-debt snapshot from the bridge + manifest.
 * @param {{ libDir?:string, rootDir?:string }} opts
 */
function gatherCodeHealth498(opts = {}) {
  const rootDir = opts.rootDir || process.cwd();
  const libDir = opts.libDir || (rootDir + '/lib');
  let chains = 0, honestRetirable = 0, parallelTowers = 0, archivedOrphans = 0, topChains = [];
  try {
    if (_Bridge498 && _Bridge498.honestDuplication496) {
      const h = _Bridge498.honestDuplication496({ libDir, rootDir });
      chains = _num498(h.inheritanceChains, 0);
      honestRetirable = _num498(h.honestRetirable, 0);
      parallelTowers = _num498(h.parallelDuplicateTowers, 0);
      topChains = (h.towers || []).filter(t => t.kind === 'inheritance-chain').slice(0, 5).map(t => ({ base: t.base, versions: t.versions, canonical: t.canonical }));
    }
  } catch (_) {}
  try { if (_Manifest498 && _Manifest498.summary497) archivedOrphans = _num498(_Manifest498.summary497(rootDir).archivedModules, 0); } catch (_) {}

  // debtScore 0..100 (higher = more debt). Chains are the dominant, hard-to-retire debt.
  const debtScore = Math.max(0, Math.min(100, chains * 3 + honestRetirable + parallelTowers));
  const severity = debtScore >= 60 ? 'MEDIUM' : 'INFO';   // debt is never an emergency vs money/safety
  return {
    version: CODE_HEALTH_VERSION_498,
    chains, parallelTowers, honestRetirable, archivedOrphans, topChains,
    debtScore, severity,
    detail: `${chains} inheritance-chain tower(s), ${honestRetirable} naively-safe retirable, ${archivedOrphans} orphans already archived`,
  };
}

/**
 * Enrich a V453 cognition with a code-health concern (bounded — never outranks money/safety).
 * @param {object} cognition  a V453 cognition
 * @param {object} codeHealth  from gatherCodeHealth498
 */
function augmentCognition498(cognition, codeHealth) {
  if (!cognition || !Array.isArray(cognition.concerns)) throw new CodeHealthError498('valid V453 cognition required', 'BAD_COGNITION');
  if (!codeHealth) throw new CodeHealthError498('codeHealth required', 'BAD_ARGS');
  const concerns = cognition.concerns.slice();
  if (codeHealth.chains > 0 || codeHealth.honestRetirable > 0) {
    concerns.push({ pillar: 'codeHealth', severity: codeHealth.severity, detail: codeHealth.detail });
  }
  concerns.sort((a, b) => SEV_RANK_498[b.severity] - SEV_RANK_498[a.severity]);
  // bounded health impact: debt can shave at most 10 points, and only if no higher emergency.
  const hasEmergency = concerns.some(c => c.severity === 'CRITICAL' || c.severity === 'HIGH');
  const debtPenalty = hasEmergency ? 0 : Math.round(Math.min(10, codeHealth.debtScore / 10));
  const healthScore = Math.max(0, Math.min(100, (typeof cognition.healthScore === 'number' ? cognition.healthScore : 100) - debtPenalty));
  return Object.assign({}, cognition, { concerns, concernCount: concerns.length, healthScore, codeHealth });
}

/**
 * Bounded cleanup proposals in the V453 decision format (run through the orchestrator).
 * Chains → manual-flatten (requiresAuth: a human must do the inline). Orphans → archive (safe).
 */
function proposeCleanup498(codeHealth, opts = {}) {
  if (!codeHealth) throw new CodeHealthError498('codeHealth required', 'BAD_ARGS');
  const actions = [];
  for (const c of (codeHealth.topChains || [])) {
    actions.push({ priority: 'LOW', pillar: 'codeHealth', capability: 'maintenance.flattenChain', preemptive: false,
      reason: `${c.base} is an inheritance chain (${c.versions} versions). Flatten into the canonical (${c.canonical}) — MANUAL: build a self-contained head exporting the union, repoint requires, then thin-re-export. Naive re-export breaks the build.`,
      reversible: true, impact: 'medium', requiresAuth: true, args: { base: c.base, canonical: c.canonical } });
  }
  if (codeHealth.honestRetirable > 0) {
    actions.push({ priority: 'LOW', pillar: 'codeHealth', capability: 'maintenance.collapseParallel', preemptive: false,
      reason: `${codeHealth.honestRetirable} parallel-duplicate module(s) are naively-safe to thin re-export of their canonical.`,
      reversible: true, impact: 'low', requiresAuth: false, args: {} });
  }
  if (actions.length === 0) actions.push({ priority: 'INFO', pillar: 'codeHealth', capability: 'monitor.noop', reason: 'code health nominal — no consolidation pending', reversible: true, impact: 'none', requiresAuth: false, args: {} });
  const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
  actions.sort((a, b) => order[a.priority] - order[b.priority]);
  return { version: CODE_HEALTH_VERSION_498, debtScore: codeHealth.debtScore, actions, actionCount: actions.length,
    note: 'proposals only — chain flattening requires human authorization; the Diamond never auto-executes destructive cleanup' };
}

module.exports = {
  CODE_HEALTH_VERSION_498, CodeHealthError498,
  gatherCodeHealth498, augmentCognition498, proposeCleanup498,
};
