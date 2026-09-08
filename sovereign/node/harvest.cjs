#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 * 111 — THE-HARVEST (קציר-האנרגיה) · שכבת-הפקת-הערך של הרשת-החופשית
 *
 * השאלה-של-המשתמש (111): ״יש טרנזקציה, יש אנרגיה שמתבזבזת, מישהו משלם עליה —
 * אנרגיה עוברת אם אנחנו מעורבים בה. איך הופכים כל-טרנזקציה-שיש-בה-ערך
 * ומשלבים אותה במערכות-שלנו כדי להנות מהפירות? איך מרוויחים משחרור-האנרגיה?״
 *
 * התשובה — ארבעה-זרמי-קציר, כולם מוכרים-על-הספר (קרנל-111: harvest/harvest_release):
 *
 *   S1 · pools  — עמלות-30bps של בריכות-הדקס זורמות-לאוצר; הדימון מזהה-את-הדלתא
 *                 מול-מצביע-קורסור ומזריק הכרה (ref = גובה+מדידה).
 *   S2 · grid   — הכנסות-העמלות של-הגריד (feeIncomeµ) — אותו-מנגנון-דלתא.
 *   S3 · rail   — מסילת-הזרמות-חוצה: transfer אמת אל-headcorner עם memo
 *                 "saos:harvest/v1" · מדיניות-מוצהרת 0.001 STEEM = 1 SAOS (1000µ)
 *                 · הסריקה קוראת-את-ההיסטוריה-האמתית (דפדוף-אחורה, עמוד ≤100 —
 *                 הלקח-המדוד מ-W22 של-האח) · כל-txid נספר-פעם-אחת (קרנל: dedupe).
 *   S4 · doors  — עמלות-השירות של-דלתות-v:3 מוכרות-אוטומטית-בתוך-הקרנל
 *                 (relay_ack) — אין-יד-חיצונית, אפס-אמון.
 *
 * גלגל-החוזר (release): כש-המאגר חוצה-רצפה — שחרור-אוטומטי-חלקי לעבודת-הרשת
 * (writer-reward לחיילים-המאמתים) — הפירות-נהנים, מוגבל-קשיח-במאגר (הקרנל אוכף).
 *
 * פקודות:
 *   status — לוח-הקציר החי · once — סריקה+הכרה+שחרור · watch — לולאה 90ש׳
 *   topup  — הזרמה-אמת: transfer מחשבון-צבא-עשיר אל-headcorner עם-הממו (דמו-מסילה)
 *
 * דיסציפלינה: אותו-נעילה/קרנל של-הצומת (saosnet --inject) · כותב-יחיד
 * (הלקח-מ-110b) · הלוג harvest.log · מפתחות-לא-עוזבים-את-המכונה.
 * ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
require('dns').setDefaultResultOrder('ipv4first');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const ROOT = path.join(HERE, '..', '..');
const SNAPSHOT = path.join(HERE, 'state-snapshot.json');
const NODESTATE = path.join(HERE, 'state.json');
const GRIDSTATE = path.join(HERE, 'grid98-state.json');
const CURSOR = path.join(HERE, 'harvest-cursor.json');
const HLOG = path.join(HERE, 'harvest.log');
const TICK = 90000;

const S = require(path.join(HERE, 'saosnet.cjs'));
const ACCOUNT = S.ACCOUNT; // 'headcorner' — מפעיל-הצומת
const steem = require(path.join(ROOT, 'node_modules', 'steem'));

/* מדיניות-מוצהרת (על-המסך, לא-נסתרת) */
const POLICY = {
  railSteemPerSaos: 0.001,          // 0.001 STEEM = 1 SAOS
  memoTag: 'saos:harvest/v1',
  releaseFloorµ: 2000,              // מתחת-לזה-המאגר-נח
  releaseSharePct: 50,              // שחרור-חצי-מהמאגר-מעל-הרצפה
  releaseMinµ: 1000,                // לא-משחררים-פחות-מ-1-SAOS
  roster: ['wog', 'siq', 'wic', 'macrame', 'woq', 'lsa', 'tov', 'haran'], // סבב-חיילים (לוח-הגריד)
};

