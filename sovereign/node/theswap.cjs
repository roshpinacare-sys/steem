#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 * THE-SWAP-ONNET (Task 117c) — הסוואפ-האמת על-הרשת-שלנו
 * ─────────────────────────────────────────────────────────────────────────────
 * המנדט (המפעיל): "תנסה שיהיה לנו את המערך על הרשת שלנו — שנוכל להחזיק מטבע
 * אמיתי אחר על הרשת שלנו וגם להחליף אותו על הרשת שלנו, גם אם זה לא STEEM ·
 * ואם מגבילים אותנו דברים — מה בדיוק מגביל אותנו ריבונית · דחוף לגיטהאב".
 *
 * התשובה-הריבונית: לא עוד ספק-חוץ (ChangeNOW: מינימום-מדומה + פיזור-18% על
 * רגל-$1 + מפתח-API) — אלא הבורסה שלנו על הספר שלנו:
 *   · החזקה: WTRX ממומש 1:1 מול TRX-אמת-על-השרשרת (דלתות-הגשר הישנות —
 *     TAzZZk… 15.397448 + TRKStC5… 3.735912, נמדד-חי פה במודול הזה).
 *   · החלפה: בריכת-AMM אפס-עמלה (feeBps:0 — kernel 117c) WTRX/WSTEEM
 *     בתמחור-שוק-חי (binance TRX/STEEM) — אפס-מינימום, אפס-אנרגיה, אפס-ספק.
 *   · אמת-כנה: יחס-גיבוי מפורסם (אספקת-הספר מול TRX-אמת-נמדד) — אם-יש פער,
 *     הוא על-הדף, לא מתחת-לשטיח (כנות מעל הכל).
 *
 * פרוטוקול-קריאה-כפולה (נמדד-חי היום: קריאה-ראשונה החזירה 0-כוזב ל-TRKStC
 * בעוד-המסמך-הגולמי מראה 3,735,912-sun — TronGrid מעוות לפעמים): כל-דלת
 * נקראת פעמיים-עם-אימות-מסמך-גולמי; קריאה-חד-פעמית לא נחשבת-ראיה.
 *
 * שימוש:
 *   node theswap.cjs attest                          עדות-חיה: דלתות+מחירים+יחס-גיבוי
 *   node theswap.cjs quote --pair WTRX/WSTEEM --side A2B --in 500
 *   node theswap.cjs seed [--a 12400] [--fee 0]      זריעת-בריכה מתומחרת-שוק
 *   node theswap.cjs swap --pair WTRX/WSTEEM --side A2B --in 500 [--taker headcorner]
 *   node theswap.cjs watch                           עדות-מחזורית (10 דק׳)
 * ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const SNAPSHOT = path.join(HERE, 'state-snapshot.json');
const ATTEST_F = path.join(HERE, 'theswap-attest.json');
const STATE_F = path.join(HERE, 'theswap-state.json');
const LOG_F = path.join(HERE, 'theswap.log');
const PID_F = path.join(HERE, 'theswap-watch.pid');

const ACCOUNT = 'headcorner';
const TRONGRID = 'https://api.trongrid.io';
const BINANCE = 'https://api.binance.com';
/* דלתות-הגשר-הישנות — ה-TRX-האמת של-המערכת (המנומניק-אבד-ברולבק-115, המטבעות-על-השרשרת) */
const LEGACY_DOORS = [
  { address: 'TAzZZkrwBXk59iRya7esnKVJeV1xLtqkGr', role: 'bridge-hub(idx1)' },
  { address: 'TRKStC5HbWzqdnrWDfc4vYNfgQgyZuQKP4', role: 'bridge-relay(idx0)' },
];

const slog = (m) => { try { fs.appendFileSync(LOG_F, new Date().toISOString() + ' ' + m + '\n'); } catch (_) {} console.log(m); };
const book = () => { const s = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')); return s.st || s; };
const loadJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return d; } };
const saveAtomic = (f, o) => { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(o, null, 2)); fs.renameSync(t, f); };
const scaleOf = (st, sym) => { const m = (st.assetMeta || {})[sym]; return (m && Number.isInteger(m.bookScale) && m.bookScale >= 1) ? m.bookScale : 1000; };
const human = (st, sym, units) => units / scaleOf(st, sym);

