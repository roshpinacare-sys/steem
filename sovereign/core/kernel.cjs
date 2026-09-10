#!/usr/bin/env node
/* kernel.cjs — SAOS-NET v0: the deterministic sovereign kernel.
 *
 * Task 68 — "המערכת שתחליף" ground files. זהו הלב של הרשת-שלנו:
 * מכונת-מצב דטרמיניסטית — אותו ג'נזיס + אותן טרנזאקציות = אותו מצב,
 * אותו state-root, בכל מכונה, בכל זמן. כל המתמטיקה בשלמים (micro-units),
 * שום float, שום תלות-סביבה: sha256 על JSON קנוני (מיון-מפתחות רקורסיבי).
 *
 * עקרון-ריבונות: ה-state-root של צ'קפוינט הוא טביעת-אצבע של כלכלת-האימפריה
 * כולה — והוא נעוגן על Steem+Hive. מי שמחזיק את הג'נזיס + את אוגר-הבלוקים
 * יכול לשחזר את העולם ולאמת כל צ'קפוינט מתמטית.
 *
 * כללי-ברזל:
 *   · יחידות: מיקרו-שלמים (1 SAOS = 1000 µ, 1 STEEM = 1000 µ, 1 LP = 1e6 µlp)
 *   · אסימון: canonicalJSON(v) — מפתחות ממוינים, אין רווחים
 *   · stateRoot = sha256(canonicalJSON(state))
 *   · blockHash = sha256(canonicalJSON(block)) — בלי שדה hash עצמו
 *   · applyTx מחזיר {ok, gas, err?} — טרנזאקציה לא-חוקית לא נוגעת במצב
 *   · self-test: --selftest מאמת וקטורי-קבוע — determinism מוכח-רץ
 */
'use strict';
const crypto = require('crypto');