const dlog = (m) => {
  const line = '[' + new Date().toISOString() + '] ' + m;
  try { fs.appendFileSync(HLOG, line + '\n'); } catch (_) {}
  console.log(line);
};

/* ── קורסור (מצביעי-הכרה) — קובץ-קטן, כתיבה-אטומית ── */
function loadCursor() {
  try { return JSON.parse(fs.readFileSync(CURSOR, 'utf8')); } catch (_) { return { feesTotalµ: null, gridFeeµ: null, railSeen: {}, releases: 0, railCredited: 0 }; }
}
function saveCursor(c) {
  const t = CURSOR + '.tmp';
  fs.writeFileSync(t, JSON.stringify(c));
  fs.renameSync(t, CURSOR);
}

/* ── זריקת-פקודות דרך-שער-הצומת (אותו-קרנל, אותו-נעילה; 4-ניסיונות על-מנעול-עמוס)
 * מחזיר {done, rejected}: done = INJECT-DONE · rejected = הקרנל-דחה-פקודה
 * (הלקח-מ-111-חי: INJECT-DONE מודפס-גם-על-בלוק-עם-REJECT — הקוצר-חייב-לדעת-להבדיל) ── */
function inject(txs, tag) {
  const f = path.join(HERE, 'inject-harvest-' + Date.now() + '.json');
  fs.writeFileSync(f, JSON.stringify(txs));
  const sleepSync = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (_) {} };
  let out = '', done = false, skipped = false, rejected = false;
  for (let a = 0; a < 4 && !done; a++) {
    if (a > 0) sleepSync(4000);
    const r = spawnSync('node', [path.join(HERE, 'saosnet.cjs'), '--inject', f], { cwd: HERE, encoding: 'utf8', timeout: 120000 });
    out = (r.stdout || '') + (r.stderr || '');
    done = /INJECT DONE/.test(out);
    skipped = /SKIPPED/.test(out);
    rejected = /REJECT/.test(out);
    if (done || !skipped) break;
  }
  try { fs.unlinkSync(f); } catch (_) {}
  const rej = (out.split('\n').filter((l) => /REJECT/.test(l)).slice(0, 2).join(' | ')) || 'clean';
  dlog('inject[' + tag + '] ' + (done ? (rejected ? 'APPLIED-WITH-REJECT' : 'OK') : skipped ? 'LOCK-BUSY(4 tries)' : 'FAIL') + ' :: ' + rej);
  return { done, rejected };
}

/* ── S1+S2 · הכרת-דלתאות-עמלות (בריכות+גריד) ── */
function recognizeFees() {
  const cur = loadCursor();
  const txs = [];
  try {
    const node = JSON.parse(fs.readFileSync(NODESTATE, 'utf8'));
    const feesTotalµ = Number((node.book && node.book.feesµ) || 0);
    if (cur.feesTotalµ != null && feesTotalµ > cur.feesTotalµ) {
      const d = feesTotalµ - cur.feesTotalµ;
      if (d > 0) txs.push({ type: 'harvest', by: ACCOUNT, stream: 'pools', amountµ: d, ref: 'pools:h' + node.height + ':' + feesTotalµ });
    }
    cur.feesTotalµ = feesTotalµ;
  } catch (_) { /* כנות: אין-מצב-צומת */ }
  try {
    const g = JSON.parse(fs.readFileSync(GRIDSTATE, 'utf8'));
    const gridFeeµ = Number(g.feeIncomeµ || 0);
    if (cur.gridFeeµ != null && gridFeeµ > cur.gridFeeµ) {
      const d = gridFeeµ - cur.gridFeeµ;
      if (d > 0) txs.push({ type: 'harvest', by: ACCOUNT, stream: 'grid', amountµ: d, ref: 'grid:h' + (g.height || 0) + ':' + gridFeeµ });
    }
    cur.gridFeeµ = gridFeeµ;
  } catch (_) { /* כנות: אין-מצב-גריד */ }
  if (txs.length) {
    const r = inject(txs, 'fees:' + txs.map((t) => t.stream + ':' + t.amountµ).join('+'));
    if (r.done && !r.rejected) saveCursor(cur); // דחייה-קרנל → לא-מתקדמים-בקורסור (הפנים-משתפר-לבד)
  } else saveCursor(cur);
  return txs.length;
}

