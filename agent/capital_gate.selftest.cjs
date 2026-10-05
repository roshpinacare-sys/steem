'use strict';
/**
 * capital_gate.selftest.cjs — וקטורים דטרמיניסטיים אופליין לשער-ההון (V-a — החוזה-האפיסטמי)
 *   node agent/capital_gate.selftest.cjs  → אפס-רשת, אפס-מפתחות, אפס-כתיבה-למדינה-החיה
 *   (השער נבדק תמיד על עותק-חול מלא: capital_gate + directivesChain + loopguard +
 *    STASIS.json/owner-directives.jsonl/lane-guards.json פיקטיביים — המדינה-החיה לא נוגעת,
 *    למעט-וקטורי-התאימות-בסוף שקוראים-את-הבית-החי ומנקים-אחריהם).
 *
 * נולד ב-T-B (trace 1a10bfe1342b2391). הורחב ב-V-a (SOVEREIGN COGNITIVE ACTIVATION, trace 1a10c90522120149):
 * אותנטיקת-פרוטוקול · סמכות-כיוונית (SHRINK מכני / EXPAND מחייב-שרשרת-הנחיות-בעלים —
 * tamper-EVIDENT) · צרכן-מכני לשומרי-הלופ (סוגרים-בלבד) · יומן-קבלות-קוגניטיביות אמיתי
 * (idempotent, append-only, journal-unwritable לא וטו) · כנות-מדידה (fail-closed במקום 'ok').
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'lib', 'capital_gate.cjs');
const LIVE_JOURNAL = path.join(ROOT, 'receipts', 'capital-decisions.jsonl');

/* לכידה-גלובלית שקטה: כל-שורות-הקבלה של-השער נכנסות-ל-LOG (הפלט מציג ✓/✗ בלבד) */
const LOG = [];
const ORIG_LOG = console.log;
console.log = (...a) => { LOG.push(a.join(' ')); };

let failures = 0;
function t(name, ok) {
  ORIG_LOG(`${ok ? ' ✓' : ' ✗'} ${name}`);
  if (!ok) failures++;
}

/* ── חול: עותק-בית מלא (השער קורא __dirname/../STASIS.json, ../receipts/, ../cognition/) ── */
const SANDBOXES = [];
function sandbox(opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capgate-selftest-'));
  SANDBOXES.push(root);
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  for (const f of ['capital_gate.cjs', 'directivesChain.cjs', 'loopguard.cjs']) {
    fs.writeFileSync(path.join(root, 'lib', f), fs.readFileSync(path.join(ROOT, 'lib', f), 'utf8'));
  }
  if (opts.stasis !== undefined) {
    if (opts.stasis === null) { /* קובץ-חסר */ }
    else fs.writeFileSync(path.join(root, 'STASIS.json'), typeof opts.stasis === 'string' ? opts.stasis : JSON.stringify(opts.stasis, null, 2));
  }
  if (opts.chain === 'seed') {
    fs.mkdirSync(path.join(root, 'receipts'), { recursive: true });
    fs.writeFileSync(path.join(root, 'receipts', 'owner-directives.jsonl'), fs.readFileSync(path.join(ROOT, 'receipts', 'owner-directives.jsonl'), 'utf8'));
  } else if (Array.isArray(opts.chain)) {
    fs.mkdirSync(path.join(root, 'receipts'), { recursive: true });
    fs.writeFileSync(path.join(root, 'receipts', 'owner-directives.jsonl'), opts.chain.join('\n') + '\n');
  }
  if (opts.guards === 'seed') {
    fs.mkdirSync(path.join(root, 'cognition'), { recursive: true });
    fs.writeFileSync(path.join(root, 'cognition', 'lane-guards.json'), fs.readFileSync(path.join(ROOT, 'cognition', 'lane-guards.json'), 'utf8'));
  } else if (opts.guards === 'corrupt') {
    fs.mkdirSync(path.join(root, 'cognition'), { recursive: true });
    fs.writeFileSync(path.join(root, 'cognition', 'lane-guards.json'), '{ this is not json');
  } else if (opts.guards && typeof opts.guards === 'object') {
    fs.mkdirSync(path.join(root, 'cognition'), { recursive: true });
    fs.writeFileSync(path.join(root, 'cognition', 'lane-guards.json'), JSON.stringify(opts.guards, null, 2));
  }
  const captured = { root, logFrom: LOG.length };
  delete require.cache[require.resolve(path.join(root, 'lib', 'capital_gate.cjs'))];
  captured.g = require(path.join(root, 'lib', 'capital_gate.cjs'));
  captured.chain = require(path.join(root, 'lib', 'directivesChain.cjs'));
  captured.loopguard = require(path.join(root, 'lib', 'loopguard.cjs'));
  return captured;
}
/* שורות-הקבלה שנוצרו-מאז-בניית-החול */
function linesOf(c) { return LOG.slice(c.logFrom); }

