#!/usr/bin/env node
'use strict';
/**
 * beat-selftest.cjs — וקטורי-בדיקה ל-cognition-beat · V-b, trace 1a10c90522120149
 * ═════════════════════════════════════════════════════════════════════════════════════════════════════
 * פונקציות-טהורות עם-fixtures מוזרקות — אפס-רשת, אפס-fs-side-effects (חוץ-מקריאה-לספריות-החוזה).
 * כיסוי-חובה: unknown-writer-טרי → guard; ישן-מהחלון → סתירה-בלבד; directives-gap → close-all;
 * שחרור-אחרי-2-מדידות-נקיות; אידמפוטנטיות; כישלון-מדידה → UNKNOWN לא-אפס; שלמות-סכימת-קבלה;
 * אימות-דגם-עצמי-מול-המאמת; חוק-ה-frontier.
 * ריצה: node agent/cognition/beat-selftest.cjs → exit 0 = הכל-ירוק.
 */
const path = require('path');
const BEAT = require('./beat.cjs');
const SELFMODEL = require('../lib/selfmodel.cjs');
const CHAIN = require('../lib/directivesChain.cjs');

let pass = 0, fail = 0;
const failures = [];
function vec(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  PASS  ${name}`);
  } catch (e) {
    fail++;
    failures.push({ name, error: String((e && e.message) || e) });
    console.log(`  FAIL  ${name} → ${String((e && e.message) || e).slice(0, 200)}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const NOW = Date.parse('2026-10-05T16:17:00Z');
const HOUR = 3600e3;
function entry(ts, op, body, trx) { return [0, { timestamp: ts, trx_id: trx || ('trx' + Math.random().toString(16).slice(2, 10)), op: [op, body] }]; }
const bucket = '2026-10-05T16';

/* fixture: orderid space helpers */
const ciOrder = (orderid, minTo) => entry('2026-10-05T15:00:00Z', 'limit_order_create', { orderid, amount_to_sell: '3.087 STEEM', min_to_receive: minTo || '0.333 SBD' }, 'aa11');
const microOrder = (orderid) => entry('2026-10-05T12:56:45Z', 'limit_order_create', { orderid, amount_to_sell: '0.500 STEEM', min_to_receive: '0.053 SBD' }, '8065683d92dcf048');

console.log('═══ beat-selftest — cognition-beat vectors (pure, no network) ═══');

/* V1: unknown-writer fresh op → guard decision emitted */
vec('V1 unknown-writer fresh op → guard decision emitted', () => {
  const { classified } = BEAT.classifyOps([microOrder(2100000379)], { ledgerTxids: new Set(), nowMs: NOW });
  assert(classified.length === 1 && classified[0].writer === 'unknown' && classified[0].confidence <= 0.2, 'micro-order must classify unknown ≤0.2');
  const { fresh } = BEAT.splitFreshUnknown(classified, NOW);
  assert(fresh.length === 1, '12:56Z op must be fresh at 16:17Z (<4h)');
  const decisions = BEAT.decideShrink({
    stagedLanes: ['grid', 'claims'], activeGuards: [], freshUnknown: fresh, gaps: [], brakeDark: [],
    laneFailures: [], hourBucket: bucket, cycle: 1,
  });
  assert(decisions.length === 1, 'exactly one close-all decision');
  const d = decisions[0];
  assert(d.decision === 'close-staged-lanes' && d.authority === 'mechanism-shrink', 'close-staged-lanes with mechanism-shrink authority');
  assert(d.note.includes('unknown-writer') && d.note.includes('ttl=12h'), 'reason unknown-writer ttl 12h');
  assert(d.evidence.some((e) => String(e.ref).includes('8065683d')), 'evidence carries the op trx id');
});

/* V2: unknown-writer older than window (4h+) → contradiction only, no guard */
vec('V2 unknown-writer older-than-fresh → contradiction only, no guard', () => {
  const oldOp = entry('2026-10-05T09:00:00Z', 'limit_order_create', { orderid: 2100000500, amount_to_sell: '1.000 STEEM', min_to_receive: '0.1 SBD' }, 'bb22');
  const { classified } = BEAT.classifyOps([oldOp], { ledgerTxids: new Set(), nowMs: NOW });
  const { fresh, older } = BEAT.splitFreshUnknown(classified, NOW);
  assert(fresh.length === 0 && older.length === 1, '7h-old op must be older-only (fresh cutoff 12:17Z)');
  const decisions = BEAT.decideShrink({
    stagedLanes: ['grid', 'claims'], activeGuards: [], freshUnknown: fresh, gaps: [], brakeDark: [],
    laneFailures: [], hourBucket: bucket, cycle: 1,
  });
  assert(decisions.length === 0, 'no guard for older-than-window unknown op');
  const m = {
    chainDark: false, rpcSplit: null, homes: [], gaps: [], custody: { problems: [] },
    modelVsChain: [], unknownFresh: fresh, unknownOlder: older, nowIso: '2026-10-05T16:17:00Z', freshCutoffIso: '2026-10-05T12:17:00Z',
  };
  const cs = BEAT.buildContradictions([], m);
  const c = cs.find((x) => x.id === 'C-unknown-writer');
  assert(c && c.status === 'open', 'C-unknown-writer open as flagged history');
  assert(c.title && c.detail && c.kind && 'a' in c && 'b' in c && typeof c.confidence === 'number' && c.firstSeen && c.epistemic, 'dashboard schema fields complete');
});

/* V3: directives-gap fixture → close-all decision */
vec('V3 directives-gap → close-all decision (TTL 6h)', () => {
  const decisions = BEAT.decideShrink({
    stagedLanes: ['grid', 'claims'], activeGuards: [], freshUnknown: [], gaps: ['Domain: allow=[grid,claims] not covered by verified chain'], brakeDark: [],
    laneFailures: [], hourBucket: bucket, cycle: 1,
  });
  assert(decisions.length === 1 && decisions[0].decision === 'close-staged-lanes', 'gap → close-all');
  assert(decisions[0].note.includes('ttl=6h'), 'gap TTL is 6h');
});

/* V4: release rule after 2 clean re-measures */
vec('V4 release rule: 2 consecutive clean re-measures → guard released', () => {
  const guard = { id: 'bg-abc123', lane: 'grid', closed: true, reason: 'unknown-writer (beat cycle 1)', evidenceRef: 'trx8065683d', openedAt: '2026-10-05T16:20:00Z', expiresAt: new Date(NOW + 12 * HOUR).toISOString(), expiryOk: true };
  const oneClean = new Map([['bg-abc123', [{ result: 'clean', at: '2026-10-05T17:17:00Z' }]]]);
  const curClean = new Map([['bg-abc123', { guardId: 'bg-abc123', result: 'clean', at: '2026-10-05T18:17:00Z' }]]);
  const curDirty = new Map([['bg-abc123', { guardId: 'bg-abc123', result: 'dirty', at: '2026-10-05T18:17:00Z' }]]);
  const r1 = BEAT.evaluateReleases([guard], oneClean, curDirty, NOW + 2 * HOUR);
  assert(r1.length === 0, 'clean,dirty → no release');
  const r2 = BEAT.evaluateReleases([guard], oneClean, curClean, NOW + 2 * HOUR);
  assert(r2.length === 1 && r2[0].guard.id === 'bg-abc123', 'clean,clean → release');
  assert(r2[0].receipt.decision === 'release-guard' && r2[0].receipt.authority === 'mechanism-shrink', 'release receipt with shrink authority');
  const expired = { ...guard, expiresAt: new Date(NOW - HOUR).toISOString(), expiryOk: false };
  const r3 = BEAT.evaluateReleases([expired], oneClean, curClean, NOW);
  assert(r3.length === 0, 'expired guard is inert — nothing to release (loopguard handles)');
});

/* V5: idempotency — same decision in same window → same idempotencyKey, no duplicate */
vec('V5 idempotency: same window → same idempotencyKey', () => {
  const mk = () => BEAT.decideShrink({
    stagedLanes: ['grid', 'claims'], activeGuards: [], freshUnknown: [{ at: '2026-10-05T12:56:45Z', op: 'limit_order_create', trx: '8065683d', class: 'order', lane: 'grid', writer: 'unknown', confidence: 0.2, orderid: '2100000379' }],
    gaps: [], brakeDark: [], laneFailures: [], hourBucket: bucket, cycle: 1,
  });
  const a = mk(), b = mk();
  assert(a.length === 1 && b.length === 1, 'both emit one decision');
  assert(a[0].idempotencyKey === b[0].idempotencyKey, 'same decision+window → same key');
  /* and a second close with an active guard for that reason → no duplicate decision */
  const withGuard = BEAT.decideShrink({
    stagedLanes: ['grid', 'claims'], activeGuards: [{ id: 'bg-x', lane: 'grid', reason: 'unknown-writer ttl=12h (beat cycle 1)', expiryOk: true }], freshUnknown: [{ at: '2026-10-05T12:56:45Z', op: 'limit_order_create', trx: '8065683d', class: 'order', lane: 'grid', writer: 'unknown', confidence: 0.2 }],
    gaps: [], brakeDark: [], laneFailures: [], hourBucket: bucket, cycle: 2,
  });
  assert(withGuard.length === 0, 'active guard for the same reason → no duplicate close');
});

/* V6: measurement failure → UNKNOWN label, never 0/false/ok */
vec('V6 measurement failure → UNKNOWN, never 0/false/ok', () => {
  const m = {
    chainDark: true, rpcSplit: null, homes: [{ home: 'Domain', stasis: { epistemic: 'UNKNOWN', reason: 'raw-timeout' }, reachability: 'dark' }, { home: 'saos-dex', stasis: { epistemic: 'UNKNOWN', reason: 'raw-404' }, reachability: 'dark' }],
    gaps: [], custody: { problems: [] }, modelVsChain: [], unknownFresh: [], unknownOlder: [],
    nowIso: '2026-10-05T16:17:00Z', freshCutoffIso: '2026-10-05T12:17:00Z',
  };
  const cs = BEAT.buildContradictions([], m);
  const cw = cs.find((x) => x.id === 'C-unknown-writer');
  assert(cw.epistemic === 'UNKNOWN' && cw.status === 'open', 'chain dark → C-unknown-writer UNKNOWN/open, not clean');
  const cd = cs.find((x) => x.id === 'C-home-dark');
  assert(cd.status === 'open' && cd.epistemic === 'UNKNOWN', 'dark homes → C-home-dark open/UNKNOWN');
  const cg = cs.find((x) => x.id === 'C-directives-gap');
  assert(cg.status === 'resolved', 'no gaps measured → gap contradiction resolved (never fabricated)');
  const stasis = BEAT.parseStasisDoc('not-json-at-all');
  assert(stasis.epistemic === 'UNKNOWN' && stasis.active === null, 'unparsable stasis → UNKNOWN with active=null, not false');
});

/* V7: receipt schema completeness */
vec('V7 receipt schema completeness (full cognitive receipt)', () => {
  const decisions = BEAT.decideShrink({
    stagedLanes: ['grid'], activeGuards: [], freshUnknown: [{ at: '2026-10-05T15:00:00Z', op: 'limit_order_create', trx: 'cc33', class: 'order', lane: 'grid', writer: 'unknown', confidence: 0.2 }],
    gaps: [], brakeDark: [], laneFailures: [], hourBucket: bucket, cycle: 1,
  });
  const REQUIRED = ['at', 'kind', 'decision', 'authority', 'evidence', 'preconditions', 'confidence', 'expectedOutcome', 'alternatives', 'idempotencyKey', 'abortConditions', 'postconditions', 'verification'];
  for (const d of [...decisions, BEAT.receipt({ kind: 'beat-guard-recheck', decision: 'recheck-clean', authority: 'free-measure', idempotencyKey: 'k' })]) {
    for (const k of REQUIRED) assert(Object.prototype.hasOwnProperty.call(d, k), `receipt missing ${k}`);
    assert(d.kind && d.decision && d.authority && d.idempotencyKey, 'core fields non-empty');
    assert(d.verification && d.verification.status === 'pending', 'verification starts pending');
    assert(Array.isArray(d.evidence) && Array.isArray(d.preconditions) && Array.isArray(d.alternatives) && Array.isArray(d.abortConditions) && Array.isArray(d.postconditions), 'arrays are arrays');
  }
  const close = decisions[0];
  assert(close.authority === 'mechanism-shrink', 'close decision authority = mechanism-shrink');
  assert(close.verification.method && close.verification.method.includes('probe'), 'verification method names the probe');
});

/* V8: organism.json (fixture model built like the beat builds it) passes the selfmodel validator */
vec('V8 self-model passes selfmodel.cjs validator', () => {
  const prev = SELFMODEL.EMPTY();
  const frontier = BEAT.computeFrontier({
    laneCycles: { grid: { observedCycles: 1, successfulCycles: 1 }, claims: { observedCycles: 1, successfulCycles: 1 } },
    openContraLanes: ['grid'], laneWriters: { grid: { writer: 'unknown', confidence: 0.2 } },
    authenticityGreen: true, stagedLanes: ['grid', 'claims'],
  });
  const model = BEAT.buildModel(prev, {
    nowIso: '2026-10-05T16:20:00Z', cycle: 1,
    steemStasis: { epistemic: 'OBSERVED', active: true, mode: 'staged', stagedLanes: ['grid', 'claims'], since: '2026-10-05T13:05:00Z', authentic: true },
    domainStasis: { epistemic: 'OBSERVED', active: true, mode: 'staged', stagedLanes: ['grid', 'claims'], since: '2026-10-05T13:05:00Z', authentic: true },
    dexStasis: { epistemic: 'UNKNOWN', reason: 'raw-timeout', reachability: 'dark' },
    chainVerify: { ok: true, entries: [{ i: 0 }, { i: 1 }, { i: 2 }], breakAt: null, reason: null },
    domainChain: { ok: true, entries: [{ i: 0 }, { i: 1 }, { i: 2 }], breakAt: null, reason: null },
    truthGate: { epistemic: 'OBSERVED', verdict: 'ALIVE-REAL-FILLS', realFills24h: 7 },
    ledger: { epistemic: 'OBSERVED', orders: 97, txids: 97 },
    activeGuardCount: 0, closedAdded: 2, releasedCount: 0,
    contradictions: BEAT.buildContradictions([], {
      chainDark: false, rpcSplit: null,
      homes: [{ home: 'steem', stasis: { epistemic: 'OBSERVED' }, reachability: 'ok' }, { home: 'Domain', stasis: { epistemic: 'OBSERVED' }, reachability: 'ok' }, { home: 'saos-dex', stasis: { epistemic: 'UNKNOWN', reason: 'dark' }, reachability: 'dark' }],
      gaps: ['saos-dex: allow=[grid,claims] with NO owner-directives chain in that home (coverage unverifiable = not covered)'],
      custody: { problems: [] }, modelVsChain: [], unknownFresh: [{ at: '2026-10-05T12:56:45Z', op: 'limit_order_create', trx: '8065683d', class: 'order', lane: 'grid', writer: 'unknown', confidence: 0.2, orderid: '2100000379' }], unknownOlder: [],
      nowIso: '2026-10-05T16:20:00Z', freshCutoffIso: '2026-10-05T12:20:00Z',
    }),
    frontier, writers: [
      { id: 'unknown-writers', kind: 'unknown', patterns: ['micro-orders'], confidence: 0.2, epistemic: 'OBSERVED', evidence: [{ source: 'chain-history window', ref: '2100000379 trx=8065683d', at: '2026-10-05T12:56:45Z' }] },
    ],
    custody: { nvZipAtHead: false, recoveryMetaPresent: true, vaultEncCount: 5, problems: [], epistemic: 'OBSERVED' },
    runErrors: ['beat-selftest injected run-error note'],
    beat: { protocol: 'SAOS-COGNITION-BEAT/1', cycle: 1, at: '2026-10-05T16:20:00Z' },
  });
  const v = SELFMODEL.validate(model);
  assert(v.ok, 'validator must accept the beat-built model; errors: ' + v.errors.join(' | '));
  /* והכלל המכני: OBSERVED בלי ראיה נדחה */
  const bad = { ...model, capabilities: [{ id: 'x', home: 'steem', lane: 'grid', status: 'STAGED', epistemic: 'OBSERVED', evidence: [] }] };
  assert(SELFMODEL.validate(bad).ok === false, 'OBSERVED without evidence must be REJECTED');
  /* והמצב-הזרוע-האמיתי: organism.json הקיים בריפו עובר את-המאמת */
  const live = SELFMODEL.load(path.join(__dirname, 'organism.json'));
  assert(live.ok, 'seed organism.json in repo must validate: ' + (live.errors || []).join(' | '));
});

/* V9: frontier recompute rule */
vec('V9 frontier rule: 3 cycles + 0 contradictions + attributed + authenticity → REAL; missing one → STAGED/HALTED', () => {
  const full = BEAT.computeFrontier({
    laneCycles: { grid: { observedCycles: 3, successfulCycles: 3 } },
    openContraLanes: [], laneWriters: { grid: { writer: 'dex-grid-ci', confidence: 0.85 } },
    authenticityGreen: true, stagedLanes: ['grid'],
  });
  assert(full.grid.level === 'REAL', 'all conditions met → REAL');
  assert(full.general.level === 'HALTED', 'general stays HALTED (never staged-allowed)');
  const miss1 = BEAT.computeFrontier({ laneCycles: { grid: { observedCycles: 3, successfulCycles: 2 } }, openContraLanes: [], laneWriters: { grid: { writer: 'dex-grid-ci', confidence: 0.85 } }, authenticityGreen: true, stagedLanes: ['grid'] });
  assert(miss1.grid.level === 'STAGED', '2/3 successful cycles → STAGED');
  const miss2 = BEAT.computeFrontier({ laneCycles: { grid: { observedCycles: 3, successfulCycles: 3 } }, openContraLanes: ['grid'], laneWriters: { grid: { writer: 'dex-grid-ci', confidence: 0.85 } }, authenticityGreen: true, stagedLanes: ['grid'] });
  assert(miss2.grid.level === 'STAGED', 'open contradiction on lane → STAGED');
  const miss3 = BEAT.computeFrontier({ laneCycles: { grid: { observedCycles: 3, successfulCycles: 3 } }, openContraLanes: [], laneWriters: { grid: { writer: 'unknown', confidence: 0.2 } }, authenticityGreen: true, stagedLanes: ['grid'] });
  assert(miss3.grid.level === 'STAGED', 'writer unknown → not attributed → STAGED');
  const miss4 = BEAT.computeFrontier({ laneCycles: { grid: { observedCycles: 3, successfulCycles: 3 } }, openContraLanes: [], laneWriters: { grid: { writer: 'dex-grid-ci', confidence: 0.85 } }, authenticityGreen: false, stagedLanes: ['grid'] });
  assert(miss4.grid.level === 'STAGED', 'authenticity not green → STAGED');
  const miss5 = BEAT.computeFrontier({ laneCycles: { grid: { observedCycles: 3, successfulCycles: 3 } }, openContraLanes: [], laneWriters: { grid: { writer: 'dex-grid-ci', confidence: 0.85 } }, authenticityGreen: true, stagedLanes: ['claims'] });
  assert(miss5.grid.level === 'HALTED', 'not staged-allowed → HALTED (fail-closed default)');
});

/* V10 (bonus): orderid-space boundaries + ledger attribution */
vec('V10 classifier boundaries: CI space / micro space / ledger txid', () => {
  assert(BEAT.isCiLadderOrderid(2026100504) === true, '2026100504 in CI space');
  assert(BEAT.isCiLadderOrderid(2026123199) === true, 'Dec 31 valid');
  assert(BEAT.isCiLadderOrderid(2100000379) === false, 'micro space NOT CI space');
  assert(BEAT.isCiLadderOrderid(12671328) === false, 'exchange-assigned id not in user space');
  assert(BEAT.isMicroOrderSpace(2100000380) === true && BEAT.isMicroOrderSpace(2100000999) === true && BEAT.isMicroOrderSpace(2100001000) === false, 'micro space bounds');
  const ledger = new Set(['ee8ae2839c05903c4440266d72d9452213871eea']);
  const { classified } = BEAT.classifyOps([entry('2026-10-05T15:00:00Z', 'limit_order_create', { orderid: 999999, amount_to_sell: '1 STEEM', min_to_receive: '0.1 SBD' }, 'ee8ae2839c05903c4440266d72d9452213871eea')], { ledgerTxids: ledger, nowMs: NOW });
  assert(classified[0].writer === 'dex-grid-ci' && classified[0].confidence === 0.9 && classified[0].attribution === 'txid-in-grid-ledger', 'ledger txid → dex-grid-ci 0.9');
  const deleg = BEAT.classifyOps([
    entry('2026-10-05T10:44:18Z', 'delegate_vesting_shares', { delegatee: 'woq', delegator: 'headcorner', vesting_shares: '48393.301791 VESTS' }, 'fcf347d5'),
    entry('2026-10-05T09:46:51Z', 'delegate_vesting_shares', { delegatee: 'hcsoldier1', delegator: 'headcorner', vesting_shares: '0.000000 VESTS' }, '38770d15'),
    entry('2026-10-05T11:00:00Z', 'delegate_vesting_shares', { delegatee: 'someoneelse', delegator: 'headcorner', vesting_shares: '123.000000 VESTS' }, 'dd44'),
  ], { ledgerTxids: new Set(), nowMs: NOW }).classified;
  assert(deleg[0].writer === 'owner-matrix' && deleg[0].confidence === 0.7, 'matrix amount → owner-matrix 0.7');
  assert(deleg[1].writer === 'owner-parallel' && deleg[1].confidence === 0.6, 'delegate-0 hcsoldier → owner-parallel 0.6');
  assert(deleg[2].writer === 'unknown' && deleg[2].confidence <= 0.2, 'delegation outside signatures → unknown ≤0.2');
});

/* V11 (bonus): lane-failure streak → close-lane after 3 */
vec('V11 lane-failure streak ≥3 → close that lane only (TTL 12h)', () => {
  const ev = [{ source: 'receipts', ref: 'status=abort-anomaly', at: '2026-10-05T06:56:26Z' }];
  const decisions = BEAT.decideShrink({
    stagedLanes: ['grid', 'claims'], activeGuards: [], freshUnknown: [], gaps: [], brakeDark: [],
    laneFailures: [{ lane: 'grid', tool: 'ladder-refresh', consecutive: 3, evidence: ev, measured: true }], hourBucket: bucket, cycle: 1,
  });
  assert(decisions.length === 1 && decisions[0].decision === 'close-lane', 'streak 3 → close-lane');
  assert(decisions[0].note.includes('lane-failure streak=3'), 'note carries streak');
  const two = BEAT.decideShrink({ stagedLanes: ['grid'], activeGuards: [], freshUnknown: [], gaps: [], brakeDark: [], laneFailures: [{ lane: 'grid', tool: 'x', consecutive: 2, evidence: ev, measured: true }], hourBucket: bucket, cycle: 1 });
  assert(two.length === 0, 'streak 2 < 3 → no guard');
});

/* V12 (bonus): live directives chain verifies + covers grid+claims (real file, no network) */
vec('V12 live owner-directives chain verifies and covers staged lanes', () => {
  const v = CHAIN.verifyChain();
  assert(v.ok && v.entries.length === 3, 'seed chain verifies (genesis + halt-all + staged-open)');
  assert(CHAIN.hasEntryForLanes(['grid', 'claims']) === true, 'grid+claims covered by i=2 staged-open');
  assert(CHAIN.hasEntryForLanes(['general']) === false, 'general NOT covered');
});

/* V13 (V-b retry): guard renewal — an expired same-id guard is replaced fresh, never blocks renewal */
vec('V13 guard renewal: expired same-id guard replaced fresh on re-close', () => {
  const reasons = 'unknown-writer';
  const id = 'bg-' + require('crypto').createHash('sha256').update(['grid', reasons].join('|')).digest('hex').slice(0, 10);
  const expiredGuard = { id, lane: 'grid', closed: true, reason: 'reasons=unknown-writer ttl=12h (beat cycle 1)', evidenceRef: 'old', openedAt: '2026-10-05T04:00:00Z', expiresAt: new Date(NOW - HOUR).toISOString() };
  const prevDoc = { protocol: 'SAOS-LANE-GUARDS/1', guards: [expiredGuard], note: 'x' };
  const close = BEAT.receipt({ kind: 'beat-guard-close', decision: 'close-staged-lanes', authority: 'mechanism-shrink', idempotencyKey: 'k13', note: 'reasons=unknown-writer ttl=12h (beat cycle 13)', evidence: [{ source: 'chain-history', ref: 'trx=deadbeef', at: '2026-10-05T15:00:00Z' }] });
  const next = BEAT.buildGuardsDoc(prevDoc, [close], [], NOW, ['grid', 'claims']);
  const g = next.guards.find((x) => x.id === id);
  assert(!!g, 'guard with stable id still present');
  assert(Date.parse(g.expiresAt) > NOW, 'expired guard was RENEWED (new expiry in the future), not kept inert');
  assert(next.guards.length === 2, 'renewed grid guard + new claims guard (close-staged-lanes covers both), no duplicates');
  /* וההפך: שומר-חי עם-אותו-מזהה לא משוכפל ולא מוזז: */
  const aliveGuard = { ...expiredGuard, expiresAt: new Date(NOW + 5 * HOUR).toISOString() };
  const next2 = BEAT.buildGuardsDoc({ protocol: 'SAOS-LANE-GUARDS/1', guards: [aliveGuard], note: 'x' }, [close], [], NOW, ['grid']);
  assert(next2.guards.length === 1 && next2.guards[0].expiresAt === aliveGuard.expiresAt, 'live guard untouched (no duplicate, no drift)');
});

/* V14 (V-b retry): self-loop closure receipts carry a FINAL verification verdict, not pending */
vec('V14 closure receipt verification is final (confirmed/failed + at/actual/deviation)', () => {
  const closure = BEAT.receipt({
    kind: 'beat-verification', decision: 'previous-receipt-confirmed', authority: 'free-measure', idempotencyKey: 'k14',
    verification: { method: 'probe', status: 'confirmed', at: '2026-10-05T17:17:00Z', actual: 'guardWorks=true', deviation: 'none' },
  });
  assert(closure.verification.status === 'confirmed' && closure.verification.at && closure.verification.actual && 'deviation' in closure.verification, 'closure verification fields final and complete');
  /* ברירת-המחדל להכרעות-רגילות נשארת pending (נסגרת-במחזור-הבא): */
  const plain = BEAT.receipt({ kind: 'x', decision: 'y', authority: 'mechanism-shrink', idempotencyKey: 'k14b' });
  assert(plain.verification.status === 'pending', 'default receipts still start pending');
});

/* V15 (V-b retry): live lane-failure streak measured from THIS repo's receipts (≥3 aborts at tail) */
vec('V15 live lane-failure streak measured (never silently zero)', () => {
  const streaks = BEAT.laneFailureStreak();
  const grid = streaks.find((s) => s.lane === 'grid');
  assert(grid && grid.measured === true, 'grid streak measured from real receipts');
  assert(grid.consecutive >= 3, 'repo fixtures end with ≥3 consecutive abort-anomaly receipts, got ' + grid.consecutive);
  assert(grid.evidence.length >= 1 && grid.evidence.some((e) => String(e.ref).includes('abort-anomaly')), 'evidence cites the failing receipt statuses');
  const claims = streaks.find((s) => s.lane === 'claims');
  assert(claims && claims.measured === false, 'claims streak honestly UNMEASURED (no receipts), not claimed 0');
});

/* V16 (V-b retry): structural no-chain gap is recorded but does NOT fire guard-closes */
vec('V16 structural saos-dex gap: contradiction open, decideShrink not fired by it', () => {
  const m = {
    chainDark: false, rpcSplit: null, homes: [], gaps: [],
    structuralGaps: ['saos-dex: allow=[grid,claims] with NO owner-directives chain in that home (structural, non-firing — recorded for owner)'],
    custody: { problems: [] }, modelVsChain: [], unknownFresh: [], unknownOlder: [],
    nowIso: '2026-10-05T16:17:00Z', freshCutoffIso: '2026-10-05T12:17:00Z',
  };
  const cs = BEAT.buildContradictions([], m);
  const cg = cs.find((x) => x.id === 'C-directives-gap');
  assert(cg && cg.status === 'open' && cg.detail.includes('structural (non-firing)'), 'structural gap stays visible to the owner with explicit non-firing label');
  const decisions = BEAT.decideShrink({ stagedLanes: ['grid', 'claims'], activeGuards: [], freshUnknown: [], gaps: [], brakeDark: [], laneFailures: [], hourBucket: bucket, cycle: 1 });
  assert(decisions.length === 0, 'structural-only gap fires NO guard-close');
  /* אבל פער-ירי (שרשרת-קיימת-שלא-מכסה) עדיין יורה TTL 6h: */
  const firing = BEAT.decideShrink({ stagedLanes: ['grid', 'claims'], activeGuards: [], freshUnknown: [], gaps: ['steem: chain broken: hash-mismatch'], brakeDark: [], laneFailures: [], hourBucket: bucket, cycle: 1 });
  assert(firing.length === 1 && firing[0].note.includes('ttl=6h'), 'real coverage/broken-chain gap still fires close-all TTL 6h');
});

/* V17 (V-b retry): lane-failure guard recheck measured against the streak itself, not a proxy */
vec('V17 lane-failure guard recheck: dirty while streak≥3, clean only after reset, dirty when unmeasured', () => {
  const guard = { id: 'bg-lf', lane: 'grid', closed: true, reason: 'lane-failure streak=4 (beat cycle 1)', expiryOk: true };
  const dirtyStreak = BEAT.recheckGuard(guard, { freshUnknown: [], gapsOpen: false, brakeDarkOpen: false, laneFailures: [{ lane: 'grid', tool: 'ladder-refresh', consecutive: 4, evidence: [], measured: true }] });
  assert(dirtyStreak.result === 'dirty' && dirtyStreak.detail.includes('still 4'), 'streak still ≥3 → dirty (guard stays)');
  const cleanReset = BEAT.recheckGuard(guard, { freshUnknown: [], gapsOpen: false, brakeDarkOpen: false, laneFailures: [{ lane: 'grid', tool: 'ladder-refresh', consecutive: 0, evidence: [], measured: true }] });
  assert(cleanReset.result === 'clean' && cleanReset.detail.includes('reset'), 'healthy receipts reset streak → clean (release path)');
  const unmeasured = BEAT.recheckGuard(guard, { freshUnknown: [], gapsOpen: false, brakeDarkOpen: false, laneFailures: [{ lane: 'grid', tool: 'ladder-refresh', consecutive: 0, evidence: [], measured: false }] });
  assert(unmeasured.result === 'dirty' && unmeasured.detail.includes('UNMEASURED'), 'unmeasured streak → dirty (no release on unmeasured), never fake-clean');
});

console.log('════════════════════════════════════════');
console.log(`beat-selftest: ${pass} PASS / ${fail} FAIL (exit ${fail ? 1 : 0})`);
if (fail) { for (const f of failures) console.log(`  ✗ ${f.name}: ${f.error}`); }
process.exit(fail ? 1 : 0);
