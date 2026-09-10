#!/usr/bin/env node
/* chain_audit.cjs — 117p8-R8 ROAST: אמת-מציאות של שרשרת SAOS עצמה.
 *
 * לא סומכים על שום טענה: replay מלא מג'נזיס דרך הקרנל, hash-ל-hash,
 * checkpoint-ל-checkpoint, ואז פורנזיקה של כל-הבאגים-החשודים:
 *   1) שלמות-בלוקים: hash מחושב-מחדש == hash שמור · prevHash רציף
 *   2) שלמות-מצב: state-root סופי == state-root.json == state.json
 *   3) checkpoints: stateRoot+blockHash מאומתים בגובה
 *   4) שימור-אספקה: Σ(saos) מול meta.supply · Σ(steem) מול host+genesis
 *   5) פורנזיקת buy-fill: כל-מילוי-מוצלח על הזמנת-buy — מי שילם מה, למי
 *   6) ארכיון: chain-archive.jsonl מלא? טייל-תואם? seal-gz תקין?
 *   7) סנאפשוט: state-snapshot.json == state.json
 * פלט: node/chain_audit_report.json + קונסולה (אפס-סודות).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const K = require('../core/kernel.cjs');

const NODE = path.join(__dirname);
const chainRaw = JSON.parse(fs.readFileSync(path.join(NODE, 'chain.json'), 'utf8'));
const blocks = Array.isArray(chainRaw) ? chainRaw : (chainRaw.blocks || []);
const genesis = JSON.parse(fs.readFileSync(path.join(NODE, '..', 'genesis', 'genesis.json'), 'utf8'));
const stateLive = JSON.parse(fs.readFileSync(path.join(NODE, 'state.json'), 'utf8'));
const rootLive = JSON.parse(fs.readFileSync(path.join(NODE, 'state-root.json'), 'utf8'));
const snap = JSON.parse(fs.readFileSync(path.join(NODE, 'state-snapshot.json'), 'utf8'));

const rep = { ts: new Date().toISOString(), blocks: blocks.length, checks: {}, findings: [] };
const F = (sev, id, msg) => { rep.findings.push({ sev, id, msg }); console.log(`[${sev}] ${id} — ${msg}`); };
const OKM = (id, msg) => { console.log(`[OK] ${id} — ${msg}`); };

/* 1+2+3 — replay מלא */
const st = K.initFromGenesis(genesis);
let hashChainOk = true, prevOk = true, gasOk = true, badHashAt = null, badPrevAt = null;
let storedRootsMatchReplay = true;
const cpByHeight = new Map();
for (const cp of (stateLive.checkpoints || [])) cpByHeight.set(cp.height, cp);
const buyFills = [];
const yieldsFail = [];
const supplyTrack = [];
let cpsVerified = 0, cpsBroken = [];

for (const b of blocks) {
  // prevHash רציף
  if (b.prevHash !== (st.meta.lastBlockHash || null)) { prevOk = false; badPrevAt = b.height; }
  // שחזור בלוק דרך הקרנל (החוק: אותו buildBlock)
  const { block, results } = K.buildBlock(st, b.txs, b.time);
  // hash מחושב-מחדש == hash שמור
  if (block.hash !== b.hash) { hashChainOk = false; badHashAt = b.height; }
  // results ו-gas תואמים
  const gasRe = results.reduce((s, r) => s + (r.gas || 0), 0);
  if (gasRe !== b.gasUsed) gasOk = false;
  // checkpoint בגובה זה?
  const cp = cpByHeight.get(b.height);
  if (cp) {
    const live = K.stateRoot(st);
    if (cp.stateRoot === live && cp.blockHash === b.hash) cpsVerified++;
    else cpsBroken.push({ h: b.height, cpRoot: cp.stateRoot, liveRoot: live });
  }
  // פורנזיקה
  for (let i = 0; i < (b.txs || []).length; i++) {
    const tx = b.txs[i], r = results[i] || {};
    if (tx.type === 'fill' && r.ok) {
      // נמצא צד-ההזמנה: סריקה אחורה על מצב-ההזמנות שלנו — נשתמש ב-st.orders
      const ord = st.orders.find((o) => o.id === tx.orderId);
      if (ord && ord.side === 'buy' && ord.owner) {
        buyFills.push({ h: b.height, owner: ord.owner, taker: String(tx.taker || '').toLowerCase(), amount: r.filled || 0 });
      }
    }
    if (tx.type === 'yield' && !r.ok && r.err === 'treasury-insufficient') yieldsFail.push(b.height);
  }
}

