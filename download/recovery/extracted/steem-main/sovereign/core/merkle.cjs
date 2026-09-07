#!/usr/bin/env node
/* merkle.cjs — WEAVE (W1): עץ-מרקל קנוני לאריגת-חותמות של SAOS-NET.
 *
 * עץ טהור מעל מחרוזות-hex בלבד — ללא תלות בקרנל (הקרנל מחשב עלים עם canon-שלו
 * ומעביר לכאן עלים-מוכנים). חוקי-העץ קבועים:
 *   · על בודד: root = העל עצמו, נתיב = []
 *   · מפלג-אי-זוגי: העלה-האחרון מוכפל (Bitcoin-style) — דטרמיניסטי
 *   · צומת פנימי: sha256(left ‖ right) — concat של hex-מחרוזות גולמיות
 *   · נתיב: רשימת אחים {pos:'L'|'R', h} מהעלה עד-השורש
 * הוכחה של hash בודד = נתיב ~1KB מול root שנעוגן על השרשראות.
 *
 * self-test: --selftest מאמת odd/even/single + הוכחות + שחיתות-נתפסת.
 */
'use strict';
const crypto = require('crypto');
const sha256s = (s) => crypto.createHash('sha256').update(s).digest('hex');

/* בניית עץ מרקל מעל עלים-hex. מחזיר { levels, root } או null לקלט-ריק. */
function buildTree(leaves) {
  if (!Array.isArray(leaves) || leaves.length === 0) return null;
  if (!leaves.every((l) => /^[0-9a-f]{64}$/.test(l))) throw new Error('bad-leaf');
  const levels = [leaves.slice()];
  let cur = leaves.slice();
  while (cur.length > 1) {
    if (cur.length % 2 === 1) cur = cur.concat(cur[cur.length - 1]); // כפילות-אחרון (קבוע)
    const next = [];
    for (let i = 0; i < cur.length; i += 2) next.push(sha256s(cur[i] + cur[i + 1]));
    levels.push(next);
    cur = next;
  }
  return { levels, root: cur[0] };
}

/* נתיב-הוכחה לעלה index — [{pos:'L'|'R', h}] מהעלה עד-השורש. */
function prove(levels, index) {
  if (!levels || !Array.isArray(levels) || !levels.length) throw new Error('no-tree');
  const n0 = levels[0].length;
  if (!Number.isInteger(index) || index < 0 || index >= n0) throw new Error('bad-index');
  const path = [];
  let idx = index;
  for (let d = 0; d < levels.length - 1; d++) {
    const lvl = levels[d];
    const isOdd = lvl.length % 2 === 1;
    const last = lvl.length - 1;
    let sibIdx, sibH;
    if (idx === last && isOdd) { sibIdx = idx; sibH = lvl[idx]; } // האח = עצמו (כפילות)
    else sibIdx = idx % 2 === 0 ? idx + 1 : idx - 1, sibH = lvl[sibIdx];
    const right = sibIdx > idx || (sibIdx === idx);
    path.push({ pos: right ? 'R' : 'L', h: sibH });
    idx = idx >> 1;
  }
  return path;
}

/* אימות עלה מול נתיב ושורש — הפונקציה שמאמתת-עצמאית בלי להחזיק את העץ. */
function verify(leaf, path, root) {
  if (!/^[0-9a-f]{64}$/.test(leaf) || !/^[0-9a-f]{64}$/.test(root)) return false;
  if (!Array.isArray(path)) return false;
  let cur = leaf;
  for (const step of path) {
    if (!step || (step.pos !== 'L' && step.pos !== 'R')) return false;
    if (!/^[0-9a-f]{64}$/.test(step.h)) return false;
    cur = step.pos === 'L' ? sha256s(step.h + cur) : sha256s(cur + step.h);
  }
  return cur === root;
}

/* עזר: שורש-בלבד */
function rootOf(leaves) { const t = buildTree(leaves); return t ? t.root : null; }

/* ── self-test: וקטורים קבועים — odd/even/single/הוכחות/שחיתות ── */
function selfTest() {
  const leaves = [];
  for (let i = 0; i < 7; i++) leaves.push(sha256s('weave-leaf-' + i)); // 7 = מפלג-אי-זוגי
  const t = buildTree(leaves);
  // אימות-ידני של fold אי-הזוגי: l0..l6 → (0,1)(2,3)(4,5)(6,6) → (A,B) → root
  const p = (a, b) => sha256s(a + b);
  const L = leaves;
  const A = p(p(L[0], L[1]), p(L[2], L[3]));
  const B = p(p(L[4], L[5]), p(L[6], L[6]));
  const manualRoot = p(A, B);
  const allProofs = [];
  let allOk = true;
  for (let i = 0; i < 7; i++) {
    const path = prove(t.levels, i);
    const ok = verify(L[i], path, t.root);
    allProofs.push({ i, ok, len: path.length });
    if (!ok) allOk = false;
  }
  const corrupt = verify(L[0], prove(t.levels, 1), t.root); // נתיב-שגוי → חייב-false
  const single = buildTree([L[0]]);
  const singleOk = single.root === L[0] && prove(single.levels, 0).length === 0 && verify(L[0], [], L[0]);
  const empty = buildTree([]);
  const even = buildTree(L.slice(0, 4));
  const evenOk = verify(L[3], prove(even.levels, 3), even.root);
  return {
    root: t.root, manualRoot, rootMatchesManual: t.root === manualRoot,
    allProofsOk: allOk, proofs: allProofs, corruptCaught: !corrupt,
    singleOk, emptyNull: empty === null, evenOk,
  };
}

module.exports = { buildTree, prove, verify, rootOf, selfTest };

if (require.main === module) {
  if (process.argv.includes('--selftest')) {
    const t = selfTest();
    console.log('merkle vectors: ' + (t.rootMatchesManual && t.allProofsOk && t.corruptCaught && t.singleOk && t.emptyNull && t.evenOk ? 'OK' : 'BROKEN'));
    console.log('root(7,odd):', t.root);
    console.log('manual-fold-match:', t.rootMatchesManual, '· all-proofs:', t.allProofsOk, '· corrupt-caught:', t.corruptCaught, '· single:', t.singleOk, '· even:', t.evenOk, '· empty-null:', t.emptyNull);
    if (!(t.rootMatchesManual && t.allProofsOk && t.corruptCaught && t.singleOk && t.emptyNull && t.evenOk)) process.exit(1);
  } else {
    console.log('merkle.cjs — WEAVE canonical merkle. usage: --selftest');
  }
}
