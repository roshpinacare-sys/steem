#!/usr/bin/env node
/* chain_forensics.cjs — 117p8-R8: פורנזיקה ממוקדת (המשך chain_audit2).
 *  1. מסע-חי מ-snapshot.st קדימה (בלוקי-חלון מעל ה-snapshot) — hash-clean?
 *  2. מסע-חי מ-snapshot.prev.st קדימה — hash-clean?
 *  3. הוכחת-שורש: state-root.json שבור-מול-הספר (מסע 12-בלוקים) → poison מוכח
 *  4. בעלי-הזמנות-buy הממולאות · דוגמאות מילוי (taker/amount)
 *  5. אריתמטיקת-נעילה לכל הזמנת-buy: lock מול Σ שחרורים (fills+cancels) → over-release
 *  6. אינווריאנט-אספקה מתוקן: accounts + pool + poolW + poolsX(SAOS/STEEM צדדים)
 *     + relay-escrow(locked כבר-בחשבון) מול supply — על ה-snapshot החי
 */
'use strict';
const fs = require('fs');
const path = require('path');
const K = require('../core/kernel.cjs');
const NODE = __dirname;

const rep = {};
const log = (k, v) => { rep[k] = v; console.log(k + ': ' + JSON.stringify(v).slice(0, 600)); };

/* טעינת ספר */
const byH = new Map();
{
  const lines = fs.readFileSync(path.join(NODE, 'chain-archive.jsonl'), 'utf8').split('\n');
  for (const l of lines) { if (!l.trim()) continue; try { const b = JSON.parse(l); if (!byH.has(b.height)) byH.set(b.height, b); } catch (_) {} }
  const win = JSON.parse(fs.readFileSync(path.join(NODE, 'chain.json'), 'utf8'));
  for (const b of (Array.isArray(win) ? win : win.blocks)) if (!byH.has(b.height)) byH.set(b.height, b);
}
const maxH = Math.max(...byH.keys());

/* walkForward — מסע hash-מאומת מ-base עד ראש (או עד שבירה) */
function walkForward(base, fromH) {
  const st = JSON.parse(JSON.stringify(base));
  st.meta.issuer = 'headcorner';
  let expectPrev = base.meta.lastBlockHash, walked = 0, hashBreak = null, linkBreak = null;
  for (let h = fromH; h <= maxH; h++) {
    const b = byH.get(h);
    if (!b) { linkBreak = h; break; }
    if (b.prevHash !== expectPrev) { linkBreak = h; break; }
    const { block } = K.buildBlock(st, b.txs, b.time);
    if (block.hash !== b.hash) { hashBreak = h; break; }
    expectPrev = b.hash; walked++;
  }
  return { walked, head: fromH + walked - (hashBreak || linkBreak ? 1 : 0), hashBreak, linkBreak, finalRoot: K.stateRoot(st), st };
}

/* 1+2 — מסע מה-snapshots החיים */
const snap = JSON.parse(fs.readFileSync(path.join(NODE, 'state-snapshot.json'), 'utf8'));
const snapP = JSON.parse(fs.readFileSync(path.join(NODE, 'state-snapshot.prev.json'), 'utf8'));
const w1 = walkForward(snap.st, snap.height + 1);
log('walkFromSnapshot', { from: snap.height + 1, ...w1, finalRoot: w1.finalRoot.slice(0, 16) });
const w2 = walkForward(snapP.st, snapP.height + 1);
log('walkFromSnapshotPrev', { from: snapP.height + 1, ...w2, finalRoot: w2.finalRoot.slice(0, 16) });

/* 3 — הוכחת-רעל בשורש: 12 בלוקים מה-rootfile */
const rf = JSON.parse(fs.readFileSync(path.join(NODE, 'state-root.json'), 'utf8'));
const w3 = walkForward(rf.st, rf.height + 1);
log('walkFromRootfile', { from: rf.height + 1, walked: w3.walked, hashBreak: w3.hashBreak, linkBreak: w3.linkBreak, verdict: w3.hashBreak || w3.linkBreak ? 'POISONED-PROVEN' : 'clean' });