const STAGED = (allow, extra = {}) => ({
  protocol: 'SAOS-FATE-DEFENSE-STASIS/1', active: true, mode: 'staged',
  reason: 'selftest staged brake', since: '2026-10-05T00:00:00Z',
  stagedLanes: { allow, reason: 'selftest', since: '2026-10-05T00:00:00Z' },
  ...extra,
});
const FULL = (extra = {}) => ({ protocol: 'SAOS-FATE-DEFENSE-STASIS/1', active: true, mode: 'full', reason: 'selftest full brake', since: '2026-10-04T22:18:00Z', ...extra });

function receiptsOf(root) {
  try {
    return fs.readFileSync(path.join(root, 'receipts', 'capital-decisions.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch (_) { return []; }
}

/* ═════════ 1) מורשת: בלם-מלא אותנטי עוצר הכל ═════════ */
let c = sandbox({ stasis: FULL(), chain: 'seed', guards: 'seed' });
t('legacy full brake (valid protocol) halts even a claims tool', c.g.stasisHalt('agent:claim') === true);
t('mode=full halts even a listed lane', sandbox({ stasis: FULL({ stagedLanes: { allow: ['claims'] } }), chain: 'seed' }).g.stasisHalt('agent:claim') === true);

/* ═════════ 2) staged + שרשרת-תקפה → grid+claims מותרות, general עצור ═════════ */
c = sandbox({ stasis: STAGED(['grid', 'claims']), chain: 'seed', guards: 'seed' });
let ok;
ok = c.g.stasisHalt('ladder-refresh') === false && c.g.stasisHalt('agent:claim') === false && c.g.stasisHalt('fleet-claim') === false;
t('valid staged file + directives chain → grid+claims ALLOW', ok);
t('allow path prints STASIS-STAGED-ALLOW with the lane + directives-covered', linesOf(c).some((l) => /STASIS-STAGED-ALLOW ladder-refresh \(lane=grid\).*directives-covered/.test(l)));
ok = c.g.stasisHalt('totally-unknown-tool') === true && c.g.stasisHalt('head-delegate') === true;
t('general lane still HALTs (unknown tool, head-delegate)', ok && linesOf(c).some((l) => /STASIS-HALT totally-unknown-tool \(lane=general\)/.test(l)));

/* ═════════ 3) V-a אותנטיקה: פרוטוקול-זר/חסר/לא-תקף → HALT ═════════ */
c = sandbox({ stasis: { active: false, reason: 'forged lift, no protocol' }, chain: 'seed', guards: 'seed' });
const st = c.g.stasisState();
t('forged STASIS without protocol → HALT (was ALLOW before V-a)', c.g.stasisHalt('agent:claim') === true && c.g.stasisHalt('head-delegate') === true);
t('unauthenticated flag + honest reason (fail-closed, never "ok")', st.unauthenticated === true && /fail-closed/.test(st.reason) && st.reason !== 'ok');
t('loud STASIS-UNAUTHENTICATED receipt line', linesOf(c).some((l) => /STASIS-UNAUTHENTICATED agent:claim/.test(l)));
t('auth-halt receipt written with authority=mechanism-shrink', receiptsOf(c.root).some((r) => r.decision === 'halt' && r.tool === 'agent:claim' && r.authority === 'mechanism-shrink'));
c = sandbox({ stasis: { protocol: 'FOREIGN/9', active: false }, chain: 'seed' });
t('foreign protocol SAOS-…/9 → HALT', c.g.stasisHalt('ladder-refresh') === true);
c = sandbox({ stasis: { protocol: 'SAOS-FATE-DEFENSE-STASIS/1', active: true, mode: 'banana', since: '2026-10-05T00:00:00Z' } });
t('invalid mode fails protocol validation → HALT', c.g.stasisHalt('agent:claim') === true && c.g.stasisState().unauthenticated === true);
c = sandbox({ stasis: { protocol: 'SAOS-FATE-DEFENSE-STASIS/1', active: true, mode: 'staged', since: 'not-a-date' } });
t('non-ISO since fails protocol validation → HALT', c.g.stasisHalt('agent:claim') === true);

/* ═════════ 4) V-a סמכות-כיוונית: active:false מזויף בלי-הנחיות-בעלים → HALT ═════════ */
c = sandbox({ stasis: { protocol: 'SAOS-FATE-DEFENSE-STASIS/1', active: false, mode: 'staged', since: '2026-10-04T22:18:00Z', reason: 'forged full lift' }, chain: 'seed', guards: 'seed' });
ok = c.g.stasisHalt('agent:claim') === true && c.g.stasisHalt('ladder-refresh') === true && c.g.stasisHalt('head-delegate') === true;
t('forged active:false with NO full-resume directive → HALT everywhere (closes the R27 hole)', ok && linesOf(c).filter((l) => /RESUME-DENIED .*resume-lacks-owner-directive-entry/.test(l)).length === 3);
t('resume-denial receipt: authority=mechanism-shrink + reason recorded', receiptsOf(c.root).filter((r) => r.decision === 'halt' && r.note === 'resume-lacks-owner-directive-entry' && r.authority === 'mechanism-shrink').length === 3);

/* active:false + staged allow כשהשרשרת מכסה → רק-המסילות-המכוסות נפתחות */
c = sandbox({ stasis: { protocol: 'SAOS-FATE-DEFENSE-STASIS/1', active: false, mode: 'staged', since: '2026-10-05T00:00:00Z', stagedLanes: { allow: ['grid', 'claims'] } }, chain: 'seed' });
t('active:false + allow covered by chain → covered lanes resume (policy-gated)', c.g.stasisHalt('ladder-refresh') === false);
t('…but lanes outside the covered resume still HALT', c.g.stasisHalt('head-delegate') === true);

/* "active":"true" כמחרוזת (חור-R27) — הרחבה-מעבר-לשרשרת נסגרת */
c = sandbox({ stasis: { protocol: 'SAOS-FATE-DEFENSE-STASIS/1', active: 'true', mode: 'staged', since: '2026-10-05T00:00:00Z', stagedLanes: { allow: ['grid', 'claims'] } }, chain: 'seed' });
t('forged "active":"true" string does NOT reopen the general lane (R27 vector, now closed)', c.g.stasisHalt('totally-unknown-tool') === true);

/* ═════════ 5) staged allow עם-מסילה-שאינה-מכוסה-בשרשרת → HALT ═════════ */
c = sandbox({ stasis: STAGED(['grid', 'claims', 'general']), chain: 'seed' });
ok = c.g.stasisHalt('ladder-refresh') === true && c.g.stasisHalt('agent:claim') === true;
t('staged allow listing a lane NOT in directives → HALT for every staged tool', ok && linesOf(c).filter((l) => /STAGED-DENIED .*staged-lane-lacks-directive-entry/.test(l)).length === 2);

/* tampered chain: hash שבור → verifyChain נופל → HALT על-מסילה-פתוחה-לכאורה */
const seedLines = fs.readFileSync(path.join(ROOT, 'receipts', 'owner-directives.jsonl'), 'utf8').split('\n').filter(Boolean);
const tampered = seedLines.map((l, idx) => {
  if (idx !== 2) return l;
  const e = JSON.parse(l); e.hash = '0'.repeat(64); return JSON.stringify(e);
});
c = sandbox({ stasis: STAGED(['grid', 'claims']), chain: tampered });
const v = c.chain.verifyChain();
t('tampered chain → verifyChain fails with breakAt on the edited entry', v.ok === false && v.breakAt === 2 && v.reason === 'hash-mismatch');
t('tampered chain → staged lane HALTs (no expansion without intact evidence)', c.g.stasisHalt('ladder-refresh') === true && linesOf(c).some((l) => /staged-lane-lacks-directive-entry/.test(l)));

/* halt-all מאוחר בשרשרת סוגר-מכנית את-הכיסוי (סמכות-הכיווץ של-השרשרת-עצמה) */
const afterHalt = (() => {
  const lib = require(path.join(ROOT, 'lib', 'directivesChain.cjs'));
  let prev = JSON.parse(seedLines[seedLines.length - 1]).hash;
  const e3 = { i: 3, at: '2026-10-05T15:00:00Z', type: 'halt-all', trace: 'selftest-halt-all', source: 'selftest', lanes: [], note: 'owner halt-all (selftest vector)' };
  const h3 = lib.entryHash(prev, e3);
  return [...seedLines, JSON.stringify({ ...e3, hash: h3 })];
})();
c = sandbox({ stasis: STAGED(['grid', 'claims']), chain: afterHalt });
t('owner halt-all entry appended → staged lanes mechanically re-close (hasEntryForLanes=false)', c.chain.hasEntryForLanes(['grid', 'claims']) === false && c.g.stasisHalt('ladder-refresh') === true);

/* ═════════ 6) שומרי-מסילה (loopguard) — סוגרים-בלבד ═════════ */
const G = (over = {}) => ({ id: 'G-TEST', lane: 'grid', closed: true, reason: 'beat closed after red cycle', evidenceRef: 'selftest/G-TEST', openedAt: '2026-10-05T15:00:00Z', expiresAt: null, ...over });
c = sandbox({ stasis: STAGED(['grid', 'claims']), chain: 'seed', guards: { protocol: 'SAOS-LANE-GUARDS/1', guards: [G()] } });
ok = c.g.stasisHalt('ladder-refresh') === true;
t('guard closes an allowed lane → HALT with LANE-GUARD-HALT', ok && linesOf(c).some((l) => /LANE-GUARD-HALT ladder-refresh \(lane=grid\) · guard=G-TEST/.test(l)));
t('guard-halt receipt: authority=mechanism-guard + evidenceRef', receiptsOf(c.root).some((r) => r.decision === 'halt' && r.authority === 'mechanism-guard' && /G-TEST/.test(r.evidence.map((e) => e.ref).join(' '))));
t('other lanes unaffected by the grid guard', c.g.stasisHalt('agent:claim') === false);

c = sandbox({ stasis: STAGED(['grid']), guards: { protocol: 'SAOS-LANE-GUARDS/1', guards: [{ id: 'G-OPEN', lane: 'grid', closed: false, open: true, allow: true, reason: 'attempt to open' }] } });
const ghOpen = c.loopguard.guardHalt('grid');
t('guard entry with open/allow attempt: NOT honored, foreignFields flagged (open+allow)', ghOpen.halt === false && ghOpen.foreignFields.some((f) => f.field === 'open') && ghOpen.foreignFields.some((f) => f.field === 'allow'));
{
  const x = sandbox({ stasis: STAGED(['grid']), guards: { protocol: 'SAOS-LANE-GUARDS/1', guards: [{ id: 'G-MIX', lane: 'grid', closed: true, open: true, reason: 'x' }] } });
  const r = x.loopguard.guardHalt('grid');
  t('closed:true + smuggled open:true → still halts (closed honored, open flagged)', r.halt === true && r.foreignFields.some((f) => f.field === 'open'));
}

c = sandbox({ stasis: STAGED(['grid', 'claims']), chain: 'seed', guards: 'corrupt' });
t('corrupt guards file → HALT on EVERY lane (fail-closed loud)', c.loopguard.guardHalt('grid').halt === true && c.loopguard.guardHalt('general').halt === true && c.loopguard.guardHalt('claims').halt === true);
t('corrupt guards file halts even a directives-covered staged tool', c.g.stasisHalt('ladder-refresh') === true && linesOf(c).some((l) => /guards-unreadable/.test(l)));

c = sandbox({ stasis: STAGED(['grid', 'claims']), chain: 'seed', guards: { protocol: 'WRONG/2', guards: [] } });
t('guards file with wrong protocol → fail-closed halt (authenticity applies here too)', c.loopguard.guardHalt('grid').halt === true && c.loopguard.guardHalt('grid').reason === 'guards-unreadable');

c = sandbox({ stasis: STAGED(['grid', 'claims']), chain: 'seed', guards: { protocol: 'SAOS-LANE-GUARDS/1', guards: [G({ expiresAt: '2020-01-01T00:00:00Z' })] } });
t('expired guard (expiresAt < now) is inert', c.loopguard.guardHalt('grid').halt === false && c.g.stasisHalt('ladder-refresh') === false);
c = sandbox({ stasis: STAGED(['grid']), guards: { protocol: 'SAOS-LANE-GUARDS/1', guards: [G({ expiresAt: 'not-a-date' })] } });
t('unparseable expiresAt keeps the guard alive (shrink never falls to a date bug)', c.loopguard.guardHalt('grid').halt === true);

c = sandbox({ stasis: STAGED(['grid', 'claims']), chain: 'seed', guards: undefined });
t('missing guards file → no guard effect (logged once, not an error)', c.loopguard.guardHalt('grid').halt === false && c.g.stasisHalt('ladder-refresh') === false);

/* ═════════ 7) היומן-האמיתי: קבלות-קוגניטיביות + אידמפוטנציה ═════════ */
c = sandbox({ stasis: STAGED(['grid', 'claims']), chain: 'seed', guards: 'seed' });
c.g.stasisHalt('ladder-refresh');   /* allow */
c.g.stasisHalt('head-delegate');    /* halt  */
c.g.stasisHalt('ladder-refresh');   /* אותה-הכרעה, אותו-דקה → אין-כפילות */
let rs = receiptsOf(c.root);
t('every decision writes exactly one cognitive receipt (same tool|lane|decision within the minute never duplicates)', rs.length === 2);
t('receipt schema: at/kind/decision/tool/lane/authority/evidence/idempotencyKey/verification', rs.every((r) => r.at && r.kind === 'capital-gate-stasis-decision' && r.decision && r.tool && r.lane && r.authority && Array.isArray(r.evidence) && /^[0-9a-f]{64}$/.test(r.idempotencyKey) && r.verification && r.verification.status === 'pending'));
t('allow receipt authority=policy-gated with directives evidence; halt=mechanism-shrink', rs.some((r) => r.decision === 'allow' && r.authority === 'policy-gated' && r.evidence.some((e) => /owner-directives/.test(e.source))) && rs.some((r) => r.decision === 'halt' && r.authority === 'mechanism-shrink'));
t('authorityOf mapping: shrink→mechanism-shrink, expand→policy-gated, measure→free, unknown→policy-gated (fail-closed)', c.g.authorityOf('shrink') === 'mechanism-shrink' && c.g.authorityOf('expand') === 'policy-gated' && c.g.authorityOf('measure') === 'free' && c.g.authorityOf('weird') === 'policy-gated');
t('journalHealth() contract fields: ok=true, lastAt ISO, lines counted from the journal itself (2 decisions = 2 lines)', (() => { const h = c.g.journalHealth(); return h.ok === true && /^\d{4}-\d{2}-\d{2}T/.test(h.lastAt || '') && h.lines === 2; })());

/* journal-unwritable: היומן-הוא-זיכרון, לא-וטו */
c = sandbox({ stasis: STAGED(['grid', 'claims']), chain: 'seed' });
const origAppend = fs.appendFileSync;
try {
  fs.appendFileSync = () => { throw new Error('EACCES: mocked unwritable journal'); };
  const decision = c.g.stasisHalt('ladder-refresh');
  t('journal-unwritable → decision STILL enforced (allow stands) + degraded flagged + loud line', decision === false && c.g.journalHealth().degraded === true && linesOf(c).some((l) => /journal-unwritable \(decision still enforced\)/.test(l)));
  const halt = c.g.stasisHalt('head-delegate');
  t('…same for halt decisions (halt stands under broken journal)', halt === true && c.g.journalHealth().degraded === true && linesOf(c).filter((l) => /journal-unwritable/.test(l)).length === 2);
} finally { fs.appendFileSync = origAppend; }

/* ═════════ 8) כנות-מדידה: קובץ-חסר/שבור = fail-closed עם-נימוק-כן ═════════ */
c = sandbox({ stasis: null, chain: 'seed' });
const stMissing = c.g.stasisState();
t('missing stasis file halts — fail-closed', c.g.stasisHalt('agent:claim') === true);
t('unreadable STASIS reason is fail-closed (never "ok") — measurement-error honesty vector', /fail-closed/.test(stMissing.reason || '') && stMissing.reason !== 'ok');
c = sandbox({ stasis: '{ this is not json', chain: 'seed' });
t('corrupt stasis file halts — fail-closed', c.g.stasisHalt('ladder-refresh') === true);

/* ═════════ 9) selfmodel — המאמת-האפיסטמי ═════════ */
const sm = require(path.join(ROOT, 'lib', 'selfmodel.cjs'));
const org = sm.load(path.join(ROOT, 'cognition', 'organism.json'));
t('live organism.json validates against SAOS-SELFMODEL/1', org.ok === true && org.model.protocol === 'SAOS-SELFMODEL/1');
const badCap = sm.updateSection(org.model, 'capabilities', [{ id: 'x', home: 'steem', lane: 'grid', status: 'REAL', epistemic: 'OBSERVED', evidence: [] }]);
const vBad = sm.validate(badCap);
t('validator rejects OBSERVED without evidence[] (epistemic honesty is mechanical)', vBad.ok === false && vBad.errors.some((e) => /OBSERVED requires non-empty evidence/.test(e)));
t('EMPTY template is valid (zero claims = zero risk)', sm.validate(sm.EMPTY()).ok === true);
const stamped = sm.updateSection(org.model, 'custody', { extraCheck: true });
t('updateSection stamps generatedAt and keeps the model valid', /^\d{4}-\d{2}-\d{2}T/.test(stamped.generatedAt) && sm.validate(stamped).ok === true);

/* ═════════ 10) תאימות: הבית-החי (קורא-קבצים-אמיתיים; מנקה-אחרי-עצמו) ═════════ */
const liveJournalExisted = fs.existsSync(LIVE_JOURNAL);
const live = require(SRC);
t('live home file: staged lanes grid+claims honored (ladder-refresh allowed)', live.stasisHalt('ladder-refresh') === false);
t('live home file: general lane still halts (head-delegate)', live.stasisHalt('head-delegate') === true);
const liveChain = require(path.join(ROOT, 'lib', 'directivesChain.cjs')).verifyChain();
t('live directives chain verifies (3 entries, genesis→halt-all→staged-open)', liveChain.ok === true && liveChain.entries.length === 3 && liveChain.entries[1].type === 'halt-all' && liveChain.entries[2].type === 'staged-open');
const GENESIS_HASH = '61419a4cf79ca81e9d6a774e72645ca3bde43626e89612b2dbf59d2ade8d7ae3'; /* sha256(JSON.stringify({i:0,at:"2026-10-05T00:00:00Z",type:"genesis",note:"SAOS-DIRECTIVES-CHAIN/1"})) — shared-contract constant */
t('live directives chain genesis hash_0 equals the SAOS-DIRECTIVES-CHAIN/1 contract constant (interop with V-b beat)', liveChain.entries[0].hash === GENESIS_HASH);
const liveGuards = require(path.join(ROOT, 'lib', 'loopguard.cjs')).guardHalt('grid');
t('live guards placeholder: no guards in effect, no foreign fields', liveGuards.halt === false && liveGuards.foreignFields.length === 0);
if (!liveJournalExisted && fs.existsSync(LIVE_JOURNAL)) {
  fs.rmSync(LIVE_JOURNAL);
  ORIG_LOG(' ✓ live test receipts cleaned (journal is a runtime artifact — born with the first real decision)');
}

console.log = ORIG_LOG;
for (const s of SANDBOXES) fs.rmSync(s, { recursive: true, force: true });
ORIG_LOG(failures ? 'capital_gate.selftest: FAIL' : 'capital_gate.selftest: all vectors PASS');
process.exit(failures ? 1 : 0);
