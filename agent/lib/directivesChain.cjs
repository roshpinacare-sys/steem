'use strict';
/**
 * directivesChain.cjs — שרשרת-הנחיות-הבעלים (SAOS-DIRECTIVES-CHAIN/1) · V-a, trace 1a10c90522120149
 * ═════════════════════════════════════════════════════════════════════════════════════════════════════
 * העיקרון שנמדד ב-R27 (ואושר ע"י הבעלים): לקבצי-מדינה אין אותנטיות ואין כיוון.
 * STASIS.json שנערך בידי-סוכן ("active":false שקרי) הרים-את-הבלם בפועל. התיקון-המבני:
 * סמכות-הרחבה (פתיחת-מסילות / הרמת-בלם) חייבת ראיה-משורשרת של-הבעלים. כיווץ (SHRINK)
 * נשאר מנגנון-חופשי — אף-סוכן לא צריך רשות כדי לעצור.
 *
 * פורמט: JSONL, כל-שורה {"i","at","type","trace","source","lanes","note","hash"}
 *   types: genesis | halt-all | staged-open | owner-note
 *   hash_0 = sha256(JSON.stringify({i:0,at,type:"genesis",note:"SAOS-DIRECTIVES-CHAIN/1"}))
 *   hash_i = sha256(hash_{i-1} + JSON.stringify({i,at,type,trace,source,lanes,note}))
 *
 * **כנות-מחייבת**: זו ראיה-מפורכת (tamper-EVIDENT), לא חתימה-קריפטוגרפית (tamper-PROOF).
 * עריכה-שקטה של רשומה-קיימת נופלת מיד (ה-hash נשבר); אבל מי שכותב לקובץ יכול לבנות
 * שרשרת-שלמה-חדשה. ההגנה האמיתית = הקובץ בגיט (diff גלוי לכל-כתיבה) + מדיניות שהרשומות
 * נכתבות רק מדברי-בעלים. זו הרשאה-מדיניות-מוגנת-בשקיפות — לא הוכחה-קריפטוגרפית.
 *
 * כיווניות: halt-all סוגר מכנית. רשומת staged-open מכסה-מסילה רק אם היא מאוחרת מה-halt-all
 * האחרון — כך גם לקובץ-הנחיות יש סמכות-כיווץ בלבד-עצמו: אף-רשומה ישנה לא "פותחת-מחדש"
 * אחרי-עצירה-חדשה של-הבעלים. '*' = כיסוי לכל-המסילות (הרמה-מלאה).
 * אפס-סודות: המודול קורא מדיניות-בלבד.
 */
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const PROTOCOL = 'SAOS-DIRECTIVES-CHAIN/1';
const TYPES = Object.freeze(['genesis', 'halt-all', 'staged-open', 'owner-note']);
const CHAIN_FILE = path.join(__dirname, '..', 'receipts', 'owner-directives.jsonl');

/** המטען-הקנוני לחישוב-hash — סדר-מפתחות קבוע; שדות-חסרים (undefined) נופלים מה-JSON. */
function canonicalPayload(e) {
  if (e.i === 0) return JSON.stringify({ i: 0, at: e.at, type: e.type, note: e.note });
  return JSON.stringify({ i: e.i, at: e.at, type: e.type, trace: e.trace, source: e.source, lanes: e.lanes, note: e.note });
}

function entryHash(prevHash, e) {
  return crypto.createHash('sha256').update(prevHash + canonicalPayload(e), 'utf8').digest('hex');
}

/**
 * verifyChain(file?) → { ok, entries, breakAt, reason, file }
 * קובץ-חסר/לא-קריא/שורה-לא-JSON/סדר-שבור/hash-לא-תואם → ok:false עם breakAt (כישלון-גלוי).
 */
function verifyChain(file) {
  const f = file || CHAIN_FILE;
  const out = { ok: false, entries: [], breakAt: null, reason: null, file: f };
  let raw;
  try { raw = fs.readFileSync(f, 'utf8'); }
  catch (e) { out.breakAt = 0; out.reason = 'chain-file-unreadable: ' + String((e && e.message) || e).slice(0, 80); return out; }
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  let prev = '';
  for (let n = 0; n < lines.length; n++) {
    let e;
    try { e = JSON.parse(lines[n]); } catch (_) { out.breakAt = n; out.reason = 'line-not-json'; return out; }
    if (!e || typeof e !== 'object' || e.i !== n) { out.breakAt = n; out.reason = 'sequence-break'; return out; }
    if (n === 0 && e.type !== 'genesis') { out.breakAt = 0; out.reason = 'first-entry-not-genesis'; return out; }
    if (n > 0 && !TYPES.includes(e.type)) { out.breakAt = n; out.reason = 'unknown-entry-type: ' + String(e.type).slice(0, 40); return out; }
    const h = entryHash(prev, e);
    if (e.hash !== h) { out.breakAt = n; out.reason = 'hash-mismatch'; return out; }
    out.entries.push(e);
    prev = h;
  }
  if (out.entries.length === 0) { out.breakAt = 0; out.reason = 'empty-chain'; return out; }
  out.ok = true;
  return out;
}

/**
 * hasEntryForLanes(lanes, file?) → bool
 * true אם כל-מסילה-מבוקשת מכוסה ע"י רשומת staged-open תקפה (trace לא-ריק) שמאוחרת
 * מה-halt-all האחרון, והשרשרת כולה מאומתת. '*' ברשומה מכסה-הכל (הרמה-מלאה).
 * כישלון-שרשרת (tamper) → false — הרחבה ללא-ראיה שלמה = אין-הרשאה.
 */
function hasEntryForLanes(lanes, file) {
  const v = verifyChain(file);
  if (!v.ok) return false;
  const need = (Array.isArray(lanes) ? lanes : [lanes]).map((x) => String(x || '').toLowerCase());
  if (need.length === 0) return false;
  let lastHaltIdx = -1;
  for (const e of v.entries) if (e.type === 'halt-all') lastHaltIdx = Math.max(lastHaltIdx, e.i);
  for (const lane of need) {
    const covered = v.entries.some((e) =>
      e.i > lastHaltIdx
      && e.type === 'staged-open'
      && Array.isArray(e.lanes)
      && (e.lanes.map((x) => String(x).toLowerCase()).includes(lane) || e.lanes.includes('*'))
      && typeof e.trace === 'string' && e.trace.length > 0);
    if (!covered) return false;
  }
  return true;
}

module.exports = { PROTOCOL, TYPES, verifyChain, hasEntryForLanes, canonicalPayload, entryHash, CHAIN_FILE };
