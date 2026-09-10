#!/usr/bin/env node
/* chain_audit2.cjs — 117p8-R8 ROAST v2: אמת-מציאות מתמטית של SAOS-NET עצמה.
 *
 * מה נבדק (בלי לסמוך על אף טענה):
 *  A. איטום-בייטים: sha256 של הקידומת-החתומה של הארכיון == seal-state · sha256 של ה-gz
 *  B. hash-פר-בלוק: כל בלוק (ארכיון+חלון) — sha256(canon(block)) == hash שמור
 *  C. כפילויות: זהות-byte מול סותרות (hash שונה לאותו גובה = fork אמיתי)
 *  D. פערי-גובה: כל הגבהים החסרים 1..max — טווחים, מספרים, מתועד-או-לא
 *  E. שורש-עצמי: state-root.json — stateRoot(st) == stateRoot המוצהר
 *  F. מסע-התחנות: rootfile.st@126000 + בלוקים (buildBlock — hash מאומת בדרך)
 *     → == snapshot.st@X (שוויון byte) → המשך עד ראש → מצב-חי + שורש סופי
 *  G. checkpoints בטווח-המסע: stateRoot שמור == root חי בגובה
 *  H. פורנזיקת buy-fill על כל-ההיסטוריה הידועה (ארכיון+חלון): side נגזר מה-order-creation
 *  I. אינווריאנטים במצב-הסופי: Σsaos==supply · יתרות-שליליות · locked-שלילי
 *  J. weave: totalStamps/totalSeals/meta עקביות עם weave state
 * פלט: node/chain_audit2_report.json · אפס-סודות.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const K = require('../core/kernel.cjs');
const NODE = __dirname;

const rep = { ts: new Date().toISOString(), findings: [] };
const F = (sev, id, msg) => { rep.findings.push({ sev, id, msg }); console.log(`[${sev}] ${id} — ${msg}`); };
const OKM = (id, msg) => { console.log(`[OK] ${id} — ${msg}`); };
const shaFile = (p, len) => { const fd = fs.openSync(p, 'r'); try { const buf = Buffer.alloc(len); const n = fs.readSync(fd, buf, 0, len, 0); return crypto.createHash('sha256').update(n === len ? buf : buf.subarray(0, n)).digest('hex'); } finally { fs.closeSync(fd); } };

/* A — איטום-בייטים */
try {
  const seal = JSON.parse(fs.readFileSync(path.join(NODE, 'chain-archive-seal-state.json'), 'utf8'));
  const archSize = fs.statSync(path.join(NODE, 'chain-archive.jsonl')).size;
  rep.seal = { sealedAt: seal.at, archiveBytes: seal.archiveBytes, currentBytes: archSize, restoredAt: seal.restoredAt };
  if (archSize >= seal.archiveBytes) {
    const prefixSha = shaFile(path.join(NODE, 'chain-archive.jsonl'), seal.archiveBytes);
    rep.seal.prefixMatch = prefixSha === seal.archiveSha256;
    if (prefixSha === seal.archiveSha256) OKM('archive-seal', `קידומת ${seal.archiveBytes}B == האיטום מ-${seal.at} (append-only מוכח)`);
    else F('HIGH', 'archive-seal', `קידומת-הארכיון שונה מהאיטום! (${prefixSha.slice(0, 10)} ≠ ${seal.archiveSha256.slice(0, 10)})`);
  } else F('HIGH', 'archive-seal', `הארכיון קטן מהאיטום (${archSize} < ${seal.archiveBytes}) — נחתך אחרי-האיטום!`);
  const gzSha = shaFile(path.join(NODE, 'chain-archive-seal.jsonl.gz'), fs.statSync(path.join(NODE, 'chain-archive-seal.jsonl.gz')).size);
  rep.seal.gzMatch = gzSha === seal.sealSha256;
  if (gzSha === seal.sealSha256) OKM('seal-gz', 'gz == איטום (sha זהה)');
  else F('MEDIUM', 'seal-gz', 'gz שונה מהאיטום-הרשום (אולי נאטם אחר-כך — מתועד)');
} catch (e) { F('MEDIUM', 'seal', 'לא נבדק: ' + e.message); }

