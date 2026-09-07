'use strict';
/**
 * lib/canonTowerAuditor518.js — ECOS V518 (Phase P406)
 *
 * CONNECTION (Action C — audit-side): canonBridgePatch508 ↔ tower-classification truth
 *
 * Problem (discovered while preparing V518 candidates):
 *   NEXT_SESSION_PROMPT_V517 listed 3 candidate towers for registration as
 *   parallel-duplicate with canonBridgePatch508:
 *     - marketMaker ×36 (298..333)
 *     - providerAdapters ×17 (267..286)  ← one V482 thin re-export, rest active
 *     - economicIntegrityLoadBearing ×11 (361..371)
 *
 *   Direct inspection (head -2 + grep '^module\.exports = require') of every
 *   non-tip member shows:
 *     marketMaker:                   0 / 35 non-tip members are thin re-exports
 *     providerAdapters:              1 / 16 non-tip members are thin re-exports
 *     economicIntegrityLoadBearing:  0 / 10 non-tip members are thin re-exports
 *
 *   None of the three meet the V516/V517 contract for parallel-duplicate
 *   registration (≥1 tip + all non-tip = thin `module.exports = require('./<tip>')`).
 *   Registering them anyway would produce the same false reporting V516/V517
 *   set out to eliminate.
 *
 * Solution (this module): a read-only auditor that scans every lib/<name><NNN>.js
 * tower group with ≥3 members and classifies each non-tip member as either
 * `thinReexport` or `active`. The auditor exposes:
 *   - classifyTower518(name) → per-tower verdict
 *   - auditAllTowers518()    → full report (used by V518-T02 endpoint)
 *   - getCandidateVerdicts518() → focused verdict on the 3 V517-listed candidates
 *
 * No descriptors are registered with canonBridgePatch508. This is intentional
 * fail-closed truth-keeping: until a candidate actually becomes parallel-dup,
 * the bridge stays untouched.
 *
 * SACRED untouched. Zero npm deps. Node built-ins + relative require only.
 *
 * @module canonTowerAuditor518
 * @version 518.0.0
 */

const fs   = require('fs');
const path = require('path');

const AUDITOR_VERSION_518 = '518.0.0';

const CANDIDATE_NAMES_518 = Object.freeze([
  'marketMaker',
  'providerAdapters',
  'economicIntegrityLoadBearing',
]);

// A "thin re-export" is a module whose body essentially is
//   module.exports = require('./<something>')
// optionally preceded by 'use strict' / a header comment.
const THIN_REEXPORT_RE_518 = /^module\.exports\s*=\s*require\(\s*['"]\.\/[^'"]+['"]\s*\)\s*;?\s*$/m;

function _libDir518() {
  return path.resolve(__dirname);
}

function _listTowerFiles518(libDir, name) {
  const re = new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)\\.js$');
  const out = [];
  let entries;
  try { entries = fs.readdirSync(libDir); }
  catch (_) { return out; }
  for (const f of entries) {
    const m = f.match(re);
    if (m) out.push({ file: f, n: parseInt(m[1], 10) });
  }
  out.sort((a, b) => a.n - b.n);
  return out;
}

function _classifyMember518(libDir, file) {
  let src;
  try { src = fs.readFileSync(path.join(libDir, file), 'utf8'); }
  catch (e) { return { file, kind: 'unreadable', error: e.message }; }
  if (THIN_REEXPORT_RE_518.test(src)) return { file, kind: 'thinReexport' };
  return { file, kind: 'active', bytes: src.length };
}

function classifyTower518(name, opts) {
  const libDir = (opts && opts.libDir) || _libDir518();
  const members = _listTowerFiles518(libDir, name);
  if (members.length === 0) {
    return Object.freeze({
      name, count: 0, eligible: false,
      reason: 'no members found',
      members: [],
    });
  }
  const tip = members[members.length - 1];
  const verdicts = members.map(m => {
    if (m.n === tip.n) return { file: m.file, n: m.n, kind: 'tip' };
    const v = _classifyMember518(libDir, m.file);
    return { file: m.file, n: m.n, kind: v.kind };
  });
  const nonTip = verdicts.filter(v => v.kind !== 'tip');
  const thin   = nonTip.filter(v => v.kind === 'thinReexport').length;
  const active = nonTip.filter(v => v.kind === 'active').length;
  const unread = nonTip.filter(v => v.kind === 'unreadable').length;
  const isParallelDuplicate = (active === 0 && unread === 0 && thin === nonTip.length && nonTip.length >= 1);
  return Object.freeze({
    name,
    count: members.length,
    base: String(members[0].n),
    tip:  String(tip.n),
    nonTipTotal: nonTip.length,
    thinReexport: thin,
    active,
    unreadable: unread,
    isParallelDuplicate,
    eligible: isParallelDuplicate,
    reason: isParallelDuplicate
      ? 'all non-tip members are thin re-exports of tip — eligible for canonBridgePatch508 registration'
      : `${active} non-tip member(s) are active modules — NOT a parallel-duplicate tower`,
    members: Object.freeze(verdicts.map(Object.freeze)),
  });
}

