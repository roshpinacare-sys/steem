#!/usr/bin/env node
/**
 * weave_batch.cjs — באצ'ר-האריגה (W2 — THE WEAVE).
 *
 * הלולאה-השעתית שהופכת חותמות-קיום לאיטומי-מרקל מעוגנים. ארבעה-שלבים:
 *
 *   א. סקר — replay עצמאי מלא (ג'נזיס + בלוקים-שמורים) דרך הקרנל; אותה-מתמטיקה
 *      בדיוק כמו הצומת. מתוך-ה-replay נאסף גם יומן-העלים (כל-רישום-שער
 *      שהתקבל-בפועל, לפי-סדר-הרצף) — חומר-ההוכחה-העצמאי.
 *
 *   ב. בקשת-איטום — אם יש-רישומים-חיים ו(חלף-הפוך-השעה מהאיטום-האחרון או
 *      סף-הלחץ התקרב-לקיבולת) → עלים=sha256(seq‖h‖kind) → מיון-קנוני →
 *      שורש-מרקל → weave-request.json (כתיבה-אטומית). הצומת (הכותב-היחיד,
 *      תחת-הנעילה) מגיש את ה-op; הקרנל מחשב-בעצמו את-השורש-מהרישומים-החיים —
 *      שורש-מזויף/ישן נדחה מתמטית (root-mismatch) והבקשה נבלעת-בכבוד.
 *
 *   ג. עיגון — כל-seal שנחתם-על-הספר (state.json → weave.seals) וטרם-עוגן:
 *        · Steem  custom_json (סמכות-active, חינם)   id="saos.weave.v1"
 *        · Hive   custom_json (סמכות-active, חינם)   id="saos.weave.v1"
 *        · Blurt  custom_json — רק-כשהקצוות-חיים (cool-down מדוד, fix-89)
 *        · TRON   טרנזיטיבי: הצ'קפוינט-הראשון מעל-גובה-האיטום נושא את-השורש
 *          בתוך-ה-stateRoot ומעוגן-יומית ע"י מסילת-הגשר-הקיימת (אפס-הוצאה-חדשה)
 *
 *   ד. הוכחה-עצמאית — העלים נבנים-מחדש מה-block-log (לא מה-state-החי):
 *      root(עלים)==seal.root → הוכחת-merkle לעלה-הראשון → verify → בתעודה.
 *
 * קבצים:
 *   sovereign/node/weave-request.json — בקשת-איטום (כותב: הבאצ'ר · קורא+מוחק: הצומת)
 *   agent/weave_state.json            — רישום-עיגונים (dedupe לפי sealSeq, טבעת-64)
 *   agent/weave_last.json             — תעודת-הריצה-האחרונה (ציבורי, בלי-סודות)
 *
 * שימוש:  node weave_batch.cjs [--dry]   — ריצה-אחת (הדמון מריץ-זאת שעתית)
 *         node weave_batch.cjs --status  — סיכום-מצב-האריגה
 *
 * עקרון-בית: הוכחה או לא-קרה. כישלון-שידור לא מוחק-עובדות — הוא נרשם כנה
 * והעיגון ינוסה-שוב בפעימה-הבאה. אין-מפתחות-בלוגים; ACTIVE_WIF נשאר-מקומי.
 */
'use strict';

const fs = require('fs');
const path = require('path');

// steem must resolve from ANY checkout shape (הגשר-84 — כמו ב-saosnet.cjs)
let steem;
try { steem = require('steem'); } catch (_) { steem = require(path.join(__dirname, 'node_modules', 'steem')); }

const K = require(path.join(__dirname, '..', 'sovereign', 'core', 'kernel.cjs'));
const A = require('./anchor.cjs'); // grapheneBroadcast · findInHistory · blurt* · HIVE_*
const HIVE_RC = require('./hive_rc.cjs'); // 103 — RC-DISCIPLINE: שער-תקציב לרגל-ה-Hive