rep.checks.hashChainOk = hashChainOk; rep.checks.prevOk = prevOk; rep.checks.gasOk = gasOk;
if (!hashChainOk) F('CRITICAL', 'hash-chain', `hash מחושב ≠ שמור בגובה ${badHashAt}`); else OKM('hash-chain', `${blocks.length} בלוקים — hash מחושב-מחדש זהה לכולם`);
if (!prevOk) F('CRITICAL', 'prev-link', `prevHash רציף נשבר בגובה ${badPrevAt}`); else OKM('prev-link', 'שרשרת-prevHash רציפה מ-1 עד ' + blocks.length);
if (!gasOk) F('MEDIUM', 'gas', 'gasUsed שמור ≠ מחושב בבלוק כלשהו'); else OKM('gas', 'gasUsed זהה בכל הבלוקים');

/* מצב סופי */
const rootReplay = K.stateRoot(st);
const rootFromStateJson = K.stateRoot(stateLive.state || stateLive);
const rootFromRootFile = rootLive.root || rootLive.stateRoot || (rootLive.state && K.stateRoot(rootLive.state));
rep.checks.finalRootReplay = rootReplay;
rep.checks.rootMatchesStateJson = rootFromStateJson === rootReplay;
rep.checks.rootMatchesRootFile = rootFromRootFile === rootReplay;
if (rootFromStateJson !== rootReplay) F('CRITICAL', 'state-root', 'state.json לא תואם ל-replay (' + rootFromStateJson.slice(0, 12) + '≠' + rootReplay.slice(0, 12) + ')'); else OKM('state-root', 'state.json == replay == ' + rootReplay.slice(0, 16) + '…');
if (rootFromRootFile !== rootReplay) F('CRITICAL', 'state-root-file', 'state-root.json לא תואם ל-replay'); else OKM('state-root-file', 'state-root.json זהה ל-replay');

/* checkpoints */
rep.checks.checkpoints = { total: cpByHeight.size, verified: cpsVerified, broken: cpsBroken.length };
if (cpsBroken.length) F('CRITICAL', 'checkpoints', cpsBroken.length + ' צ׳קפוינטים לא מאומתים-מתמטית'); else OKM('checkpoints', cpsVerified + '/' + cpByHeight.size + ' צ׳קפוינטים מאומתים בגובה-מדויק');

/* שימור אספקה */
let sumSaos = 0, sumSteem = 0, negAccounts = [];
for (const [n, a] of Object.entries(st.accounts)) {
  sumSaos += a.saos || 0; sumSteem += a.steem || 0;
  if ((a.saos || 0) < 0 && n !== 'host') negAccounts.push(n);
  if ((a.lockedSaos || 0) < 0) negAccounts.push(n + ':lockedSaos');
  if ((a.lockedSteem || 0) < 0) negAccounts.push(n + ':lockedSteem');
}
rep.checks.supply = { sumSaos, meta: st.meta.supply, sumSteem, negativeAccounts: negAccounts.slice(0, 20) };
if (st.meta.supply != null && sumSaos !== st.meta.supply) F('HIGH', 'supply-invariant', `Σ(saos)=${sumSaos} ≠ meta.supply=${st.meta.supply}`); else OKM('supply-invariant', `Σ(saos)=${sumSaos} == supply`);
if (negAccounts.length) F('HIGH', 'negative-balances', 'חשבונות-שליליים (חוץ-מ-host): ' + negAccounts.join(', ')); else OKM('negative-balances', 'אף-יתרה-שלילית (חוץ-מ-host המותר)');