/* ── canonical JSON ── */
function canon(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const stateRoot = (state) => sha256(canon(state));

/* WEAVE (W1): מודול-המרקל הקנוני (עץ-טהור מעל hex — ללא-תלות-חוזרת) */
const M = require('./merkle.cjs');

/* WEAVE (W1): עלה-קנוני לרישום-חותמת — הצורה קבועה-חוזה:
 * leaf = sha256(canon({h, seq, kind, by, at, salt})) — אותו-עצם שיושב ב-st.weave.stamps.
 * כל-הוכחת-חותמת נגזרת מהעלים האלה; העלים נגזרים מה-block log הציבורי (replay). */
function weaveLeaf(entry) {
  return sha256(canon({ h: entry.h, seq: entry.seq, kind: entry.kind, by: entry.by, at: entry.at, salt: entry.salt }));
}

/* WEAVE (W1): אתחול-עצלני של מצב-האריגה — אסור לקרוא מחוץ ל-case-ים של weave,
 * כדי-שמצב-לפני-חותמת-ראשונה יישאר byte-זהה (הוקטורים-הקדושים לא-זזים —
 * אותו-דפוס של st.producers ב-produce). */
function weaveInit(st) {
  return (st.weave = st.weave || { nextSeq: 1, nextSeal: 1, total: 0, stamps: {}, seals: [], witnesses: {}, lastSeal: null });
}

/* תקרת-חותמות-חיות (בקרת-נפיחה — אחרי-איטום המפה מתרוקנת) */
const WEAVE_LIVE_CAP = 1024;
/* טבעת-איטומים נשמרת-במצב (ההיסטוריה המלאה = ה-block log עצמו) */
const WEAVE_SEALS_RING = 32;
/* טבעת-נושאי-עדות */
const WEAVE_WITNESS_RING = 64;

/* ── gas table (metering v0 — מדידה בלבד, תמחור ב-v1) ── */
const GAS = {
  transfer: 100, pay: 120, order: 150, cancel: 60, fill: 200,
  pool_add: 180, pool_swap: 220, wrap_mint: 250, wrap_burn: 250,
  yield: 150, attest: 50, heartbeat: 10, steemPay: 120, produce: 30,
  wrap_cover: 80, delegate: 60,
  // WEAVE (W1): רשת-האמת — חותמות/איטום/עדים (THE_WEAVE.md §4.1)
  stamp: 20, seal: 60, witness: 40,
  // 96 — כלכלת-טרון-העטופה: רישום-מטבעות-מוכרים (bridge-ready) + ציטוטי-מחיר-על-הספר
  asset_list: 70, asset_price: 40,
  // 97 — GRID-PROFIT: זרימת-נזילות-עטופה + בריכת-גשר WTRX/SAOS (עמלי-30bps כמו-הבריכה-הילידית)
  transfer_w: 100, pool_addw: 180, pool_swapw: 220,
  // 98 — DEX-98: בריכות-זוגות-גנריות — כל-מטבע-עטוף-מבחוץ מקבל-דקס אמת על-אותו-חוזה
  pool_xAdd: 180, pool_x: 220, pool_xRm: 120,
  // 98 — אוסף-גרוטאות-פרוטוקולי: ניקוי-הזמנות-מתות (מונע-נפיחת-מצב בקצבי-מיליונים)
  order_gc: 30,
  // 99b — שחרור-נעולים: פיוס-כיסוי-כנה (המאזן-החי-ירד — המנעול-משתחרר, אסור-לשחרר-מתחת-להיצע)
  wrap_release: 80,
  // 100 — משיכת-נזילות-מבריכת-הגשר (pro-rata, מאזן-מחיר) — השלמת-בריכות-חד-צדדיות מהנזילות-הגשר
  pool_rmw: 120,
  // 108 — THE-DOOR (דבר-גורר-דבר): פקודת-חוזה-חינם שמכריחה טרנזקציה על רשת-מרוחקת.
  // relay = ההצתה על-הרשת-שלנו (אפס-גז — החינם-הוא-היתרון) · relay_ack = הוכחת-ביצוע
  // מהמפעיל (מפתח-הצומת בלבד) עם txid אמת מהרשת-המרוחקת. לולאה-מלאה: אנחנו → רשת-רחוקה → אנחנו.
  relay: 0, relay_ack: 0,
  // 110 — דקס-המפלצת + אימות-אח: המופע-התאום מאמת את-הדלתות-שלנו מהשרשרת-הגולמית (W22)
  // — ואנחנו מאמתים את-שלו בחזרה. כל-רשומת sibling = ראיה שסרקנו-בעצמנו (לא-העתקת-טענות).
  sibling: 30,
  // 111 — THE-HARVEST (קציר-האנרגיה): שכבת-הפקת-הערך של הרשת-החופשית.
  // harvest = הכרה-על-הספר בערך-שהפיקו-זרימות-המערכת (עמלות-בריכות · גריד · מסילת-הזרמות · דלתות-v:3)
  // — הכסף-האמת-כבר-ביד-האוצר; המאגר = פנקס-הכרה ריבוני שכופה-את-הכלכלה על-השחרור.
  // harvest_release = גלגל-החוזר: הפירות-נהנים — שחרור-מוגבל-במאגר לעבודת-הרשת.
  harvest: 20, harvest_release: 30,
  // 113 — THE-WALLETS (ארנקי-הצבא): רישום-כתובות-רב-רשתי-מעוגן לכל-סוכן.
  // wallet = סט-כתובות (evm/tron/sol/btc) + digest-המניפסט המעוגן-על-המארח (STEEM custom_json).
  // זול (40) — רישום-זהות, לא-תנועת-ערך. dedupe-קשוח (agent,digest).
  wallet: 40,
};
const OPS = Object.keys(GAS);

/* ── עזרים שלמים ── */
const µ = (n) => Math.round(n * 1000);           // SAOS/STEEM → micro
const fromµ = (n) => n / 1000;
/* 117 — דיוק-פר-סמל: bookScale ב-assetMeta מגדיר את-יחידת-הספר-לסמל (ברירת-מחדל 1000 = µ,
 * כל-הסמלים-הקיימים-נשארים-µ ללא-שינוי — הווקטורים-הקדושים-נשארים-byte-זהים).
 * מטבעות-רשת-אמת (ETH 18 ספרות · SOL 9 · BTC 8) נרשמים-עם-bookScale=1e9 (ננו) —
 * הפקדת-$1 (≈0.00033 ETH) מיוצגת-בכנות-על-הספר במקום-להידחות-כ-µ=0.
 * הגנת-הגיבוי-נשמרת-מעצמה: mint ו-lockedDelta תמיד-באותו-scale — היחס-שלם. */
const bookScaleOf = (st, sym) => {
  const m = st.assetMeta && st.assetMeta[sym];
  return (m && Number.isInteger(m.bookScale) && m.bookScale >= 1 && m.bookScale <= 1e18) ? m.bookScale : 1000;
};
const acct = (st, name) => {
  st.accounts[name] = st.accounts[name] || { saos: 0, steem: 0, lockedSaos: 0, lockedSteem: 0, lp: 0, wrapped: {}, credits: 0 };
  return st.accounts[name];
};

/* ── אתחול-מצב מג'נזיס (ג'נזיס כבר ב-µ) ── */
function initFromGenesis(genesis) {
  const st = JSON.parse(JSON.stringify(genesis.state));
  st.meta = st.meta || {};
  st.meta.height = 0;
  st.meta.lastTime = genesis.time || null;
  st.orders = st.orders || [];
  st.nextOrder = st.nextOrder || 1;
  st.pool = st.pool || { saos: 0, steem: 0, lpSupply: 0, feeBps: 30 };
  st.fees = st.fees || { total: 0, toLp: 0, toTreasury: 0 };
  st.wrapped = st.wrapped || {};
  st.attests = st.attests || {};
  // STAGE-3 (72): st.producers נוצר-עצלנית בתוך case 'produce' בלבד —
  // מצב-לפני-הפקה-כלשהי נשאר byte-זהה (וקטורי-הקביעות לא נשברים).
  st.checkpoints = st.checkpoints || [];
  return st;
}

/* 117p8-R8 — גובה-מזלג ענף-buy: מהבלוק-הראשון-מעל גובה-זה, מילוי-על-הזמנת-buy רץ
 * בסמנטיקה-התקינה (taker-מוכר-SAOS). קבוע-חוזה-בקוד (לא-סביבה!) — אותו-ערך בכל מכונה.
 * מתועד: spec §10 · worklog 117p8-R8. בלוקים ≤ גובה-זה משוחזרים byte-זהים להיסטוריה. */
const FILL_BUY_FIX_HEIGHT = 130000;

/* ── הפעלת טרנזאקציה בודדת (טהורה — ללא גישה לזמן/סביבה) ──
 * atHeight (אופציונלי, 117p8-R8): גובה-הבלוק-שבו-ה-tx מיושם — נדרש לכללי-מזלג
 * (fill-buy). buildBlock מעביר st.meta.height+1; replay-היסטוריה חייב להעביר
 * את גובה-הבלוק-האמיתי. קריאה-2-ארגומנטים = ברירת-מחדל לשורה-הבאה. */
function applyTx(st, tx, atHeight) {
  if (!tx || typeof tx !== 'object') return { ok: false, gas: 0, err: 'bad-tx' };
  const type = tx.type;
  if (!GAS.hasOwnProperty(type)) return { ok: false, gas: 0, err: 'unknown-op' };
  const gas = GAS[type];
  /* 117p8-R8 — גובה-היישום (לכללי-המזלג): buildBlock מעביר גובה-הבלוק-החדש;
   * replay-אמיתי מעביר גובה-הבלוק-ההיסטורי; קריאה-2-ארגומנטים = הבא-בתור. */
  const atH = Number.isInteger(atHeight) ? atHeight : (st.meta.height || 0) + 1;
  switch (type) {
    case 'transfer':
    case 'pay': {
      const a = µ(Number(tx.amount));
      if (!(a > 0)) return { ok: false, gas, err: 'amount' };
      const from = acct(st, String(tx.from || '').toLowerCase());
      const to = acct(st, String(tx.to || '').toLowerCase());
      if (from.saos < a) return { ok: false, gas, err: 'insufficient' };
      if (from === to && tx.from === tx.to) return { ok: false, gas, err: 'self' };
      from.saos -= a; to.saos += a;
      if (type === 'pay') st.meta.pays = (st.meta.pays || 0) + 1;
      return { ok: true, gas };
    }
    case 'order': {
      const owner = String(tx.owner || '').toLowerCase();
      const side = tx.side === 'sell' ? 'sell' : tx.side === 'buy' ? 'buy' : null;
      const a = µ(Number(tx.amount));
      const p = Number(tx.price);
      if (!side || !(a > 0) || !(p > 0)) return { ok: false, gas, err: 'bad-order' };
      const o = acct(st, owner);
      if (st.orders.filter((x) => x.owner === owner && x.live).length >= 8) return { ok: false, gas, err: 'order-cap' };
      if (side === 'sell') {
        if (o.saos < a) return { ok: false, gas, err: 'insufficient' };
        o.saos -= a; o.lockedSaos += a;
      } else {
        const paySteem = Math.ceil(a * p);
        if (o.steem < paySteem) return { ok: false, gas, err: 'insufficient-steem' };
        o.steem -= paySteem; o.lockedSteem += paySteem;
      }
      const id = st.nextOrder++;
      st.orders.push({ id, side, owner, amount: a, price: Math.round(p * 1e6), live: true, at: tx.at || null });
      return { ok: true, gas, orderId: id };
    }
    case 'cancel': {
      const id = Number(tx.orderId);
      const ord = st.orders.find((x) => x.id === id && x.live);
      if (!ord) return { ok: false, gas, err: 'no-order' };
      if (ord.owner !== String(tx.owner || '').toLowerCase()) return { ok: false, gas, err: 'not-owner' };
      ord.live = false;
      const o = acct(st, ord.owner);
      if (ord.side === 'sell') { o.lockedSaos -= ord.amount; o.saos += ord.amount; }
      else { const back = Math.ceil(ord.amount * (ord.price / 1e6)); o.lockedSteem -= back; o.steem += back; }
      return { ok: true, gas };
    }
    case 'fill': {
      const taker = String(tx.taker || '').toLowerCase();
      const id = Number(tx.orderId);
      const ord = st.orders.find((x) => x.id === id && x.live);
      if (!ord) return { ok: false, gas, err: 'no-order' };
      if (ord.owner === taker) return { ok: false, gas, err: 'self-trade' };
      let a = µ(Number(tx.amount));
      if (!(a > 0)) return { ok: false, gas, err: 'amount' };
      if (a > ord.amount) a = ord.amount;
      const price = ord.price / 1e6;
      const buyer = ord.side === 'sell' ? taker : ord.owner;
      const seller = ord.side === 'sell' ? ord.owner : taker;
      const b = acct(st, buyer), s = acct(st, seller);
      /* 117p8-R8 — תיקון-מזלג ענף-buy (חוק-מספר, לא-סביבה):
       * FILL_BUY_FIX_HEIGHT — מעליו ענף-buy תקין: ה-taker (מוכר-ה-SAOS) חייב-להחזיק
       * SAOS ומוותר עליו; הבעלים מקבל SAOS ומשחרר-נעול עד-תקרת-המנעול (אף-יתרה-
       * נעולה-שלילית). מתחתיו — הסמנטיקה-ההיסטורית byte-זהה (9,358 מילויים-חיים
       * רצו-הפוך: הבעלים שילם SAOS+STEEM וה-taker קיבל את-שניהם — מתועד-ב-spec §10). */
      if (ord.side === 'sell') {
        // buyer משלם STEEM ישירות (יתרה-פנויה), seller ה-locked משוחרר ל-buyer-SAOS
        const pay = Math.ceil(a * price);
        if (b.steem < pay) return { ok: false, gas, err: 'insufficient-steem' };
        b.steem -= pay; s.steem += pay;
        ord.amount -= a; s.lockedSaos -= a; b.saos += a;
      } else if (atH < FILL_BUY_FIX_HEIGHT) {
        // buyer (ה-owner) כבר-נעל STEEM; taker מקבל את ה-STEEM ונותן SAOS מהפנוי
        const pay = Math.ceil(a * price);
        if (b.saos < a) return { ok: false, gas, err: 'insufficient' };
        b.saos -= a; s.saos += a;
        ord.amount -= a; b.lockedSteem -= pay; s.steem += pay;
      } else {
        // 117p8-R8 (fork @FILL_BUY_FIX_HEIGHT): taker-מוכר-SAOS · בעלים-מקבל ·
        // שחרור-נעול מוגבל-במנעול-הקיים — אין-מנטרה, אין-שלילי, שימור-מלא.
        const pay = Math.ceil(a * price);
        if (s.saos < a) return { ok: false, gas, err: 'insufficient' };
        const rel = Math.min(pay, Math.max(0, b.lockedSteem));
        s.saos -= a; b.saos += a;
        ord.amount -= a; b.lockedSteem -= rel; s.steem += rel;
      }
      if (ord.amount === 0) ord.live = false;
      st.meta.trades = (st.meta.trades || 0) + 1;
      st.meta.lastPrice = Math.round(price * 1e6);
      return { ok: true, gas, filled: a };
    }
    case 'pool_add': {
      const o = acct(st, String(tx.owner || '').toLowerCase());
      const inS = µ(Number(tx.amountSaos)), inT = µ(Number(tx.amountSteem));
      if (inS < 0 || inT < 0 || inS + inT <= 0) return { ok: false, gas, err: 'amount' };
      if (o.saos < inS || o.steem < inT) return { ok: false, gas, err: 'insufficient' };
      let shares;
      if (st.pool.lpSupply <= 0) { shares = Math.round((inS + inT) * 1000); } // 1e3 µlp per µ
      else { shares = Math.floor((inS / Math.max(st.pool.saos, 1)) * st.pool.lpSupply); if (!(shares > 0)) shares = 1; }
      o.saos -= inS; o.steem -= inT;
      st.pool.saos += inS; st.pool.steem += inT; st.pool.lpSupply += shares;
      o.lp += shares;
      return { ok: true, gas, shares };
    }
    case 'pool_swap': {
      const t = String(tx.taker || '').toLowerCase();
      const side = tx.side === 'sell_saos' ? 'sell_saos' : tx.side === 'buy_saos' ? 'buy_saos' : null;
      const inAmt = µ(Number(tx.inAmt));
      if (!side || !(inAmt > 0)) return { ok: false, gas, err: 'bad-swap' };
      const o = acct(st, t);
      const p = st.pool;
      if (p.saos <= 0 || p.steem <= 0) return { ok: false, gas, err: 'empty-pool' };
      if (side === 'sell_saos') {
        if (o.saos < inAmt) return { ok: false, gas, err: 'insufficient' };
        const fee = Math.floor(inAmt * p.feeBps / 10000);
        const net = inAmt - fee;
        const out = Math.floor(net * p.steem / (p.saos + net));
        if (!(out > 0)) return { ok: false, gas, err: 'dust' };
        // 117k — minOut-אופציונלי (אותו-חוזה-של-pool_x): tx-ישן-בלי-השדה = התנהגות-זהה-ביט-ביט (replay-safe)
        if (tx.minOut !== undefined && !(out >= Math.floor(Number(tx.minOut)))) return { ok: false, gas, err: 'minOut' };
        const feeToLp = Math.floor(fee / 2), feeToTr = fee - feeToLp;
        // שימור: inAmt == (net + feeToLp) + feeToTr — כל-המיקרו נספרים
        o.saos -= inAmt;
        p.saos += net; p.steem -= out;
        p.saos += feeToLp;
        o.steem += out;
        st.fees.toLp += feeToLp; st.fees.toTreasury += feeToTr;
        acct(st, st.meta.issuer || 'treasury').saos += feeToTr;
        st.fees.total += fee;
        st.meta.swaps = (st.meta.swaps || 0) + 1;
        return { ok: true, gas, out };
      } else {
        if (o.steem < inAmt) return { ok: false, gas, err: 'insufficient-steem' };
        const fee = Math.floor(inAmt * p.feeBps / 10000);
        const net = inAmt - fee;
        const out = Math.floor(net * p.saos / (p.steem + net));
        if (!(out > 0)) return { ok: false, gas, err: 'dust' };
        // 117k — minOut-אופציונלי (אותו-חוזה-של-pool_x): replay-safe
        if (tx.minOut !== undefined && !(out >= Math.floor(Number(tx.minOut)))) return { ok: false, gas, err: 'minOut' };
        const feeToLp = Math.floor(fee / 2), feeToTr = fee - feeToLp;
        o.steem -= inAmt;
        p.steem += net; p.saos -= out;
        p.steem += feeToLp;
        o.saos += out;
        st.fees.toLp += feeToLp; st.fees.toTreasury += feeToTr;
        acct(st, st.meta.issuer || 'treasury').steem += feeToTr;
        st.fees.total += fee;
        st.meta.swaps = (st.meta.swaps || 0) + 1;
        return { ok: true, gas, out };
      }
    }
    case 'wrap_mint': {
      const sym = String(tx.symbol || '').toUpperCase();
      if (!/^[A-Z0-9-]{2,12}$/.test(sym)) return { ok: false, gas, err: 'bad-symbol' };
      const ISSUER = st.meta.issuer || 'treasury';
      if (String(tx.issuer || '').toLowerCase() !== ISSUER) return { ok: false, gas, err: 'issuer' };
      if (!tx.ref || st.wrapped[sym] && st.wrapped[sym].refs && st.wrapped[sym].refs[tx.ref]) return { ok: false, gas, err: 'ref' };
      const a = Math.round(Number(tx.amount) * bookScaleOf(st, sym));
      if (!(a > 0)) return { ok: false, gas, err: 'amount' };
      const w = st.wrapped[sym] = st.wrapped[sym] || { locked: 0, supply: 0, refs: {} };
      // שמור-על-טהור: לא-נוגעים במצב לפני-שכל-הבדיקות עברו (מרוצף-מטה)
      const candLocked = w.locked + (tx.lockedDelta ? Math.round(Number(tx.lockedDelta) * bookScaleOf(st, sym)) : 0);
      const newRatio = (w.supply + a) / Math.max(candLocked, 1);
      if (newRatio > 1.0001) return { ok: false, gas, err: 'under-backed' };
      w.locked = candLocked;
      w.refs[tx.ref] = true;
      if (Object.keys(w.refs).length > 256) delete w.refs[Object.keys(w.refs)[0]];
      const to = acct(st, String(tx.to || '').toLowerCase());
      to.wrapped[sym] = (to.wrapped[sym] || 0) + a;
      w.supply += a;
      return { ok: true, gas };
    }
    case 'wrap_burn': {
      const sym = String(tx.symbol || '').toUpperCase();
      const a = Math.round(Number(tx.amount) * bookScaleOf(st, sym));
      if (!(a > 0)) return { ok: false, gas, err: 'amount' };
      const w = st.wrapped[sym];
      if (!w) return { ok: false, gas, err: 'no-symbol' };
      const o = acct(st, String(tx.from || '').toLowerCase());
      if ((o.wrapped[sym] || 0) < a) return { ok: false, gas, err: 'not-holder' };
      o.wrapped[sym] -= a; w.supply -= a; w.redeemed = (w.redeemed || 0) + a;
      return { ok: true, gas };
    }
    case 'wrap_cover': {
      /* 95 — תיקון-גיבוי: מנפיק-בלבד מוסיף-כיסוי (locked) בלי-לשנות-supply.
       * שימוש-אמת (95): מדידת-S1-החסרה רשמה-20.84-TRX-כשהמדידה-החיה-המלאה = 24.44 —
       * התיקון על-הספר-עצמו עם-ref-מדידה, לא-עריכת-היסטוריה. */
      const sym = String(tx.symbol || '').toUpperCase();
      if (!/^[A-Z0-9-]{2,12}$/.test(sym)) return { ok: false, gas, err: 'bad-symbol' };
      const ISSUER = st.meta.issuer || 'treasury';
      if (String(tx.issuer || '').toLowerCase() !== ISSUER) return { ok: false, gas, err: 'issuer' };
      const w = st.wrapped[sym];
      if (!w) return { ok: false, gas, err: 'no-symbol' };
      if (!tx.ref || (w.refs && w.refs[tx.ref])) return { ok: false, gas, err: 'ref' };
      const d = Math.round(Number(tx.lockedDelta) * bookScaleOf(st, sym));
      if (!(d > 0)) return { ok: false, gas, err: 'delta' };
      const newRatio = w.supply / Math.max(w.locked + d, 1);
      if (newRatio > 1.0001) return { ok: false, gas, err: 'under-backed' };
      w.locked += d;
      w.refs[tx.ref] = true;
      return { ok: true, gas };
    }
    case 'wrap_release': {
      /* 99b — שחרור-נעולים: התאמה-כנה של-הנעול-ליתרה-החיה-הנמדדת (המאזן-החי-ירד —
       * אותם-מטבעות-לא-יכולים-להמשיך-לשעבד-ספק-ישן). מנפיק-בלבד · דורש-ref-טרי ·
       * הגנה: אסור-לשחרר-מתחת-לכיסוי-ההיצע-החי (supply/locked-after ≤ 1.0001). */
      const sym = String(tx.symbol || '').toUpperCase();
      if (!/^[A-Z0-9-]{2,12}$/.test(sym)) return { ok: false, gas, err: 'bad-symbol' };
      const ISSUER = st.meta.issuer || 'treasury';
      if (String(tx.issuer || '').toLowerCase() !== ISSUER) return { ok: false, gas, err: 'issuer' };
      const w = st.wrapped[sym];
      if (!w) return { ok: false, gas, err: 'no-symbol' };
      if (!tx.ref || (w.refs && w.refs[tx.ref])) return { ok: false, gas, err: 'ref' };
      const d = Math.round(Number(tx.lockedDelta) * bookScaleOf(st, sym));
      if (!(d > 0)) return { ok: false, gas, err: 'delta' };
      if (w.locked - d < 0) return { ok: false, gas, err: 'over-release' };
      const newRatio = w.supply / Math.max(w.locked - d, 1);
      if (newRatio > 1.0001) return { ok: false, gas, err: 'under-backed' };
      w.locked -= d;
      w.released = (w.released || 0) + d;
      w.refs[tx.ref] = true;
      return { ok: true, gas };
    }
    case 'delegate': {
      /* 95 — האצלה: חיבור-כולם לראש (@headcorner) בלי-לגעת-במפתחות-ראשיים.
       * הרשאות-מוגדרות-סקופ-פר-נושא; מוקלד-עצלנית (דיסציפלינת-מצב-קבועה —
       * כמו st.producers) כדי-שכל-ה-replay-שלפני-ה-op-הראשון יישאר byte-זהה. */
      const ISSUER = st.meta.issuer || 'treasury';
      if (String(tx.issuer || '').toLowerCase() !== ISSUER) return { ok: false, gas, err: 'issuer' };
      const subject = String(tx.subject || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (!subject || subject.length > 32) return { ok: false, gas, err: 'subject' };
      if (!tx.ref) return { ok: false, gas, err: 'ref' };
      st.delegations = st.delegations || {};
      if (st.delegations[subject] && st.delegations[subject].ref === tx.ref) return { ok: false, gas, err: 'ref' };
      const scopes = Array.isArray(tx.scopes) ? tx.scopes.map((s) => String(s).slice(0, 32)).slice(0, 16) : [];
      if (!scopes.length) return { ok: false, gas, err: 'scopes' };
      st.delegations[subject] = { scopes, ref: tx.ref, note: String(tx.note || '').slice(0, 160) };
      return { ok: true, gas };
    }
    case 'yield': {
      const ISSUER = st.meta.issuer || 'treasury';
      if (String(tx.from || '').toLowerCase() !== ISSUER) return { ok: false, gas, err: 'issuer' };
      if (tx.day && st.meta.yieldDay === tx.day) return { ok: false, gas, err: 'dup-day' };
      const pays = Array.isArray(tx.payments) ? tx.payments : [];
      let paid = 0;
      for (const p of pays) {
        const a = µ(Number(p.amount));
        if (!(a > 0)) continue;
        const t = acct(st, ISSUER); // v1.2: תשואה-משולמת-מהמנפיק-החי (בווקטורים: אין-issuer → 'treasury' — הוקטורים-לא-נשברים)
        if (t.saos < a) return { ok: false, gas, err: 'treasury-insufficient' };
        t.saos -= a; acct(st, String(p.account || '').toLowerCase()).saos += a;
        paid += a;
      }
      if (tx.day) st.meta.yieldDay = tx.day;
      st.meta.yieldTotal = (st.meta.yieldTotal || 0) + paid;
      return { ok: true, gas, paid };
    }
    case 'steemPay': {
      // מראה-STEEM: תנועת-STEEM אמיתית-מהמארח ממופה למצב-הריבוני (mirror).
      // 'host' = חשבון-גבול (boundary): מייצג את-צד-ה-STEEM של-המארח,
      // רשאי-יתרה-שלילית (כמו-חשבון-פיקדון-בבורסה) — הוא-הסמן-המצטבר של
      // הזרימה-נטו-מעבר-לגבול. מקור-כל-שאר-החשבונות: מאוזן-רגיל.
      const a = µ(Number(tx.amount));
      if (!(a > 0)) return { ok: false, gas, err: 'amount' };
      const fromName = String(tx.from || '').toLowerCase();
      const toName = String(tx.to || '').toLowerCase();
      const from = acct(st, fromName);
      const to = acct(st, toName);
      if (fromName !== 'host' && from.steem < a) return { ok: false, gas, err: 'insufficient-steem' };
      from.steem -= a; to.steem += a;
      st.meta.steemPays = (st.meta.steemPays || 0) + 1;
      return { ok: true, gas };
    }
    case 'attest': {
      const v = String(tx.validator || '').toLowerCase();
      const h = String(tx.checkpointHash || '');
      if (!v || !/^[0-9a-f]{64}$/.test(h)) return { ok: false, gas, err: 'bad-attest' };
      const arr = st.attests[h] = st.attests[h] || [];
      if (arr.includes(v)) return { ok: false, gas, err: 'dup-attest' };
      arr.push(v);
      if (st.attests[Object.keys(st.attests)[0]] && Object.keys(st.attests).length > 32) delete st.attests[Object.keys(st.attests)[0]];
      return { ok: true, gas };
    }
    case 'heartbeat': {
      st.meta.lastHeartbeat = String(tx.note || '').slice(0, 160);
      return { ok: true, gas };
    }
    case 'stamp': {
      // WEAVE (W1): חותמת-קיום — hash יחיד-עולמית, רישום-חי-עד-האיטום הבא.
      // טהור: כל-הבדיקות לפני-כל-נגיעה-במצב.
      const h = String(tx.h || '');
      if (!/^[0-9a-f]{64}$/.test(h)) return { ok: false, gas, err: 'bad-hash' };
      const kind = String(tx.kind || 'text');
      if (!/^[a-z0-9-]{2,16}$/.test(kind)) return { ok: false, gas, err: 'bad-kind' };
      if (tx.salt != null && !/^[0-9a-f]{64}$/.test(String(tx.salt))) return { ok: false, gas, err: 'bad-salt' };
      const by = String(tx.by || '').toLowerCase();
      if (!by) return { ok: false, gas, err: 'bad-by' };
      const w = weaveInit(st);
      if (w.stamps[h]) return { ok: false, gas, err: 'exists' };
      if (Object.keys(w.stamps).length >= WEAVE_LIVE_CAP) return { ok: false, gas, err: 'seal-required' };
      const entry = { h, seq: w.nextSeq, kind, by, at: tx.at || null, salt: tx.salt || null };
      w.stamps[h] = entry;
      w.nextSeq++;
      w.total++;
      st.meta.totalStamps = (st.meta.totalStamps || 0) + 1;
      return { ok: true, gas, seq: entry.seq };
    }
    case 'seal': {
      // WEAVE (W1): איטום-אריגה — רק-המנפיק; הקרנל עצמו מחשב את שורש-המרקל
      // הקנוני מהרישומים-החיים ומשווה ל-root הנטען — שורש-מזויף נדחה מתמטית.
      // אחרי-הצלחה: הרישומים-החיים מתרוקנים (ההיסטוריה = ה-block log),
      // ה-seal נכנס לטבעת-32 וה-meta נושא את-החותם-האחרון.
      const ISSUER = st.meta.issuer || 'treasury';
      if (String(tx.issuer || '').toLowerCase() !== ISSUER) return { ok: false, gas, err: 'issuer' };
      const root = String(tx.root || '');
      if (!/^[0-9a-f]{64}$/.test(root)) return { ok: false, gas, err: 'bad-root' };
      const w = weaveInit(st);
      const entries = Object.values(w.stamps).sort((a, b) => a.seq - b.seq);
      if (!entries.length) return { ok: false, gas, err: 'empty' };
      const count = Number(tx.count);
      if (!Number.isInteger(count) || count !== entries.length) return { ok: false, gas, err: 'count' };
      const computed = M.rootOf(entries.map(weaveLeaf));
      if (computed !== root) return { ok: false, gas, err: 'root-mismatch' };
      const seal = { seq: w.nextSeal, root, count, from: entries[0].seq, to: entries[entries.length - 1].seq, at: tx.at || null };
      w.nextSeal++;
      w.seals.push(seal);
      if (w.seals.length > WEAVE_SEALS_RING) w.seals.shift();
      w.stamps = {};
      w.lastSeal = { seq: seal.seq, root: seal.root, count: seal.count, at: seal.at };
      st.meta.totalSeals = (st.meta.totalSeals || 0) + 1;
      return { ok: true, gas, sealSeq: seal.seq, count: seal.count };
    }
    case 'witness': {
      // WEAVE (W1): עדות-צי — הצהרה חתומה על claim תחת topic;
      // dedupe per (topic, claimHash, validator) — מראת-attest; קוורום-ספירה = שכבת-השאילתה.
      const topic = String(tx.topic || '');
      if (!/^[a-z0-9-]{2,32}$/.test(topic)) return { ok: false, gas, err: 'bad-topic' };
      const c = String(tx.claimHash || '');
      if (!/^[0-9a-f]{64}$/.test(c)) return { ok: false, gas, err: 'bad-claim' };
      const v = String(tx.validator || '').toLowerCase();
      if (!v) return { ok: false, gas, err: 'bad-validator' };
      const w = weaveInit(st);
      const key = topic + ':' + c;
      const arr = w.witnesses[key] = w.witnesses[key] || [];
      if (arr.includes(v)) return { ok: false, gas, err: 'dup-witness' };
      arr.push(v);
      const keys = Object.keys(w.witnesses);
      if (keys.length > WEAVE_WITNESS_RING) delete w.witnesses[keys[0]];
      st.meta.totalWitness = (st.meta.totalWitness || 0) + 1;
      return { ok: true, gas, witnesses: arr.length };
    }
    case 'asset_list': {
      /* 96 — רישום-מטבע-עטוף-מוכר (bridge-ready): הקרנל מכיר באסימון ובחוזה-האם
       * שלו על שרשרת-האם — אבל לא מנפיק אחד-מעל-אפס בלי-הוכחת-נעילה:
       * wrap_mint עם-ref-נעילה נשאר הדרך-היחידה לאסימונים (מגן-under-backed
       * לא זז). supply/locked נולדים-אפס — רכבת-מוכנה לפיקדונות אמת.
       * כתובת-חוזה אופציונלית — מטבעות-ילידים (TRX/STEEM) נרשמים בלי-חוזה.
       * st.assetMeta נוצר-עצלנית (דיסציפלינת-מצב — כמו st.producers). */
      const sym = String(tx.symbol || '').toUpperCase();
      if (!/^[A-Z0-9-]{2,12}$/.test(sym)) return { ok: false, gas, err: 'bad-symbol' };
      const ISSUER = st.meta.issuer || 'treasury';
      if (String(tx.issuer || '').toLowerCase() !== ISSUER) return { ok: false, gas, err: 'issuer' };
      if (!tx.ref) return { ok: false, gas, err: 'ref' };
      const contract = String(tx.contract || '').trim();
      if (contract && !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(contract)) return { ok: false, gas, err: 'bad-contract' };
      st.assetMeta = st.assetMeta || {};
      if (st.assetMeta[sym] && st.assetMeta[sym].ref === tx.ref) return { ok: false, gas, err: 'ref' };
      if (!st.wrapped[sym]) st.wrapped[sym] = { locked: 0, supply: 0, refs: {} };
      st.assetMeta[sym] = {
        chain: String(tx.chain || 'tron').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 16),
        contract,
        decimals: Number.isInteger(tx.decimals) && tx.decimals >= 0 && tx.decimals <= 18 ? tx.decimals : 6,
        // 117 — יחידת-הספר-לסמל (ברירת-מחדל 1000 = µ מורשת · מטבעות-רשת-אמת נרשמים 1e9 ננו)
        bookScale: Number.isInteger(tx.bookScale) && tx.bookScale >= 1 && tx.bookScale <= 1e18 ? tx.bookScale : 1000,
        ref: tx.ref,
        note: String(tx.note || '').slice(0, 160),
      };
      return { ok: true, gas };
    }
    case 'asset_price': {
      /* 96 — ציטוט-מחיר-על-הספר: מקור-אמת חתום (src+ref+at) — הדקס, הגריד
       * והכלכלה מחשבים-מאותו-מחיר בדיוק. px בננו-דולר שלם (1e-9 USD —
       * אין-float; גם מטבעות-פרוטה כמו BTTC מקבלים-דיוק). ציטוט-חדש =
       * ref חדש — ציטוט-ישן לא נערך (הספר הוא-האמת). רק לאסימונים
       * רשומים (asset_list קודם). */
      const ISSUER = st.meta.issuer || 'treasury';
      if (String(tx.issuer || '').toLowerCase() !== ISSUER) return { ok: false, gas, err: 'issuer' };
      const sym = String(tx.symbol || '').toUpperCase();
      if (!st.assetMeta || !st.assetMeta[sym]) return { ok: false, gas, err: 'no-symbol' };
      const px = Math.round(Number(tx.px));
      if (!(px > 0)) return { ok: false, gas, err: 'price' };
      if (!tx.ref) return { ok: false, gas, err: 'ref' };
      st.assetPrices = st.assetPrices || {};
      if (st.assetPrices[sym] && st.assetPrices[sym].ref === tx.ref) return { ok: false, gas, err: 'ref' };
      st.assetPrices[sym] = { px, unit: String(tx.unit || 'USD').slice(0, 8), src: String(tx.src || '').slice(0, 48), ref: tx.ref, at: tx.at || null };
      return { ok: true, gas };
    }
    case 'transfer_w': {
      /* 97 — העברת-נכס-עטוף בין-חשבונות (זרימת-נזילות-גשר: חיילים↔אוצר).
       * אותו-חוזה-ריבוני: µ-שלמים · יתרות-wrapped פר-חשבון (קיימות-מ-wrap_mint).
       * אין-יצירה-ואין-שריפה כאן — supply המטבע נשאר זהה בדיוק (העברה-בלבד).
       * סמל-לא-רשום (אין-assetMeta) נדחה — הכל-על-מטבעות-מוכרים-בלבד. */
      const sym = String(tx.symbol || '').toUpperCase();
      if (!/^[A-Z0-9-]{2,12}$/.test(sym)) return { ok: false, gas, err: 'bad-symbol' };
      if (!st.assetMeta || !st.assetMeta[sym]) return { ok: false, gas, err: 'no-symbol' };
      const a = Math.round(Number(tx.amount) * bookScaleOf(st, sym));
      if (!(a > 0)) return { ok: false, gas, err: 'amount' };
      const from = acct(st, String(tx.from || '').toLowerCase());
      const to = acct(st, String(tx.to || '').toLowerCase());
      if ((from.wrapped[sym] || 0) < a) return { ok: false, gas, err: 'not-holder' };
      if (from === to && String(tx.from || '').toLowerCase() === String(tx.to || '').toLowerCase()) return { ok: false, gas, err: 'self' };
      from.wrapped[sym] -= a;
      to.wrapped[sym] = (to.wrapped[sym] || 0) + a;
      return { ok: true, gas };
    }
    case 'pool_addw': {
      /* 97 — בריכת-הגשר WTRX/SAOS (st.poolW נוצר-עצלנית — דיסציפלינת-מצב):
       * נזילות-גשר אמת (WTRX מגובה-מדידה על-הספר) נמשכת-לבריכות-שלנו.
       * אותה-מתמטיקת-mint-me-של-pool_add · אותן-עמלי-feeBps (ברירת-מחדל 30).
       * מניות-µlp: 1e3 µlp ל-µ בבריכה-הראשונה; אחר-כך יחסי. */
      const o = acct(st, String(tx.owner || '').toLowerCase());
      const inS = µ(Number(tx.amountSaos));   // צד-SAOS
      const inW = µ(Number(tx.amountWtrx));   // צד-WTRX
      if (inS < 0 || inW < 0 || inS + inW <= 0) return { ok: false, gas, err: 'amount' };
      if (o.saos < inS || (o.wrapped.WTRX || 0) < inW) return { ok: false, gas, err: 'insufficient' };
      const p = st.poolW = st.poolW || { saos: 0, wtrx: 0, lpSupply: 0, feeBps: 30 };
      let shares;
      if (p.lpSupply <= 0) { shares = Math.round((inS + inW) * 1000); }
      else { shares = Math.floor((inS / Math.max(p.saos, 1)) * p.lpSupply); if (!(shares > 0)) shares = 1; }
      o.saos -= inS;
      o.wrapped.WTRX = (o.wrapped.WTRX || 0) - inW;
      p.saos += inS; p.wtrx += inW; p.lpSupply += shares;
      o.lp += shares;
      return { ok: true, gas, shares };
    }
    case 'pool_swapw': {
      /* 97 — החלפה-על-בריכת-הגשר: sell_wtrx (WTRX→SAOS) · buy_wtrx (SAOS→WTRX).
       * אותה-מתמטיקת-AMM-קבוע-מכפיל כמו-pool_swap (שימור-µ מלא) · עמלה 30bps
       * מתחלקת 50/50 LP/אוצר — העמלה-המגיעה-לאוצר נזקפת ביחידות-הקלט
       * (WTRX→wrapped של-המנפיק · SAOS→saos של-המנפיק). אירוע-עמלה אמת
       * מנזילות-הגשר — הכנסה-פרוטוקולית-מדודה על-הספר. */
      const t = String(tx.taker || '').toLowerCase();
      const side = tx.side === 'sell_wtrx' ? 'sell_wtrx' : tx.side === 'buy_wtrx' ? 'buy_wtrx' : null;
      const inAmt = µ(Number(tx.inAmt));
      if (!side || !(inAmt > 0)) return { ok: false, gas, err: 'bad-swap' };
      const o = acct(st, t);
      const p = st.poolW;
      if (!p || p.saos <= 0 || p.wtrx <= 0) return { ok: false, gas, err: 'empty-pool' };
      const ISSUER = st.meta.issuer || 'treasury';
      const tr = acct(st, ISSUER);
      if (side === 'sell_wtrx') {
        if ((o.wrapped.WTRX || 0) < inAmt) return { ok: false, gas, err: 'insufficient' };
        const fee = Math.floor(inAmt * p.feeBps / 10000);
        const net = inAmt - fee;
        const out = Math.floor(net * p.saos / (p.wtrx + net));
        if (!(out > 0)) return { ok: false, gas, err: 'dust' };
        // 117k — minOut-אופציונלי (אותו-חוזה-של-pool_x): tx-ישן-בלי-השדה = התנהגות-זהה-ביט-ביט (replay-safe)
        if (tx.minOut !== undefined && !(out >= Math.floor(Number(tx.minOut)))) return { ok: false, gas, err: 'minOut' };
        const feeToLp = Math.floor(fee / 2), feeToTr = fee - feeToLp;
        o.wrapped.WTRX -= inAmt;
        p.wtrx += net; p.saos -= out;
        p.wtrx += feeToLp;
        /* 117p8-R8 — תיקון-שריפה (מזלג @FILL_BUY_FIX_HEIGHT): ה-taker חייב-לקבל
         * את ה-SAOS-שיצא מהבריכה. לפני-המזלג השורה-חסרה — ~111 SAOS נשרפו-חי
         * (נמדד: ΔT ב-replay-מלא). מתחת-למזלג: byte-זהה להיסטוריה. */
        if (atH >= FILL_BUY_FIX_HEIGHT) o.saos += out;
        tr.wrapped.WTRX = (tr.wrapped.WTRX || 0) + feeToTr;
        st.fees.total += fee;
        st.meta.swapsW = (st.meta.swapsW || 0) + 1;
        return { ok: true, gas, out };
      } else {
        if (o.saos < inAmt) return { ok: false, gas, err: 'insufficient' };
        const fee = Math.floor(inAmt * p.feeBps / 10000);
        const net = inAmt - fee;
        const out = Math.floor(net * p.wtrx / (p.saos + net));
        if (!(out > 0)) return { ok: false, gas, err: 'dust' };
        // 117k — minOut-אופציונלי (אותו-חוזה-של-pool_x): replay-safe
        if (tx.minOut !== undefined && !(out >= Math.floor(Number(tx.minOut)))) return { ok: false, gas, err: 'minOut' };
        const feeToLp = Math.floor(fee / 2), feeToTr = fee - feeToLp;
        o.saos -= inAmt;
        p.saos += net; p.wtrx -= out;
        p.saos += feeToLp;
        /* 117p8-R8 — תיקון-שריפה (אותו-מזלג): ה-taker חייב-לקבל את ה-WTRX-שיצא
         * מהבריכה — השורה-חסרה-השנייה של-אותו-באג. */
        if (atH >= FILL_BUY_FIX_HEIGHT) o.wrapped.WTRX = (o.wrapped.WTRX || 0) + out;
        tr.saos += feeToTr;
        st.fees.total += fee;
        st.meta.swapsW = (st.meta.swapsW || 0) + 1;
        return { ok: true, gas, out };
      }
    }
    case 'pool_xAdd': {
      /* 98 — DEX-98: בריכה-גנרית לזוג-סמלים (pair:'SYM/SAOS') — כל-מטבע-עטוף
       * מקבל-בריכה על-אותו-חוזה: עתודות-µ לשני-הצדדים · st.poolsX נוצר-עצלנית
       * (דיסציפלינת-מצב — אף-שדה-לא-נוצר עד-השימוש-הראשון). אותה-מתמטיקת-מניות
       * כמו-pool_addw · נאמנות-יתרות נאכפת לפי-סוג-הצד: סמל-עטוף → wrapped[sym]
       * · 'STEEM' → steem · 'SAOS' → saos. זריעה-חד-צדדית מותרת (inA או inB יכולים 0). */
      const pair = String(tx.pair || '');
      const m = /^([A-Z0-9.\-]{2,12})\/([A-Z0-9.\-]{2,12})$/.exec(pair);
      if (!m || m[1] === m[2]) return { ok: false, gas, err: 'bad-pair' };
      const A = m[1], B = m[2];
      /* 117c — raw-תעודה: tx.raw:true → יחידות-ספר-גולמיות-שלמות (בלי-µ-כפילה) —
       * הדיוק-הננו-נדרש למטבעות-אמת (bookScale 1e9) · בלי-raw ההתנהגות-זהה-בית */
      const raw = tx.raw === true;
      const inA = raw ? Math.floor(Number(tx.amountA || 0)) : µ(Number(tx.amountA || 0)), inB = raw ? Math.floor(Number(tx.amountB || 0)) : µ(Number(tx.amountB || 0));
      if (inA < 0 || inB < 0 || inA + inB <= 0) return { ok: false, gas, err: 'amount' };
      const o = acct(st, String(tx.owner || '').toLowerCase());
      const bal = (acc, sym) => sym === 'SAOS' ? acc.saos : sym === 'STEEM' ? acc.steem : (acc.wrapped[sym] || 0);
      const debit = (acc, sym, amt) => { if (sym === 'SAOS') acc.saos -= amt; else if (sym === 'STEEM') acc.steem -= amt; else acc.wrapped[sym] = (acc.wrapped[sym] || 0) - amt; };
      if (bal(o, A) < inA || bal(o, B) < inB) return { ok: false, gas, err: 'insufficient' };
      const ps = st.poolsX = st.poolsX || {};
      /* 117c — תקנת-הריבונות: עמלת-בריכה-ניתנת-להצהרה בעת-היצירה (tx.feeBps 0..100).
       * המנדט (המפעיל): "להשתחרר-מהתלות של עמלות" — בריכת-אמת על-הרשת-שלנו יכולה
       * להיוולד אפס-עמלה מלאה (feeBps:0) · ברירת-מחדל 30bps כמו-תמיד (וקטורי-קודש
       * לא-נוגעים — בלי-tx.feeBps ההתנהגות-זהה בית). בריכה-קיימת שומרת-על העמלה-שלה. */
      const feeBps0 = Number.isInteger(tx.feeBps) && tx.feeBps >= 0 && tx.feeBps <= 100 ? tx.feeBps : 30;
      const p = ps[pair] = ps[pair] || { a: 0, b: 0, lpSupply: 0, feeBps: feeBps0, symA: A, symB: B };
      let shares;
      if (p.lpSupply <= 0) { shares = Math.round((inA + inB) * 1000); }
      else if (inA > 0) { shares = Math.floor((inA / Math.max(p.a, 1)) * p.lpSupply); if (!(shares > 0)) shares = 1; }
      /* 100 — צד-יחיד-על-b: ב-0 מתפוצץ inB×lpSupply (נמדד-חי: WBLURT קיבל 1.7e11
       * מניות-µlp) — √(inB·lpSupply) הוא-החלק-הסביר (Uniswap-style); ב-b>0 יחסי רגיל. */
      else { shares = p.b > 0 ? Math.floor((inB / p.b) * p.lpSupply) : Math.floor(Math.sqrt(inB * p.lpSupply)); if (!(shares > 0)) shares = 1; }
      debit(o, A, inA); debit(o, B, inB);
      p.a += inA; p.b += inB; p.lpSupply += shares;
      o.lp += shares;
      return { ok: true, gas, shares };
    }
    case 'pool_x': {
      /* 98 — DEX-98: סוופ-גנרי על-בריכת-זוג (A2B: מכירת-צד-A · B2A: קניית-צד-A).
       * אותה-מתמטיקת-AMM-µ-שלמה של-pool_swapw (שימור-µ מלא) · עמלה-feeBps מתחלקת
       * 50/50 LP/אוצר ביחידות-הקלט · העמלה-לאוצר נזקפת ליתרת-הסמל-המתאים של-המנפיק. */
      const pair = String(tx.pair || '');
      const p = (st.poolsX || {})[pair];
      if (!p || !(p.a > 0) || !(p.b > 0)) return { ok: false, gas, err: 'no-pair' };
      const side = tx.side === 'A2B' ? 'A2B' : tx.side === 'B2A' ? 'B2A' : null;
      const inAmt = tx.raw === true ? Math.floor(Number(tx.inAmt)) : µ(Number(tx.inAmt)); // 117c raw-תעודה — אותו-חוזה כמו-pool_xAdd
      if (!side || !(inAmt > 0)) return { ok: false, gas, err: 'bad-swap' };
      const A = p.symA, B = p.symB;
      const t = String(tx.taker || '').toLowerCase();
      const o = acct(st, t);
      const ISSUER = st.meta.issuer || 'treasury';
      const tr = acct(st, ISSUER);
      const bal = (acc, sym) => sym === 'SAOS' ? acc.saos : sym === 'STEEM' ? acc.steem : (acc.wrapped[sym] || 0);
      const debit = (acc, sym, amt) => { if (sym === 'SAOS') acc.saos -= amt; else if (sym === 'STEEM') acc.steem -= amt; else acc.wrapped[sym] = (acc.wrapped[sym] || 0) - amt; };
      const credit = (acc, sym, amt) => { if (sym === 'SAOS') acc.saos += amt; else if (sym === 'STEEM') acc.steem += amt; else acc.wrapped[sym] = (acc.wrapped[sym] || 0) + amt; };
      const inSym = side === 'A2B' ? A : B;
      if (bal(o, inSym) < inAmt) return { ok: false, gas, err: 'insufficient' };
      const fee = Math.floor(inAmt * p.feeBps / 10000);
      const net = inAmt - fee;
      const inRes = side === 'A2B' ? p.a : p.b;
      const outRes = side === 'A2B' ? p.b : p.a;
      const out = Math.floor(net * outRes / (inRes + net));
      if (!(out > 0)) return { ok: false, gas, err: 'dust' };
      /* 117k — מגן-slippage (ממצא-מוביל-בסקר-הדקס): בלי-תקרת-סליפאג', סוופ-על-בריכה-מוטעית
       * מתמלא-בכל-מחיר. minOut-אופציונלי-ביחידות-ספר: tx-ישן-בלי-השדה = התנהגות-זהה-ביט-ביט
       * (replay-safe) · tx-חדש-עם-השדה → השוואה-לפני-כל-שינוי-מצב — REJECT-כנה 'minOut'. */
      if (tx.minOut !== undefined && !(out >= Math.floor(Number(tx.minOut)))) return { ok: false, gas, err: 'minOut' };
      const outSym = side === 'A2B' ? B : A;
      const feeToLp = Math.floor(fee / 2), feeToTr = fee - feeToLp;
      debit(o, inSym, inAmt);
      if (side === 'A2B') { p.a += net + feeToLp; p.b -= out; } else { p.b += net + feeToLp; p.a -= out; }
      credit(o, outSym, out);
      credit(tr, inSym, feeToTr);
      st.fees.total += fee;
      st.meta.swapsX = (st.meta.swapsX || 0) + 1;
      return { ok: true, gas, out };
    }
    case 'pool_xRm': {
      /* 98 — DEX-98: שריפת-מניות-LP → משיכת-עתודות יחסית (ה-AMM-הסטנדרטי-שחסר).
       * µ-שימור: הבריכה-מחזיקה-שארית מדויקת; המושך-מקבל-את-שני-הצדדים-יחסית-למניות.
       * 99-מגני-אמת (תקלה-חיה-נמדדה: משיכות-חוזרות-על-lp-מיושן → עתודות-שליליות =
       * מינט-פיקטיבי-מול-אינווריאנט-ה-AMM): (1) ש ≤ אספקת-המניות-בפועל; (2) תקרת-משיכה
       * 50%-לפעולה — איזון-הון-חוזר-דורש-refs-חדשים, לא-משיכה-בטלה. */
      const pair = String(tx.pair || '');
      const p = (st.poolsX || {})[pair];
      if (!p || !(p.lpSupply > 0)) return { ok: false, gas, err: 'no-pair' };
      const o = acct(st, String(tx.owner || '').toLowerCase());
      const sh = µ(Number(tx.shares));
      if (!(sh > 0) || (o.lp || 0) < sh) return { ok: false, gas, err: 'shares' };
      if (sh > p.lpSupply) return { ok: false, gas, err: 'shares' };
      if (sh * 2 > p.lpSupply) return { ok: false, gas, err: 'over-pull' };
      const fracA = Math.floor(p.a * sh / p.lpSupply);
      const fracB = Math.floor(p.b * sh / p.lpSupply);
      if (fracA + fracB <= 0) return { ok: false, gas, err: 'dust' };
      const bal = (acc, sym) => sym === 'SAOS' ? acc.saos : sym === 'STEEM' ? acc.steem : (acc.wrapped[sym] || 0);
      const credit = (acc, sym, amt) => { if (sym === 'SAOS') acc.saos += amt; else if (sym === 'STEEM') acc.steem += amt; else acc.wrapped[sym] = (acc.wrapped[sym] || 0) + amt; };
      p.a -= fracA; p.b -= fracB; p.lpSupply -= sh; o.lp -= sh;
      credit(o, p.symA, fracA); credit(o, p.symB, fracB);
      return { ok: true, gas, outA: fracA, outB: fracB };
    }
    case 'pool_rmw': {
      /* 100 — שריפת-מניות-LP על בריכת-הגשר WTRX/SAOS → משיכה-יחסית של שני-הצדדים
       * (מקביל-המדויק של pool_xRm על DEX-98 — אותם-מגני-אמת). המטרה-המדודה: השלמת
       * בריכות-חד-צדדיות (WBLURT a=10/b=0 נמדד-חי) מהנזילות-הגשר — pro-rata לא-מזיז
       * מחיר (היחס-בבריכה-נשמר) · תקרת-משיכה 50%-לפעולה (over-pull) · dust-guard. */
      const pw = st.poolW;
      if (!pw || !(pw.lpSupply > 0)) return { ok: false, gas, err: 'no-pool' };
      const ow = acct(st, String(tx.owner || '').toLowerCase());
      const shr = µ(Number(tx.shares));
      if (!(shr > 0) || (ow.lp || 0) < shr) return { ok: false, gas, err: 'shares' };
      if (shr > pw.lpSupply) return { ok: false, gas, err: 'shares' };
      if (shr * 2 > pw.lpSupply) return { ok: false, gas, err: 'over-pull' };
      const outS = Math.floor(pw.saos * shr / pw.lpSupply);
      const outW = Math.floor(pw.wtrx * shr / pw.lpSupply);
      if (outS + outW <= 0) return { ok: false, gas, err: 'dust' };
      pw.saos -= outS; pw.wtrx -= outW; pw.lpSupply -= shr; ow.lp -= shr;
      ow.saos += outS;
      ow.wrapped.WTRX = (ow.wrapped.WTRX || 0) + outW;
      return { ok: true, gas, outS, outW };
    }
    case 'order_gc': {
      /* 98 — אוסף-גרוטאות: מסירת-הזמנות-מתות (live=false) שגילן-מעל-cutoff מהמצב.
       * tx-אמת-על-השרשרת — ה-replay מיישם-אותו-בדיוק-כמו-הצומת-החי → דטרמיניזם-מלא.
       * מנוע-זרימה-גבוהה מייצר-מאות-אלפי-הזמנות/יום — בלי-GC המצב-וה-stateRoot-מתנפחים. */
      const cutoff = String(tx.before || '');
      if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(cutoff)) return { ok: false, gas, err: 'bad-cutoff' };
      const before = st.orders.length;
      st.orders = st.orders.filter((o) => o.live || !o.at || o.at >= cutoff);
      st.meta.gcs = (st.meta.gcs || 0) + 1;
      return { ok: true, gas, purged: before - st.orders.length };
    }
    case 'produce': {
      // STAGE-3 ROTATION (72): הפקה-במנדט — השרשרת עצמה אוכפת ראש-אחד-לסבב.
      // החוק (§12): producer(round) = roster[round mod |roster|] — הרוסטר מפורסם.
      // הקרנל אינו יודע את הרוסטר (נתון-סביבה) — הוא אוכף את המבנה ואת
      // האכיפה-הקונסנסואלית: אין שני ראשים לאותו סבב (dup-round).
      const p = String(tx.producer || '').toLowerCase();
      const r = Number(tx.round);
      const ref = String(tx.ref || '');
      if (!p || !Number.isInteger(r) || r < 0 || !ref) return { ok: false, gas, err: 'bad-produce' };
      st.producers = st.producers || {}; // יצירה-עצלנית — לא-נוגעים-במצב-לפני-הפקה-ראשונה
      if (st.producers[r]) return { ok: false, gas, err: 'dup-round' };
      st.producers[r] = { producer: p, ref };
      for (const k of Object.keys(st.producers)) if (Number(k) < r - 31) delete st.producers[k];
      st.meta.lastProducer = p;
      st.meta.lastProduceRound = r;
      return { ok: true, gas };
    }
    case 'relay': {
      /* 108 — THE-DOOR (דבר-גורר-דבר): החוזה-החינמי שלנו מכתיב פעולה על רשת-מרוחקת.
       * via: steem|blurt|tron · act: anchor|post|transfer|chain · seq מונוטוני פר-מנפיק.
       * אפס-גז בכוונה — החינם הוא היתרון-המוחלט של הרשת-שלנו. מדיניות-מצב-כנה:
       * open ≤ 48 (מניעת-נפיחה) · payload ≤ 400 תווים קנוניים · לוג-מסתובב 200.
       * ה-relayer (חוץ-לקרנל) קורא queued → מבצע-באמת-על-הרשת-המרוחקת → relay_ack. */
      const issuer = String(tx.issuer || '').toLowerCase();
      const seq = Math.floor(Number(tx.seq));
      const via = String(tx.via || '');
      const act = String(tx.act || '');
      const payload = tx.payload == null ? {} : tx.payload;
      let payStr;
      try { payStr = canon(payload); } catch (_) { return { ok: false, gas, err: 'relay-payload' }; }
      if (!issuer) return { ok: false, gas, err: 'relay-issuer' };
      if (!['steem', 'blurt', 'tron'].includes(via)) return { ok: false, gas, err: 'relay-via' };
      if (!['anchor', 'post', 'transfer', 'chain'].includes(act)) return { ok: false, gas, err: 'relay-act' };
      if (!Number.isInteger(seq) || seq < 1) return { ok: false, gas, err: 'relay-seq' };
      if (payStr.length > 400) return { ok: false, gas, err: 'relay-payload-big' };
      const R = st.relay = st.relay || { nextBy: {}, open: {}, log: [], sent: 0, issued: 0 };
      const want = R.nextBy[issuer] || 1;
      if (seq !== want) return { ok: false, gas, err: 'relay-seq-want-' + want };
      if (Object.keys(R.open).length >= 48) return { ok: false, gas, err: 'relay-congested' };
      const ref = issuer + ':' + seq;
      /* 109 — ESCROW (החוזה-מחזיק-את-הכסף) — לדלתות-v:2 (שער-תאימות-לאחור):
       * דלת-עם-budgetSun+ו:2 נועלת את-התקציב-כולו מאיזון-המנפיק ברגע-ההצתה.
       * דלתות-109-המוקדמות (בלי-ו) חוזרות-ביתית byte-זהה לקרנל-שהנפיק-אותן —
       * אפס-פיצול-שחזור (הלקח-מ-36666). מנפיק-בלי-כיסוי = דחייה-כנה.
       * 111 — v:3 דלת-קציר: אותו-נעילה + עמלת-שירות feeBps (ברירת-מחדל 1000=10%,
       * תקרה 2500) שנשארת-בחוזה במקום-פידיון-מלא — המרווח = קציר אמת
       * מזרימת-אנרגיית-הטרנזקציות (v:2 נשאר חינם-מלא — החינם-הוא-היתרון).
       * 111-fix (חוק-הברזל, נחשף-חי בסנדבוקס): כל-האימותים-והכיסוי קודמים
       * למוטציה-הראשונה — דחייה-חייבת-להשאיר-את-המצב byte-זהה (לא-צורך-רצף,
       * לא-דלת-נפתחה). נתיב-הצלחה byte-זהה לקרנל-109. */
      const pv = Number(payload.v);
      const budSun = Math.max(0, Math.min(1000000, Math.floor(Number(payload.budgetSun) || 0)));
      let lockµ = 0, feeBps = 0;
      if (pv === 2 || pv === 3) {
        if (pv === 3 && !(budSun > 0)) return { ok: false, gas, err: 'relay-v3-budget' };
        if (budSun > 0) {
          const RATE = 1; // µSAOS ל-sun — תעריף-פרוטוקול-קבוע: 2000-sun דלת = 2 SAOS פיקדון (סדר-גודל-נמדד: יתרת-המנפיק)
          lockµ = budSun * RATE;
          const iss0 = acct(st, issuer);
          if (iss0.saos < lockµ) return { ok: false, gas, err: 'relay-budget-unfunded(' + budSun + 'sun)' };
          if (pv === 3) {
            const fb = Number(payload.feeBps);
            feeBps = Math.max(0, Math.min(2500, Number.isFinite(fb) ? Math.floor(fb) : 1000));
          }
        }
      }
      R.nextBy[issuer] = seq + 1;
      R.open[ref] = { ref, via, act, payload: JSON.parse(payStr), by: issuer, status: 'queued', tries: 0 };
      if (lockµ > 0) {
        const iss = acct(st, issuer);
        iss.saos -= lockµ; iss.lockedSaos += lockµ;
        R.open[ref].escrowµ = lockµ;
        R.open[ref].v = pv;
        if (pv === 3) R.open[ref].feeBps = feeBps;
      }
      R.log.push(ref); if (R.log.length > 200) R.log.splice(0, R.log.length - 200);
      R.issued++;
      return { ok: true, gas, ref };
    }
    case 'relay_ack': {
      /* 108 — הוכחת-ביצוע: רק מפעיל-הצומת (st.meta.issuer) רשאי לאשר — הדלת
       * נסגרת ב-txid אמת מהרשת-המרוחקת. ack כפול נדחה: הוכחה-אחת לכל relay.
       * 109 — GAS-SETTLE (שלם-להם-דרך-החוזה-שלנו): הפיקדון-כבר-ביד-החוזה
       * (escrow מרגע-הצתת-הדלת). המבצע מוכיח spentSun; הוצאה-מעל-התקציב → דחייה.
       * החוזה משלם-למבצע לפי-ההוצאה-האמת (תעריף-קבוע) ומחזיר-למנפיק את-העודף.
       * Bandwidth-חינם = spentSun 0 = אפס-תשלום + פידיון-מלא — החינם-נשאר-היתרון. */
      const opIssuer = String(st.meta.issuer || '').toLowerCase();
      const acker = String(tx.issuer || '').toLowerCase();
      const ref = String(tx.ref || '');
      const txid = String(tx.txid || '').trim().slice(0, 96);
      const spentSun = Math.max(0, Math.min(1000000, Math.floor(Number(tx.spentSun) || 0)));
      if (!opIssuer || acker !== opIssuer) return { ok: false, gas, err: 'relay-ack-forbidden' };
      const R = st.relay;
      if (!R || !R.open[ref]) return { ok: false, gas, err: 'relay-unknown' };
      const r = R.open[ref];
      if (r.status !== 'queued') return { ok: false, gas, err: 'relay-acked' };
      if (!txid) return { ok: false, gas, err: 'relay-txid' };
      const budSun = Math.max(0, Math.min(1000000, Math.floor(Number((r.payload || {}).budgetSun) || 0)));
      if (spentSun > budSun) return { ok: false, gas, err: 'spent-over-budget(' + spentSun + '>' + budSun + ')' };
      if (r.escrowµ > 0) {
        const RATE = 1; // אותו-תעריף-פרוטוקול — הפידיון-ההפוך-של-הנעילה
        const payµ = Math.min(r.escrowµ, spentSun * RATE);
        let feeµ = 0;
        if (r.v === 3 && r.feeBps > 0) {
          /* 111 — עמלת-הקציר: החוזה-מחזיק את-הסכום במקום-להחזיר.
           * מוגבל-בשארית-הפידיון (לעולם-לא-נוגע בתשלום-המבצע). */
          feeµ = Math.min(r.escrowµ - payµ, Math.floor(r.escrowµ * r.feeBps / 10000));
        }
        const iss = acct(st, r.by);
        const exe = acct(st, acker);
        iss.lockedSaos -= r.escrowµ;
        iss.saos += r.escrowµ - payµ - feeµ; // עודף-חוזר-למנפיק (אחרי-עמלת-השירות)
        exe.saos += payµ;                    // החוזה-משלם-למבצע
        if (feeµ > 0) {
          /* 111 — הכרה-אוטומטית-על-הספר: עמלת-הדלת = קציר-זרם-doors. */
          const H = st.harvest = st.harvest || { potµ: 0, byStream: {}, seen: {}, seenRing: [], releases: [], count: 0, releasedµ: 0 };
          const href = 'door:' + ref;
          H.potµ += feeµ;
          H.byStream.doors = (H.byStream.doors || 0) + feeµ;
          if (!H.seen[href]) { H.seen[href] = 1; H.seenRing.push(href); if (H.seenRing.length > 512) { const old = H.seenRing.shift(); delete H.seen[old]; } H.count++; }
          st.meta.harvestTotalµ = (st.meta.harvestTotalµ || 0) + feeµ;
          r.harvestFeeµ = feeµ;
        }
        r.gasPaidµ = payµ;
        r.refundµ = r.escrowµ - payµ - feeµ;
        R.gasSettledSun = (R.gasSettledSun || 0) + spentSun;
      }
      r.status = 'sent'; r.txid = txid;
      if (spentSun > 0) r.spentSun = spentSun;
      R.sent++;
      return { ok: true, gas, ref, txid, spentSun };
    }
    case 'harvest': {
      /* 111 — THE-HARVEST (קציר-האנרגיה): הכרה-על-הספר בערך-שהפיקה-הרשת.
       * השאלה-שהובילה-לכאן: ״יש טרנזקציה, יש אנרגיה שמתבזבזת, מישהו משלם —
       * איך אנחנו מרוויחים משחרור-האנרגיה של הטרנזקציות?״
       * התשובה: כל-זרימה-שעוברת-במסילות-שלנו משאירה-עמלה-אמת ביד-האוצר
       * (עמלות-30bps של-הבריכות · הכנסות-הגריד · הזרמות-מסילה-חוצות · עמלות-דלתות-v:3).
       * הפקודה מכירה-בערך-הזה על-הספר — מאגר-מדוד לפי-זרם, עם-ראיה (ref) אחת-לכל-ערך.
       * רק-מפעיל-הצומת מכיר (מי-שמפעיל-את-המסילות-מודד-אותן) · dedupe-קשוח לפי-ref
       * · תקרת-מאגר-seen (בקרת-נפיחה — אותה-משמעת כמו-טבעות-ה-weave). */
      const ISSUER = st.meta.issuer || 'treasury';
      if (String(tx.by || '').toLowerCase() !== ISSUER) return { ok: false, gas, err: 'harvest-forbidden' };
      const stream = String(tx.stream || '');
      if (['pools', 'grid', 'rail', 'doors'].indexOf(stream) < 0) return { ok: false, gas, err: 'harvest-stream' };
      const amt = Math.max(0, Math.min(1e9, Math.floor(Number(tx.amountµ) || 0)));
      if (!(amt > 0)) return { ok: false, gas, err: 'harvest-amount' };
      const ref = String(tx.ref || '').trim().slice(0, 64);
      if (!ref) return { ok: false, gas, err: 'harvest-ref' };
      const H = st.harvest = st.harvest || { potµ: 0, byStream: {}, seen: {}, seenRing: [], releases: [], count: 0, releasedµ: 0 };
      if (H.seen[ref]) return { ok: false, gas, err: 'harvest-dup' };
      H.seen[ref] = 1; H.seenRing.push(ref);
      if (H.seenRing.length > 512) { const old = H.seenRing.shift(); delete H.seen[old]; }
      H.potµ += amt;
      H.byStream[stream] = (H.byStream[stream] || 0) + amt;
      H.count++;
      st.meta.harvestTotalµ = (st.meta.harvestTotalµ || 0) + amt;
      return { ok: true, gas, potµ: H.potµ };
    }
    case 'harvest_release': {
      /* 111 — גלגל-החוזר: הפירות-נהנים. שחרור-ערך-מהמאגר לעבודת-הרשת:
       * purpose: writer-reward (חיילים-שמאמתים/עוגנים) · gas-subsidy (מימון-תקציבי-דלת)
       * · treasury-return. כפיפות-כלכלית-קשה: אי-אפשר-לשחרר-מעל-מה-שנקצר
       * (potµ הוא-התקרה) — והכסף-האמת זז מיתרת-המפעיל אל-הנהנה.
       * טבעת-שחרורים-100 — ההיסטוריה-המלאה-בפנקס-הבלוקים עצמו. */
      const ISSUER = st.meta.issuer || 'treasury';
      if (String(tx.by || '').toLowerCase() !== ISSUER) return { ok: false, gas, err: 'harvest-release-forbidden' };
      const purpose = String(tx.purpose || '');
      if (['writer-reward', 'gas-subsidy', 'treasury-return'].indexOf(purpose) < 0) return { ok: false, gas, err: 'harvest-purpose' };
      const to = String(tx.to || '').toLowerCase();
      if (!to) return { ok: false, gas, err: 'harvest-to' };
      const amt = Math.max(0, Math.min(1e9, Math.floor(Number(tx.amountµ) || 0)));
      if (!(amt > 0)) return { ok: false, gas, err: 'harvest-release-amount' };
      const H = st.harvest;
      if (!H || H.potµ < amt) return { ok: false, gas, err: 'harvest-pot-dry' };
      const src = acct(st, ISSUER);
      if (src.saos < amt) return { ok: false, gas, err: 'insufficient' };
      const dst = acct(st, to);
      src.saos -= amt; dst.saos += amt;
      H.potµ -= amt;
      H.releasedµ = (H.releasedµ || 0) + amt;
      H.byPurpose = H.byPurpose || {};
      H.byPurpose[purpose] = (H.byPurpose[purpose] || 0) + amt;
      H.releases.push({ to, amountµ: amt, purpose, ref: String(tx.ref || '').slice(0, 64) || null, h: st.meta.height });
      if (H.releases.length > 100) H.releases.shift();
      return { ok: true, gas, potµ: H.potµ };
    }
    case 'sibling': {
      /* 110 — אח-וריאפקה: רישום-אימות-עצמאי של ארטיפקטים-על-שרשרת-חוץ של-המופע-התאום.
       * הסמנטיקה-הריבונית: הצומת-עצמו (st.meta.issuer) סרק את-השרשרת-הגולמית
       * (STEEM get_account_history / trongrid) ומצא את-הראיה בעצמו — לא העתקת-טענות
       * ממסך-של-אף-אחד. dedupe-קשוח לפי txid · מחסנית-מצב-עצלנית · מכסה-200.
       * kind: door | step | ack | proof — מה-נבדק · verdict: verified | rejected. */
      const ISSUER = st.meta.issuer || 'treasury';
      if (String(tx.by || '').toLowerCase() !== ISSUER) return { ok: false, gas, err: 'sibling-forbidden' };
      const stxid = String(tx.txid || '').trim().toLowerCase();
      if (!/^[0-9a-f]{8,80}$/.test(stxid)) return { ok: false, gas, err: 'sibling-txid' };
      const peer = String(tx.peer || '').trim().slice(0, 48);
      const kind = ['door', 'step', 'ack', 'proof'].indexOf(String(tx.kind || '')) >= 0 ? String(tx.kind) : null;
      if (!peer || !kind) return { ok: false, gas, err: 'sibling-shape' };
      const S = st.siblings = st.siblings || { seen: {}, recs: [] };
      if (S.seen[stxid]) return { ok: false, gas, err: 'sibling-dup' };
      S.seen[stxid] = 1;
      S.recs.push({
        txid: stxid, peer, kind,
        verdict: tx.verdict === 'rejected' ? 'rejected' : 'verified',
        contract: String(tx.contract || '').slice(0, 64) || null,
        step: Number.isInteger(Number(tx.step)) ? Number(tx.step) : null,
        ref: String(tx.ref || '').slice(0, 64) || null,
        note: String(tx.note || '').slice(0, 120) || null,
        at: String(tx.at || '').slice(0, 32) || null,
      });
      if (S.recs.length > 200) { const dropped = S.recs.shift(); delete S.seen[dropped.txid]; }
      st.meta.siblingsTotal = (st.meta.siblingsTotal || 0) + 1;
      if (tx.verdict !== 'rejected') st.meta.siblingsVerified = (st.meta.siblingsVerified || 0) + 1;
      return { ok: true, gas, txid: stxid };
    }
    case 'wallet': {
      /* 113 — THE-WALLETS (ארנקי-הצבא): רישום-כתובות-רב-רשתי-מעוגן לכל-סוכן.
       * הסמנטיקה-הריבונית: לכל-סוכן סט-ארנקים-פרטיים על-הרשתות-המובילות —
       * evm (משרת ETH+BSC+Polygon+Arbitrum+Optimism+Base+Avalanche),
       * tron, sol, btc (P2WPKH). digest = טביעת-המניפסט המעוגן-על-המארח
       * (STEEM custom_json saos:wallets/v1 — ראיה-ציבורית-מתוארכת, אפס-עמלה).
       * הכלל: המנפיק = headcorner (רישום-המניפסט) או הסוכן-עצמו (רישום-עצמי).
       * מינימום-כתובת-אחת · אורכים-נבדקים · dedupe-קשוח (agent,digest) · מחסנית-200. */
      const ISSUER = st.meta.issuer || 'treasury';
      const by = String(tx.by || '').toLowerCase();
      const agent = String(tx.agent || '').toLowerCase();
      if (!/^[a-z0-9-]{3,20}$/.test(agent)) return { ok: false, gas, err: 'wallet-agent' };
      if (by !== ISSUER && by !== agent) return { ok: false, gas, err: 'wallet-forbidden' };
      const digest = String(tx.digest || '').trim().toLowerCase();
      if (!/^[0-9a-f]{8,64}$/.test(digest)) return { ok: false, gas, err: 'wallet-digest' };
      const evm = String(tx.evm || '').trim().toLowerCase();
      const tron = String(tx.tron || '').trim();
      const sol = String(tx.sol || '').trim();
      const btc = String(tx.btc || '').trim();
      if (evm && !/^0x[0-9a-f]{40}$/.test(evm)) return { ok: false, gas, err: 'wallet-evm' };
      if (tron && !/^T[1-9A-HJ-NP-Za-km-z]{25,33}$/.test(tron)) return { ok: false, gas, err: 'wallet-tron' };
      if (sol && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(sol)) return { ok: false, gas, err: 'wallet-sol' };
      if (btc && !/^bc1[a-z0-9]{11,71}$/.test(btc)) return { ok: false, gas, err: 'wallet-btc' };
      if (!evm && !tron && !sol && !btc) return { ok: false, gas, err: 'wallet-empty' };
      const hostTxid = String(tx.hostTxid || '').trim().toLowerCase();
      if (hostTxid && !/^[0-9a-f]{8,80}$/.test(hostTxid)) return { ok: false, gas, err: 'wallet-hosttxid' };
      const W = st.wallets = st.wallets || { seen: {}, recs: [] };
      const key = agent + '/' + digest;
      if (W.seen[key]) return { ok: false, gas, err: 'wallet-dup' };
      W.seen[key] = 1;
      W.recs.push({
        agent, digest,
        evm: evm || null, tron: tron || null, sol: sol || null, btc: btc || null,
        hostTxid: hostTxid || null,
        by, selfReg: by === agent,
        at: String(tx.at || '').slice(0, 32) || null,
      });
      if (W.recs.length > 200) { const dropped = W.recs.shift(); delete W.seen[dropped.agent + '/' + dropped.digest]; }
      st.meta.walletsTotal = (st.meta.walletsTotal || 0) + 1;
      st.meta.walletsAgents = st.wallets.recs.length;
      return { ok: true, gas, agent };
    }
    default:
      return { ok: false, gas, err: 'unknown-op' };
  }
}

