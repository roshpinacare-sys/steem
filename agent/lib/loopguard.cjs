'use strict';
/**
 * loopguard.cjs — צרכן-המכני של-פסקי-הדין (SAOS-LANE-GUARDS/1) · V-a, trace 1a10c90522120149
 * ═════════════════════════════════════════════════════════════════════════════════════════════════════
 * R27 מדד: לפסקי-הדין של-הסשנים אין צרכנים-מכניים — הלמידה חיה במטה-שכבה (סשני-LLM).
 * הקובץ agent/cognition/lane-guards.json הוא הגשר הראשון: ה-cognition-beat (V-b) כותב
 * לו שומרים — והשער קורא אותו מכנית.
 *
 * עיקרון-הכיוון (מחייב): שומר-מסילה יכול **רק לסגור**. כל-שדה שמנסה לפתוח (open/allow/…)
 * מנוטרל, מודגל כ-foreignFields ומושמט — אף-קומבינציה בקובץ לא יכולה לפתוח-מסילה.
 *   רק closed:true נחשב; expiresAt שעבר (ISO תקין < עכשיו) מנטרל את-השומר;
 *   expiresAt לא-תקין = השומר נשאר-חי (כיווץ-לא-נופל-בגלל-באג-תאריך);
 *   קובץ-לא-קריא/פרוטוקול-זר = guardHalt(lane)=true לכל-מסילה (fail-closed צועק, 'guards-unreadable');
 *   קובץ-חסר = אין-שומרים (מתועד פעם-אחת, לא שגיאה — ה-beat יכתוב-אותו-בהמשך).
 * אפס-סודות: ערכי-שדות-זרים לא נדפסים — רק שמות-השדות.
 */
const fs = require('fs');
const path = require('path');

const PROTOCOL = 'SAOS-LANE-GUARDS/1';
const GUARDS_FILE = path.join(__dirname, '..', 'cognition', 'lane-guards.json');
const SCHEMA_FIELDS = Object.freeze(['id', 'lane', 'closed', 'reason', 'evidenceRef', 'openedAt', 'expiresAt']);
let missingLogged = false;

/**
 * readGuards(file?) → { ok, missing?, guards[], foreignFields[], reason?, detail? }
 * guards[] = רק הרשומות-הסוגרות-התקפות (closed:true). foreignFields = כל-ניסיון-פתיחה/שדה-זר.
 */
function readGuards(file) {
  const f = file || GUARDS_FILE;
  let raw;
  try { raw = fs.readFileSync(f, 'utf8'); }
  catch (e) {
    if (e && e.code === 'ENOENT') {
      if (!missingLogged) { console.log('[LOOPGUARD] guards file absent — no guards in effect (cognition-beat will write it later)'); missingLogged = true; }
      return { ok: true, missing: true, guards: [], foreignFields: [] };
    }
    return { ok: false, missing: false, guards: [], foreignFields: [], reason: 'guards-unreadable' };
  }
  let doc;
  try { doc = JSON.parse(raw); }
  catch (_) { return { ok: false, missing: false, guards: [], foreignFields: [], reason: 'guards-unreadable', detail: 'not-json' }; }
  if (!doc || typeof doc !== 'object' || doc.protocol !== PROTOCOL) {
    return { ok: false, missing: false, guards: [], foreignFields: [], reason: 'guards-unreadable', detail: 'protocol-mismatch' };
  }
  if (!Array.isArray(doc.guards)) {
    return { ok: false, missing: false, guards: [], foreignFields: [], reason: 'guards-unreadable', detail: 'guards-not-array' };
  }
  const foreign = [];
  for (const k of Object.keys(doc)) if (k !== 'protocol' && k !== 'guards' && k !== 'note') foreign.push({ top: k });
  const guards = [];
  doc.guards.forEach((g, idx) => {
    if (!g || typeof g !== 'object' || Array.isArray(g)) { foreign.push({ entry: idx, issue: 'not-an-object' }); return; }
    for (const k of Object.keys(g)) if (!SCHEMA_FIELDS.includes(k)) foreign.push({ guard: String(g.id || ('#' + idx)), field: k });
    if (typeof g.lane !== 'string' || !g.lane.trim()) { foreign.push({ guard: String(g.id || ('#' + idx)), issue: 'missing-lane' }); return; }
    if (g.closed !== true) return; /* רק סגירה נחשבת — שומר לעולם לא פותח */
    guards.push({
      id: String(g.id || ('guard-' + idx)),
      lane: String(g.lane).toLowerCase(),
      closed: true,
      reason: String(g.reason || 'unspecified').slice(0, 200),
      evidenceRef: g.evidenceRef == null ? null : String(g.evidenceRef).slice(0, 200),
      openedAt: g.openedAt == null ? null : String(g.openedAt),
      expiresAt: g.expiresAt == null ? null : String(g.expiresAt),
    });
  });
  return { ok: true, missing: false, guards, foreignFields: foreign };
}

/**
 * guardHalt(lane, file?) → { halt, guard?, reason?, foreignFields? }
 * true = הקורא חייב לעצור את-המסילה מיד (עיקרון: כיווץ תמיד מותר — וכאן הוא מכני).
 */
function guardHalt(lane, file) {
  const laneKey = String(lane || '').toLowerCase();
  const r = readGuards(file);
  if (r.ok === false) return { halt: true, guard: null, reason: r.reason || 'guards-unreadable', foreignFields: r.foreignFields || [] };
  const now = Date.now();
  const hit = r.guards.find((g) => {
    if (g.lane !== laneKey) return false;
    if (g.expiresAt == null) return true;
    const exp = Date.parse(g.expiresAt);
    return Number.isNaN(exp) || exp > now; /* לא-תקין = נשאר-חי; תקין-שעבר = inert */
  });
  if (hit) return { halt: true, guard: hit, reason: hit.reason, foreignFields: r.foreignFields || [] };
  return { halt: false, guard: null, foreignFields: r.foreignFields || [] };
}

module.exports = { PROTOCOL, readGuards, guardHalt, GUARDS_FILE, SCHEMA_FIELDS };
