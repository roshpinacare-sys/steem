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
 * fail-closed: רוסטר-חסר או-שגיאת-שער = כל-היעדים נדחים / המסילה עוצרת.
 * אפס-סודות: המודול קורא מדיניות-בלבד, לעולם לא נוגע בחומר-מפתח ולא מדפיס סודות.
 */
const fs = require('fs');
const path = require('path');

const AGENT_DIR = path.join(__dirname, '..');
const STASIS_FILE = path.join(AGENT_DIR, 'STASIS.json');
const JOURNAL = path.join(AGENT_DIR, 'receipts', 'capital-decisions.jsonl');

/** רשימת-האיסור-הקנונית (מעל-הרוסטר — אפילו אם-יום-אחד יופיעו ברוסטר, אסור-הון): */
const BANNED_CAPITAL = Object.freeze([
  { name: 'hcsoldier1', reason: 'LOST-NO-CUSTODY — no key material exists anywhere (agent/receipts/2026-10-04-hcsoldier-custody-audit.json); zero authority anchors measured live 2026-10-04; 18.667 STEEM + 0.139 SBD already stranded inside' },
  { name: 'hcsoldier2', reason: 'LOST-NO-CUSTODY — same custody evidence as hcsoldier1, live-measured 2026-10-04' },
  { name: 'hcsoldier3', reason: 'LOST-NO-CUSTODY — same custody evidence as hcsoldier1, live-measured 2026-10-04' },
  { name: 'ynet', reason: 'retired by sovereign decision 2026-09-29/30 — economicUse=false on the canonical roster' },
  { name: 'headcorner', reason: 'self is the treasury — self-delegation/self-transfer is not a fleet operation' },
]);

function stasisState() {
  try { return JSON.parse(fs.readFileSync(STASIS_FILE, 'utf8')); } catch (_) { return { active: true, unreadable: true, reason: 'stasis file unreadable — fail-closed' }; }
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

/**
 * true = הקורא חייב לצאת 0 (no-op בריא) מיד, לפני-כל-טעינת-מפתחות.
 * STAGED (owner directive 2026-10-05, trace 1a10bfe1342b2391 — 'Re-enable its autonomous
 * capabilities intelligently. Let it operate.' + calibration mandate): כש-mode=staged
 * והמסילה של הכלי ∈ stagedLanes.allow → קבלת STASIS-STAGED-ALLOW והיתר-מותנה;
 * כל-יתר נעצר בדיוק-כמו-קודם. אין-נפילה-פתוחה: קובץ-חסר/פגום = active=true = עצירה.
 */
function stasisHalt(tool) {
  const s = stasisState();
  if (s.active !== true) return false;
  const lane = laneOf(tool);
  const allow = Array.isArray(s.stagedLanes && s.stagedLanes.allow) ? s.stagedLanes.allow.map((x) => String(x).toLowerCase()) : [];
  if (s.mode === 'staged' && allow.includes(lane)) {
    console.log(`[CAPITAL-GATE] STASIS-STAGED-ALLOW ${tool} (lane=${lane}) · reason: ${String(s.reason || 'unspecified').slice(0, 160)} · since ${s.since || '?'}`);
    return false;
  }
  console.log(`[CAPITAL-GATE] STASIS-HALT ${tool} (lane=${lane}) · reason: ${String(s.reason || 'unspecified').slice(0, 160)} · since ${s.since || '?'}`);
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

/** יומן-ההחלטות — שורה-אחת לכל-הכרעת-הון (מה/למה/תוצאה). אפס-סודות. */
function journal(tool, row) {
  try {
    fs.mkdirSync(path.dirname(JOURNAL), { recursive: true });
    fs.appendFileSync(JOURNAL, JSON.stringify({ at: new Date().toISOString(), tool, ...row }) + '\n');
  } catch (_) { /* יומן לא מפיל ריצה — השערים כן */ }
}

module.exports = { stasisState, stasisHalt, laneOf, guardTargets, journal, BANNED_CAPITAL, STASIS_FILE, JOURNAL };