/* ── בניית בלוק — ההפעלה היחידה מותרת לדעת את הזמן, והוא נכנס לטרנזאקציות ── */
function buildBlock(st, txs, time) {
  const results = [];
  for (const tx of txs) {
    const r = applyTx(st, tx, (st.meta.height || 0) + 1);
    results.push({ ok: r.ok, err: r.err || null, gas: r.gas, filled: r.filled || undefined, out: r.out || undefined, shares: r.shares || undefined, orderId: r.orderId || undefined, type: tx.type });
  }
  st.meta.height = (st.meta.height || 0) + 1;
  st.meta.lastTime = time;
  const block = { height: st.meta.height, time, prevHash: st.meta.lastBlockHash || null, txs, results, gasUsed: results.reduce((s, r) => s + (r.gas || 0), 0) };
  const blockHash = sha256(canon(block));
  block.hash = blockHash;
  st.meta.lastBlockHash = blockHash;
  return { block, results };
}

/* ── צ'קפוינט — עיגון-מצב ── */
function buildCheckpoint(st, validator, anchorRefs) {
  const cp = {
    height: st.meta.height,
    blockHash: st.meta.lastBlockHash,
    stateRoot: stateRoot(st),
    supply: st.meta.supply || null,
    time: st.meta.lastTime,
    validator: String(validator || 'treasury').toLowerCase(),
    anchors: anchorRefs || {},
    quorum: { required: 3, attests: [] },
  };
  return cp;
}