/* ── S3 · סריקת-מסילת-ההזרמות (memo saos:harvest/v1) ── */
function parseAmount(a) { const n = parseFloat(String(a || '').split(' ')[0] || '0'); return Number.isFinite(n) ? n : 0; }

async function railScan() {
  const cur = loadCursor();
  const credited = [];
  // הלקח-המדוד-חי (111): צמתי-STEEM מאוזני-עומס — אותו-שם-מחזיר-חלונות-שונים
  // (אחד-החזיר 48149-48249 בזמן-שההעברה-שלנו-ב-48252). פתרון: שאילתא-לשני-הצמתים
  // ומיזוג-יוניון — כל-txid-נספר-פעם-אחת (הקרנל dedupe קשיח; הקורסור רק-נימוס).
  let start = -1;
  for (let page = 0; page < 3; page++) {
    const windows = await Promise.all(['https://api.steemit.com', 'https://api.justyy.com'].map(async (url) => {
      try {
        const res = await fetch(url, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'condenser_api.get_account_history', params: [ACCOUNT, start, 100], id: 1 }),
          signal: AbortSignal.timeout(12000),
        });
        const j = await res.json();
        return (j.result && j.result.length) ? j.result : [];
      } catch (_) { return []; }
    }));
    const merged = new Map();
    for (const w of windows) for (const ent of w) if (ent && ent[1] && ent[1].trx_id) merged.set(ent[1].trx_id, ent[1]);
    if (!merged.size) break;
    for (const [, e] of merged) {
      const [type, v] = e && e.op ? e.op : [];
      if (type !== 'transfer' || !v || v.to !== ACCOUNT) continue;
      if (!String(v.memo || '').includes(POLICY.memoTag)) continue;
      const txid = e.trx_id;
      if (!txid || cur.railSeen[txid]) continue;
      const steemAmt = parseAmount(v.amount);
      const amountµ = Math.round(steemAmt / POLICY.railSteemPerSaos) * 1000; // 0.001 STEEM → 1000µ
      if (!(amountµ > 0)) continue;
      const r = inject([{ type: 'harvest', by: ACCOUNT, stream: 'rail', amountµ, ref: txid }], 'rail:' + txid.slice(0, 10));
      cur.railSeen[txid] = (r.done && !r.rejected) ? 1 : -1;
      if (r.done && !r.rejected) { credited.push({ txid, from: v.from, steemAmt, amountµ }); cur.railCredited += amountµ; }
    }
    let oldest = Infinity;
    for (const w of windows) if (w.length && typeof w[0][0] === 'number') oldest = Math.min(oldest, w[0][0]);
    if (!Number.isFinite(oldest) || oldest <= 1) break;
    start = oldest - 1;
  }
  const seenKeys = Object.keys(cur.railSeen);
  if (seenKeys.length > 400) { // חיתוך-קורסור (הקרנל-עצמו dedupe קשיח — כאן-רק-נימוס)
    for (const k of seenKeys.slice(0, seenKeys.length - 200)) delete cur.railSeen[k];
  }
  saveCursor(cur);
  /* נתיב-2 (מהוכח-חי-111): אינדוקס-`account_history` מתנדנד-בצמתים (אותו-חלון-ישן
   * מוחזר-גם-אחרי-שהטרנז-אושר). עבור-הזרמות-שאנחנו-ביצענו-בעצמנו — היומן שלנו
   * מכיל-את-ה-txid; מאמתים-כל-אחד-ישירות-מול-השרשרת (get_transaction: from→אוצר,
   * סכום, ממו) — הוכחה-ישירה חזקה-מחלון-היסטוריה. הזרמות-חיצוניות ממשיכות-דרך
   * נתיב-1 (סריקת-היסטוריה) כשהאינדוקס מתיישב. */
  const direct = await railDirect();
  for (const d of direct) credited.push(d);
  return credited;
}

