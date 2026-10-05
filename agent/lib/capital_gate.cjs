'use strict';
/**
 * capital_gate.cjs — שער-המחשבה-לפני-חתימה של בית-steem (owner directive 2026-10-04, trace 1a108e28015b0451)
 * ═════════════════════════════════════════════════════════════════════════════════════════════════════
 * הבעלים מדד חי ומצא שהאוטונומיה רצה "בלי שכל ואינטילגנציה" — האצלות-SP אוטומטיות
 * לחיילים-אבודים-ללא-מפתחות (hcsoldier1/2/3 — LOST-NO-CUSTODY), פלאפינג-יעדים
 * מכמה-כותבים בלי-תיאום, וכסף-חי שנשלח לכתובות-שאף-אחד לא שולט-בהן.
 *
 * החוק מהיום (שלושה-שערים לפני-כל-חתימה):
 *   1. STASIS  — agent/STASIS.json: active=true → no-op בריא (exit 0) עם שורת-קבלה קולחת.
 *   2. ROSTER  — יעד-הון חייב: ב-activeFleet של lib/fleet-roster.cjs + economicUse=true
 *                בשרשרת-היעד + לא ברשימת-האיסור (hcsoldier1/2/3, ynet — עם ראיות-משמורת).
 *   3. JOURNAL — כל-הכרעת-הון נרשמת ל-agent/receipts/capital-decisions.jsonl.
 *
 * ══ V-a — החוזה-האפיסטמי (SOVEREIGN COGNITIVE ACTIVATION, trace 1a10c90522120149) ══
 * R27 מדד: לקבצי-מדינה אין-אותנטיות (STASIS.json מזויף {"active":false} הרים-את-הבלם),
 * אין-כיוון (כל-סוכן יכול להרחיב), ולפסקי-דין אין-צרכנים-מכניים. התיקון-המבני כאן:
 *   (1) אותנטיקה — קובץ-STASIS בלי protocol=SAOS-FATE-DEFENSE-STASIS/1 תקף (mode full|staged,
 *       since ISO) = fail-closed (unauthenticated → HALT). JSON-תקין-שקרי כבר לא פותח-כלום.
 *   (2) סמכות-כיוונית — SHRINK (סגירה/עצירה) תמיד מכנית-מותר לכל-סוכן; EXPAND (פתיחת-מסילות,
 *       הרמת-בלם) מחייב כיסוי בשרשרת-הנחיות-הבעלים (owner-directives.jsonl, hash-chain —
 *       **tamper-EVIDENT, לא tamper-PROOF**: עריכה-שקטה נופלת; בנייה-מחדש-מלאה היא מדיניות-
 *       מוגנת-בשקיפות (diff גלוי), לא הוכחה-קריפטוגרפית — כך זה מתויג בכנות בכל-קבלה).
 *   (3) צרכן-מכני לשומרי-הלופ — agent/cognition/lane-guards.json (loopguard.cjs): שומר
 *       יכול רק לסגור; שדות-פתיחה הם foreignFields אינרטיים; קובץ-לא-קריא = עצירה-לכל-המסילות.
 *   (4) זיכרון-החלטות — כל-הכרעת-שער (עצירה או-אישור) כותבת קבלה-קוגניטיבית אחת
 *       (idempotencyKey=sha256(tool|lane|decision|minute) — לא-משוכפלת; append-only).
 *       יומן-לא-כתיב = לא-וטו: '[CAPITAL-GATE] journal-unwritable (decision still enforced)'
 *       + journalHealth().degraded (הדגם-העצמי יסמן).
 *
 * fail-closed: רוסטר-חסר או-שגיאת-שער = כל-היעדים נדחים / המסילה עוצרת.
 * אפס-סודות: המודול קורא מדיניות-בלבד, לעולם לא נוגע בחומר-מפתח ולא מדפיס סודות.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AGENT_DIR = path.join(__dirname, '..');
const STASIS_FILE = path.join(AGENT_DIR, 'STASIS.json');
const JOURNAL = path.join(AGENT_DIR, 'receipts', 'capital-decisions.jsonl');
const CHAIN = require('./directivesChain.cjs');
const GUARDS = require('./loopguard.cjs');

/** רשימת-האיסור-הקנונית (מעל-הרוסטר — אפילו אם-יום-אחד יופיעו ברוסטר, אסור-הון): */
const BANNED_CAPITAL = Object.freeze([
  { name: 'hcsoldier1', reason: 'LOST-NO-CUSTODY — no key material exists anywhere (agent/receipts/2026-10-04-hcsoldier-custody-audit.json); zero authority anchors measured live 2026-10-04; 18.667 STEEM + 0.139 SBD already stranded inside' },
  { name: 'hcsoldier2', reason: 'LOST-NO-CUSTODY — same custody evidence as hcsoldier1, live-measured 2026-10-04' },
  { name: 'hcsoldier3', reason: 'LOST-NO-CUSTODY — same custody evidence as hcsoldier1, live-measured 2026-10-04' },
  { name: 'ynet', reason: 'retired by sovereign decision 2026-09-29/30 — economicUse=false on the canonical roster' },
  { name: 'headcorner', reason: 'self is the treasury — self-delegation/self-transfer is not a fleet operation' },
]);