/* ── אימות צ'קפוינט מול מצב-מקומי (אותו מנוע — הוכחה מתמטית) ── */
function verifyCheckpoint(cp, localState) {
  if (cp.stateRoot !== stateRoot(localState)) return { ok: false, why: 'state-root mismatch' };
  const att = (localState.attests || {})[cp.stateRoot] || [];
  return { ok: true, attests: att.length, quorumMet: att.length >= cp.quorum.required };
}

/* ── self-test vectors — determinism מוכח-רץ ──
 * ג'נזיס-קבוע + רצף-קבוע = state-roots קבועים. שינוי-כלשהו במנוע → הוקטורים נשברים.
 */
const TEST_GENESIS = {
  time: '2026-09-05T00:00:00.000Z',
  state: {
    meta: { supply: 170000 },
    accounts: {
      treasury: { saos: 120000, steem: 50000, lockedSaos: 0, lockedSteem: 0, lp: 0, wrapped: {}, credits: 0 },
      soldier1: { saos: 30000, steem: 10000, lockedSaos: 0, lockedSteem: 0, lp: 0, wrapped: {}, credits: 0 },
      soldier2: { saos: 20000, steem: 5000, lockedSaos: 0, lockedSteem: 0, lp: 0, wrapped: {}, credits: 0 },
    },
  },
};
const TEST_TXS = [
  { type: 'transfer', from: 'treasury', to: 'soldier1', amount: 1.5 },
  { type: 'pay', from: 'soldier1', to: 'soldier2', amount: 0.25 },
  { type: 'order', owner: 'soldier1', side: 'sell', amount: 5, price: 0.017 },
  { type: 'fill', taker: 'soldier2', orderId: 1, amount: 2 },
  { type: 'pool_add', owner: 'treasury', amountSaos: 60, amountSteem: 1 },
  { type: 'pool_swap', taker: 'soldier2', side: 'sell_saos', inAmt: 0.05 },
  { type: 'wrap_mint', symbol: 'WSBD-1', issuer: 'treasury', to: 'soldier2', amount: 0.26, lockedDelta: 0.26, ref: 'lock-tx-1' },
  { type: 'wrap_burn', symbol: 'WSBD-1', from: 'soldier2', amount: 0.06, ref: 'burn-tx-1' },
  { type: 'yield', from: 'treasury', day: '2026-09-05', payments: [{ account: 'soldier1', amount: 0.003 }, { account: 'soldier2', amount: 0.002 }] },
  { type: 'attest', validator: 'soldier1', checkpointHash: 'a'.repeat(64) },
];
function selfTest() {
  const st = initFromGenesis(TEST_GENESIS);
  const roots = [];
  const time = '2026-09-05T00:01:00.000Z';
  for (const tx of TEST_TXS) {
    buildBlock(st, [tx], time);
    roots.push(stateRoot(st));
  }
  const finalRoot = stateRoot(st);
  // שיחזור-מלא מאפס — אותו רצף חייב לתת את אותן שורשים בדיוק
  const st2 = initFromGenesis(TEST_GENESIS);
  let same = true;
  for (const tx of TEST_TXS) { buildBlock(st2, [tx], time); if (stateRoot(st2) !== roots[st2.meta.height - 1]) { same = false; break; } }
  return { roots, finalRoot, replay: same, ops: OPS.length };
}