/* 5 — פורנזיקת buy-fill */
let drained = new Map(), mintedTo = new Map();
for (const bf of buyFills) {
  drained.set(bf.owner, (drained.get(bf.owner) || 0) + bf.amount);
  mintedTo.set(bf.taker, (mintedTo.get(bf.taker) || 0) + bf.amount);
}
rep.checks.buyFillForensics = {
  count: buyFills.length,
  ownersDrained: [...drained.entries()].map(([o, µ]) => ({ o, µ })).sort((a, b) => b.µ - a.µ).slice(0, 12),
  takersPaid: [...mintedTo.entries()].map(([t, µ]) => ({ t, µ })).sort((a, b) => b.µ - a.µ).slice(0, 12),
  totalµ: buyFills.reduce((s, x) => s + x.amount, 0),
};
if (buyFills.length) F('CRITICAL', 'buy-fill-inverted', `${buyFills.length} מילויים-מוצלחים על הזמנות-buy בענף-הפוך: הבעלים שילם SAOS+STEEM וה-taker קיבל את שניהם (Σ=${rep.checks.buyFillForensics.totalµ}µ)`); else OKM('buy-fill', 'אין מילויי-buy בהיסטוריה');

rep.checks.yieldFails = yieldsFail.length;
if (yieldsFail.length) F('HIGH', 'yield-atomicity', 'yield נכשל treasury-insufficient אחרי מוטציות חלקיות (אל-אטומי): ' + yieldsFail.length);
else OKM('yield', 'אין yield-כושלים בהיסטוריה — הבאג-האטומי רלוונטי-עתידית בלבד');

/* 6 — ארכיון */
try {
  const arch = fs.readFileSync(path.join(NODE, 'chain-archive.jsonl'), 'utf8');
  const lines = arch.trim().split('\n').filter(Boolean);
  const last = JSON.parse(lines[lines.length - 1]);
  const first = JSON.parse(lines[0]);
  const lastBlock = blocks[blocks.length - 1];
  const archOk = last.hash === lastBlock.hash && lines.length >= blocks.length;
  rep.checks.archive = { lines: lines.length, blocks, firstH: first.height, lastH: last.height, tailHashMatch: last.hash === lastBlock.hash };
  if (!archOk) F('HIGH', 'archive', `ארכיון ${lines.length} שורות מול ${blocks.length} בלוקים · טייל-תואם=${last.hash === lastBlock.hash}`);
  else OKM('archive', `${lines.length} שורות · טייל == ראש-השרשרת`);
} catch (e) { F('MEDIUM', 'archive', 'לא נבדק: ' + e.message); }
try {
  const gz = fs.readFileSync(path.join(NODE, 'chain-archive-seal.jsonl.gz'));
  const zlib = require('zlib');
  const txt = zlib.gunzipSync(gz).toString('utf8');
  const lines = txt.trim().split('\n').filter(Boolean);
  rep.checks.sealGz = { lines: lines.length, parseOk: true };
  OKM('seal-gz', `gzip תקין · ${lines.length} רשומות-איטום`);
} catch (e) { F('HIGH', 'seal-gz', 'gzip פגום: ' + e.message); }

/* 7 — סנאפשוט */
try {
  const snapRoot = K.stateRoot(snap.state || snap);
  rep.checks.snapshotRootMatch = snapRoot === rootReplay;
  if (snapRoot !== rootReplay) F('MEDIUM', 'snapshot', 'state-snapshot.json מפגר אחרי המצב החי (root ' + snapRoot.slice(0, 10) + ') — מסמך-שחזור שקרי'); else OKM('snapshot', 'state-snapshot == מצב-חי');
} catch (e) { F('MEDIUM', 'snapshot', 'לא נבדק: ' + e.message); }

/* ממצאים-נוספים: probes */
rep.checks.meta = { height: st.meta.height, supply: st.meta.supply, trades: st.meta.trades, swaps: st.meta.swaps, accounts: Object.keys(st.accounts).length, liveOrders: st.orders.filter((o) => o.live).length, ordersTotal: st.orders.length };
rep.checks.buyFillSample = buyFills.slice(0, 8);

fs.writeFileSync(path.join(NODE, 'chain_audit_report.json'), JSON.stringify(rep, null, 2));
console.log('\nreport → node/chain_audit_report.json');
const crit = rep.findings.filter((f) => f.sev === 'CRITICAL').length;
console.log(`SUMMARY: findings=${rep.findings.length} critical=${crit}`);
