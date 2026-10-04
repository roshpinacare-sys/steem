#!/usr/bin/env node
/* social-selftest.cjs — Z-82: שער-חוקי-הברזל של מהפכת-הקדנס.
 * כל-חוק שנמדד כאן נגזר מהבעיה שהריבון מדד בשרשרת (audit 14 יום):
 *   פיצוצי-דקה · תבניות-תאריך · גופים-זהים · תגובות-כפולות · אין-פיזור-יומי.
 * טהור: אפס-רשת, אפס-סודות. יציאה 1 = נפל (הסניף-לא-עובר).
 */
'use strict';
const path = require('path');
const cadence = require(path.join(__dirname, 'cadence.cjs'));
const content = require(path.join(__dirname, 'content-v3.cjs'));
const cq = require(path.join(__dirname, 'comment-quality.cjs'));

const FLEET = ['headcorner', 'cashmachine', 'haran', 'israelnews', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq', 'ynet'];
const RETIRED = ['ynet'];

let pass = 0, fail = 0;
const failures = [];
function rule(name, fn) {
  try {
    const r = fn();
    if (r === true) { pass++; console.log('  PASS ' + name); }
    else { fail++; failures.push(name); console.log('  FAIL ' + name + ' → ' + JSON.stringify(r)); }
  } catch (e) { fail++; failures.push(name); console.log('  FAIL ' + name + ' → threw: ' + String(e.message || e).slice(0, 120)); }
}

const factsA = {
  nums: [{ label: 'כוח-רשת כולל', value: 4057, unit: 'SP' }, { label: 'חיילים עם האצלה', value: 10, unit: '' }, { label: 'רווח-צי מינימלי', value: 25, unit: 'דק׳' }],
  context: 'הרשת מווסתת את עצמה בלי התערבות חיצונית.',
  openQuestion: 'מה קורה כשההאצלות גדלות פי עשרה?',
  sourceLine: 'מדידה חיה, רגע לפני החתימה.',
};

console.log('== קדנס: לוח-יומי נגד-להקות ==');
const cal1 = cadence.buildCalendar({ dayISO: '2026-10-05', fleet: FLEET, retired: RETIRED });
const cal1b = cadence.buildCalendar({ dayISO: '2026-10-05', fleet: FLEET, retired: RETIRED });
rule('determinism: אותו-יום → לוח-זהה', () => JSON.stringify(cal1.slots) === JSON.stringify(cal1b.slots));
const cal2 = cadence.buildCalendar({ dayISO: '2026-10-06', fleet: FLEET, retired: RETIRED });
rule('day-change: יום-אחר → מועדים-שונים', () => JSON.stringify(cal1.slots) !== JSON.stringify(cal2.slots));
rule('minute-uniqueness: אף-שתי-פעולות-צי באותה-דקה', () => {
  const mins = cal1.slots.map((s) => s.t);
  return new Set(mins).size === mins.length;
});
rule('fleet-gap ≥ 25 דק׳ (נמדד על-הלוח עצמו)', () => {
  const mins = cal1.slots.map((s) => { const [h, m] = s.t.split(':').map(Number); return h * 60 + m; }).sort((a, b) => a - b);
  let g = Infinity; for (let i = 1; i < mins.length; i++) g = Math.min(g, mins[i] - mins[i - 1]);
  return g >= cadence.FLEET_GAP_MIN ? true : { minGap: g };
});
rule('soldier-gap ≥ 120 דק׳ לאותו-חייל', () => {
  const byA = {};
  for (const s of cal1.slots) { const [h, m] = s.t.split(':').map(Number); (byA[s.account] = byA[s.account] || []).push(h * 60 + m); }
  for (const a of Object.keys(byA)) { const xs = byA[a].sort((x, y) => x - y); for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] < cadence.SOLDIER_GAP_MIN) return { account: a, gap: xs[i] - xs[i - 1] }; }
  return true;
});
rule('posts ≥ 180 דק׳ ביניהם', () => {
  const ps = cal1.slots.filter((s) => s.kind === 'post').map((s) => { const [h, m] = s.t.split(':').map(Number); return h * 60 + m; }).sort((a, b) => a - b);
  for (let i = 1; i < ps.length; i++) if (ps[i] - ps[i - 1] < cadence.POST_GAP_MIN) return { gap: ps[i] - ps[i - 1] };
  return true;
});
rule('window: הכל ב-05:30–23:30 UTC', () => {
  for (const s of cal1.slots) { const [h, m] = s.t.split(':').map(Number); const v = h * 60 + m; if (v < cadence.WINDOW_START_MIN || v > cadence.WINDOW_END_MIN) return { slot: s }; }
  return true;
});
rule('counts: 3 פוסטים · 6 תגובות · 14 הצבעות', () => cal1.stats.posts === 3 && cal1.stats.comments === 6 && cal1.stats.votes === 14 ? true : cal1.stats);
rule('post-authors נבדלים', () => {
  const pa = cal1.slots.filter((s) => s.kind === 'post').map((s) => s.account);
  return new Set(pa).size === pa.length ? true : { pa };
});
rule('כל-חייל-פעיל לפחות משבצת-אחת', () => {
  const missing = FLEET.filter((n) => !RETIRED.includes(n) && !cal1.slots.some((s) => s.account === n));
  return missing.length === 0 ? true : { missing };
});
rule('maxSlotsPerSoldier לא-נפרץ', () => cal1.stats.maxPerSoldier <= cadence.DEFAULTS.maxSlotsPerSoldier + 1 ? true : { max: cal1.stats.maxPerSoldier });
rule('weights: חייל 10000 · ראש 2000', () => {
  for (const s of cal1.slots) { if (s.account === 'headcorner' && s.weight !== cadence.HEAD_WEIGHT) return s; if (s.account !== 'headcorner' && s.kind === 'vote' && s.weight !== cadence.SOLDIER_WEIGHT) return s; }
  return true;
});
rule('7 ימים: החוקים לא-נשברים יום אחרי יום', () => {
  for (let d = 1; d <= 7; d++) {
    const day = '2026-10-' + String(5 + d).padStart(2, '0');
    const c = cadence.buildCalendar({ dayISO: day, fleet: FLEET, retired: RETIRED });
    const mins = c.slots.map((s) => { const [h, m] = s.t.split(':').map(Number); return h * 60 + m; }).sort((a, b) => a - b);
    let g = Infinity; for (let i = 1; i < mins.length; i++) g = Math.min(g, mins[i] - mins[i - 1]);
    if (g < cadence.FLEET_GAP_MIN) return { day, minGap: g };
    if (c.stats.maxPerSoldier > cadence.DEFAULTS.maxSlotsPerSoldier + 1) return { day, max: c.stats.maxPerSoldier };
  }
  return true;
});
rule('voteBudget: vp=50 → 5 הצבעות-מלאות מתקציב-ההתאוששות', () => cadence.voteBudget(50).maxFullVotes === 5 ? true : cadence.voteBudget(50));
rule('voteBudget: vp=95 → אפס (חוק-הפס 80%)', () => cadence.voteBudget(95).maxFullVotes === 0 ? true : cadence.voteBudget(95));

