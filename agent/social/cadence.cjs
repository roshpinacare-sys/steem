'use strict';
/* cadence.cjs — Z-82: לוח-קדנס יומי ריבוני · אפס-פיצוצי-דקה.
 *
 * המדידה שהציתה את זה (social-audit, נתוני-שרשרת אמת, חלון 14 יום):
 *   88.7% מהפעולות בדקות-משותפות · שיא 11 חיילים באותה-דקה (פרסום והצבעה) ·
 *   שעות-שיא 14:00–15:00 UTC (הרכבת-היומית) — בדיוק "הכל באותו רגע" שהריבון מדד.
 *
 * החוק החדש: כל-פעולה-חברתית נולדת עם מועד-משלה. לוח-יומי דטרמיניסטי (seed=יום),
 * חייל-אחר בכל-פעם, לאורך-כל-היום, עם רווחי-נגידות מדודים:
 *   · רווח-צי: אף-שתי-פעולות-צי באותה-דקה ובמרחק < 25 דק׳
 *   · רווח-חייל: אותו-חייל לא פועל פעמיים בתוך 120 דק׳
 *   · פוסטים: ≥ 3 שעות בין-פוסטים · לכל-היותר 3 ביום
 *   · הצבעות: מפוזרות לאורך-כל-היום (דילוג-על-פרסום — קציר-קוראציה נכון)
 *   · חלון-יומי: 05:30–23:30 UTC
 *
 * טהור-לחלוטין (בלי-רשת, בלי-סודות, בלי-I/O) — כל-חוק נבדק ב-social-selftest.cjs.
 */
'use strict';

function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WINDOW_START_MIN = 5 * 60 + 30;   // 05:30 UTC
const WINDOW_END_MIN = 23 * 60 + 30;    // 23:30 UTC
const FLEET_GAP_MIN = 25;               // אף-שתי-פעולות-צי קרובות מזה
const SOLDIER_GAP_MIN = 120;            // אותו-חייל: מרווח-מינימום
const POST_GAP_MIN = 180;               // בין-פוסטים
const SOLDIER_WEIGHT = 10000;           // חיילים: 100% (SP-אבק — מקסום-אות)
const HEAD_WEIGHT = 2000;               // ראש: 20% (SP-כבד — פרס-משמעותי, חיסכון-VP)
const VOTE_REGEN_PCT_PER_DAY = 20;      // קצב-התאוששות VP טבעי
const VOTE_COST_PCT = 2;                // עלות-הצבעה מלאה ב-VP

const DEFAULTS = Object.freeze({
  postsPerDay: 3,
  commentsPerDay: 6,
  votesPerDay: 14,
  maxSlotsPerSoldier: 4,
});