async function railDirect() {
  const cur = loadCursor();
  const credited = [];
  let lines = [];
  try { lines = fs.readFileSync(HLOG, 'utf8').split('\n'); } catch (_) { return credited; }
  const txids = new Set();
  for (const l of lines) {
    const m = l.match(/RAIL-TOPUP ✓ [0-9.]+ STEEM @(\S+) → @\S+ txid=([0-9a-f]{40})/);
    if (m) txids.add(m[2]);
  }
  for (const txid of txids) {
    if (cur.railSeen[txid] === 1) continue;
    let tx = null;
    for (const url of ['https://api.steemit.com', 'https://api.justyy.com']) {
      try {
        const res = await fetch(url, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'condenser_api.get_transaction', params: [txid], id: 1 }),
          signal: AbortSignal.timeout(12000),
        });
        const j = await res.json();
        if (j.result) { tx = j.result; break; }
      } catch (_) { /* צומת-הבא */ }
    }
    if (!tx || !Array.isArray(tx.operations)) { dlog('rail-direct: txid ' + txid.slice(0, 12) + ' עדיין-לא-נצפה (אינדוקס) — מושאר-למעבר-הבא'); continue; }
    let ok = false;
    for (const [type, v] of tx.operations) {
      if (type !== 'transfer' || !v || v.to !== ACCOUNT) continue;
      if (!String(v.memo || '').includes(POLICY.memoTag)) continue;
      const steemAmt = parseAmount(v.amount);
      const amountµ = Math.round(steemAmt / POLICY.railSteemPerSaos) * 1000;
      if (!(amountµ > 0)) continue;
      const r = inject([{ type: 'harvest', by: ACCOUNT, stream: 'rail', amountµ, ref: txid }], 'rail-direct:' + txid.slice(0, 10));
      ok = r.done && !r.rejected;
      if (ok) {
        credited.push({ txid, from: v.from, steemAmt, amountµ });
        cur.railCredited += amountµ;
        dlog('RAIL-DIRECT ✓ ' + steemAmt + ' STEEM @' + v.from + ' אומת-ישירות-מהשרשרת → הכרה ' + amountµ + 'µ (pot)');
      }
      break;
    }
    cur.railSeen[txid] = ok ? 1 : -1;
  }
  saveCursor(cur); // תמיד-שומר — ה-shadowing-של-111-החי: קורסור-הנתיב-הישיר-הוא-הקורסור-האמת
  return credited;
}

/* ── גלגל-החוזר · שחרור-אוטומטי לעבודת-הרשת ── */
function flywheel() {
  const snap = readSnapshot();
  if (!snap) return null;
  const H = snap.st.harvest;
  if (!H || !(H.potµ >= POLICY.releaseFloorµ)) return null;
  const amt = Math.max(POLICY.releaseMinµ, Math.floor(H.potµ * POLICY.releaseSharePct / 100));
  if (amt > H.potµ) return null;
  const cur = loadCursor();
  const to = POLICY.roster[cur.releases % POLICY.roster.length];
  const ref = 'fly:h' + (snap.st.meta.height || 0) + ':n' + cur.releases;
  const r = inject([{ type: 'harvest_release', by: ACCOUNT, purpose: 'writer-reward', to, amountµ: amt, ref }], 'fly:' + to + ':' + amt);
  if (r.done && !r.rejected) { cur.releases++; saveCursor(cur); dlog('FLYWHEEL ✓ ' + amt + 'µ → @' + to + ' (writer-reward, pot ' + (H.potµ - amt) + 'µ)'); return { to, amt }; }
  return null;
}