console.log('== תוכן v3: נגד-תבניות ==');
const topic = content.TOPICS.find((t) => t.id === 'sp-economy');
rule('fail-closed: פחות מ-3 מספרים → אין-פוסט', () => content.buildArticle({ soldier: 'haran', topic, structure: 'numbers-first', facts: { nums: factsA.nums.slice(0, 2) } }) === null);
rule('fail-closed: NaN/∞ מספר → אין-פוסט', () => content.buildArticle({ soldier: 'haran', topic, structure: 'numbers-first', facts: { nums: [...factsA.nums.slice(0, 2), { label: 'x', value: NaN, unit: '' }] } }) === null);
const art = content.buildArticle({ soldier: 'haran', topic, structure: 'numbers-first', facts: factsA, rng: content.mulberry32(7) });
rule('build: כל-3 המספרים מוטמעים בגוף', () => factsA.nums.every((n) => art.body.includes(n.value.toLocaleString('en-US'))) ? true : art.body.slice(0, 200));
rule('כותרת בלי-תאריך ובלי-מקף-מנדריני', () => !/\d{4}-\d{2}-\d{2}/.test(art.title) && !/ — /.test(art.title) ? true : art.title);
rule('8 מבנים → 8 כותרות נבדלות', () => {
  const set = new Set(content.STRUCTURES.map((st) => content.buildArticle({ soldier: 'haran', topic, structure: st, facts: factsA, rng: content.mulberry32(11) }).title));
  return set.size === 8 ? true : { size: set.size };
});
rule('10 קולות → 10 גופים נבדלים (אותו-נושא)', () => {
  const soldiers = Object.keys(content.VOICES);
  const set = new Set(soldiers.map((s) => content.buildArticle({ soldier: s, topic, structure: 'qa', facts: factsA, rng: content.mulberry32(13) }).body.slice(0, 60)));
  return set.size === soldiers.length ? true : { size: set.size };
});
{
  const rng = content.mulberry32(21);
  let h = { soldierHistory: {}, fleetHistory: {} };
  let first = content.pickTopic({ soldier: 'haran', dayISO: '2026-10-05', ...h, rng });
  h = content.updateHistory({ ...h, soldier: 'haran', topicId: first.id, dayISO: '2026-10-05' });
  const again = content.pickTopic({ soldier: 'haran', dayISO: '2026-10-10', ...h, rng });
  rule('רוטציה: חייל לא חוזר על-נושא בתוך 21 יום', () => again && again.id !== first.id ? true : { first: first && first.id, again: again && again.id });
  const sameFleet = content.pickTopic({ soldier: 'wic', dayISO: '2026-10-06', ...h, rng });
  rule('רוטציה: הצי לא חוזר על-נושא בתוך 3 ימים', () => sameFleet && sameFleet.id !== first.id ? true : { first: first && first.id, fleet: sameFleet && sameFleet.id });
}
rule('lint תופס: תאריך-בכותרת', () => content.lintArticle({ title: 'דוח רשת 2026-10-05', body: 'x'.repeat(1300) }).includes('title-contains-date'));
rule('lint תופס: מקף-מנדריני בכותרת', () => content.lintArticle({ title: 'דוח — מספרים', body: 'x'.repeat(1300) }).includes('title-em-dash'));
rule('lint תופס: גוף-קצר', () => content.lintArticle({ title: 'כותרת תקינה וארוכה', body: 'קצר' }).includes('body-too-short(<1200)'));
rule('lint תופס: שאריות-קוד', () => content.lintArticle({ title: 'כותרת תקינה וארוכה', body: 'undefined הדלף ' + 'x'.repeat(1300) }).includes('leaked-code-artifact'));
rule('lint תופס: כפילות-גוף מול-עצמי', () => {
  const b = 'טקסט ארוך מאוד '.repeat(120);
  return content.lintArticle({ title: 'כותרת תקינה וארוכה', body: b, ownRecentBodies: [b] }).includes('body-dup-own(>0.25)');
});
rule('lint מאשר מאמר-תקין טרי', () => {
  const issues = content.lintArticle({ title: art.title, body: art.body, ownRecentTitles: ['מאמר אחר לגמרי בנושא'], ownRecentBodies: ['שונה ' + 'טקסט '.repeat(300)] });
  return issues.length === 0 ? true : issues;
});