/* ── וקטורי-רוטציה (72) — determinism ל-op produce + אכיפת dup-round ──
 * נפרדים-מהוקטורים-הקדושים (366ad477 לא נוגעים): רצף-קבוע → שורש-קבוע,
 * הפקה-כפולה-לסבב נדחית-בכנות, ו-meta נושא את-הראש-האחרון.
 */
const ROT_TEST_GENESIS = {
  time: '2026-09-05T01:00:00.000Z',
  state: {
    meta: { supply: 10000 },
    accounts: {
      treasury: { saos: 8000, steem: 1000, lockedSaos: 0, lockedSteem: 0, lp: 0, wrapped: {}, credits: 0 },
      a: { saos: 1000, steem: 0, lockedSaos: 0, lockedSteem: 0, lp: 0, wrapped: {}, credits: 0 },
      b: { saos: 1000, steem: 0, lockedSaos: 0, lockedSteem: 0, lp: 0, wrapped: {}, credits: 0 },
      c: { saos: 1000, steem: 0, lockedSaos: 0, lockedSteem: 0, lp: 0, wrapped: {}, credits: 0 },
    },
  },
};
const ROT_TEST_TXS = [
  { type: 'produce', producer: 'a', round: 0, ref: 'prc:0:vec0' },
  { type: 'produce', producer: 'b', round: 1, ref: 'prc:1:vec1' },
  { type: 'produce', producer: 'c', round: 2, ref: 'prc:2:vec2' },
  { type: 'produce', producer: 'a', round: 0, ref: 'prc:0:dup' }, // חייב-היכשל dup-round
];
function selfTestRotation() {
  const st = initFromGenesis(ROT_TEST_GENESIS);
  const roots = [];
  const time = '2026-09-05T01:01:00.000Z';
  const results = [];
  for (const tx of ROT_TEST_TXS) {
    const r = buildBlock(st, [tx], time);
    roots.push(stateRoot(st));
    results.push(r.results[0]);
  }
  // שיחזור-מלא מאפס
  const st2 = initFromGenesis(ROT_TEST_GENESIS);
  let same = true;
  for (let i = 0; i < ROT_TEST_TXS.length; i++) {
    buildBlock(st2, [ROT_TEST_TXS[i]], time);
    if (stateRoot(st2) !== roots[i]) { same = false; break; }
  }
  const dupGuard = results[3].ok === false && results[3].err === 'dup-round';
  return { roots, finalRoot: stateRoot(st), replay: same, dupGuard, lastProducer: st.meta.lastProducer, rounds: Object.keys(st.producers).sort() };
}

