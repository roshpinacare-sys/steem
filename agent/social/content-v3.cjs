'use strict';
/* content-v3.cjs — Z-82: מנוע-תוכן נגד-תבניות.
 *
 * הבעיה שנמדדה (social-audit): אותן-תבניות יום-יום עם תאריך מתחלף —
 * כותרות-תאריך (9/13 אצל הראש), כותרות-מקף (11/13), גופים זהים לגמרי
 * (דמיון-מרבי 1.0 אצל 4 חיילים), פוסטי "דוח-צי" שנחתכים אמצע-משפט.
 *
 * החוק החדש: אין-תבניות-תאריך. כל-פוסט = קול(חייל) × נושא(רוטציה) × מבנה(8) ×
 * מספרים-חיים(≥3, נמדדו-רגע-לפני-הפרסום, אחרת-אין-פוסט). אותו-חייל לא חוזר
 * על-אותו-נושא פחות מ-21 יום, הצי לא חוזר על-נושא פחות מ-3 ימים.
 * שער-איכות (lintArticle) חוסם: תאריך-בכותרת, מקף-מנדריני, כפילות-גוף 3-gram,
 * גוף-קצר, שאריות-קוד, גדר-``` לא-סגורה, ניתוק-אמצע-משפט.
 *
 * כנות-קבועה: הפוסט נחתם כנאמר — נכתב-בקוד, נחתם-במפתח-החייל, כל-מספר-ממקור-מדידה.
 * אנחנו לא מתחפשים לאנשים — אנחנו משפרים את התוכן עד-שהוא באמת שווה-קריאה.
 * טהור-לחלוטין: בלי-רשת, בלי-סודות, בלי-I/O. נבדק ב-social-selftest.cjs.
 */

/* ── קולות-חיילים (DNA קיים, משופר) ── */
const VOICES = {
  haran: { tone: 'מספרים-בלי-סיסמאות', openers: ['במקום לספר — אמדוד.', 'מספרים קודם, מסקנות אחר כך.'], closers: ['המדידה הבאה כבר בדרך.', 'המספרים ידברו גם בלינו.'] },
  wic: { tone: 'יומן-מבצעים', openers: ['הערות מתוך היומן שלי.', 'רשמתי לעצמי — ומסרתי גם לכם.'], closers: ['היומן ממשיך מחר.', 'המבצע הבא כבר בתכנון.'] },
  woq: { tone: 'כנות-מעל-הכל', openers: ['היום בלי לייפות.', 'מה שעובד — ומה שעוד לא.'], closers: ['גם הימים האיטיים נרשמים.', 'הכנות היא האסטרטגיה.'] },
  siq: { tone: 'תהליך-צעד-אחר-צעד', openers: ['בואו נעבור על התהליך.', 'איך זה עובד בפועל:'], closers: ['צעד-צעד, בלי קיצורי-דרך.', 'התהליך הוא הסוד.'] },
  tov: { tone: 'אמון-מכיוון-האימות', openers: ['אמון לא נשבעים בו — בודקים אותו.', 'השרשרת פתוחה, תבדקו.'], closers: ['כל-טענה כאן ניתנת לאימות.', 'האימות הוא ההוכחה.'] },
  israelnews: { tone: 'מדדים-וגיליון', openers: ['הגיליון היומי של המדדים.', 'המדדים דיברו היום.'], closers: ['המדדים הם המלך.', 'מחר — גיליון חדש.'] },
  lsa: { tone: 'מסילות-וצינורות', openers: ['מהמסילה עצמה:', 'הרכבת רצה גם בלי קהל.'], closers: ['המסילה ממשיכה לרוץ.', 'הרכבת לא מפסיקה.'] },
  macrame: { tone: 'אריגה-וקשרים', openers: ['מעולם הקשרים שלי:', 'קשר טוב נבדק במשיכה.'], closers: ['ככה אורגים רשת שמחזיקה.', 'הקשרים מתהדקים עם הזמן.'] },
  cashmachine: { tone: 'כלכלה-אמיתית', openers: ['מנועי-הערך, בלי קסם:', 'כסף אמיתי = משמעות + מדידה.'], closers: ['כלכלה היא משמעת יומית.', 'הפאי גדל רק עם ערך.'] },
  wog: { tone: 'יומן-התעוררות', openers: ['הרשת מתעוררת — היום שלב אחר.', 'עוד צעד בהתעוררות:'], closers: ['ההתעוררות מתועדת.', 'מחר נמדוד שוב.'] },
  headcorner: { tone: 'קול-הראש', openers: ['מהראש של הצי:', 'היום הראש מדווח:'], closers: ['הראש ממשיך לבנות.', 'הצי קדימה.'] },
};