const NODE_DIR = path.join(__dirname, '..', 'sovereign', 'node');
const GENESIS_FILE = path.join(__dirname, '..', 'sovereign', 'genesis', 'genesis.json');
const CHAIN_FILE = path.join(NODE_DIR, 'chain.json');
const STATE_FILE = path.join(NODE_DIR, 'state.json');
const REQ_FILE = path.join(NODE_DIR, 'weave-request.json');
const STATE_W_FILE = path.join(__dirname, 'weave_state.json');
const LAST_FILE = path.join(__dirname, 'weave_last.json');

// 8-b: חשבון-הפעולה חובה מה-env — אין ברירת-מחדל, לעולם (המשך 7-c · docs/117o-KEY-INCIDENT.md)
const ACCOUNT = (process.env.AGENT_ACCOUNT || '').toLowerCase();
if (!ACCOUNT) { console.error('usage: AGENT_ACCOUNT=<account> node agent/weave_batch.cjs — no default acting account (2026-09-08 incident)'); process.exit(1); } // זהה לצומת (saosnet.cjs) — המנפיק-הריבוני
const WEAVE_ANCHOR_ID = 'saos.weave.v1';
const HIVE_RPC = process.env.HIVE_RPC || 'https://api.hive.blog';

// ספי-איטום: פוך-השעה (המפרט §4.2) + סף-לחץ מול-קיבולת-החי (WEAVE_LIVE_CAP=1024)
const SEAL_GAP_MIN = (() => { const n = parseFloat(process.env.WEAVE_SEAL_GAP_MIN); return Number.isFinite(n) && n > 0 ? n : 60; })();
const SEAL_PRESSURE = (() => { const n = parseInt(process.env.WEAVE_SEAL_PRESSURE, 10); return Number.isInteger(n) && n > 0 && n <= K.WEAVE_LIVE_CAP ? n : 768; })();

function loadDotEnv(dir) {
  const envPath = path.join(dir, '.env');
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}