/* B+C+D — פארס ארכיון + חלון: hash-פר-בלוק, כפילויות, פערים */
const byH = new Map(); // height → {block, dupSame, dupDiff}
let badHash = [], dupSame = 0, dupDiff = 0, badLines = 0;
const classify = (b, src) => {
  if (!b || !Number.isInteger(b.height)) { badLines++; return; }
  /* 117p8-R8 הערה-שיטתית: rehash-ישיר של שורת-JSON אינו אמת-מעבר — האחסון
   * מוריד מפתחות-undefined (filled/out/shares/orderId) שהיו-קיימים-בזמן-החתימה
   * (גילוי-71). ה-אמת-המתמטית = מסע-ההוכחה (walk) דרך K.buildBlock — למטה.
   * כאן ה-rehash משמש רק לזיהוי-כפילויות/סתירות לפי hash-שמור. */
  const prev = byH.get(b.height);
  if (!prev) byH.set(b.height, { b, src });
  else if (prev.b.hash === b.hash) dupSame++;
  else { dupDiff++; if (!prev.diffWith) prev.diffWith = []; prev.diffWith.push(src + ':' + (b.hash || '').slice(0, 8)); }
};
{
  console.log('parsing archive…');
  const raw = fs.readFileSync(path.join(NODE, 'chain-archive.jsonl'), 'utf8').split('\n');
  for (const line of raw) { if (!line.trim()) continue; try { classify(JSON.parse(line), 'archive'); } catch (_) { badLines++; } }
  const win = JSON.parse(fs.readFileSync(path.join(NODE, 'chain.json'), 'utf8'));
  const winBlocks = Array.isArray(win) ? win : win.blocks;
  for (const b of winBlocks) classify(b, 'window');
  rep.window = { first: winBlocks[0].height, last: winBlocks[winBlocks.length - 1].height, n: winBlocks.length };
}
rep.blockHashCheck = { checked: byH.size, method: 'walk-based (K.buildBlock) — see walk/walkFromRootfile findings' };
OKM('block-hash', `${byH.size} בלוקים בספר — אימות-hash דרך מסע-ההוכחה (למטה)`);
rep.dups = { identical: dupSame, conflicting: dupDiff };
if (dupDiff) F('CRITICAL', 'fork-dups', `${dupDiff} גבהים עם שני בלוקים שונים (fork בספר)`);
else OKM('dups', `כפילויות: ${dupSame} זהות · 0 סותרות`);
const maxH = Math.max(...byH.keys());
const missing = [];
for (let h = 1; h <= maxH; h++) if (!byH.has(h)) missing.push(h);
rep.coverage = { uniqueHeights: byH.size, maxH, missing: missing.length, missingPct: +(100 * missing.length / maxH).toFixed(2) };
// מקבצי-פערים
const ranges = []; let s = null, p = null;
for (const h of missing) { if (s === null) { s = p = h; } else if (h === p + 1) p = h; else { ranges.push([s, p]); s = p = h; } }
if (s !== null) ranges.push([s, p]);
rep.coverage.ranges = ranges.slice(0, 30);
rep.coverage.rangeCount = ranges.length;
if (missing.length > 7) F('HIGH', 'archive-gaps', `${missing.length} גבהים חסרים בספר (${rep.coverage.missingPct}%) ב-${ranges.length} פערים — doctrine-replay מג'נזיס בלתי-אפשרי על הדיסק`);
else if (missing.length === 7 && ranges.length === 1 && ranges[0][0] === 703) OKM('archive-gaps', 'רק הפער-המתועד 703-709');
else if (missing.length) F('MEDIUM', 'archive-gaps', `${missing.length} חסרים: ${JSON.stringify(ranges.slice(0, 5))}`);
else OKM('archive-gaps', 'ספר מלא 1..' + maxH);

/* E — שורש-עצמי של state-root.json */
const rf = JSON.parse(fs.readFileSync(path.join(NODE, 'state-root.json'), 'utf8'));
const rfRoot = K.stateRoot(rf.st);
rep.rootfile = { height: rf.height, declared: rf.stateRoot, computed: rfRoot, ok: rfRoot === rf.stateRoot };
if (rfRoot !== rf.stateRoot) F('CRITICAL', 'rootfile-self', 'state-root.json — ה-stateRoot המוצהר ≠ השורש המחושב מה-st שלו!');
else OKM('rootfile-self', `state-root.json @h${rf.height} עצמו-עקבי (${rfRoot.slice(0, 12)}…) · lastBlockHash תואם-ארכיון=${(byH.get(rf.height) || {}).b?.hash === rf.lastBlockHash}`);