/**
 * מצב-הבלם עם-אותנטיקה (V-a): קריאה-כושלת → fail-closed (כמו-תמיד).
 * חדש: קובץ-קריא שאינו נושא protocol='SAOS-FATE-DEFENSE-STASIS/1' — או-שהוא נכשל
 * בדרישות-הפרוטוקול (mode ∈ {full,staged}, since ISO-parseable) — מוחזר כ-unauthenticated
 * עם active=true: JSON-תקין-שקרי לא מרים-בלם. זהו סגירת-החור ש-R27 מדד.
 */
function stasisState() {
  let doc;
  try { doc = JSON.parse(fs.readFileSync(STASIS_FILE, 'utf8')); }
  catch (_) { return { active: true, unreadable: true, mode: 'full', reason: 'stasis file unreadable — fail-closed' }; }
  if (!doc || typeof doc !== 'object' || doc.protocol !== 'SAOS-FATE-DEFENSE-STASIS/1') {
    return { active: true, unreadable: false, unauthenticated: true, mode: 'full', reason: 'STASIS file lacks valid protocol — fail-closed' };
  }
  if ((doc.mode !== 'full' && doc.mode !== 'staged') || typeof doc.since !== 'string' || Number.isNaN(Date.parse(doc.since))) {
    return { active: true, unreadable: false, unauthenticated: true, mode: 'full', reason: 'STASIS file fails protocol validation (mode must be full|staged; since must be ISO) — fail-closed' };
  }
  return doc;
}

/**
 * מסילת-הכלי — laneOf(tool) (owner directive 2026-10-05, trace 1a10bfe1342b2391 —
 * staged re-entry + calibration mandate). מיפוי-מפורש מהאודיט של R24-b (כל-אתר-חתימה
 * נבדק-מול-האופ-שלו בקוד — לא לפי-שם-בלבד):
 *   'claims' — כלים שהאופ-שלהם claim_reward_balance (posting-only, אידמפוטנטי):
 *              agent:claim, agent:army-claim, fleet-claim, head-revive:claim, fleetv3-autopilot:claim.
 *   'grid'   — כלים שהאופ-שלהם limit_order_create/cancel על הספר-הפנימי:
 *              ladder-refresh (מכונת-הסולם).
 *   'general'— כל-יתר: האצלות, העברות, converts, מכירות-HE, mint/escrow, וכל-כלי-לא-מוכר.
 * כלי-לא-מוכר → 'general' (fail-closed: אין-היכרות = אין-מסילה-פתוחה).
 */
const LANES = Object.freeze({
  claims: Object.freeze(['agent:claim', 'agent:army-claim', 'fleet-claim', 'head-revive:claim', 'fleetv3-autopilot:claim']),
  grid: Object.freeze(['ladder-refresh']),
});

function laneOf(tool) {
  const t = String(tool || '').trim().toLowerCase();
  for (const lane of Object.keys(LANES)) {
    if (LANES[lane].includes(t)) return lane;
  }
  return 'general';
}