/* ── קורא-דלתות-אמת (פרוטוקול-כפול: 2-קריאות-עקביות, מסמך-גולמי-מאומת) ──
 * נמדד-חי: תשובה-מעוותת יכולה-להחזיר data:[] גם-לחשבון-עם-יתרה (התראת-השווא-הכוזבת
 * של-היום) — לכן: data:[] היא-קריאה-תקפה-של-אפס רק-אם-הקריאה-השנייה-מסכימה;
 * אי-הסכמה → max(reads) + דגל-כנה (מעולם-לא-מעידים-על-יותר-מהאמת-בלי-דגל). */
async function readDoorSun(address) {
  const reads = [];
  for (let i = 0; i < 6 && reads.length < 2; i++) {
    try {
      const r = await fetch(TRONGRID + '/v1/accounts/' + address);
      const j = await r.json();
      if (j && Array.isArray(j.data)) {
        reads.push(j.data[0] ? (j.data[0].balance || 0) : 0); // data:[] = חשבון-שלא-הופעל = אפס-לגיטימי
        if (reads.length === 2) break;
        await sleep(1200);
      } else { await sleep(2500); } // הגבלה/תשובה-מעוותת → נסיגה
    } catch (_) { await sleep(2500); }
  }
  if (!reads.length) return { sun: null, reads, honest: 'unreadable' };
  if (reads.length === 1) return { sun: reads[0], reads, honest: 'single-read' };
  const agree = reads[0] === reads[1];
  return { sun: Math.max(reads[0], reads[1]), reads, honest: agree ? 'ok' : 'inconsistent-double-read' };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function prices() {
  const out = {};
  for (const s of ['TRXUSDT', 'STEEMUSDT', 'ETHUSDT', 'SOLUSDT']) {
    try {
      const r = await fetch(BINANCE + '/api/v3/ticker/price?symbol=' + s);
      const j = await r.json();
      if (j && j.price) out[s] = Number(j.price);
    } catch (_) {}
  }
  return out;
}

/* ── attest — עדות-החזקה-החיה ── */
async function attest() {
  const st = book();
  const px = await prices();
  const doors = [];
  for (const d of LEGACY_DOORS) {
    const r = await readDoorSun(d.address);
    doors.push({ family: 'legacy-bridge', address: d.address, role: d.role, trx: r.sun === null ? null : r.sun / 1e6, sun: r.sun, reads: r.reads, honest: r.honest });
    await sleep(600); // דיפול-קצב-מול-ההגבלות-שנמדדו
  }
  // דלתות-v2-מפורסמות (הגריד-הריבוני) — קבלה-עתידית; אפס-צפוי
  const pub = loadJson(path.join(HERE, 'wallets-public.json'), null);
  let v2Total = 0, v2NonZero = [];
  if (pub && Array.isArray(pub.agents)) {
    for (const a of pub.agents.slice(0, 12)) {
      if (!a.tron) continue;
      const r = await readDoorSun(a.tron);
      await sleep(600); // דיפול-קצב-מול-ההגבלות-שנמדדו
      if (r.sun === null) { doors.push({ family: 'grid-v2', address: a.tron, agent: a.agent, trx: null, honest: 'unreadable' }); continue; }
      v2Total += r.sun / 1e6;
      if (r.sun > 0) v2NonZero.push({ agent: a.agent, address: a.tron, trx: r.sun / 1e6 });
      doors.push({ family: 'grid-v2', address: a.tron, agent: a.agent || null, trx: r.sun / 1e6, honest: r.honest });
    }
  }
  const legacyTrx = doors.filter((d) => d.family === 'legacy-bridge').reduce((s, d) => s + (d.trx || 0), 0);
  const totalTrx = legacyTrx + v2Total;
  const supplyUnits = ((st.wrapped || {}).WTRX || {}).supply || 0;
  const supplyTrx = supplyUnits / scaleOf(st, 'WTRX');
  const doc = {
    at: new Date().toISOString(), protocol: 'double-read',
    prices: px,
    doors: doors.filter((d) => d.family === 'legacy-bridge' || d.trx > 0 || d.honest === 'unreadable'),
    v2DoorsScanned: (pub && pub.agents || []).length,
    legacyTrx: +legacyTrx.toFixed(6), v2Trx: +v2Total.toFixed(6), v2NonZero,
    totalTrx: +totalTrx.toFixed(6), totalUsd: px.TRXUSDT ? +(totalTrx * px.TRXUSDT).toFixed(4) : null,
    book: { WTRX_supply_units: supplyUnits, WTRX_supply_trx: +supplyTrx.toFixed(6) },
    backing: { ratio: supplyTrx > 0 ? +(totalTrx / supplyTrx).toFixed(4) : null, note: 'supply מול TRX-אמת-נמדד — פער-מורשת-ct94/95+דלתות-נעולות, מפורסם-בכנות (docs/117-LIMITS.md)' },
  };
  saveAtomic(ATTEST_F, doc);
  const state = loadJson(STATE_F, { startedAt: new Date().toISOString(), attests: [], seeded: [], swaps: [] });
  state.lastAttest = doc.at;
  state.attests = [{ at: doc.at, totalTrx: doc.totalTrx, totalUsd: doc.totalUsd, backing: doc.backing.ratio, honest: doors.some((d) => d.honest !== 'ok' && d.family === 'legacy-bridge') ? 'flagged' : 'ok' }].concat(state.attests || []).slice(0, 30);
  saveAtomic(STATE_F, state);
  slog('attest: legacy=' + doc.legacyTrx + ' TRX · v2=' + doc.v2Trx + ' · total=' + doc.totalTrx + ' ($' + doc.totalUsd + ') · backing=' + doc.backing.ratio);
  return doc;
}

/* ── quote — מתמטיקת-AMM טהורה מהספר ── */
function quote(pair, side, inAmt) {
  const st = book();
  const p = (st.poolsX || {})[pair];
  if (!p) return { ok: false, err: 'no-pair' };
  if (!(p.a > 0) || !(p.b > 0)) return { ok: false, err: 'empty-pool' };
  const s = side === 'A2B' ? 'A2B' : side === 'B2A' ? 'B2A' : null;
  if (!s) return { ok: false, err: 'bad-side' };
  const inU = Math.floor(Number(inAmt)); // יחידות-ספר (µ לסמלי-µ) — אותו-חוזה כמו-swap
  if (!(inU > 0)) return { ok: false, err: 'amount' };
  const inRes = s === 'A2B' ? p.a : p.b, outRes = s === 'A2B' ? p.b : p.a;
  const fee = Math.floor(inU * p.feeBps / 10000);
  const net = inU - fee;
  const out = Math.floor(net * outRes / (inRes + net));
  const A = p.symA, B = p.symB;
  const inSym = s === 'A2B' ? A : B, outSym = s === 'A2B' ? B : A;
  const scA = scaleOf(st, A), scB = scaleOf(st, B);
  // מחיר = outSym-ליחידת-inSym (יחס-עתודות) · הפרש-המחיר-הכנה = עלות-הביצוע-בפועל
  const px0 = outRes / inRes;
  const px1 = outRes > out ? (outRes - out) / (inRes + net) : null;
  return {
    ok: true, pair, side: s, feeBps: p.feeBps,
    in: { sym: inSym, units: inU, human: inU / (s === 'A2B' ? scA : scB) },
    out: { sym: outSym, units: out, human: out / (s === 'A2B' ? scB : scA) },
    reserves: { A: { sym: A, units: p.a, human: p.a / scA }, B: { sym: B, units: p.b, human: p.b / scB } },
    priceBefore: +px0.toFixed(6), priceAfter: px1 !== null ? +px1.toFixed(6) : null,
    impactPct: px1 !== null ? +((1 - px1 / px0) * 100).toFixed(3) : null,
    cap: Math.floor(inRes * 0.3), capOk: inU <= Math.floor(inRes * 0.3),
  };
}

/* ── inject — אותו-שער-כמו-הכל (DONE/REJECT · נעילה-עמוסה → ניסיון-חוזה) ── */
function inject(txs, tag) {
  const f = path.join(HERE, 'inject-theswap-' + Date.now() + '.json');
  fs.writeFileSync(f, JSON.stringify(txs));
  let out = '';
  for (let a = 0; a < 12; a++) {
    const r = spawnSync('node', [path.join(HERE, 'saosnet.cjs'), '--inject', f], { cwd: HERE, encoding: 'utf8', timeout: 150000 });
    out = (r.stdout || '') + '\n' + (r.stderr || '');
    if (/INJECT DONE/.test(out)) break;
    if (/LOCK-BUSY|beat lock held/.test(out) && a < 11) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20000); continue; }
    break;
  }
  try { fs.unlinkSync(f); } catch (_) {}
  const done = /INJECT DONE/.test(out);
  const rejected = (out.match(/REJECT[^\n]*/g) || []).join(' | ').slice(0, 300);
  slog('inject[' + tag + '] ' + (done ? (rejected ? 'APPLIED-WITH-REJECT' : 'OK') : 'FAIL') + (rejected ? ' :: ' + rejected : ''));
  return { done, rejected };
}