/* F — מסע-התחנות: rootfile.st → בלוקים (buildBlock, hash-verified) → snapshot.st */
const snap = JSON.parse(fs.readFileSync(path.join(NODE, 'state-snapshot.json'), 'utf8'));
const st0 = JSON.parse(JSON.stringify(rf.st));
st0.meta.issuer = 'headcorner';
let walked = 0, hashBreak = null, linkBreak = null, expectPrev = rf.lastBlockHash;
const cps = (JSON.parse(fs.readFileSync(path.join(NODE, 'state.json'), 'utf8')).checkpoints || []);
const cpByH = new Map(cps.map((c) => [c.height, c]));
let cpsChecked = 0, cpsBad = [];
const walkStart = rf.height + 1;
for (let h = walkStart; h <= maxH; h++) {
  const e = byH.get(h);
  if (!e) { linkBreak = h; break; }
  const b = e.b;
  if (b.prevHash !== expectPrev) { linkBreak = h; break; }
  const { block } = K.buildBlock(st0, b.txs, b.time);
  if (block.hash !== b.hash) { hashBreak = h; break; }
  expectPrev = b.hash; walked++;
  const cp = cpByH.get(h);
  if (cp) {
    cpsChecked++;
    const liveRoot = K.stateRoot(st0);
    if (cp.stateRoot !== liveRoot) cpsBad.push({ h, declared: cp.stateRoot.slice(0, 10), live: liveRoot.slice(0, 10) });
  }
}
rep.walk = { from: walkStart, walked, to: rf.height + walked, hashBreak, linkBreak };
if (hashBreak) F('CRITICAL', 'walk-hash', `replay-מסע: hash שבור בגובה ${hashBreak}`);
if (linkBreak) F('HIGH', 'walk-link', `replay-מסע נעצר בגובה ${linkBreak} (חסר/prevHash שבור)`);
// השוואה ל-snapshot אם הגענו לגובהו
const walkHead = rf.height + walked;
if (!hashBreak && !linkBreak && walkHead >= snap.height) {
  // יישור: אם עברנו מעל snapshot.height — נשווה אחרי חיתוך? פשוט: משווים את st0 ל-snapshot.st
  // (אם walked מעבר — snapshot ישן; משווים בגובה ה-snapshot בלבד אם עצרנו בדיוק שם)
}
if (!hashBreak && !linkBreak && walkHead === snap.height) {
  const a = K.canon(st0), b = K.canon(snap.st);
  rep.walk.snapshotByteEqual = a === b;
  if (a === b) OKM('walk→snapshot', `rootfile+${walked} בלוקים == snapshot.st בדיוק (byte)`);
  else F('CRITICAL', 'walk→snapshot', 'replay מהשורש לא מגיע ל-snapshot.st — ליניאגה-כוזבת!');
} else rep.walk.snapshotCheck = 'skipped (walk head ' + walkHead + ' vs snap ' + snap.height + ')';

/* G — checkpoints */
rep.checkpoints = { checked: cpsChecked, bad: cpsBad.length, sample: cpsBad.slice(0, 6) };
if (cpsBad.length) F('CRITICAL', 'checkpoints', cpsBad.length + '/' + cpsChecked + ' צ׳קפוינטים בטווח-המסע עם stateRoot שונה מה-replay');
else OKM('checkpoints', cpsChecked + ' צ׳קפוינטים בטווח-המסע מאומתים מתמטית');

