#!/usr/bin/env node
/* saosnet-status.cjs — SAOS-NET: סטטוס חי + אימות עצמאי ב-JSON (Task 15-b)
 *
 * הרצה: node scripts/saosnet-status.cjs
 * פלט:   JSON ב-stdout — אימות replay מלא (snapshot ⇒ בלוקים ⇒ שורש סופי)
 *        + תמצית הכלכלה (חיילים/LP/נכסים עטופים) + מצב האריגה (weave)
 *        + הדלתות (relay) + הקציר (harvest) + ארנקי-הצבא (wallets).
 *
 * תווית אמת: האימות מתמטי ודטרמיניסטי — אותו קלט = אותו פלט בכל מכונה
 * (קרנל SAOS-NET v0). ה-pack עצמו נגזר מריפו הפלטפורמה של הצי (DERIVED)
 * וניתן להצלבה מול ההיסטוריה הציבורית של המארח.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const PACK = path.resolve(__dirname, '..', 'saos-verify');
const K = require(path.join(PACK, 'sovereign', 'core', 'kernel.cjs'));
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const sr = read(path.join(PACK, 'sovereign', 'node', 'state-root.json'));
const chain = read(path.join(PACK, 'sovereign', 'node', 'chain.json'));
const nodeState = read(path.join(PACK, 'sovereign', 'node', 'state.json'));
const genesis = read(path.join(PACK, 'sovereign', 'genesis', 'genesis.json'));

// ── 1. עקביות-עצמית של ה-snapshot ──
const st = JSON.parse(JSON.stringify(sr.st));
const snapRoot = K.stateRoot(st);
const snapshotSelf = snapRoot === sr.stateRoot;

// ── 2. replay של כל הבלוקים מעל גובה ה-snapshot ──
const blocks = chain.blocks
  .filter((b) => b.height > sr.height)
  .sort((a, b) => a.height - b.height);
let hashOk = 0, linkOk = 0;
const bad = [];
let prev = st.meta.lastBlockHash;
for (const b of blocks) {
  if (b.prevHash === prev) linkOk++;
  else bad.push({ h: b.height, why: 'prevHash-link' });
  const { block } = K.buildBlock(st, b.txs, b.time);
  if (block.hash === b.hash) hashOk++;
  else bad.push({ h: b.height, why: 'hash-mismatch' });
  prev = b.hash;
}

// ── 3. המצב הסופי מול הצהרת הצומת ──
const finalRoot = K.stateRoot(st);
const rootMatch = finalRoot === nodeState.stateRoot;
const heightMatch = st.meta.height === nodeState.height;
const verified = snapshotSelf && hashOk === blocks.length && linkOk === blocks.length && rootMatch && heightMatch;

// ── 4. תמצית הכלכלה מהמצב המשוחזר (החיילים = החשבונות) ──
const accounts = st.accounts || {};
const fromMicro = (n) => Math.round((n || 0) / 1000 * 1000) / 1000;
const soldiers = Object.entries(accounts)
  .map(([name, a]) => {
    const acc = a || {};
    const wrapped = Object.entries(acc.wrapped || {})
      .filter(([, v]) => (v || 0) > 0)
      .map(([sym, v]) => `${sym}:${fromMicro(v)}`);
    return {
      name,
      saos: fromMicro(acc.saos),
      steem: fromMicro(acc.steem),
      lp: Math.round((acc.lp || 0) / 1000) / 1000, // µlp → LP
      lockedSaos: fromMicro(acc.lockedSaos),
      wrapped,
    };
  })
  .sort((a, b) => b.lp - a.lp || b.saos - a.saos);

const lpHolders = soldiers.filter((s) => s.lp > 0).length;
const wrappedSymbols = [
  ...new Set(soldiers.flatMap((s) => s.wrapped.map((w) => w.split(':')[0]))),
].sort();

// ── 5. מודולי הרשת מהמצב המשוחזר ──
const weave = st.weave || {};
const seals = Array.isArray(weave.seals) ? weave.seals : [];
const relay = st.relay || null;
const harvest = st.harvest || null;
const wallets = st.wallets || null;
const book = st.book || null;
const orderCount = book && Array.isArray(book.orders) ? book.orders.length : null;

// r121 — גיל ה-pack בכנות: השעה שעל הבלוק האחרון שבו, לא חותמת-בדיקה
// טרייה מעל נתונים קפואים. pack מעל 24ש' מתויג FROZEN-PACK בגלוי.
const packLastTime = st.meta.lastTime ? Date.parse(st.meta.lastTime) : NaN;
const packAgeHours = Number.isFinite(packLastTime) ? Math.round(((Date.now() - packLastTime) / 3.6e6) * 10) / 10 : null;

const out = {
  // r124 · חוק: ok אמיתי — חבילה שלא עברה אימות אינה "ok" בשום קורא.
  // הצרכן שקורא רק את ok מקבל כעת את פסק-הדין הכנה של האימות.
  ok: verified,
  net: {
    netVersion: st.netVersion || nodeState.netVersion || 'saos-net/0',
    genesisHash: genesis.genesisHash || null,
    height: st.meta.height,
    stateRoot: finalRoot,
    lastBlockHash: st.meta.lastBlockHash || null,
    lastTime: st.meta.lastTime || null,
    issuer: st.meta.issuer || null,
    supply: st.meta.supply ?? null,
    lastHeartbeat: st.meta.lastHeartbeat || null,
    snapshotHeight: sr.height,
    blocksInPack: chain.blocks.length,
    archivedGapsFile: fs.existsSync(path.join(PACK, 'sovereign', 'node', 'archive_gaps.json')),
  },
  verify: {
    snapshotSelf,
    snapshotRootClaimed: sr.stateRoot,
    replayed: blocks.length,
    hashMatch: `${hashOk}/${blocks.length}`,
    linkage: `${linkOk}/${blocks.length}`,
    finalRoot,
    nodeClaimRoot: nodeState.stateRoot,
    nodeClaimHeight: nodeState.height,
    rootMatch,
    heightMatch,
    verdict: verified
      ? 'FULLY-VERIFIED — chain state is mathematically consistent from snapshot'
      : rootMatch
        ? 'PARTIAL — root ok, other checks failed'
        : 'ROOT-MISMATCH — node state does not verify',
    mismatches: bad.slice(0, 5),
    genesisDerivedAt: genesis.time || null,
    genesisSources: Object.keys(genesis.sources || {}),
  },
  economy: {
    soldiers: soldiers.length,
    lpHolders,
    lpSupply: Math.round((genesis.counts && genesis.counts.poolLpSupplyUlp || 0) / 1000) / 1000,
    wrappedSymbols,
    orderBookOrders: orderCount,
    accounts: soldiers,
  },
  weave: {
    total: weave.total ?? 0,
    seals: seals.length,
    lastSeal: seals.length > 0 ? seals[seals.length - 1] : null,
    witnesses: Object.keys(weave.witnesses || {}).length,
    liveCap: 1024,
  },
  doors: relay
    ? {
        issued: relay.issued ?? 0,
        sent: relay.sent ?? 0,
        open: Object.keys(relay.open || {}).length,
        gasSettledSun: relay.gasSettledSun ?? 0,
        note: 'v:1 חינם-מלא · v:2 escrow-GAS-SETTLE · v:3 עמלת-קציר — החינם הוא היתרון',
      }
    : { issued: 0, sent: 0, open: 0, gasSettledSun: 0, note: 'אופס 108 בקרנל, טרם הופעל ב-pack' },
  harvest: harvest
    ? {
        pot: fromMicro(harvest.potµ),
        streams: Object.fromEntries(
          Object.entries(harvest.byStream || {}).map(([k, v]) => [k, fromMicro(v)])
        ),
        count: harvest.count ?? 0,
        released: fromMicro(harvest.releasedµ ?? 0),
      }
    : { pot: 0, streams: {}, count: 0, released: 0 },
  wallets: wallets
    ? {
        total: wallets.recs ? wallets.recs.length : 0,
        agents: wallets.recs ? new Set(wallets.recs.map((r) => r.agent)).size : 0,
        last: wallets.recs ? wallets.recs.slice(-5).reverse() : [],
      }
    : { total: 0, agents: 0, last: [] },
  truthLabel: 'REAL (דטרמיניסטי — replay מתמטי) · ה-pack: DERIVED מריפו הפלטפורמה של הצי · גיל ה-pack מתויג בגלוי',
  pack: {
    path: 'saos-verify/',
    kernelOps: Object.keys(K.GAS || K.gas || {}).length || null,
    checkedAt: new Date().toISOString(),
    lastAdvancedAt: st.meta.lastTime || null,
    ageHours: packAgeHours,
    state:
      packAgeHours == null
        ? 'UNKNOWN-AGE'
        : packAgeHours > 24
          ? 'FROZEN-PACK — replay אמיתי על תמונת-מצב שאינה מתקדמת; אין ריפו שמעדכן את ה-pack מאז שהפלטפורמה הפסיקה לכתוב אליו'
          : 'LIVE-PACK',
  },
};

process.stdout.write(JSON.stringify(out, null, 2) + '\n');