/* ── וקטורי-HARVEST (111) — determinism + אכיפות-הקציר ──
 * נפרדים-מהוקטורים-הקדושים (366ad477/b8ee2ee8 לא-נוגעים). מכסה:
 * harvest: forbidden(לא-מנפיק) · stream-שגוי · amount-שגוי · dup-ref · ok+צבירה
 * harvest_release: pot-dry · insufficient · ok (כסף-אמת זז + מאגר-מנוקה)
 * relay v:3: בלי-תקציב נדחה · feeBps-ברירת-מחדל-1000 · ack עם-עמלה (refund חסר-עמלה)
 *            · v:2 נשאר byte-זהה (פידיון-מלא, אפס-עמלה) */
function selfTestHarvest() {
  const GEN = {
    time: '2026-09-07T00:00:00.000Z',
    state: {
      meta: { supply: 9000, issuer: 'treasury' },
      accounts: {
        treasury: { saos: 6000, steem: 1000, lockedSaos: 0, lockedSteem: 0, lp: 0, wrapped: {}, credits: 0 },
        soldier1: { saos: 2000, steem: 0, lockedSaos: 0, lockedSteem: 0, lp: 0, wrapped: {}, credits: 0 },
        soldier2: { saos: 1000, steem: 0, lockedSaos: 0, lockedSteem: 0, lp: 0, wrapped: {}, credits: 0 },
      },
    },
  };
  const time = '2026-09-07T00:01:00.000Z';
  const st = initFromGenesis(GEN);
  const r = (tx) => applyTx(st, tx);
  const out = {};
  // harvest guards
  out.forbidden = r({ type: 'harvest', by: 'soldier1', stream: 'pools', amountµ: 500, ref: 'x1' }).err === 'harvest-forbidden';
  out.badStream = r({ type: 'harvest', by: 'treasury', stream: 'moon', amountµ: 500, ref: 'x2' }).err === 'harvest-stream';
  out.badAmount = r({ type: 'harvest', by: 'treasury', stream: 'pools', amountµ: 0, ref: 'x3' }).err === 'harvest-amount';
  out.noRef = r({ type: 'harvest', by: 'treasury', stream: 'pools', amountµ: 100, ref: '' }).err === 'harvest-ref';
  out.ok1 = r({ type: 'harvest', by: 'treasury', stream: 'pools', amountµ: 400, ref: 'fee:blk:100' }).ok === true;
  out.dup = r({ type: 'harvest', by: 'treasury', stream: 'pools', amountµ: 400, ref: 'fee:blk:100' }).err === 'harvest-dup';
  out.ok2 = r({ type: 'harvest', by: 'treasury', stream: 'rail', amountµ: 1000, ref: 'steem-txid-abc' }).ok === true;
  const H1 = st.harvest;
  out.pot = H1.potµ === 1400 && H1.byStream.pools === 400 && H1.byStream.rail === 1000 && H1.count === 2;
  // release guards + ok
  out.potDry = r({ type: 'harvest_release', by: 'treasury', purpose: 'writer-reward', to: 'soldier1', amountµ: 9999 }).err === 'harvest-pot-dry';
  out.badPurpose = r({ type: 'harvest_release', by: 'treasury', purpose: 'moon', to: 'soldier1', amountµ: 100 }).err === 'harvest-purpose';
  out.relOk = r({ type: 'harvest_release', by: 'treasury', purpose: 'writer-reward', to: 'soldier1', amountµ: 400, ref: 'fly:1' }).ok === true;
  out.relMath = st.accounts.soldier1.saos === 2400 && st.accounts.treasury.saos === 5600 && H1.potµ === 1000 && H1.releasedµ === 400;
  // relay v:3 — no budget rejected; with budget: default feeBps=1000
  out.v3NoBudget = r({ type: 'relay', issuer: 'treasury', seq: 1, via: 'steem', act: 'anchor', payload: { v: 3, note: 'x' } }).err === 'relay-v3-budget';
  out.v3Ok = r({ type: 'relay', issuer: 'treasury', seq: 1, via: 'steem', act: 'anchor', payload: { v: 3, budgetSun: 2000, note: 'fee-door' } }).ok === true;
  out.v3Lock = st.accounts.treasury.lockedSaos === 2000 && st.accounts.treasury.saos === 3600;
  out.v3FeeDefault = st.relay.open['treasury:1'].feeBps === 1000;
  // ack with spentSun=0 → executor 0, fee = 10% of 2000 = 200, refund = 1800
  out.v3Ack = r({ type: 'relay_ack', issuer: 'treasury', ref: 'treasury:1', txid: 'abcd1234', spentSun: 0 }).ok === true;
  const d = st.relay.open['treasury:1'];
  out.v3FeeMath = d.harvestFeeµ === 200 && d.refundµ === 1800 && d.gasPaidµ === 0;
  out.v3PotAfter = st.harvest.potµ === 1200 && st.harvest.byStream.doors === 200 && st.harvest.count === 3;
  out.v3IssuerBack = st.accounts.treasury.saos === 5400 && st.accounts.treasury.lockedSaos === 0;
  // v:2 control — full refund, NO fee (byte-identical legacy behavior)
  out.v2Ok = r({ type: 'relay', issuer: 'treasury', seq: 2, via: 'steem', act: 'anchor', payload: { v: 2, budgetSun: 2000 } }).ok === true;
  out.v2Ack = r({ type: 'relay_ack', issuer: 'treasury', ref: 'treasury:2', txid: 'efef5678', spentSun: 0 }).ok === true;
  const d2 = st.relay.open['treasury:2'];
  out.v2NoFee = d2.harvestFeeµ === undefined && d2.refundµ === 2000 && st.accounts.treasury.saos === 5400;
  // replay determinism over the harvest sequence
  const seq = [
    { type: 'harvest', by: 'treasury', stream: 'pools', amountµ: 400, ref: 'fee:blk:100' },
    { type: 'harvest', by: 'treasury', stream: 'rail', amountµ: 1000, ref: 'steem-txid-abc' },
    { type: 'harvest_release', by: 'treasury', purpose: 'writer-reward', to: 'soldier1', amountµ: 400, ref: 'fly:1' },
  ];
  const stA = initFromGenesis(GEN);
  const rootsA = [];
  for (const tx of seq) { buildBlock(stA, [tx], time); rootsA.push(stateRoot(stA)); }
  const stB = initFromGenesis(GEN);
  let replay = true;
  for (let i = 0; i < seq.length; i++) { buildBlock(stB, [seq[i]], time); if (stateRoot(stB) !== rootsA[i]) { replay = false; break; } }
  out.replay = replay;
  return out;
}