/* ── דמו-מסילה · הזרמה-אמת מחשבון-צבא (מפתח-active לא-עוזב-את-המכונה) ── */
async function topup(amountSteem) {
  const amt = Number(amountSteem) > 0 ? Number(amountSteem) : 0.001;
  let vault = null;
  try { vault = JSON.parse(fs.readFileSync(path.join(ROOT, 'agent', 'keys', 'vault.json'), 'utf8')); } catch (_) { return dlog('topup: vault-unreadable (כנות)'); }
  const cands = (vault.accounts || [])
    .map((a) => ({ username: a.username, wif: a.keys && a.keys.active && a.keys.active.wif }))
    .filter((a) => a.username && a.wif && a.username !== ACCOUNT);
  if (!cands.length) return dlog('topup: אין-מפתחות-active בצבא (כנות)');
  let accs = [];
  for (const url of ['https://api.steemit.com', 'https://api.justyy.com']) {
    try {
      const res = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [cands.map((c) => c.username)], id: 1 }),
        signal: AbortSignal.timeout(12000),
      });
      const j = await res.json();
      if (j.result) { accs = j.result; break; }
    } catch (_) {}
  }
  const rich = accs
    .map((a) => ({ name: a.name, liquid: parseAmount(a.balance) }))
    .sort((a, b) => b.liquid - a.liquid)
    .find((a) => a.liquid >= amt * 2);
  if (!rich) return dlog('topup: אף-חשבון-צבא-אינו-מממן (יתרה < 2×הסכום) — כנות');
  const payer = cands.find((c) => c.username === rich.name);
  const memo = JSON.stringify({ protocol: POLICY.memoTag, saos: Math.round(amt / POLICY.railSteemPerSaos), note: 'rail topup — real value into the free network (111)' });
  const op = ['transfer', { from: payer.username, to: ACCOUNT, amount: amt.toFixed(3) + ' STEEM', memo }];
  try {
    /* אותו-נתיב-מוכח כמו-doorSteem: הספרייה בונה-את-הטרנזקציה (dgp/ref_block) בפנים */
    const conf = await steem.broadcast.sendAsync({ operations: [op], extensions: [] }, [payer.wif]);
    const txid = conf && conf.id;
    if (!txid) return dlog('topup: broadcast-ללא-txid (כנות)');
    dlog('RAIL-TOPUP ✓ ' + amt + ' STEEM @' + payer.username + ' → @' + ACCOUNT + ' txid=' + txid + ' (memo ' + POLICY.memoTag + ') — rail scan יכיר-בו-במעבר-הבא');
    return { txid, from: payer.username };
  } catch (e) {
    return dlog('topup: sign/broadcast-FAILED :: ' + String(e.message || e).slice(0, 140));
  }
}

/* ── לוח-מצב ── */
function readSnapshot() {
  try {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const st = snap.st || {};
    return { snap, st, harvest: st.harvest || null, height: (st.meta && st.meta.height) || 0, issuer: String(st.meta && st.meta.issuer || '') };
  } catch (_) { return null; }
}

function status() {
  const s = readSnapshot();
  if (!s) return dlog('status: snapshot-unreadable (כנות)');
  const cur = loadCursor();
  const H = s.harvest;
  const node = (() => { try { return JSON.parse(fs.readFileSync(NODESTATE, 'utf8')); } catch (_) { return null; } })();
  const g = (() => { try { return JSON.parse(fs.readFileSync(GRIDSTATE, 'utf8')); } catch (_) { return null; } })();
  dlog('status · h=' + s.height + ' · pot=' + (H ? H.potµ : 0) + 'µ · byStream=' + JSON.stringify(H ? H.byStream : {}) +
    ' · released=' + (H ? (H.releasedµ || 0) : 0) + 'µ · releases=' + (H && H.releases ? H.releases.length : 0) +
    ' · cursor{pools=' + cur.feesTotalµ + ',grid=' + cur.gridFeeµ + ',releases=' + cur.releases + ',railCredited=' + cur.railCredited + 'µ}' +
    ' · live-cursors{book.feesµ=' + (node && node.book ? node.book.feesµ : '?') + ',grid.feeIncomeµ=' + (g ? g.feeIncomeµ : '?') + '}');
}