function writeJsonAtomic(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

/* ── א. סקר: replay עצמאי — אותה-מתמטיקה כמו-הצומת, יומן-עלים בצד ──
 * 93-fix: ה-replay קורא מהארכיון-המלא (chain-archive.jsonl) — החלון-החם (512)
 * לא-מספיק לשחזור-מצב (תגלית-519). אותו-דפוס בדיוק כמו-הצומת. */
function loadReplayBlocks(chainState) {
  try {
    const archLines = fs.readFileSync(path.join(NODE_DIR, 'chain-archive.jsonl'), 'utf8').trim().split('\n');
    const full = [];
    for (let i = 1; i < archLines.length; i++) { try { full.push(JSON.parse(archLines[i])); } catch (_) {} }
    if (full.length && (!chainState.blocks.length || full[0].height <= chainState.blocks[0].height)) return full;
  } catch (_) { /* אין-ארכיון — חלון (כנות) */ }
  return chainState.blocks;
}

function replayWeave() {
  const genesis = JSON.parse(fs.readFileSync(GENESIS_FILE, 'utf8'));
  const chainState = readJson(CHAIN_FILE) || { blocks: [] };
  const replayBlocks = loadReplayBlocks(chainState);
  const st = K.initFromGenesis(genesis);
  st.meta.issuer = ACCOUNT; // זהה-לצומת — בלי-זה seals היסטוריים נופלים ב-replay
  const stampLog = [];      // כל-רישום-שער שהתקבל-בפועל (לפי-סדר-הרצף) — חומר-הוכחה
  let rejected = 0;
  for (const b of replayBlocks) {
    for (const tx of b.txs) {
      const r = K.applyTx(st, tx);
      if (tx && tx.type === 'stamp' && r.ok) {
        // יומן-העלים: מה-tx-עצמו (block-log) — לא-מה-state-החי. חומר-ההוכחה.
        stampLog.push({ h: tx.h, seq: r.seq, kind: String(tx.kind || 'text'), by: String(tx.by || '').toLowerCase(), at: tx.at || (b && b.time) || null, salt: tx.salt || null });
      }
      if (r && !r.ok) rejected++;
    }
  }
  // ממצא-W3: שחזור-המטא-ש-buildBlock הציב (height/hash/lastTime) — בלי-זה
  // שורש-ה-replay סוטה מההיסטוריה (stateRoot כולל meta.lastTime).
  st.meta.height = Math.max(st.meta.height, replayBlocks.length);
  st.meta.lastBlockHash = replayBlocks.length ? replayBlocks[replayBlocks.length - 1].hash : null;
  st.meta.lastTime = replayBlocks.length ? replayBlocks[replayBlocks.length - 1].time : st.meta.lastTime;
  const w = K.weaveInit(st);
  // R18h — גובה-ראשית-החלון הנראה ל-replay: חותמות שמתחתיו אינן-ניתנות-לשחזור
  // (היסטוריה-נשטפה/ארכיון-החל) — חיוני-לעיגון-כן.
  const firstHeight = replayBlocks.length ? Number(replayBlocks[0].height) : null;
  return { st, w, stampLog, blocksKept: replayBlocks.length, firstHeight, truncated: !!chainState.truncated, rejected };
}

/* ── ב. בקשת-איטום ── */
function maybeWriteSealRequest(scan, notes) {
  const live = Object.values(scan.w.stamps).sort((a, b) => a.seq - b.seq);
  if (!live.length) return null;
  const lastSealAt = scan.w.lastSeal && scan.w.lastSeal.at ? new Date(scan.w.lastSeal.at).getTime() : 0;
  const gapMin = lastSealAt ? (Date.now() - lastSealAt) / 60000 : Infinity;
  const due = !lastSealAt || gapMin >= SEAL_GAP_MIN;
  const pressure = live.length >= SEAL_PRESSURE;
  if (!due && !pressure) {
    notes.push('seal not due (' + live.length + ' live · gap=' + (Number.isFinite(gapMin) ? gapMin.toFixed(0) + 'm' : 'first') + ' · due@' + SEAL_GAP_MIN + 'm)');
    return null;
  }
  const prev = readJson(REQ_FILE);
  const root = K.merkle.rootOf(live.map(K.weaveLeaf));
  if (prev && prev.root === root && Number(prev.count) === live.length) {
    notes.push('seal-request already pending (same root) — node beat will apply');
    return { root, count: live.length, pending: true };
  }
  const req = {
    protocol: 'saos-weave/v1',
    action: 'seal-request',
    at: new Date().toISOString(),
    computedAt: new Date().toISOString(),
    root,
    count: live.length,
    from: live[0].seq,
    to: live[live.length - 1].seq,
    reason: pressure ? 'pressure≥' + SEAL_PRESSURE : 'hourly-gap',
    by: 'weaveBatch',
  };
  writeJsonAtomic(REQ_FILE, req);
  notes.push('seal-request WRITTEN · count=' + live.length + ' · root=' + root.slice(0, 12) + '… (' + req.reason + ')');
  return { root, count: live.length, written: true };
}

/* ── ג. עיגון: seal אחד לא-מעוגן לכל-ריצה (עדין-מול-השרשראות) ── */
function buildOp(payload) {
  return ['custom_json', {
    required_auths: [ACCOUNT],
    required_posting_auths: [],
    id: WEAVE_ANCHOR_ID,
    json: JSON.stringify(payload),
  }];
}

async function anchorSeal(seal, WIF, dry, notes) {
  const payload = () => ({
    protocol: 'saos-weave/v1',
    action: 'seal',
    net: 'saos-net/0',
    seq: seal.seq,
    root: seal.root,
    count: seal.count,
    from: seal.from,
    to: seal.to,
    height: seal.height,
    time: seal.at,
  });
  const txids = { steem: null, hive: null, blurt: null };
  const skips = [];

  if (dry) { skips.push('DRY'); }
  else if (!WIF) { skips.push('no-ACTIVE_WIF (anchors honest-skip — keys stay local)'); }

  if (!dry && WIF) {
    // Steem — steem-js native (active) — חינם-RC
    try {
      const conf = await steem.broadcast.sendAsync({ operations: [buildOp(payload())], extensions: [] }, [WIF]);
      txids.steem = (conf && conf.id) || (await A.findInHistory(A.STEEM_HIST_NODES[0], ACCOUNT, seal.at));
    } catch (e) { skips.push('steem: ' + String((e && e.message) || e).slice(0, 80)); }

    // Hive — raw Graphene sign with chain_id — חינם-RC · 103: מאחורי-שער-התקציב
    // (היה-השורף-הגדול: חותמת-שעתית-ישירה-מהראש ~250M-RC — רוקנה-את-המאגר)
    try {
      let rcSnap = null;
      try { rcSnap = await HIVE_RC.snapshot([ACCOUNT]); } catch (_) { rcSnap = null; }
      if (rcSnap) {
        const g = HIVE_RC.gate(rcSnap, ACCOUNT, 250e6, 'weave-seal-hive');
        if (!g.ok) throw new Error('rc-gated: ' + g.reason + ' (regen budget — honest skip, parity waits)');
      }
      await A.grapheneBroadcast(HIVE_RPC, A.HIVE_CHAIN_ID, [buildOp(payload())], WIF);
      txids.hive = await A.findInHistory(HIVE_RPC, ACCOUNT, seal.at);
    } catch (e) { skips.push('hive: ' + String((e && e.message) || e).slice(0, 80)); }

    // Blurt — רק-כשהקצוות-חיים (cool-down מדוד — fix-89)
    try {
      if (A.blurtDeadUntil() > Date.now()) throw new Error('cooled-down (endpoints measured dead — anti-bleed)');
      const { wifToScalar } = require('./identity.cjs');
      const { d } = wifToScalar(WIF);
      const signerPoint = require('ecurve').getCurveByName('secp256k1').G.multiply(d);
      const r = await A.blurtBroadcast([buildOp(payload())], WIF, signerPoint, ACCOUNT, seal.at);
      txids.blurt = r && r.txid;
      if (txids.blurt) A.blurtMarkAlive(); else A.blurtMarkFail('broadcast-ok-but-invisible');
    } catch (e) { A.blurtMarkFail((e && e.message) || e); skips.push('blurt: ' + String((e && e.message) || e).slice(0, 80)); }
  }

  // TRON — טרנזיטיבי: הצ'קפוינט-הראשון מעל-גובה-האיטום נושא את-השורש (stateRoot)
  // ומעוגן-יומית ע"י מסילת-הגשר-הקיימת (tronbridge) — אפס-הוצאה-חדשה.
  let tron = null;
  const nodeSt = readJson(STATE_FILE) || {};
  const cps = nodeSt.checkpoints || [];
  const cp = cps.find((c) => Number(c.height) >= Number(seal.height) && c.stateRoot);
  if (cp) {
    tron = { via: 'checkpoint', cpHeight: cp.height, stateRoot: cp.stateRoot, note: 'root carried inside stateRoot → anchored by tronbridge daily rail' };
    if (!((cp.anchors || {}).steem || (cp.anchors || {}).hive)) tron.note += ' · checkpoint anchors pending (node will anchor)';
  } else {
    const nextCp = Math.ceil(Number(seal.height) / 12) * 12; // CHECKPOINT_EVERY=12
    tron = { status: 'pending-checkpoint', note: 'checkpoint @' + nextCp + ' will carry the root in stateRoot (≤12 blocks) — recorded when the beat anchors it' };
  }

  const landed = Object.values(txids).filter(Boolean).length;
  notes.push('anchor seq=' + seal.seq + ': ' + landed + '/3 chains' + (skips.length ? ' · skips: ' + skips.join(' | ') : '') + ' · tron=' + (tron.via ? 'cp#' + tron.cpHeight : tron.status));
  return { txids, skips, tron, chains: landed };
}

/* ── ד. הוכחה-עצמאית מה-block-log ── */
function independentProof(scan, seal) {
  try {
    const leaves = scan.stampLog
      .filter((e) => e.seq >= seal.from && e.seq <= seal.to)
      .sort((a, b) => a.seq - b.seq)
      .map(K.weaveLeaf);
    if (leaves.length !== seal.count) return { ok: false, why: 'leaf-count ' + leaves.length + ' != seal.count ' + seal.count };
    const rebuilt = K.merkle.rootOf(leaves);
    if (rebuilt !== seal.root) return { ok: false, why: 'rebuilt root != seal.root' };
    const tree = K.merkle.buildTree(leaves);
    if (!tree || !tree.levels) return { ok: false, why: 'no-tree' };
    const p = K.merkle.prove(tree.levels, 0);
    return { ok: K.merkle.verify(leaves[0], p, seal.root), root: seal.root, leaf: scan.stampLog.find((e) => e.seq === seal.from).h, pathLen: p.length };
  } catch (e) { return { ok: false, why: String((e && e.message) || e).slice(0, 100) }; }
}

/* ── הריצה-השעתית ── */
async function runWeaveBatch(opts = {}) {
  const dry = !!opts.dry;
  const notes = [];
  const at = new Date().toISOString();

  const scan = replayWeave();
  notes.push('scan: height=' + scan.st.meta.height + ' · kept=' + scan.blocksKept + (scan.truncated ? ' (TRUNCATED)' : '') + ' · live=' + Object.keys(scan.w.stamps).length + ' · total=' + scan.w.total + ' · seals=' + scan.w.seals.length + (scan.rejected ? ' · replay-rejected=' + scan.rejected : ''));

  // ב. בקשת-איטום (רק-כשאין-בקשה-עומדת-זהה)
  let request = null;
  try { request = maybeWriteSealRequest(scan, notes); } catch (e) { notes.push('seal-request ERR: ' + String((e && e.message) || e).slice(0, 80)); }

  // ג. עיגון-ה-seal-האחרון-שטרם-עוגן
  const ENV = loadDotEnv(__dirname);
  const WIF = ENV.ACTIVE_WIF || '';
  const wRec = readJson(STATE_W_FILE) || { anchored: {} };
  const nodeStRead = readJson(STATE_FILE) || {};
  const seals = (nodeStRead.weave && nodeStRead.weave.seals) || [];
  let anchored = null;
  /* R18i-תיקון (משוחזר-R18j): ה-state-נכתב-במפתח-השורש (ממצא-W3) אך-המסנן-בדק-במפתח-ה-seq
   * → כל-חותם-נשאר-ממתין-בכל-מחזור → עיבוד/שידור-חוזר. מסנן-מתוקן: שורש + נפילה-ל-seq. */
  const pending = seals.filter((s) => s && !wRec.anchored[String(s.root)] && !wRec.anchored[s.seq]).sort((a, b) => b.seq - a.seq);
  if (pending.length) {
    const seal = pending[0];
    // R18h — עוגן-רק-חותמות-ניתנות-להוכחה: אם-טווח-החותם-נופל-מתחת-לחלון-הארכיון
    // (היסטוריה-נשטפה) ההוכחה-העצמאית-לעולם-לא-תצליח — עיגון-כזה = אנקור-שבור-לנצח
    // ומטה-אמון-בשטח-העיגון. סימון-כן-ודילוג (החותם-נשאר-ב-state-הצומת — לא-נמחק).
    const preProof = independentProof(scan, seal);
    const rangeBelowWindow = scan.firstHeight != null && Number(seal.from) < Number(scan.firstHeight) && scan.stampLog.length === 0;
    if (!preProof.ok && rangeBelowWindow) {
      wRec.anchored[String(seal.root)] = {
        seq: seal.seq, at: new Date().toISOString(), dry,
        skipped: 'unprovable-washed',
        note: 'range ' + seal.from + '..' + seal.to + ' below archive window ' + scan.firstHeight + ' (washed history) — anchor skipped honest',
      };
      const keys2 = Object.keys(wRec.anchored);
      if (keys2.length > 64) { for (const k of keys2.slice(0, keys2.length - 64)) delete wRec.anchored[k]; }
      writeJsonAtomic(STATE_W_FILE, wRec);
      notes.push('anchor seq=' + seal.seq + ': SKIPPED — unprovable (stamps below archive window ' + scan.firstHeight + ' — washed history, marked honest)');
      anchored = { seq: seal.seq, root: seal.root, count: seal.count, chains: 0, txids: { steem: null, hive: null, blurt: null }, skipped: 'unprovable-washed', proof: preProof };
    } else {
    const res = await anchorSeal(seal, WIF, dry, notes);
    // ממצא-W3: המפתח הוא השורש (32B ייחודי) — לא-ה-seq (מספור-נמדד-מחדש בין-קווים;
    // seal#1-של-המעבדה (fork-סנדבוקס) התנגש-עם-seal#1-מיוצר — השורש-בלתי-ניתן-להתנגשות)
    wRec.anchored[String(seal.root)] = { seq: seal.seq, at: new Date().toISOString(), dry, txids: res.txids, tron: res.tron };
    const keys = Object.keys(wRec.anchored);
    if (keys.length > 64) { for (const k of keys.slice(0, keys.length - 64)) delete wRec.anchored[k]; }
    writeJsonAtomic(STATE_W_FILE, wRec);
    const proof = independentProof(scan, seal);
    notes.push('independent-proof: ' + (proof.ok ? 'OK (leaf verified against sealed root)' : 'BROKEN — ' + (proof.why || 'verify failed')));
    anchored = { seq: seal.seq, root: seal.root, count: seal.count, chains: res.chains, txids: res.txids, tron: res.tron, proof };
    }
  } else {
    notes.push('no unanchored seals');
  }

  // תעודת-הריצה (ציבורי, בלי-סודות)
  const result = {
    at,
    mode: dry ? 'DRY' : (WIF ? 'LIVE' : 'LIVE-no-WIF'),
    account: ACCOUNT,
    anchorId: WEAVE_ANCHOR_ID,
    scan: { height: scan.st.meta.height, blocksKept: scan.blocksKept, truncated: scan.truncated, liveStamps: Object.keys(scan.w.stamps).length, totalStamps: scan.w.total, nextSeq: scan.w.nextSeq, lastSeal: scan.w.lastSeal, sealsRing: scan.w.seals },
    request: request ? { root: request.root, count: request.count, written: !!request.written, pending: !!request.pending } : null,
    anchored,
    notes,
  };
  try { writeJsonAtomic(LAST_FILE, result); } catch (_) { /* non-fatal */ }

  return {
    liveStamps: Object.keys(scan.w.stamps).length,
    totalStamps: scan.w.total,
    request: request || null,
    /* R18i-תיקון (משוחזר-R18j): השדה-skipped-חייב-להגיע-לדמון — בלעדיו-הסטטוס-מדרדר-degraded
     * גם-כשהדילוג-כן והתווית-מוצגת-BROKEN-במקום-SKIPPED(honest). */
    anchored: anchored ? { seq: anchored.seq, chains: anchored.chains, skipped: anchored.skipped || null } : null,
    proof: anchored ? anchored.proof : null,
    notes,
  };
}

function printStatus() {
  const scan = replayWeave();
  const nodeSt = readJson(STATE_FILE) || {};
  const wRec = readJson(STATE_W_FILE) || { anchored: {} };
  const out = {
    height: scan.st.meta.height,
    blocksKept: scan.blocksKept,
    weave: {
      liveStamps: Object.keys(scan.w.stamps).length,
      cap: K.WEAVE_LIVE_CAP,
      pressureSealAt: SEAL_PRESSURE,
      totalStamps: scan.w.total,
      nextSeq: scan.w.nextSeq,
      lastSeal: scan.w.lastSeal,
      seals: scan.w.seals,
      nodeSeals: (nodeSt.weave || {}).seals || [],
      anchored: wRec.anchored,
      pendingRequest: readJson(REQ_FILE),
    },
  };
  console.log(JSON.stringify(out, null, 2));
}

module.exports = { runWeaveBatch, replayWeave, independentProof, WEAVE_ANCHOR_ID, SEAL_GAP_MIN, SEAL_PRESSURE };

if (require.main === module) {
  if (process.argv.includes('--status')) { printStatus(); process.exit(0); }
  const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
  const GATE = resolveLiveGate(process.argv);
  announceGate(GATE);
  runWeaveBatch({ dry: GATE.dry })
    .then((r) => {
      console.log('weaveBatch done: ' + (r.notes || []).join(' · '));
      process.exit(0);
    })
    .catch((e) => { console.error('weave_batch fatal: ' + ((e && e.message) || e)); process.exit(1); });
}