/* ══ V-a: זיכרון-ההחלטות — ה-JOURNAL הופך-אמיתי ══
 * קבלה-קוגניטיבית אחת לכל-הכרעת-שער (halt/allow), סכימת SAOS-COGNITIVE-RECEIPT:
 * idempotencyKey=sha256(tool|lane|decision|minuteBucket) — אם-השורה-האחרונה כבר-נושאת
 * את-המפתח, מדלגים (append-only, לעולם לא לכתוב-מחדש). שגיאת-יומן ≠ וטו: ההחלטה
 * נאכפת בכל-מקרה, journalHealth מסומן-degraded. */
let journalHealthState = { ok: true, lastError: null, lastWriteAt: null };

function journalHealth() {
  let lines = 0;
  try { lines = fs.readFileSync(JOURNAL, 'utf8').split('\n').filter(Boolean).length; } catch (_) { lines = 0; }
  return { ok: journalHealthState.ok, degraded: !journalHealthState.ok, lastAt: journalHealthState.lastWriteAt, lines, file: JOURNAL, lastError: journalHealthState.lastError, lastWriteAt: journalHealthState.lastWriteAt, receiptProtocol: 'SAOS-COGNITIVE-RECEIPT/1' };
}

function writeReceipt(tool, lane, decision, authority, evidence, reasonNote) {
  const minuteBucket = new Date().toISOString().slice(0, 16); /* YYYY-MM-DDTHH:MM */
  const key = crypto.createHash('sha256').update([tool, lane, decision, minuteBucket].join('|'), 'utf8').digest('hex');
  try {
    fs.mkdirSync(path.dirname(JOURNAL), { recursive: true });
    let raw = '';
    try { raw = fs.readFileSync(JOURNAL, 'utf8'); } catch (_) { /* קובץ-חסר = כתיבה-ראשונה */ }
    if (raw.indexOf(key) !== -1) return key; /* idempotency: אותו-כלי/מסילה/הכרעה באותו-דקה לעולם לא משוכפלת (append-only, לעולם לא לכתוב-מחדש) */
    const receipt = {
      at: new Date().toISOString(),
      kind: 'capital-gate-stasis-decision',
      decision,
      tool,
      lane,
      authority,
      evidence: (evidence || []).map((e) => ({ source: String(e.source || '').slice(0, 120), ref: String(e.ref || '').slice(0, 200), at: e.at || null })),
      preconditions: ['stasisState authenticated (SAOS-FATE-DEFENSE-STASIS/1)', 'laneOf(' + String(tool) + ')=' + lane],
      confidence: 1,
      expectedOutcome: decision === 'halt'
        ? 'tool exits as a healthy no-op before any key material is loaded'
        : 'tool proceeds under staged-lane authority; roster + journal gates still apply downstream',
      alternatives: [],
      idempotencyKey: key,
      abortConditions: [],
      postconditions: [],
      verification: { method: 'next gate invocation appends the paired receipt', status: 'pending', at: null, actual: null, deviation: null },
      note: String(reasonNote || '').slice(0, 200),
    };
    fs.appendFileSync(JOURNAL, JSON.stringify(receipt) + '\n');
    journalHealthState = { ok: true, lastError: null, lastWriteAt: receipt.at };
    return key;
  } catch (e) {
    journalHealthState = { ok: false, lastError: String((e && e.message) || e).slice(0, 120), lastWriteAt: journalHealthState.lastWriteAt };
    console.log('[CAPITAL-GATE] journal-unwritable (decision still enforced) · ' + journalHealthState.lastError);
    return null;
  }
}

/* סמכות-לפי-כיוון (V-a) — מטא-דאטה טהור לקוראים ולדגם-העצמי:
 * shrink (סגירה/עצירה) = מנגנון, תמיד-מותר; expand (פתיחה/הרחבה) = policy-gated
 * (חייב-ראיה-משורשרת של-הבעלים — tamper-EVIDENT); measure (קריאה/מדידה) = חופשי. */