/* ── משמעת-כותב-יחיד (הלקח-מ-110b): פקודה-ידנית-מסרבת-לרוץ-במקביל-ל-watch-חי ──
 * 117j-תיקון-עצמי: pgrep -f 'harvest.cjs' היה-מתאים-גם-למעטפת-sh-שלעצמו
 * (sh -c "pgrep -f 'harvest.cjs'" מכיל-את-המחרוזת) → pid-זר-חדש-בכל-פעימה
 * → watch-מעולם-לא-ביצע-pass-אחד-אמת (נמדד: "כותב-אחר-חי" כל-90ש׳ מאז-העלאה).
 * התיקון: טריק-הסוגריים [h] — הרגקס-מוצא-'harvest.cjs'-אמת-בלבד, והמעטפת-עצמה
 * מכילה-'[h]arvest.cjs'-מילולי-שאינו-נתפס. דיסציפלינת-הכותב-היחיד-נשמרת-במלואה:
 * 'once'-ידני שמופעל-מקרן-ה-guardian עדיין-רואה-את-watch-האמת ונסוג-כנות. */
function singleWriter(who) {
  try {
    const { execSync } = require('child_process');
    const out = execSync("pgrep -f '[h]arvest\\.cjs' || true", { encoding: 'utf8' });
    const pids = out.split('\n').map((s) => Number(s.trim())).filter((n) => n && n !== process.pid);
    if (pids.length) { dlog(who + ': כותב-אחר-חי (pid ' + pids.join(',') + ') — נסוג (משמעת-כותב-יחיד)'); return false; }
  } catch (_) { /* pgrep-חסר → נמשיך (הקרנל-אוכף-בכל-מקרה) */ }
  return true;
}

/* ── מעבר-אחד ── */
async function once() {
  if (!singleWriter('once')) return { f: 0, rail: [], fly: null };
  const f = recognizeFees();
  const rail = await railScan();
  const fly = flywheel();
  if (f || rail.length || fly) dlog('once: fees=' + f + ' rail=' + rail.length + ' flywheel=' + (fly ? fly.to + ':' + fly.amt : 'quiet'));
  return { f, rail, fly };
}

/* ── לולאה ── */
async function watch() {
  dlog('watch: THE-HARVEST alive · tick=' + TICK + 'ms · policy=' + JSON.stringify(POLICY));
  for (;;) {
    try { await once(); } catch (e) { dlog('watch-error(כנות): ' + String((e && e.message) || e).slice(0, 120)); }
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await sleep(TICK);
  }
}

(async () => {
  const arg = process.argv[2] || 'status';
  if (arg === 'status') return status();
  if (arg === 'once') return once();
  if (arg === 'fees') return singleWriter('fees') ? dlog('fees: recognized ' + recognizeFees()) : undefined;
  if (arg === 'rail') return singleWriter('rail') ? railScan().then((r) => dlog('rail: credited ' + r.length)) : undefined;
  if (arg === 'release') return singleWriter('release') ? dlog('release: ' + JSON.stringify(flywheel())) : undefined;
  if (arg === 'topup') return topup(process.argv[3]); // הזרמה-אמת-מותרת-תמיד — כתיבה-על-STEEM-בלבד
  if (arg === 'watch') return watch();
  dlog('usage: status|once|fees|rail|release|topup [amt]|watch');
})();