module.exports = {
  canon, sha256, stateRoot, GAS, OPS, initFromGenesis, applyTx, buildBlock,
  buildCheckpoint, verifyCheckpoint, selfTest, selfTestRotation, µ, fromµ, acct,
  TEST_GENESIS, TEST_TXS, ROT_TEST_GENESIS, ROT_TEST_TXS,
  // WEAVE (W1)
  weaveLeaf, weaveInit, selfTestWeave, merkle: M,
  WEAVE_LIVE_CAP, WEAVE_SEALS_RING, WEAVE_WITNESS_RING,
  // HARVEST (111)
  selfTestHarvest,
  // 117p8-R8 — fill-buy fork law
  FILL_BUY_FIX_HEIGHT, selfTestFillBuy,
};

/* ── וקטורי-FILL-BUY (117p8-R8) — הוכחת-שני-הענפים ──
 * אותו-רצף: order-buy + fill-על-ה-buy. מתחת-לגובה-המזלג: ההיסטוריה (taker מרוויח
 * SAOS — הסמנטיקה-הישנה). מעל: התיקון (taker מוותר SAOS · הבעלים מקבל ·
 * אין-נעול-שלילי). שני-הנתיבים דטרמיניסטיים-ונבדקים-כאן לעד. */
const FILLBUY_TEST_GENESIS = {
  time: '2026-09-10T00:00:00.000Z',
  state: {
    meta: { supply: 5000000 },   /* הכל ב-micro! 5 SAOS */
    accounts: {
      treasury: { saos: 2000000, steem: 2000000, lockedSaos: 0, lockedSteem: 0, lp: 0, wrapped: {}, credits: 0 },
      buyer: { saos: 500000, steem: 1000000, lockedSaos: 0, lockedSteem: 0, lp: 0, wrapped: {}, credits: 0 },
      seller: { saos: 1000000, steem: 100000, lockedSaos: 0, lockedSteem: 0, lp: 0, wrapped: {}, credits: 0 },
    },
  },
};
function selfTestFillBuy() {
  const mk = () => initFromGenesis(FILLBUY_TEST_GENESIS);
  const orderTx = { type: 'order', owner: 'buyer', side: 'buy', amount: 10, price: 0.05 }; // lock=500µ STEEM
  const fillTx = (who) => ({ type: 'fill', taker: who, orderId: 1, amount: 4 });           // pay=200µ STEEM
  // ענף-תיקון (מעל המזלג)
  const stNew = mk();
  applyTx(stNew, orderTx, FILL_BUY_FIX_HEIGHT);
  const rNew = applyTx(stNew, fillTx('seller'), FILL_BUY_FIX_HEIGHT);
  const bN = stNew.accounts.buyer, sN = stNew.accounts.seller;
  const fixedOk = rNew.ok === true
    && sN.saos === 996000 && bN.saos === 504000    // SAOS: 4000µ עברו seller→buyer
    && sN.steem === 100200 && bN.steem === 999500  // STEEM: 200µ שוחררו-מהנעול אל-המוכר
    && bN.lockedSteem === 300 && bN.lockedSteem >= 0 // שארית-מנעול תקינה (500-200)
    && stNew.orders[0].amount === 6000;
  // מוכר-בלי-SAOS מספיק — נדחה (בענף-הישן-היה-מקבל-חינם!)
  const stNoFunds = mk();
  applyTx(stNoFunds, orderTx, FILL_BUY_FIX_HEIGHT);
  applyTx(stNoFunds, { type: 'transfer', from: 'seller', to: 'treasury', amount: 999 }, FILL_BUY_FIX_HEIGHT);
  const rNo = applyTx(stNoFunds, fillTx('seller'), FILL_BUY_FIX_HEIGHT);
  const noMint = rNo.ok === false && rNo.err === 'insufficient';
  // ענף-מורשת (מתחת-למזלג) — byte-זהה להיסטוריה
  const stOld = mk();
  applyTx(stOld, orderTx, FILL_BUY_FIX_HEIGHT - 1);
  const rOld = applyTx(stOld, fillTx('seller'), FILL_BUY_FIX_HEIGHT - 1);
  const bO = stOld.accounts.buyer, sO = stOld.accounts.seller;
  const legacyOk = rOld.ok === true
    && sO.saos === 1004000 && bO.saos === 496000   // הישן: SAOS זרם buyer→seller (הפוך)
    && sO.steem === 100200 && bO.lockedSteem === 300;
  // replay-דטרמיניזם על-הרצף-המתוקן
  const stR = mk();
  const root1 = (() => { applyTx(stR, orderTx, FILL_BUY_FIX_HEIGHT); applyTx(stR, fillTx('seller'), FILL_BUY_FIX_HEIGHT); return stateRoot(stR); })();
  const stR2 = mk();
  applyTx(stR2, orderTx, FILL_BUY_FIX_HEIGHT); applyTx(stR2, fillTx('seller'), FILL_BUY_FIX_HEIGHT);
  const replay = stateRoot(stR2) === root1;
  // 117p8-R8 — וקטור-pool_swapw: שימור-מלא מעל-המזלג (ה-taker מקבל את ה-out)
  // · והיסטוריה byte-זהה מתחתיו (השריפה-שנמדדה ~111 SAOS נשארת-כפי-שהייתה)
  const GENW = {
    time: '2026-09-10T00:00:00.000Z',
    state: {
      meta: { supply: 5000000 },
      accounts: {
        treasury: { saos: 2000000, steem: 2000000, lockedSaos: 0, lockedSteem: 0, lp: 0, wrapped: {}, credits: 0 },
        taker: { saos: 0, steem: 0, lockedSaos: 0, lockedSteem: 0, lp: 0, wrapped: { WTRX: 100000 }, credits: 0 },
      },
    },
  };
  const T = (st2) => { let t = 0; for (const a of Object.values(st2.accounts)) t += (a.saos || 0) + (a.lockedSaos || 0); t += st2.poolW ? st2.poolW.saos : 0; return t; };
  const mkW = () => initFromGenesis(GENW);
  const seed = (st2, at) => applyTx(st2, { type: 'wrap_mint', symbol: 'WTRX', issuer: 'treasury', to: 'treasury', amount: 200, lockedDelta: 200, ref: 'seed-' + at }, at)
    && applyTx(st2, { type: 'pool_addw', owner: 'treasury', amountSaos: 300, amountWtrx: 100 }, at);
  const swTx = { type: 'pool_swapw', taker: 'taker', side: 'sell_wtrx', inAmt: 10 };
  const stW = mkW(); seed(stW, FILL_BUY_FIX_HEIGHT);
  stW.accounts.taker.wrapped.WTRX = 100000;
  const t0 = T(stW);
  const rW = applyTx(stW, swTx, FILL_BUY_FIX_HEIGHT);
  const t1 = T(stW);
  const swapwOk = rW.ok === true && rW.out > 0 && stW.accounts.taker.saos === rW.out && t1 === t0; // ה-out הגיע-ל-taker · אפס-שריפה
  const stW2 = mkW(); seed(stW2, FILL_BUY_FIX_HEIGHT - 1);
  stW2.accounts.taker.wrapped.WTRX = 100000;
  const tL0 = T(stW2);
  const rWL = applyTx(stW2, swTx, FILL_BUY_FIX_HEIGHT - 1);
  const tL1 = T(stW2);
  const legacyBurn = rWL.ok === true && stW2.accounts.taker.saos === 0 && tL1 === tL0 - rWL.out; // ההיסטוריה: ה-out נשרף
  return { fixedOk, noMint, legacyOk, replay, swapwOk, legacyBurn, atHeight: FILL_BUY_FIX_HEIGHT };
}