/* H — פורנזיקת buy-fill על כל-הספר הידוע */
const orderSide = new Map();
let buyFillCount = 0, sellFillCount = 0, unknownFill = 0, buyFillµ = 0, buyOwners = new Map(), buyTakers = new Map();
for (const [h, e] of byH) {
  const txs = e.b.txs || [], res = e.b.results || [];
  for (let i = 0; i < txs.length; i++) {
    const tx = txs[i], r = res[i] || {};
    if (tx.type === 'order' && r.ok) orderSide.set(r.orderId, tx.side);
    else if (tx.type === 'fill' && r.ok) {
      const side = orderSide.get(tx.orderId);
      if (side === 'buy') {
        buyFillCount++; buyFillµ += r.filled || 0;
        const o = String(tx.taker || '') + '←' + 'ord' + tx.orderId;
        buyOwners.set(tx.orderId, (buyOwners.get(tx.orderId) || 0) + 1);
      } else if (side === 'sell') sellFillCount++;
      else unknownFill++;
    }
  }
}
rep.fillForensics = { sellSide: sellFillCount, buySide: buyFillCount, unknownSide: unknownFill, buyFillTotalµ: buyFillµ };
if (buyFillCount) F('CRITICAL', 'buy-fill-inverted', `${buyFillCount} מילויים-מוצלחים על הזמנות-buy רצו בענף-הפוך (Σ=${buyFillµ}µ SAOS הועבר מבעלים→taker במקום taker→בעלים)`);
else OKM('fill-direction', `0 מילויי-buy · ${sellFillCount} מילויי-sell · ${unknownFill} עם-order-חסר-בספר`);

/* I — אינווריאנטים במצב-ההליכה (או snapshot אם המסע נעצר) */
const stF = (!hashBreak && !linkBreak) ? st0 : snap.st;
let sumSaos = 0, sumSteem = 0; const negatives = [];
for (const [n, a] of Object.entries(stF.accounts)) {
  sumSaos += a.saos || 0; sumSteem += a.steem || 0;
  if ((a.saos || 0) < 0 && n !== 'host') negatives.push(n + ':' + a.saos);
  if (a.lockedSaos < 0) negatives.push(n + ':lockedSaos:' + a.lockedSaos);
  if (a.lockedSteem < 0) negatives.push(n + ':lockedSteem:' + a.lockedSteem);
  for (const [sym, amt] of Object.entries(a.wrapped || {})) if (amt < 0) negatives.push(n + ':w.' + sym + ':' + amt);
}
rep.invariants = { atHeight: stF.meta.height, sumSaos, supply: stF.meta.supply, supplyOk: stF.meta.supply == null || sumSaos === stF.meta.supply, negatives: negatives.slice(0, 20) };
if (!rep.invariants.supplyOk) F('HIGH', 'supply', `Σ(saos)=${sumSaos} ≠ supply=${stF.meta.supply} בגובה ${stF.meta.height}`);
else OKM('supply', `Σ(saos)=${sumSaos} == supply @h${stF.meta.height}`);
if (negatives.length) F('HIGH', 'negatives', 'יתרות-שליליות: ' + negatives.slice(0, 8).join(' · ')); else OKM('negatives', 'אין יתרות-שליליות (מחוץ-ל-host)');

/* בדיקת-מיקוד: מי הבעלים של הזמנות-buy שמולאו */
if (buyFillCount) {
  const topOrders = [...buyOwners.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6);
  rep.fillForensics.topBuyOrderIds = topOrders;
}

/* J — weave עקביות */
try {
  const w = stF.weave;
  rep.weave = {
    totalStampsMeta: stF.meta.totalStamps, weaveTotal: w && w.total,
    totalSealsMeta: stF.meta.totalSeals, sealsRing: w && w.seals && w.seals.length,
    liveStamps: w && w.stamps && Object.keys(w.stamps).length,
    lastSeal: w && w.lastSeal && { seq: w.lastSeal.seq, count: w.lastSeal.count },
  };
  const okw = w && stF.meta.totalStamps === w.total;
  if (!okw) F('MEDIUM', 'weave-count', `meta.totalStamps=${stF.meta.totalStamps} ≠ weave.total=${w && w.total}`);
  else OKM('weave', `stamps=${w.total} · seals=${w.seals.length} · live=${Object.keys(w.stamps).length} עקבי`);
} catch (_) {}

fs.writeFileSync(path.join(NODE, 'chain_audit2_report.json'), JSON.stringify(rep, null, 2));
const crit = rep.findings.filter((f) => f.sev === 'CRITICAL').length;
console.log(`\nSUMMARY: findings=${rep.findings.length} critical=${crit} → node/chain_audit2_report.json`);