const AUTHORITY_OF = Object.freeze({ shrink: 'mechanism-shrink', expand: 'policy-gated', measure: 'free' });
function authorityOf(action) {
  return AUTHORITY_OF[String(action || '').trim().toLowerCase()] || 'policy-gated'; /* לא-מוכר = כמו-הרחבה (fail-closed) */
}

/** עזר: האם-שרשרת-הנחיות-הבעלים מאומתת ומכסה-את-המסילות-המבוקשות. */
function directivesCover(neededLanes) {
  const v = CHAIN.verifyChain();
  if (!v.ok) return { covered: false, chainOk: false, breakAt: v.breakAt, reason: v.reason };
  return { covered: CHAIN.hasEntryForLanes(neededLanes), chainOk: true, breakAt: null, reason: null };
}

/**
 * true = הקורא חייב לצאת 0 (no-op בריא) מיד, לפני-כל-טעינת-מפתחות.
 *
 * סדר-ההכרעה (V-a — החוזה-האפיסטמי):
 *   (a) אותנטיקה: קובץ-לא-קריא או-בלי-פרוטוקול-תקף → HALT (mechanism-shrink);
 *   (b) שומר-המסילה: guardHalt(lane).halt → HALT עם '[CAPITAL-GATE] LANE-GUARD-HALT' (mechanism-guard);
 *   (c) active!==true = טענת-הרחבה (הרמת-בלם): מותרת רק אם שרשרת-הנחיות-הבעלים מאומתת
 *       ומכסה-את-ההמשך (מסילות-ה-stagedLanes.allow שבקובץ, או '*' להרמה-מלאה) — אחרת HALT
 *       'resume-lacks-owner-directive-entry' (סגירת-החור-של-"active:false" מזויף);
 *   (d) staged allow: כל-מסילה-פתוחה-בקובץ חייבת-כיסוי-בשרשרת — אחרת HALT
 *       'staged-lane-lacks-directive-entry' (כיווניות: הקובץ לא יכול לפתוח-מה שהבעלים לא פתחו);
 *   (e) אחרת — ההתנהגות-הקיימת (STASIS-STAGED-ALLOW / STASIS-HALT).
 * אין-נפילה-פתוחה: קובץ-חסר/פגום/מזויף = עצירה.
 */