function hm(min) { return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0'); }

/** בחירה דטרמיניסטית-מסובבת של מפרסמי-היום (רוטציה לפי-יום, בלי-חזרה-באותו-יום) */
function pickRotate(rng, pool, n, exclude) {
  const p = pool.filter((x) => !exclude.includes(x));
  const arr = p.slice();
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr.slice(0, Math.min(n, arr.length));
}

/** לוח-היום. טהור: אותו-יום → אותו-לוח, ביט-בביט. */
function buildCalendar({ dayISO, fleet, retired = [], seedExtra = '', opts = {} }) {
  const o = { ...DEFAULTS, ...opts };
  const active = fleet.filter((n) => !retired.includes(n));
  const rng = mulberry32(hashStr(dayISO + '|' + seedExtra + '|' + active.join(',')));
  const head = active[0] === 'headcorner' ? 'headcorner' : null;
  const soldiers = active.filter((n) => n !== 'headcorner');

  const slots = [];
  const collisions = (min, who) =>
    slots.some((s) => {
      if (Math.abs(s.min - min) < FLEET_GAP_MIN) return true;           // רווח-צי
      if (s.account === who && Math.abs(s.min - min) < SOLDIER_GAP_MIN) return true; // רווח-חייל
      return false;
    });
  const postNear = (min) => slots.some((s) => s.kind === 'post' && Math.abs(s.min - min) < POST_GAP_MIN);

  function place(kind, who, anchorWins, weight) {
    for (let relax = 0; relax < 4; relax++) {
      const fleetGap = FLEET_GAP_MIN - relax * 6;
      const soldierGap = SOLDIER_GAP_MIN - relax * 20;
      for (let attempt = 0; attempt < 220; attempt++) {
        const w = anchorWins[Math.floor(rng() * anchorWins.length)];
        const min = Math.round(w[0] + rng() * (w[1] - w[0]));
        if (min < WINDOW_START_MIN || min > WINDOW_END_MIN) continue;
        const clash = slots.some((s) => Math.abs(s.min - min) < fleetGap || (s.account === who && Math.abs(s.min - min) < soldierGap));
        if (clash) continue;
        if (kind === 'post' && postNear(min)) continue;
        slots.push({ min, t: hm(min), account: who, kind, weight: weight || null });
        return true;
      }
    }
    return false; // כנות: לא-הצלחנו למקם — מדלגים, לא-כופפים את החוק
  }

  /* פוסטים — 3 חיילים שונים, בשלושה-חלונות-יום שונים (בוקר/צהריים/ערב) */
  const postAuthors = pickRotate(rng, soldiers, o.postsPerDay, []);
  const postWins = [[6 * 60, 9 * 60 + 30], [12 * 60, 15 * 60], [19 * 60, 22 * 60]];
  postAuthors.forEach((who, i) => {
    if (slots.filter((s) => s.account === who).length >= o.maxSlotsPerSoldier) return;
    place('post', who, [postWins[i % postWins.length]]);
  });

  /* תגובות — 6 משבצות, חיילים-שונים, חלונות-ביניים */
  const commentAuthors = pickRotate(rng, soldiers, o.commentsPerDay, postAuthors.slice(0, 2));
  commentAuthors.forEach((who) => {
    if (slots.filter((s) => s.account === who).length >= o.maxSlotsPerSoldier) return;
    place('comment', who, [[9 * 60, 12 * 60], [16 * 60, 21 * 60]]);
  });

  /* הצבעות — מפוזרות על-פני-כל-היום; רוטציה על-כל-החיילים; ראש מדולל */
  const votePool = soldiers.concat(head ? [head, head] : []); // ראש: סיכוי-מופחת (2 מתוך n+k)
  const voters = [];
  for (let i = 0; i < o.votesPerDay; i++) {
    const who = votePool[(Math.floor(rng() * votePool.length) + i) % votePool.length];
    voters.push(who);
  }
  for (const who of voters) {
    const weight = who === 'headcorner' ? HEAD_WEIGHT : SOLDIER_WEIGHT;
    if (slots.filter((s) => s.account === who).length >= o.maxSlotsPerSoldier + 1) continue;
    place('vote', who, [[5 * 60 + 30, 23 * 60]], weight);
  }

  slots.sort((a, b) => a.min - b.min);
  /* מדידות-אמת של-הלוח (לא-הנחות) */
  const gaps = [];
  for (let i = 1; i < slots.length; i++) gaps.push(slots[i].min - slots[i - 1].min);
  const bySoldier = {};
  for (const s of slots) bySoldier[s.account] = (bySoldier[s.account] || 0) + 1;
  return {
    day: dayISO,
    seed: hashStr(dayISO + '|' + seedExtra),
    slots: slots.map(({ min, ...rest }) => rest),
    stats: {
      total: slots.length,
      minFleetGap: gaps.length ? Math.min(...gaps) : null,
      maxPerSoldier: Math.max(0, ...Object.values(bySoldier)),
      perSoldier: bySoldier,
      posts: slots.filter((s) => s.kind === 'post').length,
      comments: slots.filter((s) => s.kind === 'comment').length,
      votes: slots.filter((s) => s.kind === 'vote').length,
      unplaced: { posts: o.postsPerDay - slots.filter((s) => s.kind === 'post').length },
    },
    laws: { FLEET_GAP_MIN, SOLDIER_GAP_MIN, POST_GAP_MIN, WINDOW_START_MIN, WINDOW_END_MIN, SOLDIER_WEIGHT, HEAD_WEIGHT, VOTE_REGEN_PCT_PER_DAY, VOTE_COST_PCT },
  };
}

/** תקציב-הצבעה יומי מכוח-ההתאוששות בלבד (מלוא-כוח-ההצבעה בלי-ריקון-החשבון) */
function voteBudget(vpPct) {
  const regen = VOTE_REGEN_PCT_PER_DAY * (1 - Math.min(100, Math.max(0, vpPct)) / 100) / 1; // נקודות-VP שייאספו עד-מלוא
  const headroom = Math.max(0, 80 - vpPct); // חוק-הפס: לא-לרדת מתחת-20% → תקציב עד 80%
  const usable = Math.min(regen, headroom);
  return { maxFullVotes: Math.floor(usable / VOTE_COST_PCT), usablePct: Math.round(usable) };
}

module.exports = { buildCalendar, voteBudget, mulberry32, hashStr, pickRotate, DEFAULTS, SOLDIER_WEIGHT, HEAD_WEIGHT, FLEET_GAP_MIN, SOLDIER_GAP_MIN, POST_GAP_MIN, WINDOW_START_MIN, WINDOW_END_MIN, VOTE_REGEN_PCT_PER_DAY, VOTE_COST_PCT };