/* ── מבני-מאמר (8) — כל-אחד עם תבנית-כותרת משלו (בלי-תאריך, בלי-מקף-קבוע) ── */
const STRUCTURES = ['numbers-first', 'field-notes', 'qa', 'protocol', 'letter', 'myth-vs-measured', 'glossary', 'walkthrough'];

const TITLES = {
  'numbers-first': (a) => `שלושה מספרים שמסבירים: ${a}`,
  'field-notes': (a) => `הערות שדה על ${a}`,
  'qa': (a) => `${a}? שאלות עם תשובות מדודות`,
  'protocol': (a) => `פרוטוקול עבודה: ${a}`,
  'letter': (a) => `מכתב גלוי בעניין ${a}`,
  'myth-vs-measured': (a) => `מיתוס מול מדידה בעניין ${a}`,
  'glossary': (a) => `מילון חי של ${a}`,
  'walkthrough': (a) => `מהלך הליכה צעד אחר צעד: ${a}`,
};

/* ── נושאים (16) — כולם נכונים-מציאות, כולם ניזונים ממדידות-חיות ── */
const TOPICS = [
  { id: 'maker-book', angle: 'החזקת הטאץ׳ בשוק הפנימי', loader: 'book' },
  { id: 'book-law', angle: 'החוק שאוסר לחצות את הספר', loader: 'book' },
  { id: 'convert-arb', angle: 'הנחת ה-SBD ומכונת ההמרה', loader: 'convert' },
  { id: 'sp-economy', angle: 'כלכלת כוח-הרשת', loader: 'fleet' },
  { id: 'rc-vs-vp', angle: 'למה פרסום שורף RC והצבעה שורפת VP', loader: 'rc' },
  { id: 'sovereign-chain', angle: 'השרשרת הריבונית שמאמתת את עצמה', loader: 'chain' },
  { id: 'ci-rail', angle: 'ה-CI כמסילת רכבת של הצי', loader: 'ci' },
  { id: 'receipts', angle: 'תרבות הקבלות בצי', loader: 'ci' },
  { id: 'determinism', angle: 'דטרמיניזם בין סנדבוקס לענן', loader: 'sim' },
  { id: 'key-hygiene', angle: 'היגיינת מפתחות אחרי התאונה', loader: 'chain' },
  { id: 'grid-mechanics', angle: 'מכניקת הסולם בשוק', loader: 'book' },
  { id: 'honest-failures', angle: 'הדוח הכנה על התקלה האחרונה', loader: 'ci' },
  { id: 'fleet-anatomy', angle: 'אנטומיה של צי סוכנים', loader: 'fleet' },
  { id: 'curation-math', angle: 'מתמטיקת הקוראציה', loader: 'rc' },
  { id: 'delegation-capital', angle: 'הון עצמי במקום בקשות', loader: 'fleet' },
  { id: 'social-cadence', angle: 'למה הפסקנו לפרסם בלהקות', loader: 'audit' },
];

function hashStr(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
function mulberry32(seed) { let a = seed >>> 0; return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
function ngrams(s, n = 3) { const w = norm(s).split(' ').filter(Boolean); const out = new Set(); for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' ')); return out; }
function jaccard(a, b) { if (!a.size || !b.size) return 0; let inter = 0; for (const x of a) if (b.has(x)) inter++; return inter / (a.size + b.size - inter); }