function recordState(mut) {
  const state = loadJson(STATE_F, { startedAt: new Date().toISOString(), attests: [], seeded: [], swaps: [] });
  mut(state);
  saveAtomic(STATE_F, state);
  return state;
}

/* ── seed — זריעת-בריכה-אפס-עמלה מתומחרת-שוק-חי ── */
async function seed(args) {
  const st = book();
  const me = (st.accounts || {})[ACCOUNT] || { wrapped: {} };
  const px = await prices();
  if (!px.TRXUSDT || !px.STEEMUSDT) return slog('seed BLOCKED — live prices unavailable (need TRXUSDT+STEEMUSDT)');
  const pair = args.pair || 'WTRX/WSTEEM';
  const [A, B] = pair.split('/');
  if ((st.poolsX || {})[pair]) return slog('seed BLOCKED — pool exists: ' + pair + ' (use swap; הבריכה-כבר-חיה)');
  const balA = A === 'SAOS' ? (me.saos || 0) : A === 'STEEM' ? (me.steem || 0) : ((me.wrapped || {})[A] || 0);
  const balB = B === 'SAOS' ? (me.saos || 0) : B === 'STEEM' ? (me.steem || 0) : ((me.wrapped || {})[B] || 0);
  const fee = Number.isInteger(+args.fee) ? +args.fee : 0;
  let aU = args.a != null ? Math.round(+args.a) : Math.floor(balA * 0.999); // ברירת-מחדל: כמעט-הכל (רזרבה-אבק)
  // צד-B מתומחר-שוק-חי: ערך-דולרי-זהה לצד-A (ברירת-מחדל), או-ידני
  const usdA = args.a != null ? (aU / scaleOf(st, A)) * (A === 'WTRX' ? px.TRXUSDT : A === 'WSTEEM' ? px.STEEMUSDT : 0) : (balA / scaleOf(st, A)) * (A === 'WTRX' ? px.TRXUSDT : 0);
  const priceB = B === 'WSTEEM' ? px.STEEMUSDT : B === 'WTRX' ? px.TRXUSDT : null;
  if (!priceB) return slog('seed BLOCKED — no live price for ' + B);
  let bU = args.b != null ? Math.round(+args.b) : Math.floor((usdA / priceB) * scaleOf(st, B));
  if (!(aU > 0) || !(bU > 0)) return slog('seed BLOCKED — amounts: a=' + aU + ' b=' + bU);
  if (balA < aU || balB < bU) return slog('seed BLOCKED — balances: ' + A + '=' + balA + '/' + aU + ' · ' + B + '=' + balB + '/' + bU);
  const tx = { type: 'pool_xAdd', owner: ACCOUNT, pair, amountA: aU, amountB: bU, feeBps: fee, raw: true, at: new Date().toISOString() }; // raw=true — יחידות-ספר-גולמיות (117c)
  slog('seed: ' + pair + ' a=' + aU + ' b=' + bU + ' feeBps=' + fee + ' (market: TRX=$' + px.TRXUSDT + ' STEEM=$' + px.STEEMUSDT + ')');
  const r = inject([tx], 'seed:' + pair);
  if (r.done) {
    recordState((s) => s.seeded = (s.seeded || []).concat([{ at: tx.at, pair, aU, bU, feeBps: fee, prices: { TRX: px.TRXUSDT, STEEM: px.STEEMUSDT } }]));
  }
  return r;
}