console.log('== תגובות: אין-עוד-גנרי ==');
const postBody = '**נתוני-אמת:** 4057 SP כוח-רשת. הרשת מווסתת את עצמה, וכל-הצבעה עוברת סורג של אימות-מפתח לפני חתימה וקריאה-חוזרת אחריה.';
rule('extractAnchor: מספר-עם-יחידה נתפס', () => cq.extractAnchor(postBody).kind === 'number' ? true : cq.extractAnchor(postBody));
rule('extractAnchor: fail-closed על-גוף-ריק/קצר', () => cq.extractAnchor('קצר') === null);
const c1 = cq.buildComment({ postBody, myStat: { sp: 30.2, vp: 42.9 }, rng: cq.ngrams ? undefined : undefined });
const c1b = cq.buildComment({ postBody, myStat: { sp: 30.2, vp: 42.9 }, rng: undefined });
rule('buildComment: עוגן מוטמע + תחום-אורך 140–420', () => c1 && c1.body.length >= 140 && c1.body.length <= 420 && c1.body.includes(c1.anchor.text) ? true : c1);
rule('buildComment: fail-closed בלי-עוגן', () => cq.buildComment({ postBody: 'קצר מדי' }) === null);
rule('guard תופס: שכפול-מדויק', () => cq.guardComment(c1.body, [c1.body]).includes('exact-dup'));
rule('guard תופס: פתיח-חוזר (6 מילים) מול-אותו-מחבר', () => cq.guardComment(c1.body + ' תוספת חדשה לגמרי וארוכה', [], [c1.body]).includes('opener-repeat(6w)') ? true : cq.guardComment(c1.body + ' תוספת חדשה לגמרי וארוכה', [], [c1.body]));
rule('generator: תגובה-לא-פוגעת תוך ≤5 זרעים (חוק-הניסיונות)', () => {
  const mem = [c1.body, c1b.body];
  const stems = [c1.body];
  for (let seed = 1; seed <= 5; seed++) {
    const c2 = cq.buildComment({ postBody: postBody + ' עוד מספר: 243 fills.', myStat: { sp: 31, vp: 41 }, rng: require('crypto').randomInt ? undefined : undefined }) || cq.buildComment({ postBody: postBody + ' עוד מספר: 243 fills.', myStat: { sp: 31, vp: 41 } });
    if (!c2) continue;
    if (cq.guardComment(c2.body, mem, stems).length === 0) return true;
  }
  return { why: 'no fresh comment in 5 tries' };
});
rule('gini: שוויון → 0 · ריכוז-קיצוני → חוק (n−1)/n = 0.75', () => cq.gini([1, 1, 1, 1]) === 0 && Math.abs(cq.gini([0, 0, 0, 1]) - 0.75) < 1e-9 ? true : { eq: cq.gini([1, 1, 1, 1]), sk: cq.gini([0, 0, 0, 1]) });