/* ── בורר-נושאים: רוטציה כנה עם זיכרון ── */
function pickTopic({ soldier, dayISO, soldierHistory = {}, fleetHistory = {}, rng }) {
  const r = rng || mulberry32(hashStr(soldier + dayISO));
  const dayNum = Math.floor(Date.parse(dayISO + 'T00:00:00Z') / 864e5);
  const mine = soldierHistory[soldier] || {};
  const cands = [];
  for (const t of TOPICS) {
    const lastMine = mine[t.id] != null ? mine[t.id] : -99999;
    const lastFleet = fleetHistory[t.id] != null ? fleetHistory[t.id] : -99999;
    if (dayNum - lastMine < 21) continue;   // חייל לא חוזר על נושא פחות מ-21 יום
    if (dayNum - lastFleet < 3) continue;   // הצי לא חוזר על נושא פחות מ-3 ימים
    const freshness = Math.min(30, dayNum - lastFleet);
    cands.push({ t, w: freshness + r() * 10 });
  }
  if (!cands.length) return null; // כנות: אין-נושא-פנוי → אין-פוסט-היום
  cands.sort((a, b) => b.w - a.w);
  return cands[0].t;
}

/* ── בונה-המאמר ── */
function buildArticle({ soldier, topic, structure, facts, rng }) {
  const voice = VOICES[soldier] || VOICES.haran;
  const r = rng || mulberry32(hashStr(soldier + (topic && topic.id) + structure + JSON.stringify(facts || {}).length));
  if (!topic || !STRUCTURES.includes(structure)) return null;
  const nums = (facts && facts.nums) || [];
  if (nums.length < 3) return null; // חוק-כנות: פחות מ-3 מספרים מדודים → אין-פוסט
  for (const n of nums) if (typeof n.value !== 'number' || !isFinite(n.value) || !n.label) return null;

  const numLine = (n) => `**${n.label}:** ${n.value.toLocaleString('en-US')}${n.unit ? ' ' + n.unit : ''}`;
  const numsBlock = nums.slice(0, 3).map(numLine);
  const extraNums = nums.slice(3).map(numLine);
  const open = voice.openers[Math.floor(r() * voice.openers.length)];
  const close = voice.closers[Math.floor(r() * voice.closers.length)];
  const angle = topic.angle;
  const context = String((facts && facts.context) || 'המספרים נמדדו מהשרשרת רגע לפני הפרסום.');
  const question = String((facts && facts.openQuestion) || 'מה הייתם מודדים אחרת?');
  const source = String((facts && facts.sourceLine) || 'מקור: מדידה חיה מהשרשרת הציבורית, רגע לפני החתימה.');

  const methodPara = `שיטת-המדידה שלנו קצרה ופשוטה: לפני כל פרסום קוראים את הערכים מהשרשרת הציבורית, בודקים ספים, ורק אז חותמים. אין מספר שנכתב מהזיכרון, ואין טענה שאין לה מקור. אם המדידה נכשלת — הפוסט לא יוצא, וזו בעצמה הצהרת-אמת.`;
  const limitsPara = `גבול כנה: מה שלא נמדד כאן לא מוצג. המערכת שלנו מחויבת להציג גם את הפערים ולא רק את ההצלחות, ולכן כל עדכון כזה הוא תמונת-מצב חלקית בכוונה — החלק הבא של התמונה מגיע בפוסט הבא, עם מדידות חדשות.`;
  const P = [];
  const T = TITLES[structure](angle);
  P.push(`*${open}*`, '');
  if (structure === 'numbers-first') {
    P.push(`נושא היום: ${angle}. לפני שאני מסביר — המספרים:`, '');
    for (const l of numsBlock) P.push(l);
    if (extraNums.length) { P.push(''); for (const l of extraNums) P.push(l); }
    P.push('', `מה המספרים בעצם אומרים: ${context}`, '', `שאלה פתוחה אליכם: ${question}`);
  } else if (structure === 'field-notes') {
    P.push(`נושא: ${angle}. הרשמות מהשדה, בסדר שבו קרו:`, '');
    numsBlock.forEach((l, i) => P.push(`**${i + 1}.** ${l}`));
    if (extraNums.length) { P.push(''); extraNums.forEach((l) => P.push(`**•** ${l}`)); }
    P.push('', `המסקנה הכנה מהשדה: ${context}`, '', `עוד פתוח אצלי: ${question}`);
  } else if (structure === 'qa') {
    P.push(`ש: מה זה ${angle}?`, '', `ת: מהצד המדידתי של הדברים, ככה זה נראה עכשיו:`, '');
    numsBlock.forEach((l) => P.push(l));
    P.push('', `ש: ומה המשמעות?`, '', `ת: ${context}`, '', `ש: ומה עוד לא ידוע?`, '', `ת: ${question}`);
  } else if (structure === 'protocol') {
    P.push(`פרוטוקול הפעלה בעניין ${angle}, כפי שהוא באמת רץ אצלנו:`, '');
    P.push(`**שלב 1 · מדידה.** ${numsBlock[0]}`);
    P.push(`**שלב 2 · בדיקת-סף.** ${numsBlock[1]}`);
    P.push(`**שלב 3 · פעולה.** ${numsBlock[2]}`);
    if (extraNums.length) { P.push(`**שלב 4 · השלמה.** ${extraNums[0]}`); }
    P.push('', `העיקרון שמחזיק את הפרוטוקול: ${context}`);
  } else if (structure === 'letter') {
    P.push(`שלום לקורא,`, '', `רציתי לספר לך על ${angle}, עם המספרים שיש לי ביד עכשיו:`, '');
    for (const l of numsBlock) P.push(`- ${l}`);
    P.push('', `מה שהמספרים האלה באמת אומרים: ${context}`, '', `ושאלה שאני עדיין נושא איתי: ${question}`, '', `בהערכה, @${soldier}`);
  } else if (structure === 'myth-vs-measured') {
    P.push(`**המיתוס:** ${angle} — עניין של דעות וסיסמאות.`, '', `**המדידה:**`, '');
    for (const l of numsBlock) P.push(`- ${l}`);
    P.push('', `**המסקנה המדודה:** ${context}`, '', `**המיתוס הבא לבדיקה:** ${question}`);
  } else if (structure === 'glossary') {
    P.push(`מונחים חיים סביב ${angle}, כפי שהם נמדדים אצלנו היום:`, '');
    P.push(`**מונח 1 — המספר הגדול.** ${numsBlock[0]}`);
    P.push(`**מונח 2 — הסף.** ${numsBlock[1]}`);
    P.push(`**מונח 3 — הקצב.** ${numsBlock[2]}`);
    P.push('', `בין המונחים: ${context}`, '', `מונח שעדיין מוגדר: ${question}`);
  } else { /* walkthrough */
    P.push(`נלך על ${angle} צעד אחר צעד, עם הערכים החיים של עכשיו:`, '');
    P.push(`**עצור ראשון.** ${numsBlock[0]}`, '');
    P.push(`**עצור שני.** ${numsBlock[1]}`, '');
    P.push(`**עצור שלישי.** ${numsBlock[2]}`, '');
    P.push(`מה שרואים בסוף המסלול: ${context}`, '', `מסלול חלופי ששווה לבדוק: ${question}`);
  }
  /* ניתוח-עומק: כל-מספר מקבל פרשנות-עצמאית — לא-רק רשימה */
  const interp = [
    (n) => `מה שהמספר הראשון בעצם אומר (${n.label}: ${n.value.toLocaleString('en-US')}${n.unit ? ' ' + n.unit : ''}) — זה קו-הבסיס שממנו כל ההשוואות נגזרות. בלי קו-בסיס אין תמונה, רק רושם.`,
    (n) => `השני (${n.label}: ${n.value.toLocaleString('en-US')}${n.unit ? ' ' + n.unit : ''}) מספר על הקצב — איך המצב זז בין מדידה למדידה. קצב מספר לנו על העתיד הקרוב יותר מכל תחזית.`,
    (n) => `והשלישי (${n.label}: ${n.value.toLocaleString('en-US')}${n.unit ? ' ' + n.unit : ''}) הוא הסף שמכריע: מתחתיו עוצרים ומתקנים, מעליו ממשיכים בדרך. ספים הם מה שהופך מדידה להחלטה.`,
  ];
  nums.slice(0, 3).forEach((n, i) => { if (i) P.push(''); P.push(interp[i](n)); });
  P.push('', `מה נמדד הלאה: את ההמשך של ${angle} נבחן במדידה הבאה. אם המגמה מחזיקה — נחזק אותה. אם היא נשברת — נדווח על זה קודם כל לעצמנו, ואז גם כאן, בכנות. זה ההבדל בין ניהול אמיתי לסיפור יפה.`);
  P.push('', `ולסיום, בלי סיסמאות: כל מה שקראת כאן ניתן לבדיקה עצמאית. מי שרוצה לאמת — השרשרת פתוחה, הקבלות בגיט ציבוריות, והשאלה "${question}" מחכה לתשובה של מי שמוכן למדוד בעצמו.`);
  P.push('', methodPara, '', limitsPara, '', `---`, '', `*פוסט זה נכתב בקוד הפרסום של הצי, נחתם במפתח-הפרסום של @${soldier}, וכל-מספר בו נמדד רגע לפני השידור. ${source}*`, '', `*${close}*`);
  const body = P.join('\n');
  return { title: T, body, structureId: structure, topicId: topic.id };
}