/* ── swap — ההחלפה-האמת על-הרשת (מוגן: cap 30%-מעתודת-הכניסה) ── */
function swap(args) {
  const pair = args.pair, side = args.side, taker = (args.taker || ACCOUNT).toLowerCase();
  const inAmt = Number(args.in);
  const q = quote(pair, side, inAmt);
  if (!q.ok) return slog('swap BLOCKED — ' + q.err);
  if (!q.capOk) return slog('swap BLOCKED — cap-30%: in=' + q.in.units + ' > cap=' + q.cap + ' (מגן-מחיר-הבריכה)');
  const st = book();
  const me = (st.accounts || {})[taker];
  if (!me) return slog('swap BLOCKED — taker not on book: ' + taker);
  const balOf = (sym) => sym === 'SAOS' ? (me.saos || 0) : sym === 'STEEM' ? (me.steem || 0) : ((me.wrapped || {})[sym] || 0);
  if (balOf(q.in.sym) < q.in.units) return slog('swap BLOCKED — taker ' + taker + ' ' + q.in.sym + '=' + balOf(q.in.sym) + ' < ' + q.in.units);
  const tx = { type: 'pool_x', pair, side: q.side, inAmt: q.in.units, taker, raw: true, at: new Date().toISOString() }; // raw=true — יחידות-ספר-גולמיות (117c)
  slog('swap: ' + taker + ' ' + q.in.human + ' ' + q.in.sym + ' → ' + q.out.human + ' ' + q.out.sym + ' (feeBps=' + q.feeBps + ', impact=' + q.impactPct + '%)');
  const r = inject([tx], 'swap:' + pair + ':' + q.side);
  if (r.done) {
    recordState((s) => s.swaps = [{ at: tx.at, taker, pair, side: q.side, inUnits: q.in.units, inSym: q.in.sym, inHuman: q.in.human, outUnits: q.out.units, outSym: q.out.sym, outHuman: q.out.human, feeBps: q.feeBps, quoteImpactPct: q.impactPct }].concat(s.swaps || []).slice(0, 50));
  }
  return r;
}