function getCandidateVerdicts518(opts) {
  return Object.freeze(CANDIDATE_NAMES_518.map(n => classifyTower518(n, opts)));
}

function auditAllTowers518(opts) {
  const libDir = (opts && opts.libDir) || _libDir518();
  const minMembers = (opts && Number.isInteger(opts.minMembers) && opts.minMembers > 0)
    ? opts.minMembers : 3;
  let entries;
  try { entries = fs.readdirSync(libDir); }
  catch (e) { return Object.freeze({ ok: false, error: e.message, towers: [] }); }
  const groups = new Map();
  for (const f of entries) {
    const m = f.match(/^([A-Za-z][A-Za-z0-9_]*?)(\d+)\.js$/);
    if (!m) continue;
    const name = m[1];
    if (!groups.has(name)) groups.set(name, 0);
    groups.set(name, groups.get(name) + 1);
  }
  const towers = [];
  for (const [name, count] of groups.entries()) {
    if (count < minMembers) continue;
    towers.push(classifyTower518(name, { libDir }));
  }
  towers.sort((a, b) => b.count - a.count);
  return Object.freeze({
    ok: true,
    libDir,
    minMembers,
    totalTowers: towers.length,
    eligibleForRegistration: towers.filter(t => t.eligible).map(t => t.name),
    ineligibleCount: towers.filter(t => !t.eligible).length,
    towers,
  });
}

function getAuditorSummary518() {
  const candidates = getCandidateVerdicts518();
  return Object.freeze({
    version:     AUDITOR_VERSION_518,
    candidates,
    eligibleCandidates:    candidates.filter(c => c.eligible).map(c => c.name),
    ineligibleCandidates:  candidates.filter(c => !c.eligible).map(c => c.name),
    bridgeRegistrationsThisVersion: 0,
    contract: 'parallel-duplicate = all non-tip members match /^module\\.exports = require(...);?$/m',
  });
}

function registerEndpoints518(app) {
  if (!app || typeof app.get !== 'function') return;

  // V518-T01: auditor summary (focused on the 3 V517 candidates)
  app.get('/api/v1/registry/canon-auditor-v518/status', (req, res) => {
    try {
      res.json({ ok: true, summary: getAuditorSummary518(), ecosVersion: 'V518' });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V518' });
    }
  });

  // V518-T02: full audit of every lib/ tower with >=3 members
  app.get('/api/v1/registry/canon-auditor-v518/full', (req, res) => {
    try {
      const minMembers = req.query && req.query.min ? parseInt(req.query.min, 10) : 3;
      const report = auditAllTowers518({ minMembers: Number.isInteger(minMembers) && minMembers > 0 ? minMembers : 3 });
      res.json({ ok: true, report, ecosVersion: 'V518' });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V518' });
    }
  });

  // V518-T03: admin summary
  app.get('/api/v1/admin/summary/v518', (req, res) => {
    try {
      const summary = getAuditorSummary518();
      res.json({
        ok: true,
        version: AUDITOR_VERSION_518,
        phase:   'P406',
        feature: 'canon-tower-auditor',
        action:  'C (audit-side) — truth-keeping for canonBridgePatch508 candidates',
        description: 'Read-only auditor: classifies every lib/ tower group (>=3 members) as parallel-duplicate or active. Prevents false registration with canonBridgePatch508. V517 listed 3 candidates (marketMaker, providerAdapters, economicIntegrityLoadBearing) — verdict: NONE eligible (active non-tip members present). Zero descriptors registered this version.',
        summary,
        endpoints: [
          'V518-T01 GET /api/v1/registry/canon-auditor-v518/status',
          'V518-T02 GET /api/v1/registry/canon-auditor-v518/full',
          'V518-T03 GET /api/v1/admin/summary/v518',
        ],
        thesis:      'Truth > optics. A wrong registration would reintroduce the very false-classification bug V516/V517 fixed.',
        ecosVersion: 'V518',
        timestamp:   Date.now(),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V518' });
    }
  });
}

module.exports = {
  AUDITOR_VERSION_518,
  CANDIDATE_NAMES_518,
  classifyTower518,
  getCandidateVerdicts518,
  auditAllTowers518,
  getAuditorSummary518,
  registerEndpoints518,
};