/* ── שער-איכות ── */
function lintArticle({ title, body, ownRecentTitles = [], ownRecentBodies = [], fleetRecentTitles = [] }) {
  const issues = [];
  const t = String(title || ''); const b = String(body || '');
  if (!t.trim()) issues.push('title-empty');
  if (/\d{4}-\d{2}-\d{2}/.test(t)) issues.push('title-contains-date');
  if (/ — /.test(t)) issues.push('title-em-dash');
  const pref = t.trim().slice(0, 12);
  if (pref && ownRecentTitles.some((x) => String(x).trim().slice(0, 12) === pref)) issues.push('title-prefix-reuse');
  if (b.trim().length < 1200) issues.push('body-too-short(<1200)');
  if (/undefined|NaN(?![a-z])|\$\{|\[object Object\]/.test(b)) issues.push('leaked-code-artifact');
  if (((b.match(/```/g) || []).length) % 2 === 1) issues.push('unclosed-code-fence');
  const lastLine = b.trim().split('\n').pop() || '';
  if (b.trim().length > 300 && lastLine.length > 40 && /[א-תa-zA-Z]$/.test(lastLine.trim())) issues.push('ends-mid-sentence');
  const g = ngrams(b);
  for (const rb of ownRecentBodies) { if (jaccard(g, ngrams(rb)) > 0.25) { issues.push('body-dup-own(>0.25)'); break; } }
  const tg = norm(t).split(' ');
  for (const ft of fleetRecentTitles) { const fg = norm(ft).split(' '); if (tg.length > 3 && fg.length > 3) { const s = jaccard(new Set(tg), new Set(fg)); if (s > 0.6) { issues.push('title-dup-fleet(>0.6)'); break; } } }
  return issues;
}

/** זיכרון-רוטציה: מעדכן היסטוריות אחרי-פרסום (טהור — מחזיר מבנה-חדש) */
function updateHistory({ soldierHistory = {}, fleetHistory = {}, soldier, topicId, dayISO }) {
  const dayNum = Math.floor(Date.parse(dayISO + 'T00:00:00Z') / 864e5);
  const sh = JSON.parse(JSON.stringify(soldierHistory));
  const fh = JSON.parse(JSON.stringify(fleetHistory));
  sh[soldier] = { ...(sh[soldier] || {}), [topicId]: dayNum };
  fh[topicId] = dayNum;
  return { soldierHistory: sh, fleetHistory: fh };
}

module.exports = { VOICES, STRUCTURES, TITLES, TOPICS, buildArticle, lintArticle, pickTopic, updateHistory, ngrams, jaccard, mulberry32, hashStr };