/* ── watch — עדות-מחזורית ── */
async function watch() {
  if (fs.existsSync(PID_F)) { try { const p = JSON.parse(fs.readFileSync(PID_F, 'utf8')); process.kill(p.pid, 0); slog('watch already alive pid=' + p.pid); return; } catch (_) {} }
  fs.writeFileSync(PID_F, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  slog('watch started pid=' + process.pid + ' (every 10 min)');
  const tick = async () => { try { await attest(); } catch (e) { slog('watch tick error: ' + String(e && e.message || e).slice(0, 120)); } };
  await tick();
  setInterval(tick, 10 * 60 * 1000).unref();
  setInterval(() => {}, 1 << 30); // stay alive
}

/* ── main ── */
(async () => {
  const cmd = process.argv[2];
  const args = {};
  for (let i = 3; i < process.argv.length; i++) { const m = /^--([a-z]+)$/.exec(process.argv[i]); if (m) args[m[1]] = process.argv[++i]; }
  if (cmd === 'attest') { await attest(); return; }
  if (cmd === 'quote') { const q = quote(args.pair, args.side, args.in); console.log(JSON.stringify(q, null, 2)); return; }
  if (cmd === 'seed') { await seed(args); return; }
  if (cmd === 'swap') { swap(args); return; }
  if (cmd === 'watch') { await watch(); return; }
  console.log('usage: theswap.cjs attest | quote --pair --side --in | seed [--a --b --fee] | swap --pair --side --in [--taker] | watch');
})();