/* 4+5 — פורנזיקת הזמנות-buy על כל-הספר */
const orders = new Map(); // id → {side, owner, amountµ, price, lock, released, fills, lastFill}
let buyFillExamples = [], buyFilledCount = 0, buyFilledOwners = new Map();
for (const [h, b] of byH) {
  const txs = b.txs || [], res = b.results || [];
  for (let i = 0; i < txs.length; i++) {
    const tx = txs[i], r = res[i] || {};
    if (tx.type === 'order' && r.ok) {
      const a = Math.round(Number(tx.amount) * 1000);
      const p = Math.round(Number(tx.price) * 1e6);
      const lock = tx.side === 'buy' ? Math.ceil(a * (p / 1e6)) : 0;
      orders.set(r.orderId, { side: tx.side, owner: String(tx.owner).toLowerCase(), amount: a, price: p, lock, released: 0, fills: 0, fillµ: 0, h });
    } else if (tx.type === 'fill' && r.ok) {
      const o = orders.get(tx.orderId);
      if (o && o.side === 'buy') {
        const a = Math.min(Math.round(Number(tx.amount) * 1000), o.amount);
        const pay = Math.ceil(a * (o.price / 1e6));
        o.released += pay; o.fills++; o.fillµ += a;
        buyFilledCount++;
        buyFilledOwners.set(o.owner, (buyFilledOwners.get(o.owner) || 0) + 1);
        if (buyFillExamples.length < 6 && o.fills === 1) buyFillExamples.push({ h, orderId: tx.orderId, owner: o.owner, taker: tx.taker, amount: tx.amount, price: o.price / 1e6 });
      }
    } else if (tx.type === 'cancel' && r.ok) {
      const o = orders.get(tx.orderId);
      if (o && o.side === 'buy') o.released += Math.ceil(o.amount * (o.price / 1e6));
    }
  }
}
log('buyFills', { count: buyFilledCount, owners: [...buyFilledOwners.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10), examples: buyFillExamples });
const over = [];
for (const [id, o] of orders) if (o.side === 'buy' && o.fills > 0 && o.released > o.lock) over.push({ id, owner: o.owner, lock: o.lock, released: o.released, delta: o.released - o.lock, fills: o.fills });
over.sort((a, b) => b.delta - a.delta);
log('overRelease', { count: over.length, totalDelta: over.reduce((s, x) => s + x.delta, 0), top: over.slice(0, 8) });

/* 6 — אינווריאנט-אספקה מתוקן על ה-snapshot החי */
const st = snap.st;
let sumSaos = (st.accounts || {}); let accSaos = 0, accSteem = 0;
const neg = [];
for (const [n, a] of Object.entries(st.accounts)) {
  accSaos += a.saos || 0; accSteem += a.steem || 0;
  if (a.lockedSaos < 0) neg.push(n + ':lockedSaos:' + a.lockedSaos);
  if (a.lockedSteem < 0) neg.push(n + ':lockedSteem:' + a.lockedSteem);
  for (const [s2, amt] of Object.entries(a.wrapped || {})) if (amt < 0) neg.push(n + ':w' + s2 + ':' + amt);
}
const inPool = (st.pool && st.pool.saos || 0);
const inPoolW = (st.poolW && st.poolW.saos || 0);
let inPoolsX = 0, inPoolsXSteem = 0;
for (const p of Object.values(st.poolsX || {})) { if (p.symA === 'SAOS') inPoolsX += p.a; if (p.symB === 'SAOS') inPoolsX += p.b; if (p.symA === 'STEEM') inPoolsXSteem += p.a; if (p.symB === 'STEEM') inPoolsXSteem += p.b; }
log('supplyInvariant', {
  height: st.meta.height, supply: st.meta.supply,
  accountsSaos: accSaos, poolSaos: inPool, poolWSaos: inPoolW, poolsXSaos: inPoolsX,
  totalSaos: accSaos + inPool + inPoolW + inPoolsX,
  accountsSteem: accSteem, poolSteem: st.pool && st.pool.steem, poolWSteem: st.poolW && st.poolW.wtrx, poolsXSteem: inPoolsXSteem,
  totalSteem: accSteem + (st.pool && st.pool.steem || 0) + inPoolsXSteem,
  negatives: neg,
});

fs.writeFileSync(path.join(NODE, 'chain_forensics_report.json'), JSON.stringify(rep, null, 2));
console.log('→ node/chain_forensics_report.json');
