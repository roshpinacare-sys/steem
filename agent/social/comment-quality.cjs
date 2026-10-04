'use strict';
/* comment-quality.cjs — Z-82: שומר-תגובות · אין-עוד "מעניין מאוד!" גנרי.
 *
 * המדידה: 4–5 תגובות-כפולות לחייל בחלון 14 יום. הריבון: "תגובות חוזרות על עצמם".
 *
 * החוק החדש — תגובה בלי-עוגן-ספציפי-מהפוסט לא נולדת:
 *   · חובה לשלוף עוגן מהפוסט-המטרה: מספר-עם-יחידה / ביטוי-מודגש / משפט-פתיחה משמעותי
 *   · בלי-עוגן → null (fail-closed) — לא-מדברים על מה-שלא-קראנו
 *   · תוספת-ערך: נתון-מדוד משל-המגיב + שאלה פתוחה אחת
 *   · שומרים: אורך 140–420, איסור-שכפול מדויק, 3-gram > 0.3 מול-עצמי, חזרת-פתיח
 *     (6 המילים-הראשונות) מול-הזיכרון שלי→מחבר
 * טהור-לחלוטין. נבדק ב-social-selftest.cjs.
 */

const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
function ngrams(s, n = 3) { const w = norm(s).split(' ').filter(Boolean); const out = new Set(); for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' ')); return out; }
function jaccard(a, b) { if (!a.size || !b.size) return 0; let inter = 0; for (const x of a) if (b.has(x)) inter++; return inter / (a.size + b.size - inter); }

/** שליפת-עוגן כנה מגוף-הפוסט. מחזיר {kind, text} או null. */
function extractAnchor(postBody) {
  const b = String(postBody || '');
  if (b.length < 40) return null;
  const num = b.match(/\d[\d,.]*\s*(?:SP|%|STEEM|SBD|HIVE|BLURT|blocks?|חיילים?|חשבונות?|דולר|שקל)/u);
  if (num) return { kind: 'number', text: num[0].trim() };
  const bold = b.match(/\*\*([^*\n]{8,80})\*\*/);
  if (bold) return { kind: 'bold', text: bold[1].trim() };
  const firstSentence = b.split(/[.。\n]/).map((s) => s.trim()).find((s) => s.length >= 30 && s.length <= 160);
  if (firstSentence) return { kind: 'sentence', text: firstSentence };
  return null;
}

const OPENERS = [
  (a) => `העוגן שתפס את העין שלי אצלך: ${a}.`,
  (a) => `עצרתי ב-${a} וחשבתי על זה קצת.`,
  (a) => `השורה ${a} היא בדיוק החלק המעניין.`,
  (a) => `שווה לעצור על הנתון הזה: ${a}.`,
  (a) => `קראתי פעמיים את החלק עם ${a}.`,
  (a) => `${a} — שמתי לב אל זה מיד.`,
];
const QUESTIONS = [
  'איך זה משתנה ביום-רגזה?',
  'מה הערך הזה אומר על שבוע שלם?',
  'יש מדידה הפוכה שמאמתת את זה?',
  'איפה הגבול העליון של העיקרון הזה?',
  'מה קורה כשהנחת-היסוד מתהפכת?',
  'איך זה מתנהג כשהנפח מוכפל?',
  'האם המדידה הזאת יציבה לאורך ימים?',
  'איזה מדד נוסף היה הופך את התמונה לשלמה?',
];

/** בונה-תגובה. fail-closed: בלי-עוגן → null. */
function buildComment({ postBody, myStat, rng, myRecentBodies = [] }) {
  const r = rng || Math.random;
  const anchor = extractAnchor(postBody);
  if (!anchor) return null;
  const op = OPENERS[Math.floor(r() * OPENERS.length)](anchor.text);
  const q = QUESTIONS[Math.floor(r() * QUESTIONS.length)];
  const stat = myStat && typeof myStat.sp === 'number' && typeof myStat.vp === 'number'
    ? `אצלי במדידה חיה עכשיו: ${myStat.sp.toLocaleString('en-US')} SP אפקטיבי ב-VP ${myStat.vp}%.`
    : '';
  const CORES = [
    `השילוב בין מה שמדת ובין מה שנמדד אצלנו היום נותן זווית שלא הייתה קיימת בנפרד. ${stat}`,
    `קריאה מול המדידות שלנו מראה שהכיוון שלך עולה בקנה אחד עם מה שרואים בשרשרת. ${stat}`,
    `מה שעשית כאן הוא בדיוק סוג העבודה שמייצר בסיס למדידות הבאות של כולנו. ${stat}`,
  ];
  const core = CORES[Math.floor(r() * CORES.length)];
  const body = [op, core, q].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  if (body.length < 140 || body.length > 420) return null;
  const guard = guardComment(body, myRecentBodies);
  if (guard.length) return null;
  return { body, anchor };
}

/** שומר-תגובה: מחזיר רשימת-תקלות (ריק = עובר) */
function guardComment(body, myRecentBodies = [], myOpenersForAuthor = []) {
  const issues = [];
  const b = String(body || '').trim();
  if (b.length < 140) issues.push('too-short(<140)');
  if (b.length > 420) issues.push('too-long(>420)');
  const g = ngrams(b);
  for (const rb of myRecentBodies) {
    if (norm(b) === norm(rb)) { issues.push('exact-dup'); break; }
    if (jaccard(g, ngrams(rb)) > 0.3) { issues.push('near-dup(>0.3)'); break; }
  }
  const stem = norm(b).split(' ').slice(0, 6).join(' ');
  if (stem && myOpenersForAuthor.some((x) => norm(x).split(' ').slice(0, 6).join(' ') === stem)) issues.push('opener-repeat(6w)');
  if (/\$\{|undefined|\[object Object\]/.test(b)) issues.push('leaked-artifact');
  return issues;
}

/** מדד-שוויון (ג'יני) — לאיזון-כוח-ההצבעה בין-החיילים */
function gini(xs) {
  const v = xs.filter((x) => x >= 0).sort((a, b) => a - b);
  const n = v.length; if (!n || v[n - 1] === 0) return 0;
  let s = 0; for (let i = 0; i < n; i++) s += (i + 1) * v[i];
  return +((2 * s) / (n * v.reduce((a, b) => a + b, 0)) - (n + 1) / n).toFixed(4);
}

module.exports = { extractAnchor, buildComment, guardComment, gini, ngrams, jaccard };