function stasisHalt(tool) {
  const s = stasisState();
  const lane = laneOf(tool);
  const reason = String(s.reason || 'unspecified');

  /* (a) אותנטיקה — קובץ שאי-אפשר לאמת = עצירה */
  if (s.unreadable || s.unauthenticated) {
    const tag = s.unauthenticated ? 'STASIS-UNAUTHENTICATED' : 'STASIS-STATE-UNREADABLE';
    console.log(`[CAPITAL-GATE] ${tag} ${tool} (lane=${lane}) · reason: ${reason.slice(0, 160)}`);
    writeReceipt(tool, lane, 'halt', 'mechanism-shrink', [
      { source: 'agent/STASIS.json', ref: tag.toLowerCase() + ': ' + reason.slice(0, 140), at: new Date().toISOString() },
    ], 'fail-closed: state file could not be authenticated');
    return true;
  }

  /* (b) שומר-המסילה — פסק-דין-מכני שיכול-רק-לסגור (loopguard SAOS-LANE-GUARDS/1) */
  const gh = GUARDS.guardHalt(lane);
  if (gh.halt) {
    const gid = gh.guard ? gh.guard.id : 'guards-unreadable';
    console.log(`[CAPITAL-GATE] LANE-GUARD-HALT ${tool} (lane=${lane}) · guard=${gid} · reason: ${String(gh.reason || 'unspecified').slice(0, 120)}`);
    writeReceipt(tool, lane, 'halt', 'mechanism-guard', [
      { source: 'agent/cognition/lane-guards.json', ref: 'guard ' + gid + (gh.guard && gh.guard.evidenceRef ? ' · ' + gh.guard.evidenceRef : ''), at: (gh.guard && gh.guard.openedAt) || new Date().toISOString() },
    ], String(gh.reason || 'lane-guard-close').slice(0, 180));
    return true;
  }

  const allow = Array.isArray(s.stagedLanes && s.stagedLanes.allow) ? s.stagedLanes.allow.map((x) => String(x).toLowerCase()) : [];

  /* (c) active!==true → סמכות-כיוונית: הרמת-בלם היא-הרחבה וחייבת-ראיה-משורשרת של-הבעלים */
  if (s.active !== true) {
    const needed = allow.length ? allow : ['*'];
    const cov = directivesCover(needed);
    if (!cov.covered) {
      console.log(`[CAPITAL-GATE] RESUME-DENIED ${tool} (lane=${lane}) · reason: resume-lacks-owner-directive-entry · needed=[${needed.join(',')}]${cov.chainOk ? '' : ' · chain ' + cov.reason}`);
      writeReceipt(tool, lane, 'halt', 'mechanism-shrink', [
        { source: 'agent/receipts/owner-directives.jsonl', ref: cov.chainOk ? ('chain verifies; no coverage for [' + needed.join(',') + ']') : ('chain tampered/unreadable: ' + cov.reason), at: new Date().toISOString() },
        { source: 'agent/STASIS.json', ref: 'active=false claim without owner-directives coverage', at: s.since },
      ], 'resume-lacks-owner-directive-entry');
      return true;
    }
    if (allow.length && !allow.includes(lane)) {
      console.log(`[CAPITAL-GATE] RESUME-DENIED ${tool} (lane=${lane}) · reason: lane-not-in-owner-directive-resume · resumed=[${allow.join(',')}]`);
      writeReceipt(tool, lane, 'halt', 'mechanism-shrink', [
        { source: 'agent/receipts/owner-directives.jsonl', ref: 'covers [' + allow.join(',') + '] only', at: new Date().toISOString() },
      ], 'lane-not-in-owner-directive-resume');
      return true;
    }
    console.log(`[CAPITAL-GATE] RESUME-ALLOWED-BY-DIRECTIVES ${tool} (lane=${lane}) · owner-directives cover [${needed.join(',')}] · tamper-EVIDENT (policy-gated, not crypto-proof)`);
    writeReceipt(tool, lane, 'allow', 'policy-gated', [
      { source: 'agent/receipts/owner-directives.jsonl', ref: 'owner-directives coverage for [' + needed.join(',') + ']', at: new Date().toISOString() },
    ], 'resume covered by owner-directives chain (tamper-evident, policy-gated)');
    return false;
  }

  /* (d) staged allow — המסילה-פתוחה-בקובץ חייבת-כיסוי-בשרשרת-הנחיות-הבעלים */
  if (s.mode === 'staged' && allow.includes(lane)) {
    const cov = directivesCover(allow);
    if (!cov.covered) {
      console.log(`[CAPITAL-GATE] STAGED-DENIED ${tool} (lane=${lane}) · reason: staged-lane-lacks-directive-entry · allow=[${allow.join(',')}]${cov.chainOk ? '' : ' · chain ' + cov.reason}`);
      writeReceipt(tool, lane, 'halt', 'mechanism-shrink', [
        { source: 'agent/receipts/owner-directives.jsonl', ref: cov.chainOk ? ('chain verifies; staged allow [' + allow.join(',') + '] not fully covered') : ('chain tampered/unreadable: ' + cov.reason), at: new Date().toISOString() },
        { source: 'agent/STASIS.json', ref: 'stagedLanes.allow=[' + allow.join(',') + ']', at: s.since },
      ], 'staged-lane-lacks-directive-entry');
      return true;
    }
    console.log(`[CAPITAL-GATE] STASIS-STAGED-ALLOW ${tool} (lane=${lane}) · reason: ${reason.slice(0, 160)} · since ${s.since || '?'} · directives-covered`);
    writeReceipt(tool, lane, 'allow', 'policy-gated', [
      { source: 'agent/STASIS.json', ref: 'mode=staged, stagedLanes.allow=[' + allow.join(',') + ']', at: s.since },
      { source: 'agent/receipts/owner-directives.jsonl', ref: 'owner-directives coverage for [' + allow.join(',') + ']', at: new Date().toISOString() },
    ], 'staged allow covered by owner-directives chain (tamper-evident, policy-gated)');
    return false;
  }

  /* (e) ההתנהגות-הקיימת: עצירה-כללית */
  console.log(`[CAPITAL-GATE] STASIS-HALT ${tool} (lane=${lane}) · reason: ${reason.slice(0, 160)} · since ${s.since || '?'}`);
  writeReceipt(tool, lane, 'halt', 'mechanism-shrink', [
    { source: 'agent/STASIS.json', ref: 'protocol valid · active=true · mode=' + s.mode, at: s.since },
  ], 'stasis-halt (lane not in staged allow, or mode=full)');
  return true;
}