console.log('== אינטגרציה: 5 ימי-פרסום בלי-חזרה ==');
rule('5 ימים: רוטציית-נושאים + בנייה + lint נקי', () => {
  let h = { soldierHistory: {}, fleetHistory: {} };
  const soldiers = ['haran', 'wic', 'woq', 'siq', 'tov'];
  for (let d = 0; d < 5; d++) {
    const day = '2026-10-' + String(5 + d).padStart(2, '0');
    const c = cadence.buildCalendar({ dayISO: day, fleet: FLEET, retired: RETIRED });
    for (const slot of c.slots.filter((s) => s.kind === 'post')) {
      if (!soldiers.includes(slot.account)) continue;
      const t = content.pickTopic({ soldier: slot.account, dayISO: day, ...h, rng: content.mulberry32(cadence.hashStr(day + slot.account)) });
      if (!t) return { day, soldier: slot.account, why: 'no-topic' };
      const a = content.buildArticle({ soldier: slot.account, topic: t, structure: content.STRUCTURES[d % 8], facts: factsA, rng: content.mulberry32(cadence.hashStr(day + t.id)) });
      if (!a) return { day, why: 'build-null' };
      const issues = content.lintArticle({ title: a.title, body: a.body, ownRecentTitles: [], ownRecentBodies: [] });
      if (issues.length) return { day, issues };
      h = content.updateHistory({ ...h, soldier: slot.account, topicId: t.id, dayISO: day });
    }
  }
  return true;
});

console.log('');
console.log(`RESULT: ${pass} PASS · ${fail} FAIL`);
if (fail) { console.log('failures: ' + failures.join(' | ')); process.exit(1); }
console.log('social-selftest: ALL GREEN');