/* ── וקטורי-WEAVE (W1) — determinism + אכיפות + הוכחות-מרקל ──
 * נפרדים-מהוקטורים-הקדושים (366ad477/b8ee2ee8 לא-נוגעים): המצב ממומש-עצלנית
 * בחותמת-הראשונה בלבד — לפני-כן stateRoot זהה-למקור. */
const WEAVE_TEST_GENESIS = {
  time: '2026-09-06T00:00:00.000Z',
  state: {
    meta: { supply: 9000 },
    accounts: {
      treasury: { saos: 6000, steem: 1000, lockedSaos: 0, lockedSteem: 0, lp: 0, wrapped: {}, credits: 0 },
      soldier1: { saos: 2000, steem: 0, lockedSaos: 0, lockedSteem: 0, lp: 0, wrapped: {}, credits: 0 },
      soldier2: { saos: 1000, steem: 0, lockedSaos: 0, lockedSteem: 0, lp: 0, wrapped: {}, credits: 0 },
    },
  },
};
function weaveTxs() {
  // 7-חותמות (מפלג-אי-זוגי) — ה-root מחושב-מהרישומים-עצמם בזמן-ריצה
  return [
    { type: 'stamp', h: 'a'.repeat(64), kind: 'text', by: 'soldier1', at: '2026-09-06T00:01:00.000Z' },
    { type: 'stamp', h: 'b'.repeat(64), kind: 'file', by: 'soldier1', salt: 'c'.repeat(64) },
    { type: 'stamp', h: 'd'.repeat(64), kind: 'ai', by: 'soldier2' },
    { type: 'stamp', h: 'e'.repeat(64), kind: 'url', by: 'treasury' },
    { type: 'stamp', h: 'f'.repeat(64), kind: 'text', by: 'soldier1' },
    { type: 'stamp', h: '1'.repeat(64), kind: 'file', by: 'soldier2' },
    { type: 'stamp', h: '2'.repeat(64), kind: 'sealed', by: 'treasury' },
    { type: 'stamp', h: 'a'.repeat(64), kind: 'text', by: 'soldier1' }, // חייב-היכשל exists
    { type: 'witness', topic: 'price-feed', claimHash: '3'.repeat(64), validator: 'soldier1' },
    { type: 'witness', topic: 'price-feed', claimHash: '3'.repeat(64), validator: 'soldier2' },
    { type: 'witness', topic: 'price-feed', claimHash: '3'.repeat(64), validator: 'soldier1' }, // חייב-היכשל dup-witness
  ];
}
function selfTestWeave() {
  const T = weaveTxs();
  const time = '2026-09-06T00:01:00.000Z';

  /* שלב-A · שומרים על sandbox (applyTx — בלי בלוקים) */
  const stg = initFromGenesis(WEAVE_TEST_GENESIS);
  const gres = T.map((tx) => applyTx(stg, tx));
  const dupStamp = gres[7].ok === false && gres[7].err === 'exists';
  const dupWitness = gres[10].ok === false && gres[10].err === 'dup-witness';
  const witnessQuorum = gres[9].ok === true && gres[9].witnesses === 2;
  // lazy: op לא-אריגה לא-מממש מצב-weave (הקרנל לא נוגע במצב לפני-חותמת ראשונה)
  const stl = initFromGenesis(WEAVE_TEST_GENESIS);
  applyTx(stl, { type: 'transfer', from: 'treasury', to: 'soldier1', amount: 1 });
  const lazyOk = !('weave' in stl);
  // איטום: מזויף · לא-מנפיק · count-שגוי — כולם-נדחים-בכנות
  const entriesG = Object.values(stg.weave.stamps).sort((a, b) => a.seq - b.seq);
  const goodRoot = M.rootOf(entriesG.map(weaveLeaf));
  const rBad = applyTx(stg, { type: 'seal', issuer: 'treasury', root: '9'.repeat(64), count: entriesG.length });
  const badRootCaught = rBad.ok === false && rBad.err === 'root-mismatch';
  const rIss = applyTx(stg, { type: 'seal', issuer: 'soldier2', root: goodRoot, count: entriesG.length });
  const issuerCaught = rIss.ok === false && rIss.err === 'issuer';
  const rCount = applyTx(stg, { type: 'seal', issuer: 'treasury', root: goodRoot, count: entriesG.length - 1 });
  const countCaught = rCount.ok === false && rCount.err === 'count';

  /* שלב-B · replay-מלא מאפס פעמיים — הרצף כולל ה-seal כבלוק אמיתי */
  const full = T.concat([{ type: 'seal', issuer: 'treasury', root: goodRoot, count: entriesG.length, at: time }]);
  const st = initFromGenesis(WEAVE_TEST_GENESIS);
  const roots = [];
  for (const tx of full) { buildBlock(st, [tx], time); roots.push(stateRoot(st)); }
  const st2 = initFromGenesis(WEAVE_TEST_GENESIS);
  let replay = true;
  for (let i = 0; i < full.length; i++) { buildBlock(st2, [full[i]], time); if (stateRoot(st2) !== roots[i]) { replay = false; break; } }
  const sealOk = !!st.weave.lastSeal && st.weave.lastSeal.root === goodRoot && Object.keys(st.weave.stamps).length === 0 && st.weave.seals.length === 1 && st.weave.seals[0].from === 1 && st.weave.seals[0].to === 7;
  // איטום-על-מצב-ריק (אחרי-האיטום) חייב-היכשל empty
  const rEmpty = applyTx(st, { type: 'seal', issuer: 'treasury', root: goodRoot, count: 0 });
  const emptyCaught = rEmpty.ok === false && rEmpty.err === 'empty';

  /* שלב-C · הוכחת-מרקל עצמאית: עלה #4 מאומת מהנתיב מול השורש-החתום */
  const tree = M.buildTree(entriesG.map(weaveLeaf));
  const path4 = M.prove(tree.levels, 3);
  const proofOk = M.verify(weaveLeaf(entriesG[3]), path4, goodRoot);

  return {
    lazyOk, dupStamp, dupWitness, witnessQuorum,
    badRootCaught, issuerCaught, countCaught, emptyCaught, sealOk, replay, proofOk,
    goodRoot, finalRoot: stateRoot(st),
  };
}

if (require.main === module) {
  const mode = process.argv.includes('--selftest');
  if (mode) {
    const t = selfTest();
    console.log('ops:', t.ops, '· replay-determinism:', t.replay ? 'OK' : 'BROKEN');
    console.log('final state-root:', t.finalRoot);
    console.log('per-op roots:');
    t.roots.forEach((r, i) => console.log('  #' + (i + 1), TEST_TXS[i].type.padEnd(10), r));
    const rot = selfTestRotation();
    console.log('rotation vectors: replay=' + (rot.replay ? 'OK' : 'BROKEN') + ' · dup-guard=' + (rot.dupGuard ? 'OK' : 'BROKEN') + ' · last=' + rot.lastProducer + ' · rounds=' + rot.rounds.join(','));
    console.log('rotation final root:', rot.finalRoot);
    const wv = selfTestWeave();
    const weaveOk = wv.lazyOk && wv.dupStamp && wv.dupWitness && wv.witnessQuorum && wv.badRootCaught && wv.issuerCaught && wv.countCaught && wv.emptyCaught && wv.sealOk && wv.replay && wv.proofOk;
    console.log('weave vectors: ' + (weaveOk ? 'OK' : 'BROKEN') + ' · lazy=' + wv.lazyOk + ' · dup-stamp=' + wv.dupStamp + ' · dup-witness=' + wv.dupWitness + ' · quorum=' + wv.witnessQuorum + ' · bad-root=' + wv.badRootCaught + ' · issuer=' + wv.issuerCaught + ' · count=' + wv.countCaught + ' · empty=' + wv.emptyCaught + ' · seal=' + wv.sealOk + ' · replay=' + wv.replay + ' · proof=' + wv.proofOk);
    console.log('weave sealed root (7 stamps, odd-fold):', wv.goodRoot);
    console.log('weave final root:', wv.finalRoot);
    const fb = selfTestFillBuy();
    const fbOk = fb.fixedOk && fb.noMint && fb.legacyOk && fb.replay && fb.swapwOk && fb.legacyBurn;
    console.log('R8 fork vectors (' + fb.atHeight + '): ' + (fbOk ? 'OK' : 'BROKEN') + ' · fill-fixed=' + fb.fixedOk + ' · no-mint=' + fb.noMint + ' · fill-legacy=' + fb.legacyOk + ' · replay=' + fb.replay + ' · swapw-conserved=' + fb.swapwOk + ' · swapw-legacy-burn=' + fb.legacyBurn);
    if (!t.replay || !rot.replay || !rot.dupGuard || !weaveOk || !fbOk) process.exit(1);
  } else {
    console.log('kernel.cjs — SAOS-NET v0 deterministic kernel. usage: --selftest');
  }
}