/**
 * שוער-יעדים לפי-שרשרת. targets: שמות-חשבון; chain: 'steem'|'hive'|'blurt'.
 * מחזיר { allowed, refused, rosterLoaded } — refused תמיד עם-נימוק מפורש.
 */
function guardTargets(tool, targets, chain = 'steem') {
  const list = (targets || []).map((t) => String(t || '').toLowerCase()).filter(Boolean);
  const out = { allowed: [], refused: [], rosterLoaded: false };
  let roster = null;
  try { roster = require('./fleet-roster.cjs').roster(); } catch (_) { roster = null; }
  if (!roster || !Array.isArray(roster.accounts) || roster.accounts.length === 0) {
    console.log(`[CAPITAL-GATE] REFUSED ${tool} → ALL targets · reason: canonical roster unavailable (fail-closed)`);
    out.refused = list.map((name) => ({ name, reason: 'roster-unavailable' }));
    return out;
  }
  out.rosterLoaded = true;
  const fleet = new Set(roster.activeFleet.map((n) => String(n).toLowerCase()));
  let rowsByPair = null;
  try { rowsByPair = new Map(require('./fleet-roster.cjs').rows().map((r) => [r.account + '|' + r.chain, r])); } catch (_) {}
  const banned = new Map(BANNED_CAPITAL.map((b) => [b.name, b.reason]));
  for (const name of list) {
    if (banned.has(name)) { out.refused.push({ name, reason: 'banned: ' + banned.get(name) }); continue; }
    if (!fleet.has(name)) { out.refused.push({ name, reason: 'not-in-canonical-activeFleet' }); continue; }
    const row = rowsByPair && rowsByPair.get(name + '|' + chain);
    if (!row) { out.refused.push({ name, reason: 'no control row for ' + chain }); continue; }
    if (row.economicUse !== true) { out.refused.push({ name, reason: 'economicUse=false (' + String(row.blockedReason || '').slice(0, 80) + ')' }); continue; }
    out.allowed.push(name);
  }
  for (const x of out.refused) console.log(`[CAPITAL-GATE] REFUSED ${tool} → @${x.name} · ${x.reason}`);
  return out;
}

/** יומן-ההחלטות — שורה-אחת לכל-הכרעת-הון (מה/למה/תוצאה). אפס-סודות.
 * (ממשק-היסטורי לקוראים-קיימים; הקבלות-הקוגניטיביות נכתבות דרך writeReceipt ב-stasisHalt.) */
function journal(tool, row) {
  try {
    fs.mkdirSync(path.dirname(JOURNAL), { recursive: true });
    fs.appendFileSync(JOURNAL, JSON.stringify({ at: new Date().toISOString(), tool, ...row }) + '\n');
    journalHealthState = { ok: true, lastError: null, lastWriteAt: new Date().toISOString() };
  } catch (e) {
    journalHealthState = { ok: false, lastError: String((e && e.message) || e).slice(0, 120), lastWriteAt: journalHealthState.lastWriteAt };
    console.log('[CAPITAL-GATE] journal-unwritable (decision still enforced) · ' + journalHealthState.lastError);
  }
}

module.exports = { stasisState, stasisHalt, laneOf, guardTargets, journal, journalHealth, authorityOf, BANNED_CAPITAL, STASIS_FILE, JOURNAL };
