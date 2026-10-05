#!/usr/bin/env node
'use strict';
/**
 * beat.cjs — cognition-beat: הלופ-הקוגניטיבי-שבתוך-האורגניזם · V-b, trace 1a10c90522120149
 * ═════════════════════════════════════════════════════════════════════════════════════════════════════
 * R27 מדד: הקוגניציה חיה בסשני-LLM שמתים-עם-הסשן. V-a נתן חוזה-אפיסטמי (אותנטיקה, כיווניות,
 * צרכן-שומרים, יומן-הכרעות). ה-beat הזה הוא הצעד-הבא: המחזור-השעתי שבו-האורגניזם חושב-מכנית
 * בלי-שום-סשן-LLM:
 *   Observe → State-estimate → Contradictions → Decide(shrink-only) → Learn → Update self-model
 *   → Act(commit receipts) → Verify own outcome.
 *
 * סמכות: mechanism-shrink בלבד — ה-beat רשאי רק לכווץ/לעצור/לרשום. הוא לעולם לא פותח-מסילות
 * מעבר ל-stagedLanes שב-STASIS.json, לא מעביר-הון, ולא עורך את STASIS.json או את שרשרת-הנחיות-הבעלים.
 * קבצים שהוא כותב (רשימה-סגורה): agent/cognition/lane-guards.json (שומרים סוגרים-בלבד),
 * agent/cognition/organism.json (דגם-עצמי מאומת), agent/receipts/cognition-beat.jsonl (זיכרון append-only).
 *
 * כנות-אפיסטמית: כל-מדידה נושאת תווית — כישלון-מדידה = UNKNOWN/UNMEASURED, לעולם לא 0/false/ok.
 * ייחוס-כותבים מבוסס-ראיות בלבד; תבניות-INFERRED מדווחות בהגבלה-הגלויה שלהן.
 * אפס-סודות: ה-token שב-ZIP_PAT/GITHUB_TOKEN חי בזיכרון-ריצה בלבד — לא נדפס, לא נכתב, לא נקומיט.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const https = require('https');
const { execFileSync } = require('child_process');

const COG_DIR = __dirname;
const AGENT_DIR = path.join(COG_DIR, '..');
const REPO_ROOT = path.join(AGENT_DIR, '..');
const ORGANISM_FILE = path.join(COG_DIR, 'organism.json');
const GUARDS_FILE = path.join(COG_DIR, 'lane-guards.json');
const BEAT_RECEIPTS = path.join(AGENT_DIR, 'receipts', 'cognition-beat.jsonl');
const RECEIPTS_DIR = path.join(AGENT_DIR, 'receipts');

const SELFMODEL = require('../lib/selfmodel.cjs');
const CHAIN = require('../lib/directivesChain.cjs');
const GUARDS_LIB = require('../lib/loopguard.cjs');

const ACCOUNT = 'headcorner';
const NODES = Object.freeze([
  { name: 'api.steemit.com', url: 'https://api.steemit.com/', role: 'chain-primary' },
  { name: 'api.justyy.com', url: 'https://api.justyy.com/', role: 'chain-cross' },
]);
const ORG = 'roshpinacare-sys';
const CROSS_HOME = Object.freeze({
  domain: { repo: 'Domain', branch: 'main', stasis: 'agents/STASIS.json', chain: 'agents/receipts/owner-directives.jsonl' },
  dex: { repo: 'saos-dex', branch: 'main', stasis: 'grids/state/STASIS.json', truthGate: 'grids/state/truth-gate.json', ledger: 'db/grid-ledger.json' },
});
const WINDOW_H = 8;
const FRESH_H = 4;
const TTL_CLOSE_H = 12;
const TTL_GAP_H = 6;
const RELEASE_CLEAN_N = 2;
const LANE_FAIL_N = 3;
const FRONTIER_REAL_MIN_CYCLES = 3;
const MATRIX_VESTS = '48393.301791 VESTS'; /* 30 SP × 10 — operator matrix (INFERRED, conf 0.7) */
const RECLAIM_TARGETS = Object.freeze(['hcsoldier1', 'hcsoldier2', 'hcsoldier3']); /* delegate-0 signature (INFERRED, conf 0.6) */

const CAPITAL_OPS = new Set(['transfer', 'transfer_to_vesting', 'withdraw_vesting', 'delegate_vesting_shares', 'convert']);
const ORDER_OPS = new Set(['limit_order_create', 'limit_order_cancel', 'limit_order_create2']);
const FILL_OPS = new Set(['fill_order']);
const CLAIM_OPS = new Set(['claim_reward_balance']);
const LANE_CLASS = Object.freeze({ grid: 'order', claims: 'claim', general: 'capital' });

/* ══════════════════════════ אפיסטמיקה: עזרי-מדידה ══════════════════════════ */
function UNKNOW(reason) { return { epistemic: 'UNKNOWN', reason: String(reason || 'unmeasured').slice(0, 160) }; }
function sha256(s) { return crypto.createHash('sha256').update(s, 'utf8').digest('hex'); }
function iso(ms) { return new Date(ms).toISOString(); }
function fetchUrl(url, { headers = {}, timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch (e) { return resolve({ ok: false, status: 0, error: 'bad-url' }); }
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'GET', headers, timeout: timeoutMs }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; if (b.length > 8 * 1024 * 1024) req.destroy(); });
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: b }));
    });
    req.on('error', (e) => resolve({ ok: false, status: 0, error: String((e && e.message) || e).slice(0, 120) }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, error: 'timeout' }); });
    req.end();
  });
}
/** שאילתת-JSON-RPC אחת; כישלון = חריגה-גלויה (לא אפס-שקט). */
function rpcJson(node, method, params, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const u = new URL(node);
    const data = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const req = https.request({ hostname: u.hostname, path: u.pathname || '/', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }, timeout: timeoutMs }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; if (b.length > 4 * 1024 * 1024) req.destroy(); });
      res.on('end', () => {
        try {
          const j = JSON.parse(b);
          if (j.error) return reject(new Error('rpc-error: ' + JSON.stringify(j.error).slice(0, 140)));
          resolve(j.result);
        } catch (e) { reject(new Error('bad-json: ' + b.slice(0, 80))); }
      });
    });
    req.on('error', (e) => reject(new Error(String((e && e.message) || e).slice(0, 120))));
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

/* ══════════════════════════ 1. OBSERVE — השרשרת (מדוד-בשני-צמתים) ══════════════════════════
 * מגבלה-מדודה (V-c): צמתים-ציבוריים כופתים limit=100 — 8×100 עוטפים את חלון-8h בקלות.
 * limit גדול יותר 502-צועק — לא לחזור-על-זה. עיגון: get_account_history הוא from-anchored. */
async function observeChainNode(node, batches) {
  const head = await rpcJson(node.url, 'condenser_api.get_account_history', [ACCOUNT, -1, 0]);
  const lastIdx = head[0][0];
  const reqs = [];
  for (let i = 0; i < batches; i++) reqs.push(rpcJson(node.url, 'condenser_api.get_account_history', [ACCOUNT, lastIdx - i * 100, 99]));
  const settled = await Promise.allSettled(reqs);
  const entries = new Map();
  let okBatches = 0;
  for (const s of settled) {
    if (s.status !== 'fulfilled' || !Array.isArray(s.value)) continue;
    okBatches++;
    for (const [idx, e] of s.value) entries.set(idx, e);
  }
  if (okBatches === 0) throw new Error('all-batches-failed');
  const list = [...entries.entries()].sort((a, b) => a[0] - b[0]).map(([idx, e]) => [idx, e]);
  return { node: node.name, role: node.role, ok: true, lastIdx, entries: list, okBatches, batches: batches };
}
function windowOps(entries, nowMs, hours) {
  const cutoff = nowMs - hours * 3600e3;
  return entries.filter(([, e]) => {
    const t = Date.parse(String(e.timestamp || '').endsWith('Z') ? e.timestamp : e.timestamp + 'Z');
    return Number.isFinite(t) && t >= cutoff;
  });
}
function opMixFingerprint(winOps) {
  const mix = {};
  for (const [, e] of winOps) { const op = e.op[0]; mix[op] = (mix[op] || 0) + 1; }
  return Object.keys(mix).sort().map((k) => k + ':' + mix[k]).join(',');
}

/* ══════════════════════════ 2. STATE-ESTIMATION — ייחוס-כותבים מבוסס-ראיות ══════════════════════════ */
/** מרחב-orderid של ה-CI: 2026MMDDxx (10-ספרות; שנה/חודש/יום תקינים + xx 0..99). */
function isCiLadderOrderid(id) {
  if (!Number.isFinite(id) || id < 1e9 || id > 9999999999) return false;
  const y = Math.floor(id / 1e6), m = Math.floor(id / 1e4) % 100, d = Math.floor(id / 100) % 100, x = id % 100;
  return y === 2026 && m >= 1 && m <= 12 && d >= 1 && d <= 31 && x >= 0 && x <= 99;
}
/** מרחב-מיקרו-פקודות 2100000xxx (כמו 2100000379/80, trx 8065683d) — אין-בעלים-ידוע באף-ריפו. */
function isMicroOrderSpace(id) { return Number.isFinite(id) && id >= 2100000000 && id <= 2100000999; }

/**
 * classifyOps(winOps, {ledgerTxids, nowMs}) → {classified[], fills, scanned}
 * classified[]: {at, op, trx, class, lane, writer, confidence, attribution, orderid?, amount?, delegatee?, ledgerCrossCheck?}
 * ייחוס-חסר = writer:'unknown' conf ≤ 0.2 — לעולם לא 'known' על-בסיס-ניחוש.
 */
function classifyOps(winOps, { ledgerTxids, nowMs }) {
  const classified = [];
  let fills = 0, scanned = 0;
  for (const [, e] of winOps) {
    const op = e.op[0], body = e.op[1] || {};
    const at = String(e.timestamp || '').endsWith('Z') ? e.timestamp : String(e.timestamp || '') + 'Z';
    const t = Date.parse(at);
    if (!Number.isFinite(t)) continue;
    if (FILL_OPS.has(op)) { fills++; continue; }
    const isOrder = ORDER_OPS.has(op), isCapital = CAPITAL_OPS.has(op);
    if (!isOrder && !isCapital && !CLAIM_OPS.has(op)) continue;
    scanned++;
    const base = {
      at, op, trx: String(e.trx_id || '').slice(0, 16) || 'no-trx-id',
      class: isOrder ? 'order' : (CLAIM_OPS.has(op) ? 'claim' : 'capital'),
      lane: isOrder ? 'grid' : (CLAIM_OPS.has(op) ? 'claims' : 'general'),
      ledgerCrossCheck: ledgerTxids ? (e.trx_id && ledgerTxids.has(e.trx_id) ? 'found' : 'not-found') : 'unreadable',
    };
    if (CLAIM_OPS.has(op)) { classified.push({ ...base, writer: 'claims-suite-ci', confidence: 0.85, attribution: 'INFERRED — staged-allowed scheduled lane, op-class only' }); continue; }
    if (isOrder) {
      const idNum = typeof body.orderid === 'number' ? body.orderid : Number(body.orderid);
      base.orderid = String(body.orderid);
      base.amount = String(body.amount_to_sell || body.min_to_receive || '').slice(0, 40);
      if (ledgerTxids && e.trx_id && ledgerTxids.has(e.trx_id)) {
        classified.push({ ...base, writer: 'dex-grid-ci', confidence: 0.9, attribution: 'txid-in-grid-ledger' });
      } else if (isCiLadderOrderid(idNum)) {
        classified.push({ ...base, writer: 'dex-grid-ci', confidence: 0.85, attribution: 'INFERRED — orderid 2026MMDDxx space' });
      } else if (isMicroOrderSpace(idNum)) {
        classified.push({ ...base, writer: 'unknown', confidence: 0.2, attribution: 'NO pattern — micro-order space 2100000xxx has no owning tool in any repo (R27)' });
      } else {
        classified.push({ ...base, writer: 'unknown', confidence: 0.2, attribution: 'NO pattern — orderid outside known spaces, trx not in ledger' });
      }
      continue;
    }
    /* capital */
    if (op === 'delegate_vesting_shares') {
      const vests = String(body.vesting_shares || '').trim();
      const delegatee = String(body.delegatee || '').toLowerCase();
      base.delegatee = delegatee; base.amount = vests.slice(0, 40);
      if (vests === MATRIX_VESTS) {
        classified.push({ ...base, writer: 'owner-matrix', confidence: 0.7, attribution: 'INFERRED — operator matrix 10×48393.301791 VESTS (30 SP/soldier)' });
      } else if ((parseFloat(vests) === 0) && RECLAIM_TARGETS.includes(delegatee)) {
        classified.push({ ...base, writer: 'owner-parallel', confidence: 0.6, attribution: 'INFERRED — delegate-0 reclaim-lost-soldiers signature (tool exists in repo)' });
      } else {
        classified.push({ ...base, writer: 'unknown', confidence: 0.2, attribution: 'NO pattern — delegation outside matrix/reclaim signatures' });
      }
      continue;
    }
    classified.push({ ...base, writer: 'unknown', confidence: 0.2, attribution: 'NO pattern — capital op with no owning signature in any registry' });
  }
  return { classified, fills, scanned };
}
/** fresh-window: capital-class (order|capital) של-כותב-לא-מזוהה בתוך FRESH_H — actionable. ישן = היסטוריה-מדוגלת. */
function splitFreshUnknown(classified, nowMs) {
  const cutoff = nowMs - FRESH_H * 3600e3;
  const fresh = [], older = [];
  for (const c of classified) {
    if (c.writer !== 'unknown') continue;
    if (c.class === 'claim') continue;
    (Date.parse(c.at) >= cutoff ? fresh : older).push(c);
  }
  return { fresh, older };
}

/* ══════════════════════════ 3. CONTRADICTIONS — סכימה-קבועה לדשבורד-הבעלים ══════════════════════════ */
function contra(id, title, detail, kind, a, b, confidence, firstSeen, status, epistemic, lanes) {
  return { id, title, detail, kind, a, b, confidence, firstSeen, status, epistemic, lanes: lanes || [] };
}
/**
 * buildContradictions(prevList, m) — m: {chainDark, rpcSplit, homes, gaps, custody, modelVsChain, unknownFresh, unknownOlder, nowIso}
 * כל-סתירה: {id,title,detail,kind,a,b,confidence,firstSeen,status,epistemic}. פתורות נשמרות (לעולם לא נמחקות).
 */
function buildContradictions(prevList, m) {
  const prev = new Map((prevList || []).map((c) => [c.id, c]));
  const out = [];
  const keep = (c) => {
    const p = prev.get(c.id);
    if (p && p.firstSeen) c.firstSeen = p.firstSeen;
    out.push(c);
  };
  /* C-unknown-writer — פתוחה אם יש פעולות-הון של-כותב-לא-מזוהה בחלון (טריות=actionable; ישנות=היסטוריה-מדוגלת) */
  if (m.chainDark) {
    keep(contra('C-unknown-writer', 'כותבים-לא-מזוהים — לא-נמדד', 'רשת-השרשרת חשוכה במחזור-זה: אי-אפשר לטעון "אין-כותבים-לא-מזוהים". המצב נשאר שאלה-פתוחה.', 'writer-attribution', 'previous cycles showed unknown-writer capital ops', 'chain measurement UNMEASURED this cycle', 0.3, m.nowIso, 'open', 'UNKNOWN', ['grid', 'general']));
  } else {
    const n = m.unknownFresh.length + m.unknownOlder.length;
    if (n > 0) {
      const list = m.unknownFresh.concat(m.unknownOlder).slice(0, 8).map((c) => `${c.at.slice(0, 16)}Z ${c.op} trx=${c.trx} orderid=${c.orderid || '-'} ${c.amount || ''} [${c.at < m.freshCutoffIso ? 'ישן' : 'טרי'}]`).join(' · ');
      keep(contra('C-unknown-writer', 'כותבים-לא-מזוהים על-השרשרת', `נמדדו ${n} פעולות-הון ללא-תבנית-כותב בחלון-8h (טריות ≤4h: ${m.unknownFresh.length} — actionable, ישנות: ${m.unknownOlder.length} — היסטוריה). פירוט: ${list}`, 'writer-attribution', 'organism has no owner for these signed ops', 'chain shows the ops signed by headcorner anyway', 0.9, m.nowIso, 'open', 'OBSERVED', [...new Set(m.unknownFresh.concat(m.unknownOlder).map((c) => c.lane))]));
    } else {
      keep(contra('C-unknown-writer', 'כותבים-לא-מזוהים על-השרשרת', 'נמדד-נקי: אין פעולות-הון ללא-תבנית-כותב בחלון-8h במחזור-זה.', 'writer-attribution', 'no unknown-writer ops measured', 'window clean at ' + m.nowIso, 0.9, m.nowIso, 'resolved', 'OBSERVED', []));
    }
  }
  /* C-rpc-split */
  if (m.rpcSplit) {
    keep(contra('C-rpc-split', 'פיצול-צמתים', `שני-הצמתים חיים אך אינם מסכימים: ${m.rpcSplit.detail}. חוסר-הסכמה מוריד את ציון-ההסכמה של-הסנסורים.`, 'sensor-agreement', JSON.stringify(m.rpcSplit.a).slice(0, 200), JSON.stringify(m.rpcSplit.b).slice(0, 200), 0.8, m.nowIso, 'open', 'OBSERVED', []));
  } else {
    keep(contra('C-rpc-split', 'פיצול-צמתים', m.chainDark ? 'לא-נמדד — השרשרת חשוכה במחזור-זה.' : 'נמדד: שני-הצמתים מסכימים על lastIdx, מספר-הפעולות-בחלון וטביעת-תמהיל-האופים.', 'sensor-agreement', 'node A', 'node B', 0.8, m.nowIso, m.chainDark ? 'open' : 'resolved', m.chainDark ? 'UNKNOWN' : 'OBSERVED', []));
  }
  /* C-home-dark + C-brake-dark (בית-חשוך מול בלם-קריא-אך-לא-אותנטי) */
  const darkHomes = m.homes.filter((h) => h.stasis.epistemic === 'UNKNOWN' && h.reachability !== 'ok');
  const brakeDark = m.homes.filter((h) => h.stasis.epistemic === 'UNKNOWN' && h.reachability === 'ok');
  if (darkHomes.length) {
    keep(contra('C-home-dark', 'בית-חשוך', `${darkHomes.map((h) => h.home).join(', ')}: לא ניתן להגיע לקובץ-ה-STASIS (raw/קריאה נכשלה). לא-נמדד ≠ תקין.`, 'cross-home-visibility', 'homes expected readable', darkHomes.map((h) => `${h.home}: ${h.stasis.reason || 'unreachable'}`).join(' | ').slice(0, 300), 0.85, m.nowIso, 'open', 'UNKNOWN', []));
  } else {
    keep(contra('C-home-dark', 'בית-חשוך', 'נמדד: שלושת-הבתים נקראו בהצלחה במחזור-זה.', 'cross-home-visibility', 'steem+Domain+saos-dex', 'all readable at ' + m.nowIso, 0.85, m.nowIso, 'resolved', 'OBSERVED', []));
  }
  if (brakeDark.length) {
    keep(contra('C-brake-dark', 'בלם-חשוך', `${brakeDark.map((h) => h.home).join(', ')}: הבית נגיש אך קובץ-ה-STASIS לא קריא/לא-אותנטי — fail-closed על-ידי-השער, וה-beat סוגר-את-המסילות-המדורגות (TTL 6h).`, 'brake-readability', 'STASIS.json must be authentic-readable', brakeDark.map((h) => `${h.home}: ${h.stasis.reason || 'unauthenticated'}`).join(' | ').slice(0, 300), 0.9, m.nowIso, 'open', 'OBSERVED', []));
  } else {
    keep(contra('C-brake-dark', 'בלם-חשוך', 'נמדד: קבצי-ה-STASIS בכל-הבתים קריאים ואותנטיים.', 'brake-readability', 'all STASIS files authenticated', 'ok at ' + m.nowIso, 0.9, m.nowIso, 'resolved', 'OBSERVED', []));
  }
  /* C-model-vs-chain — frontier אומר HALTED אך החלון מציג פעולות-מהמסילה-ההיא */
  if (m.modelVsChain.length) {
    keep(contra('C-model-vs-chain', 'דגם-מול-שרשרת', `ה-frontier מצהיר HALTED אך בחלון-8h נמדדו פעולות-מאותה-מסילה: ${m.modelVsChain.join(' · ')}. זו היסטוריה-מדוגלת (ייחוס נפרד), לא-הכרעה-חדשה.`, 'frontier-vs-reality', 'frontier lane = HALTED', 'signed lane-class ops observed in window', 0.85, m.nowIso, 'open', 'OBSERVED', [...new Set(m.modelVsChain.map((x) => x.split(' ')[0].replace(/:$/, '')))]));
  } else {
    keep(contra('C-model-vs-chain', 'דגם-מול-שרשרת', 'נמדד-עקבי: אין פעולות-חלון על-מסילות שה-frontier מצהיר HALTED.', 'frontier-vs-reality', 'frontier', 'window ops', 0.85, m.nowIso, 'resolved', 'OBSERVED', []));
  }
  /* C-directives-gap — STASIS של-בית מרשה-מסילות שאינן-מכוסות-שרשרת-מאומתת.
   * שני-סוגים, מתויגים-בכנות: (1) gaps-firing = שרשרת-קיימת-ושבורה/לא-מכסה → tamper-signal,
   * ה-beat סוגר-את-המסילות-המדורגות (TTL 6h); (2) structuralGaps = אין-קובץ-שרשרת-כלל באותו-בית
   * (saos-dex — V-a הצמיח-שרשרת-רק ב-steem+Domain במכוון): סתירה-פתוחה-מוצגת לבעלים אך לא-יורה
   * שומר — ל-beat אין-תיקון לקובץ-חסר בבית-אחר, וסגירת-מסילות-steem לא הייתה תיקון אלא טקס.
   * ההחלטה-הזו-עצמה מתועדת כאן וב-measurementNotes — טענת-מדיניות של-ה-beat, נתונה-לביקורת-הבעלים. */
  const structural = m.structuralGaps || [];
  if (m.gaps.length || structural.length) {
    const firingTxt = m.gaps.length ? `${m.gaps.join(' | ')}. מסילות-פתוחות-בלי-כיסוי-שרשרת-מאומתת = אפשר-טמפרינג; ה-beat סוגר-את-המסילות-המדורגות (TTL 6h) עד-תיקון-הבעלים.` : '';
    const structTxt = structural.length ? ` · structural (non-firing): ${structural.join(' | ')} — אין-שרשרת-כלל בבית-זה; רשום-לבעלים, לא-יורה-שומר (אין-תיקון-מכני לקובץ-חסר בבית-אחר).` : '';
    keep(contra('C-directives-gap', 'פער-הנחיות-בעלים', (firingTxt + structTxt).slice(0, 700), 'directives-coverage', 'STASIS stagedLanes.allow', 'owner-directives chain coverage', 0.8, m.nowIso, 'open', 'OBSERVED', []));
  } else {
    keep(contra('C-directives-gap', 'פער-הנחיות-בעלים', 'נמדד: כל-מסילה-פתוחה בכל-בית מכוסה על-ידי שרשרת-נחיות-מאומתת (או שהבית חשוך ומדווח-כך בנפרד).', 'directives-coverage', 'staged lanes', 'verified chains', 0.8, m.nowIso, 'resolved', 'OBSERVED', []));
  }
  /* C-custody */
  if (m.custody.problems.length) {
    keep(contra('C-custody', 'משמורת-חשודה', `${m.custody.problems.join(' | ')}.`, 'custody-tree', 'nv.zip untracked + recovery chain preserved', m.custody.problems.join(' | ').slice(0, 280), 0.9, m.nowIso, 'open', 'OBSERVED', []));
  } else {
    keep(contra('C-custody', 'משמורת-חשודה', 'נמדד: nv.zip לא בעץ-החיים ושרשרת-ההשתקמות (vault/*.enc + recovery-meta) קיימת.', 'custody-tree', 'nv.zip untracked (V-a custody commit)', 'recovery chain present at HEAD', 0.9, m.nowIso, 'resolved', 'OBSERVED', []));
  }
  /* היסטוריה: כל-סתירה-קודמת שלא-נוצרה-מחדש במחזור-זה נשמרת כפתורה/פתורה כפי-שהייתה (לעולם לא נמחקת) */
  const emitted = new Set(out.map((c) => c.id));
  for (const p of prevList || []) {
    if (emitted.has(p.id)) continue;
    out.push({ ...p });
  }
  /* C-002 ההיסטורית (writer-attribution של-R27) נסגרת-על-ידי-המנגנון החדש: */
  for (const c of out) {
    if (c.id === 'C-002' && c.status === 'open') {
      c.status = 'resolved';
      c.detail = String(c.detail || '').slice(0, 200) + ' · [resolved by cognition-beat: superseded-by C-unknown-writer (mechanical, hourly)]';
    }
  }
  return out;
}

/* ══════════════════════════ 4. DECIDE — mechanism-shrink בלבד ══════════════════════════ */
function receipt(fields) {
  const full = {
    at: iso(Date.now()),
    kind: fields.kind,
    decision: fields.decision,
    authority: fields.authority,
    evidence: fields.evidence || [],
    preconditions: fields.preconditions || [],
    confidence: typeof fields.confidence === 'number' ? fields.confidence : 0.8,
    expectedOutcome: fields.expectedOutcome || '',
    alternatives: fields.alternatives || [],
    idempotencyKey: fields.idempotencyKey,
    abortConditions: fields.abortConditions || [],
    postconditions: fields.postconditions || [],
    /* V-b hardening: closure receipts can carry a FINAL verdict (status/at/actual/deviation) —
     * append-only self-loop closure; the ORIGINAL receipt line is never rewritten. */
    verification: fields.verification || { method: fields.verificationMethod || 're-measure next cycle', status: 'pending', at: null, actual: null, deviation: null },
    note: String(fields.note || '').slice(0, 300),
  };
  return full;
}
/**
 * decideShrink({stagedLanes, activeGuards, freshUnknown, gaps, brakeDark, laneFailures, hourBucket})
 * חוקים (shrink-only): (a) fresh-unknown → close ALL staged lanes TTL 12h · (b) gap/brake-dark → close ALL staged TTL 6h
 * (c) ≥3 כישלונות-רצופים-במסילה → close that lane TTL 12h.
 * אותה-הכרעה באותו-חלון = אותו idempotencyKey; סיבה שכבר-יש-עליה-שומר-פעיל לא מייצרת הכרעה-כפולה.
 */
function decideShrink(input) {
  const decisions = [];
  const staged = (input.stagedLanes || []).map((x) => String(x).toLowerCase());
  const hasGuardOnLane = (lane) => (input.activeGuards || []).some((g) => g.lane === String(lane).toLowerCase() && g.expiryOk);
  /* סיבות-מכוסות-כבר-על-ידי-שומר-פעיל (לא-פג-תוקף): */
  const coveredReasons = new Set();
  for (const g of input.activeGuards || []) {
    if (!g.expiryOk) continue;
    const r = String(g.reason || '');
    if (r.includes('unknown-writer')) coveredReasons.add('unknown-writer');
    if (r.includes('directives-gap')) coveredReasons.add('directives-gap');
    if (r.includes('brake-dark')) coveredReasons.add('brake-dark');
  }

  const pendingReasons = [];
  let ttlH = 0;
  const evidence = [];
  if (input.freshUnknown.length && !coveredReasons.has('unknown-writer')) {
    pendingReasons.push('unknown-writer');
    ttlH = Math.max(ttlH, TTL_CLOSE_H);
    for (const c of input.freshUnknown.slice(0, 8)) evidence.push({ source: 'chain-history', ref: `trx=${c.trx} ${c.op} orderid=${c.orderid || '-'} at=${c.at} writer=unknown conf=${c.confidence}`, at: c.at });
  }
  if (input.gaps.length && !coveredReasons.has('directives-gap')) {
    pendingReasons.push('directives-gap');
    ttlH = Math.max(ttlH, TTL_GAP_H);
    evidence.push({ source: 'cross-home', ref: input.gaps.join(' | ').slice(0, 300), at: iso(Date.now()) });
  }
  if (input.brakeDark.length && !coveredReasons.has('brake-dark')) {
    pendingReasons.push('brake-dark');
    ttlH = Math.max(ttlH, TTL_GAP_H);
    evidence.push({ source: 'cross-home', ref: ('STASIS unreadable: ' + input.brakeDark.join(', ')).slice(0, 300), at: iso(Date.now()) });
  }
  if (pendingReasons.length && staged.length) {
    const key = sha256(['close-staged', input.hourBucket, staged.slice().sort().join(',')].join('|'));
    decisions.push(receipt({
      kind: 'beat-guard-close',
      decision: 'close-staged-lanes',
      authority: 'mechanism-shrink',
      evidence,
      preconditions: ['staged lanes measured from STASIS.json (never beyond)', 'no active guard already covers reasons ' + pendingReasons.join('+'), 'shrink is mechanically free (V-a directional authority)'],
      confidence: 0.9,
      expectedOutcome: `loopguard.guards gain closed:true entries for [${staged.join(',')}] TTL ${ttlH}h — capital_gate.stasisHalt returns LANE-GUARD-HALT for those lanes; no lane ever opens beyond STASIS baseline`,
      alternatives: ['do-nothing (rejected: fresh unsigned capital ops / coverage gap = sovereignty break the organism must self-stop)', 'halt STASIS itself (rejected: beat never edits STASIS.json — owner-only file)'],
      idempotencyKey: key,
      abortConditions: ['STASIS.json became unreadable mid-cycle (probe re-check)', 'guards file corrupted on write'],
      postconditions: [`lane-guards.json carries ${staged.length} closed:true guards expiring ${iso(Date.now() + ttlH * 3600e3)}`, 'verification probe (guard-closed /tmp copy) halts the gate'],
      verificationMethod: '/tmp gate probe: stasisHalt on guard-closed copy must return true; empty-guards copy must allow staged lane',
      note: 'reasons=' + pendingReasons.join('+') + ' ttl=' + ttlH + 'h (beat cycle ' + input.cycle + ')',
    }));
  }
  for (const lf of input.laneFailures || []) {
    if (lf.consecutive >= LANE_FAIL_N && !hasGuardOnLane(lf.lane)) {
      decisions.push(receipt({
        kind: 'beat-guard-close',
        decision: 'close-lane',
        authority: 'mechanism-shrink',
        evidence: lf.evidence,
        preconditions: [`${lf.consecutive} consecutive failed runs measured from receipts for lane ${lf.lane}`, 'no active guard on this lane'],
        confidence: 0.8,
        expectedOutcome: `guard closes lane ${lf.lane} TTL ${TTL_CLOSE_H}h — the failing tool stops signing on-chain until re-measured clean`,
        alternatives: ['ignore (rejected: repeated on-chain-signing failures are a run-time hazard)'],
        idempotencyKey: sha256(['close-lane', lf.lane, input.hourBucket].join('|')),
        abortConditions: [],
        postconditions: [`guard ${lf.lane} closed:true TTL ${TTL_CLOSE_H}h`],
        verificationMethod: 'lane receipts re-scan next cycle: failure streak must reset or guard persists',
        note: 'lane-failure streak=' + lf.consecutive + ' (beat cycle ' + input.cycle + ')',
      }));
    }
  }
  return decisions;
}
/**
 * evaluateReleases(activeGuards, recheckHistoryByGuard, currentRecheckByGuard, nowMs)
 * שחרור: תנאי-הטריגר נמדד-נקי בשני-מחזורים-רצופים (כולל-המחזור-הנוכחי) והשומר לא-פג → הסרה (חזרה לבסיס-STASIS, לעולם לא מעבר).
 */
function evaluateReleases(activeGuards, recheckHistoryByGuard, currentRecheckByGuard, nowMs) {
  const releases = [];
  for (const g of activeGuards || []) {
    const exp = g.expiresAt ? Date.parse(g.expiresAt) : NaN;
    if (Number.isFinite(exp) && exp <= nowMs) continue; /* פג-תוקף = אינרטי (loopguard) — אין-מה-לשחרר */
    const hist = (recheckHistoryByGuard.get(g.id) || []).slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const cur = currentRecheckByGuard.get(g.id);
    const seq = hist.concat(cur ? [cur] : []);
    let streak = 0;
    for (let i = seq.length - 1; i >= 0; i--) { if (seq[i] && seq[i].result === 'clean') streak++; else break; }
    if (streak >= RELEASE_CLEAN_N) {
      releases.push({ guard: g, streak, receipt: receipt({
        kind: 'beat-guard-release',
        decision: 'release-guard',
        authority: 'mechanism-shrink',
        evidence: [{ source: 'agent/receipts/cognition-beat.jsonl', ref: `guard ${g.id} clean streak=${streak} (trigger condition re-measured clean on ${RELEASE_CLEAN_N} consecutive cycles)`, at: iso(nowMs) }],
        preconditions: ['trigger condition re-measured clean on 2 consecutive cycles', 'guard not expired', 'release returns to STASIS baseline — never beyond'],
        confidence: 0.85,
        expectedOutcome: `guard ${g.id} removed from lane-guards.json — lane returns to whatever STASIS.json itself allows (staged lanes per owner directives, nothing more)`,
        alternatives: ['keep guard forever (rejected: shrink is temporary by design; STASIS.json remains the standing brake)'],
        idempotencyKey: sha256(['release', g.id, iso(nowMs).slice(0, 13)].join('|')),
        abortConditions: [],
        postconditions: [`guard ${g.id} absent from guards file`],
        verificationMethod: 'next cycle: guard absent + probe copy with empty guards allows staged lane',
        note: 'release streak=' + streak,
      }) });
    }
  }
  return releases;
}
/* תנאי-טריגר לשומר — נמדד-מחדש כל-מחזור (ל-recheck). שומר-משולב (מספר-סיבות) = נקי רק אם-כל-סיבותיו נקיות: */
function recheckGuard(guard, m) {
  const reason = String(guard.reason || '');
  const dirty = [], clean = [];
  if (reason.includes('unknown-writer')) {
    if (m.freshUnknown.length) dirty.push('unknown-writer: ' + m.freshUnknown.length + ' fresh ops'); else clean.push('unknown-writer clean');
  }
  if (reason.includes('directives-gap')) {
    if (m.gapsOpen) dirty.push('directives-gap still open'); else clean.push('directives coverage verified');
  }
  if (reason.includes('brake-dark')) {
    if (m.brakeDarkOpen) dirty.push('a STASIS file still unreadable'); else clean.push('all brakes readable');
  }
  if (!reason.includes('unknown-writer') && !reason.includes('directives-gap') && !reason.includes('brake-dark')) {
    if (m.freshUnknown.length) dirty.push('fresh unknown-writer ops (default condition)'); else clean.push('default condition clean');
  }
  return { guardId: guard.id, lane: guard.lane, result: dirty.length ? 'dirty' : 'clean', detail: (dirty.length ? dirty.join(' ; ') : clean.join(' ; ')), at: iso(Date.now()) };
}

/* ══════════════════════════ LEARN — frontier + counters ══════════════════════════ */
/**
 * computeFrontier({laneCycles, openContraLanes, laneWriters, authenticityGreen, stagedLanes})
 * REAL = אותנטיות-ירוקה + ≥3 מחזורים-מוצלחים-נצפים + אפס-סתירות-פתוחות-על-המסילה + כותב-מיוחס; אחרת STAGED אם-מדורגת-מותרת; אחרת HALTED.
 */
function computeFrontier(input) {
  const lanes = {};
  const all = ['grid', 'claims', 'general'];
  for (const lane of all) {
    const cyc = (input.laneCycles || {})[lane] || { observedCycles: 0, successfulCycles: 0 };
    const openContra = (input.openContraLanes || []).includes(lane);
    const w = (input.laneWriters || {})[lane] || null;
    const attributed = !!w && w.writer !== 'unknown' && w.confidence >= 0.5;
    const realOk = input.authenticityGreen === true
      && cyc.successfulCycles >= FRONTIER_REAL_MIN_CYCLES
      && !openContra
      && attributed
      && lane !== 'general' && (input.stagedLanes || []).includes(lane); /* לא-מדורגת-מותרת = לעולם לא REAL */
    let level, why;
    if (realOk) { level = 'REAL'; why = `authenticity green + ${cyc.successfulCycles} successful cycles + zero open contradictions + writer ${w.writer} attributed`; }
    else if (lane !== 'general' && (input.stagedLanes || []).includes(lane)) {
      level = 'STAGED';
      const missing = [];
      if (input.authenticityGreen !== true) missing.push('authenticity');
      if (cyc.successfulCycles < FRONTIER_REAL_MIN_CYCLES) missing.push(`successful-cycles ${cyc.successfulCycles}/${FRONTIER_REAL_MIN_CYCLES}`);
      if (openContra) missing.push('open contradiction on lane');
      if (!attributed) missing.push('writer attribution');
      why = 'staged-allowed by owner directives; not REAL yet — missing: ' + missing.join(', ');
    } else { level = 'HALTED'; why = 'not staged-allowed in STASIS.json (fail-closed default)'; }
    const ev = [{ source: 'cognition-beat', ref: `frontier computed at cycle from receipts+contradictions+authenticity probe: ${why}`, at: iso(Date.now()) }];
    lanes[lane] = { level, justification: why, evidence: ev };
  }
  return lanes;
}

/* ══════════════════════════ SELF-LOOP — probe השער בעותק-/tmp ══════════════════════════
 * ה-probe בודק את-המנגנון (לא את-מצב-השומרים-הנוכחי): שומר-סינתטי-סגור על-מסילת-grid חייב
 * לעצור את-השער, guards-ריקים חייבים להתנהג-לפי-STASIS (staged+allow → אישור; אחרת → עצירה),
 * ו-STASIS-מזויף חייב להיעצר (אותנטיקה). כך guardWorks נמדד-תמיד, גם-כשאין-שומרים-אמיתיים. */
function runGateProbe() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'saos-gate-probe-'));
  const res = { tmp, guardWorks: null, authenticityGreen: null, baselineAllow: null, expectedBaselineHalt: null, error: null };
  try {
    const root = path.join(tmp, 'agent');
    fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
    fs.mkdirSync(path.join(root, 'cognition'), { recursive: true });
    fs.mkdirSync(path.join(root, 'receipts'), { recursive: true });
    fs.copyFileSync(path.join(AGENT_DIR, 'STASIS.json'), path.join(root, 'STASIS.json'));
    for (const f of ['capital_gate.cjs', 'directivesChain.cjs', 'loopguard.cjs']) fs.copyFileSync(path.join(AGENT_DIR, 'lib', f), path.join(root, 'lib', f));
    fs.writeFileSync(path.join(root, 'receipts', 'owner-directives.jsonl'), fs.readFileSync(CHAIN.CHAIN_FILE, 'utf8'));
    /* תוצאת-הבסיס-הצפויה נגזרת-מה-STASIS-עצמו — לא מראיה-מקומית: */
    const stasis = JSON.parse(fs.readFileSync(path.join(root, 'STASIS.json'), 'utf8'));
    const allow = stasis && stasis.stagedLanes && Array.isArray(stasis.stagedLanes.allow) ? stasis.stagedLanes.allow.map((x) => String(x).toLowerCase()) : [];
    res.expectedBaselineHalt = !(stasis && stasis.active === true && stasis.mode === 'staged' && allow.includes('grid'));
    const guardDoc = { protocol: 'SAOS-LANE-GUARDS/1', guards: [{ id: 'probe-guard-mechanism-check', lane: 'grid', closed: true, reason: 'probe: mechanism check (synthetic guard, never committed)', evidenceRef: 'beat-selfloop', openedAt: new Date().toISOString(), expiresAt: null }] };
    const guardsEmptyDoc = { protocol: 'SAOS-LANE-GUARDS/1', guards: [], note: 'probe baseline' };
    const script = `
      const fs=require('fs'), path=require('path');
      const root=${JSON.stringify(root)};
      const G=require(path.join(root,'lib','capital_gate.cjs'));
      const out={};
      fs.writeFileSync(path.join(root,'cognition','lane-guards.json'), ${JSON.stringify(JSON.stringify(guardDoc))});
      out.withGuard=G.stasisHalt('ladder-refresh');           /* synthetic closed guard on grid → expect true (halt) */
      fs.writeFileSync(path.join(root,'cognition','lane-guards.json'), ${JSON.stringify(JSON.stringify(guardsEmptyDoc))});
      out.baseline=G.stasisHalt('ladder-refresh');            /* empty guards → expect per-STASIS behavior */
      const stasis=JSON.parse(fs.readFileSync(path.join(root,'STASIS.json'),'utf8'));
      stasis.active=false; delete stasis.protocol;            /* forged lift */
      fs.writeFileSync(path.join(root,'STASIS.json'), JSON.stringify(stasis));
      out.forged=G.stasisHalt('ladder-refresh');              /* unauthenticated → expect true (halt) */
      console.log(JSON.stringify(out));
    `;
    const r = execFileSync(process.execPath, ['-e', script], { timeout: 30000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const o = JSON.parse(r.trim().split('\n').filter(Boolean).pop());
    res.guardWorks = o.withGuard === true;                    /* המנגנון: שומר-סגור עוצר */
    res.baselineAllow = o.baseline === res.expectedBaselineHalt; /* התנהגות-בסיס נאמנה ל-STASIS (allow אם-מותר, halt אם-לא) */
    res.authenticityGreen = o.forged === true && res.baselineAllow; /* אותנטיקה + בסיס-נאמן */
    res.actual = o;
  } catch (e) {
    res.error = String((e && e.message) || e).slice(0, 200);
  }
  return res;
}

/* ══════════════════════════ זיכרון — receipts append-only idempotent ══════════════════════════ */
function readBeatReceipts() {
  try {
    return fs.readFileSync(BEAT_RECEIPTS, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
  } catch (_) { return []; }
}
function appendReceipts(newReceipts) {
  if (!newReceipts.length) return 0;
  const existing = new Set(readBeatReceipts().map((r) => r.idempotencyKey).filter(Boolean));
  fs.mkdirSync(path.dirname(BEAT_RECEIPTS), { recursive: true });
  let n = 0;
  const lines = [];
  for (const r of newReceipts) {
    if (r.idempotencyKey && existing.has(r.idempotencyKey)) continue;
    lines.push(JSON.stringify(r));
    existing.add(r.idempotencyKey);
    n++;
  }
  if (lines.length) fs.appendFileSync(BEAT_RECEIPTS, lines.join('\n') + '\n');
  return n;
}
/** כישלונות-מסילה מהקבלות-הקיימות (grid = ladder-refresh receipts; claims אין-קבלות → לא-נמדד). */
function laneFailureStreak() {
  const out = [];
  try {
    /* שמות-הקבצים: התאריך לפני-הכלי (2026-10-05-ladder-refresh-…) — זיהוי-לפי-תוכן-השם, לא לפי-קידומת.
     * (תיקון-באג-נמדד ב-V-b retry: startsWith('ladder-refresh-') מצא אפס-קבצים והשקר streak=0 —
     * כישלון-מדידה-שקט. עכשיו: אין-קבצים = measured:false גלוי, לא אפס-שקרי.) */
    const files = fs.readdirSync(RECEIPTS_DIR).filter((f) => f.includes('ladder-refresh') && f.endsWith('.json')).sort();
    const rows = [];
    for (const f of files) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(RECEIPTS_DIR, f), 'utf8'));
        rows.push({ at: j.at || f, status: String(j.status || 'unknown') });
      } catch (_) { rows.push({ at: f, status: 'unreadable-receipt' }); }
    }
    rows.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const FAIL_RE = /abort|fail|error|exception/i;
    let consec = 0;
    for (let i = rows.length - 1; i >= 0; i--) { if (FAIL_RE.test(rows[i].status)) consec++; else break; }
    const ev = rows.slice(-Math.max(consec, 1)).map((r) => ({ source: 'agent/receipts/' + (r.at || ''), ref: 'status=' + r.status, at: r.at }));
    out.push({ lane: 'grid', tool: 'ladder-refresh', consecutive: consec, evidence: ev, measured: true });
  } catch (e) { out.push({ lane: 'grid', tool: 'ladder-refresh', consecutive: 0, evidence: [], measured: false, note: String((e && e.message) || e).slice(0, 100) }); }
  out.push({ lane: 'claims', tool: 'claim-suite', consecutive: 0, evidence: [], measured: false, note: 'no per-run receipts files exist for claims — streak UNMEASURED, never claimed 0' });
  return out;
}

/* ══════════════════════════ cross-home (GitHub raw; token חי-בזיכרון-בלבד) ══════════════════════════ */
function authHeaders(token) { return token ? { Authorization: 'Bearer ' + token, 'User-Agent': 'saos-cognition-beat' } : { 'User-Agent': 'saos-cognition-beat' }; }
async function rawFetch(repo, branch, filePath, token) {
  const url = `https://raw.githubusercontent.com/${ORG}/${repo}/${branch}/${filePath}`;
  const r = await fetchUrl(url, { headers: authHeaders(token), timeoutMs: 15000 });
  if (!r.ok) return { ok: false, status: r.status || 0, error: r.error || ('http-' + r.status) };
  return { ok: true, body: r.body };
}
function parseStasisDoc(text) {
  try {
    const d = JSON.parse(text);
    const allow = d && d.stagedLanes && Array.isArray(d.stagedLanes.allow) ? d.stagedLanes.allow.map(String) : [];
    const authentic = d && d.protocol === 'SAOS-FATE-DEFENSE-STASIS/1' && (d.mode === 'full' || d.mode === 'staged') && typeof d.since === 'string' && !Number.isNaN(Date.parse(d.since));
    return { epistemic: 'OBSERVED', active: d.active === true, mode: String(d.mode || '?'), stagedLanes: allow, since: d.since || null, authentic };
  } catch (_) { return { epistemic: 'UNKNOWN', active: null, mode: null, stagedLanes: [], since: null, authentic: false }; }
}

/* ══════════════════════════ שומרים — כתיבה (סגירה-בלבד) ══════════════════════════ */
function readGuardsDoc() {
  try {
    const d = JSON.parse(fs.readFileSync(GUARDS_FILE, 'utf8'));
    if (d && d.protocol === GUARDS_LIB.PROTOCOL && Array.isArray(d.guards)) return d;
  } catch (_) {}
  return { protocol: GUARDS_LIB.PROTOCOL, guards: [], note: 'recreated by cognition-beat after unreadable file' };
}
function buildGuardsDoc(prevDoc, closeDecisions, releases, nowMs, stagedLanes) {
  const staged = (stagedLanes || inputStagedHint || []).map((x) => String(x).toLowerCase());
  const guards = prevDoc.guards
    .filter((g) => g && typeof g === 'object')
    .map((g) => ({ id: String(g.id), lane: String(g.lane).toLowerCase(), closed: g.closed === true, reason: String(g.reason || ''), evidenceRef: g.evidenceRef == null ? null : String(g.evidenceRef).slice(0, 200), openedAt: g.openedAt || null, expiresAt: g.expiresAt || null }));
  const releaseIds = new Set(releases.map((r) => r.guard.id));
  let next = guards.filter((g) => !releaseIds.has(g.id));
  /* ניקוי-היגייני: שומר-שפג-תוקפו לפני >24h יורד (ההיסטוריה חיה ב-git ובקבלות) */
  next = next.filter((g) => {
    const exp = g.expiresAt ? Date.parse(g.expiresAt) : NaN;
    return !(Number.isFinite(exp) && exp < nowMs - 24 * 3600e3);
  });
  for (const d of closeDecisions) {
    const ttlH = d.note && d.note.includes('ttl=6h') ? TTL_GAP_H : TTL_CLOSE_H;
    const reasons = ((d.note || '').match(/reasons=([\w+-]+)/) || [])[1] || 'reasons';
    if (d.decision === 'close-staged-lanes') {
      for (const lane of staged) {
        /* מזהה-יציב: מסילה+סיבה — מונע שומרים-כפולים בין-מחזורים כשהאותה-סיבה נשארת חיה.
         * חידוש-נמדד (V-b retry): שומר-קיים-חי עם-אותו-מזהה → לא נוגעים (אין-כפילות);
         * שומר-פג-תוקף עם-אותו-מזהה → מוחלף-בטרי (אחרת היה חוסם-לנצח את-החידוש-שלו-עצמו). */
        const id = 'bg-' + sha256([lane, reasons].join('|')).slice(0, 10);
        const existing = next.find((g) => g.id === id);
        if (existing) {
          const exp = existing.expiresAt ? Date.parse(existing.expiresAt) : NaN;
          if (Number.isFinite(exp) && exp > nowMs) continue; /* חי — אין-כפילות */
          next = next.filter((g) => g.id !== id); /* פג-תוקף — מוחלף-בטרי למטה */
        }
        next.push({
          id, lane, closed: true,
          reason: (d.note || '').slice(0, 200),
          evidenceRef: d.evidence.map((e) => e.ref).join(' ; ').slice(0, 200) || d.idempotencyKey,
          openedAt: d.at, expiresAt: iso(nowMs + ttlH * 3600e3),
        });
      }
    } else if (d.decision === 'close-lane') {
      const laneGuess = (d.preconditions.join(' ').match(/for lane (\w+)/) || [])[1] || 'general';
      const id = 'bg-' + sha256([laneGuess, 'lane-failures'].join('|')).slice(0, 10);
      const existing = next.find((g) => g.id === id);
      if (existing) {
        const exp = existing.expiresAt ? Date.parse(existing.expiresAt) : NaN;
        if (Number.isFinite(exp) && exp > nowMs) continue;
        next = next.filter((g) => g.id !== id);
      }
      next.push({ id, lane: laneGuess.toLowerCase(), closed: true, reason: (d.note || '').slice(0, 200), evidenceRef: d.evidence.map((e) => e.ref).join(' ; ').slice(0, 200) || d.idempotencyKey, openedAt: d.at, expiresAt: iso(nowMs + TTL_CLOSE_H * 3600e3) });
    }
  }
  next.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { protocol: GUARDS_LIB.PROTOCOL, guards: next, note: prevDoc.note && prevDoc.note.startsWith('V-a seed') ? 'cognition-beat is the writer from V-b on (trace 1a10c90522120149); guards can only CLOSE — loopguard.cjs ignores open/allow fields' : prevDoc.note };
}
let inputStagedHint = [];

/* ══════════════════════════ MODEL — organism.json regeneration ══════════════════════════ */
function buildModel(prev, ctx) {
  const next = SELFMODEL.EMPTY();
  next.generatedAt = ctx.nowIso;
  /* homes — כל-השלושה, עם-תווית-הסכמה */
  next.homes = {};
  const fp = (s) => (s && s.epistemic === 'OBSERVED') ? `${s.active ? 'armed' : 'released'}|${s.mode}|${s.stagedLanes.slice().sort().join(',')}` : null;
  const steemFp = fp(ctx.steemStasis), domFp = fp(ctx.domainStasis), dexFp = fp(ctx.dexStasis);
  const fps = [steemFp, domFp, dexFp].filter(Boolean);
  const consistent = fps.length >= 2 && fps.every((x) => x === fps[0]);
  next.homes.steem = {
    stasis: { epistemic: ctx.steemStasis.epistemic, active: ctx.steemStasis.active, mode: ctx.steemStasis.mode, stagedLanes: ctx.steemStasis.stagedLanes, since: ctx.steemStasis.since, evidence: [{ source: 'agent/STASIS.json', ref: 'local fs read, authenticated ' + (ctx.steemStasis.authentic ? 'yes' : 'NO'), at: ctx.nowIso }] },
    directivesChain: { ok: ctx.chainVerify.ok, entries: ctx.chainVerify.entries.length, breakAt: ctx.chainVerify.breakAt, reason: ctx.chainVerify.reason },
    guards: { activeGuards: ctx.activeGuardCount, closedAdded: ctx.closedAdded, released: ctx.releasedCount },
    truthSources: ['agent/STASIS.json', 'agent/lib/capital_gate.cjs', 'agent/lib/directivesChain.cjs', 'agent/lib/loopguard.cjs', 'agent/receipts/owner-directives.jsonl', 'agent/cognition/lane-guards.json'],
  };
  next.homes.domain = {
    stasis: ctx.domainStasis.epistemic === 'OBSERVED'
      ? { epistemic: 'OBSERVED', active: ctx.domainStasis.active, mode: ctx.domainStasis.mode, stagedLanes: ctx.domainStasis.stagedLanes, since: ctx.domainStasis.since, evidence: [{ source: 'raw.githubusercontent ' + CROSS_HOME.domain.repo, ref: 'agents/STASIS.json read ' + (ctx.domainStasis.authentic ? 'authenticated' : 'NOT-authentic'), at: ctx.nowIso }] }
      : { epistemic: 'UNKNOWN', reason: ctx.domainStasis.reason || 'raw fetch failed', at: ctx.nowIso },
    directivesChain: ctx.domainChain ? { ok: ctx.domainChain.ok, entries: ctx.domainChain.entries.length, breakAt: ctx.domainChain.breakAt, reason: ctx.domainChain.reason } : { ok: false, reason: 'chain not readable this cycle', epistemic: 'UNKNOWN' },
    truthSources: ['agents/STASIS.json (raw)', 'agents/receipts/owner-directives.jsonl (raw)'],
  };
  next.homes['saos-dex'] = {
    stasis: ctx.dexStasis.epistemic === 'OBSERVED'
      ? { epistemic: 'OBSERVED', active: ctx.dexStasis.active, mode: ctx.dexStasis.mode, stagedLanes: ctx.dexStasis.stagedLanes, since: ctx.dexStasis.since, evidence: [{ source: 'raw.githubusercontent ' + CROSS_HOME.dex.repo, ref: 'grids/state/STASIS.json read ' + (ctx.dexStasis.authentic ? 'authenticated' : 'NOT-authentic'), at: ctx.nowIso }] }
      : { epistemic: 'UNKNOWN', reason: ctx.dexStasis.reason || 'raw fetch failed', at: ctx.nowIso },
    truthGate: ctx.truthGate || UNKNOW('truth-gate.json unreadable'),
    gridLedger: ctx.ledger || UNKNOW('grid-ledger.json unreadable'),
    directivesChain: { ok: false, reason: 'no owner-directives chain exists in this home (V-a seeded steem+Domain only) — gap handled by C-directives-gap', epistemic: 'OBSERVED' },
    truthSources: ['grids/state/STASIS.json (raw)', 'grids/state/truth-gate.json (raw)', 'db/grid-ledger.json (raw)'],
  };
  next.homes.agreement = { consistent, fingerprint: steemFp || 'UNMEASURED', note: consistent ? 'steem+Domain(+dex) STASIS fingerprints match' : 'fingerprints differ or partially unmeasured — see C-home-dark / C-brake-dark', epistemic: fps.length === 3 ? 'OBSERVED' : 'UNKNOWN' };

  /* capabilities — נישאים-מהדגם-הקודם + סטטוס-המסילה-מחושב-מחדש + ה-capability של-ה-beat-עצמו */
  const prevCaps = Array.isArray(prev.capabilities) ? prev.capabilities : [];
  next.capabilities = prevCaps.map((c) => {
    const nc = { ...c };
    if (c.home === 'steem' && c.lane && ctx.frontier[c.lane]) nc.status = ctx.frontier[c.lane].level;
    if (nc.epistemic === 'OBSERVED' && !hasEv(nc)) nc.epistemic = 'INFERRED';
    if (nc.status === 'REAL' && nc.epistemic !== 'OBSERVED') nc.status = 'STAGED';
    return nc;
  });
  next.capabilities.push({
    id: 'steem/cognition-beat', home: 'steem', lane: 'cognition', status: 'STAGED',
    epistemic: 'OBSERVED',
    evidence: [{ source: 'agent/receipts/cognition-beat.jsonl', ref: `cycle ${ctx.cycle} completed in-organism (no LLM session): observe→decide→learn→act→verify`, at: ctx.nowIso }],
    ageHours: 0,
  });
  /* writers — מהמדידה-בפועל של-המחזור */
  next.writers = ctx.writers;
  next.authorities = prev.authorities && prev.authorities.decideAlone !== undefined ? prev.authorities : SELFMODEL.EMPTY().authorities;
  next.canonicalTruths = prev.canonicalTruths || [];
  next.contradictions = ctx.contradictions;
  next.frontier = { lanes: ctx.frontier, computedAt: ctx.nowIso, rule: `REAL requires: gate-authenticity green + >=${FRONTIER_REAL_MIN_CYCLES} observed successful cycles + zero open contradictions on lane + writer attributed; else STAGED if staged-allowed; else HALTED` };
  next.custody = prev.custody || {};
  next.custody.beatCheck = ctx.custody;
  next.unknowns = dedupe([...(prev.unknowns || []).slice(0, 8),
    'identity of the 2100000xxx micro-order writer (trx 8065683d…) — INFERRED attribution heuristics below 0.7 confidence are the ceiling of what the beat can honestly claim',
    'whether ZIP_PAT-class cross-home reads cover all homes the owner cares about',
  ]);
  next.measurementNotes = dedupe([...(prev.measurementNotes || []).slice(-12),
    'R27 orchestrator probe path-error (2026-10-05)',
    ...ctx.runErrors.slice(0, 4),
  ]);
  next.beat = ctx.beat;
  return next;
}
function hasEv(x) { return Array.isArray(x.evidence) && x.evidence.length > 0; }
function dedupe(arr) { return [...new Set(arr.filter((x) => typeof x === 'string' && x.trim()))]; }

/* ══════════════════════════ ACT — commit rebase-first, then verify own act ══════════════════════════ */
const OUR_FILES = Object.freeze(['agent/cognition/organism.json', 'agent/cognition/lane-guards.json', 'agent/receipts/cognition-beat.jsonl']);
/* (תיקון-באג-נמדד ב-e2e: החתימה הייתה git(args, opts) אך כל-הקריאות העבירו-varargs →
 * execFileSync קיבל 'add' כ-args-סקלרי וצעק. עכשיו: varargs טהורים.) */
function git(...args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_PAGER: 'cat', GIT_EDITOR: 'true' } }).trim();
}
function publish(msg) {
  try { git('config', 'user.name', 'saos-cognition'); git('config', 'user.email', 'cognition@saos.local'); } catch (_) {}
  git('add', '--', ...OUR_FILES);
  const staged = git('diff', '--cached', '--name-only');
  if (!staged) return { sha: git('rev-parse', 'HEAD'), committed: false };
  git('commit', '-m', msg);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      git('push', 'origin', 'HEAD:main');
      return { sha: git('rev-parse', 'HEAD'), committed: true };
    } catch (e) {
      console.log(`[BEAT] push attempt ${attempt} rejected — rebase-first retry`);
      try {
        git('fetch', 'origin', 'main');
        try {
          git('rebase', 'origin/main');
        } catch (re) {
          const conflicted = git('diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean);
          const onlyOurs = conflicted.length > 0 && conflicted.every((f) => OUR_FILES.includes(f));
          if (!onlyOurs) { try { git('rebase', '--abort'); } catch (_) {} throw new Error('rebase conflict on non-beat files: ' + conflicted.join(',')); }
          /* conflict on OUR generated files: take origin's, then re-apply decisions (regenerate from memory) */
          for (const f of conflicted) git('checkout', '--ours', '--', f);
          reapplyDecisions(conflicted);
          git('add', '--', ...conflicted);
          git('rebase', '--continue');
        }
      } catch (re2) {
        throw new Error('rebase-first failed: ' + String((re2 && re2.message) || re2).slice(0, 200));
      }
    }
  }
  throw new Error('push failed after 3 attempts');
}
/** re-apply: הקבצים-שלנו נוצרים-מחדש מהמצב-בזיכרון (ההחלטות-של-המחזור לא אובדות). */
let REAPPLY = {};
function reapplyDecisions(files) {
  for (const f of files) {
    const abs = path.join(REPO_ROOT, f);
    if (REAPPLY[f]) fs.writeFileSync(abs, REAPPLY[f]);
  }
}
/**
 * verifyOwnAct(sha, file, token, attempts=3) — אימות-עצמי-חיצוני: raw-fetch של-הקובץ-המקומיט-מה-API.
 * (תיקון-נמדד-בריצה-החיה: fetch אחד ~200ms אחרי-push החזיר תוכן-ישן (eventual-consistency) →
 * MISMATCH-שקרי. עכשיו: עד-3 ניסיונות עם-3s השהיה; MISMATCH-אמיתי מדווח-רק-אחרי-שלושתם.) */
async function verifyOwnAct(sha, file, token, attempts = 3) {
  const local = sha256(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'));
  const url = `https://api.github.com/repos/${ORG}/steem/contents/${file}?ref=${encodeURIComponent(sha)}`;
  let lastRemote = null;
  for (let i = 1; i <= attempts; i++) {
    const r = await fetchUrl(url, { headers: { ...authHeaders(token), Accept: 'application/vnd.github.raw' }, timeoutMs: 20000 });
    if (!r.ok) {
      if (i < attempts) { await new Promise((res) => setTimeout(res, 3000)); continue; }
      return { confirmed: false, local, remote: null, attempts: i, error: 'fetch-failed http-' + r.status + ' ' + (r.error || '') };
    }
    lastRemote = sha256(r.body);
    if (local === lastRemote) return { confirmed: true, local, remote: lastRemote, attempts: i, error: null };
    if (i < attempts) await new Promise((res) => setTimeout(res, 3000));
  }
  return { confirmed: false, local, remote: lastRemote, attempts, error: 'mismatch after ' + attempts + ' fetches' };
}

/* ══════════════════════════ MAIN LOOP ══════════════════════════ */
async function main() {
  const DRY = process.argv.includes('--dry-run');
  const nowMs = Date.now();
  const nowIso = iso(nowMs);
  const hourBucket = nowIso.slice(0, 13);
  const freshCutoffIso = iso(nowMs - FRESH_H * 3600e3);
  const runErrors = [];
  const zipPat = process.env.ZIP_PAT || '';
  const ghToken = process.env.GITHUB_TOKEN || process.env.ZIP_PAT || '';

  console.log(`[BEAT] cognition-beat cycle start ${nowIso} (dry=${DRY}) — shrink-only authority, no LLM session`);

  /* ── previous state ── */
  const prev = (() => { try { return JSON.parse(fs.readFileSync(ORGANISM_FILE, 'utf8')); } catch (_) { return SELFMODEL.EMPTY(); } })();
  const prevContradictions = Array.isArray(prev.contradictions) ? prev.contradictions : [];
  const prevFrontier = (prev.frontier && prev.frontier.lanes) || {};
  const prevBeat = prev.beat || {};
  const receiptsPrev = readBeatReceipts();
  const cycle = receiptsPrev.filter((r) => r.kind === 'cognition-beat-cycle').length + 1;

  /* ── 1. OBSERVE ── */
  let chainDark = false;
  let nodeA = null, nodeB = null;
  try {
    [nodeA, nodeB] = await Promise.all([
      observeChainNode(NODES[0], 8).catch((e) => ({ ok: false, node: NODES[0].name, role: NODES[0].role, error: String((e && e.message) || e).slice(0, 120) })),
      observeChainNode(NODES[1], 8).catch((e) => ({ ok: false, node: NODES[1].name, role: NODES[1].role, error: String((e && e.message) || e).slice(0, 120) })),
    ]);
  } catch (e) { chainDark = true; runErrors.push(`cycle ${cycle}: chain observe threw: ${String((e && e.message) || e).slice(0, 140)}`); }
  if (nodeA && !nodeA.ok && nodeB && !nodeB.ok) chainDark = true;
  const winA = nodeA && nodeA.ok ? windowOps(nodeA.entries, nowMs, WINDOW_H) : [];
  const winB = nodeB && nodeB.ok ? windowOps(nodeB.entries, nowMs, WINDOW_H) : [];
  let rpcSplit = null;
  if (nodeA && nodeA.ok && nodeB && nodeB.ok) {
    const fa = { lastIdx: nodeA.lastIdx, count: winA.length, mix: opMixFingerprint(winA) };
    const fb = { lastIdx: nodeB.lastIdx, count: winB.length, mix: opMixFingerprint(winB) };
    if (fa.lastIdx !== fb.lastIdx || fa.mix !== fb.mix) rpcSplit = { a: fa, b: fb, detail: `lastIdx ${fa.lastIdx} vs ${fb.lastIdx}; window count ${fa.count} vs ${fb.count}; mix differs: ${fa.mix !== fb.mix}` };
  }
  const primary = nodeA && nodeA.ok ? nodeA : (nodeB && nodeB.ok ? nodeB : null);
  const winOps = primary === nodeA ? winA : winB;
  console.log(`[BEAT] observe: chainDark=${chainDark} nodeA=${nodeA && nodeA.ok ? 'ok(' + nodeA.entries.length + ' ops)' : 'FAIL'} nodeB=${nodeB && nodeB.ok ? 'ok(' + nodeB.entries.length + ' ops)' : 'FAIL'} window(8h)=${winOps.length} rpcSplit=${!!rpcSplit}`);

  /* cross-home reads (raw, token never echoed) */
  const [domStasisR, domChainR, dexStasisR, dexTruthR, dexLedgerR] = await Promise.all([
    rawFetch(CROSS_HOME.domain.repo, CROSS_HOME.domain.branch, CROSS_HOME.domain.stasis, zipPat),
    zipPat ? rawFetch(CROSS_HOME.domain.repo, CROSS_HOME.domain.branch, CROSS_HOME.domain.chain, zipPat) : Promise.resolve({ ok: false, error: 'no-token' }),
    rawFetch(CROSS_HOME.dex.repo, CROSS_HOME.dex.branch, CROSS_HOME.dex.stasis, zipPat),
    rawFetch(CROSS_HOME.dex.repo, CROSS_HOME.dex.branch, CROSS_HOME.dex.truthGate, zipPat),
    rawFetch(CROSS_HOME.dex.repo, CROSS_HOME.dex.branch, CROSS_HOME.dex.ledger, zipPat),
  ]);
  const domainStasis = domStasisR.ok ? { ...parseStasisDoc(domStasisR.body), reachability: 'ok' } : { epistemic: 'UNKNOWN', reason: 'raw-' + (domStasisR.error || domStasisR.status), reachability: 'dark' };
  const dexStasis = dexStasisR.ok ? { ...parseStasisDoc(dexStasisR.body), reachability: 'ok' } : { epistemic: 'UNKNOWN', reason: 'raw-' + (dexStasisR.error || dexStasisR.status), reachability: 'dark' };
  /* local steem reads */
  let steemStasis;
  try {
    const d = JSON.parse(fs.readFileSync(path.join(AGENT_DIR, 'STASIS.json'), 'utf8'));
    steemStasis = { ...parseStasisDoc(JSON.stringify(d)), reachability: 'ok' };
    if (!d || d.protocol !== 'SAOS-FATE-DEFENSE-STASIS/1') steemStasis = { epistemic: 'UNKNOWN', reason: 'unauthenticated', reachability: 'ok' };
  } catch (e) { steemStasis = { epistemic: 'UNKNOWN', reason: 'unreadable', reachability: 'ok' }; }
  /* directives chains */
  const chainVerify = CHAIN.verifyChain();
  let domainChain = null;
  let domainChainTmp = null;
  if (domChainR.ok) {
    try {
      const tmpC = path.join(os.tmpdir(), 'domain-directives-' + crypto.randomBytes(4).toString('hex') + '.jsonl');
      fs.writeFileSync(tmpC, domChainR.body);
      domainChainTmp = tmpC;
      domainChain = CHAIN.verifyChain(tmpC);
    } catch (e) { domainChain = { ok: false, reason: 'verify-threw', breakAt: null, entries: [] }; }
  } else domainChain = { ok: false, reason: 'chain not readable (' + (domChainR.error || 'no-token') + ')', breakAt: null, entries: [] };
  /* ledger + truth-gate */
  let ledgerTxids = null, ledgerInfo;
  if (dexLedgerR.ok) {
    try {
      const j = JSON.parse(dexLedgerR.body);
      const set = new Set();
      for (const o of (j.orders || [])) if (o && typeof o.txid === 'string') set.add(o.txid);
      ledgerTxids = set;
      ledgerInfo = { epistemic: 'OBSERVED', orders: (j.orders || []).length, txids: set.size, placedTotal: j.placedTotal, filledTotal: j.filledTotal, at: nowIso };
    } catch (_) { ledgerInfo = UNKNOW('ledger json unparsable'); }
  } else ledgerInfo = UNKNOW('grid-ledger raw fetch failed: ' + (dexLedgerR.error || dexLedgerR.status));
  let truthGate;
  if (dexTruthR.ok) {
    try {
      const j = JSON.parse(dexTruthR.body);
      truthGate = { epistemic: 'OBSERVED', verdict: j.verdict || null, realFills24h: typeof j.realFills24h === 'number' ? j.realFills24h : null, at: nowIso };
    } catch (_) { truthGate = UNKNOW('truth-gate json unparsable'); }
  } else truthGate = UNKNOW('truth-gate raw fetch failed: ' + (dexTruthR.error || dexTruthR.status));
  console.log(`[BEAT] observe: cross-home Domain=${domainStasis.epistemic} dex=${dexStasis.epistemic} ledgerTxids=${ledgerTxids ? ledgerTxids.size : 'UNKNOWN'} truthGate=${truthGate.epistemic}`);

  /* custody */
  const custodyProblems = [];
  const nvZip = path.join(REPO_ROOT, 'nv.zip');
  if (fs.existsSync(nvZip)) custodyProblems.push('nv.zip reappeared in live tree (was untracked by V-a custody commit)');
  if (!fs.existsSync(path.join(AGENT_DIR, 'recovery-meta.json'))) custodyProblems.push('agent/recovery-meta.json missing from tree');
  const vaultEnc = (() => { try { return fs.readdirSync(path.join(AGENT_DIR, 'vault')).filter((f) => f.endsWith('.enc')); } catch (_) { return []; } })();
  if (vaultEnc.length === 0) custodyProblems.push('agent/vault/*.enc recovery material missing');

  /* ── 2. STATE-ESTIMATION ── */
  let classified = [], fills = 0, scanned = 0;
  if (!chainDark && primary) {
    const cl = classifyOps(winOps, { ledgerTxids, nowMs });
    classified = cl.classified; fills = cl.fills; scanned = cl.scanned;
  }
  const { fresh: freshUnknown, older: olderUnknown } = splitFreshUnknown(classified, nowMs);
  const unknownAll = freshUnknown.concat(olderUnknown);
  console.log(`[BEAT] state: capital/scanned=${scanned} fills=${fills} unknown-writers=${unknownAll.length} (fresh=${freshUnknown.length}) freshCutoff=${freshCutoffIso}`);

  /* directives-gap per home — firing (קיימת-ושבורה/לא-מכסה) מול structural (אין-שרשרת-כלל): */
  const gaps = [];
  const structuralGaps = [];
  const steemAllow = steemStasis.epistemic === 'OBSERVED' ? steemStasis.stagedLanes : [];
  if (steemStasis.epistemic === 'OBSERVED' && steemAllow.length && !(chainVerify.ok && CHAIN.hasEntryForLanes(steemAllow))) {
    gaps.push(`steem: allow=[${steemAllow.join(',')}] ` + (chainVerify.ok ? 'not covered by verified chain' : 'chain tampered/unreadable: ' + chainVerify.reason));
  }
  if (domainStasis.epistemic === 'OBSERVED' && domainStasis.stagedLanes.length) {
    const covered = domainChain.ok && domainChainTmp && CHAIN.hasEntryForLanes(domainStasis.stagedLanes, domainChainTmp);
    if (!covered) gaps.push(`Domain: allow=[${domainStasis.stagedLanes.join(',')}] not covered by verified chain (${domChainR.ok ? 'coverage missing' : domChainR.reason})`);
  }
  if (dexStasis.epistemic === 'OBSERVED' && dexStasis.stagedLanes.length) {
    /* saos-dex: V-a seeded chains in steem+Domain ONLY — a missing chain file there is a known
     * structural state, not a measured tamper signal. It stays an OPEN contradiction for the
     * owner (below), but does not fire guard-closes of the steem staged lanes: the beat has no
     * remedy for another home's missing file, and closing steem lanes would be ritual, not repair.
     * (Policy judgment labeled honestly — see measurementNotes + report.) */
    structuralGaps.push(`saos-dex: allow=[${dexStasis.stagedLanes.join(',')}] with NO owner-directives chain in that home (structural, non-firing — recorded for owner)`);
  }
  /* model-vs-chain: frontier HALTED lanes vs window lane-class ops */
  const modelVsChain = [];
  if (!chainDark) {
    const laneOps = { grid: 0, claims: 0, general: 0 };
    for (const c of classified) laneOps[c.lane] = (laneOps[c.lane] || 0) + 1;
    for (const [lane, f] of Object.entries(prevFrontier)) {
      if (f && f.level === 'HALTED' && (laneOps[lane] || 0) > 0) {
        modelVsChain.push(`${lane}: frontier=HALTED but ${laneOps[lane]} lane-class ops in window (e.g. ${classified.filter((c) => c.lane === lane).slice(0, 2).map((c) => c.op + '@' + c.at.slice(0, 16) + 'Z').join(', ')})`);
      }
    }
  }
  const homes = [
    { home: 'steem', stasis: steemStasis, reachability: steemStasis.reachability },
    { home: 'Domain', stasis: domainStasis, reachability: domainStasis.reachability },
    { home: 'saos-dex', stasis: dexStasis, reachability: dexStasis.reachability },
  ];
  const brakeDark = homes.filter((h) => h.stasis.epistemic === 'UNKNOWN' && h.reachability === 'ok').map((h) => h.home);

  /* ── 3. CONTRADICTIONS ── */
  const contradictions = buildContradictions(prevContradictions, {
    chainDark, rpcSplit, homes, gaps, structuralGaps,
    custody: { problems: custodyProblems },
    modelVsChain, unknownFresh: freshUnknown, unknownOlder: olderUnknown,
    nowIso, freshCutoffIso,
  });
  const openCount = contradictions.filter((c) => c.status === 'open').length;
  const resolvedCount = contradictions.filter((c) => c.status === 'resolved').length;
  console.log(`[BEAT] contradictions: ${openCount} open / ${resolvedCount} resolved (C-unknown-writer=${(contradictions.find((c) => c.id === 'C-unknown-writer') || {}).status})`);

  /* ── 4. DECIDE ── */
  const guardsDoc = readGuardsDoc();
  const nowGuardView = GUARDS_LIB.readGuards(GUARDS_FILE);
  if (!nowGuardView.ok) runErrors.push(`cycle ${cycle}: lane-guards.json unreadable (${nowGuardView.reason}) — gate fail-closed on ALL lanes; beat will NOT rewrite it (tamper evidence preserved)`);
  if (nowGuardView.foreignFields && nowGuardView.foreignFields.length) console.log(`[BEAT] guards foreignFields flagged: ${nowGuardView.foreignFields.length} (open/allow attempts are inert)`);
  const guardsWritable = nowGuardView.ok;
  const activeGuards = nowGuardView.ok ? nowGuardView.guards.map((g) => ({ ...g, expiryOk: !(g.expiresAt && Number.isFinite(Date.parse(g.expiresAt)) && Date.parse(g.expiresAt) <= nowMs) })) : [];
  const activeGuardCount = activeGuards.length;
  const stagedLanes = steemStasis.epistemic === 'OBSERVED' ? steemStasis.stagedLanes.map((x) => String(x).toLowerCase()) : [];
  inputStagedHint = stagedLanes;
  const laneFailures = laneFailureStreak();
  const closeDecisions = decideShrink({
    stagedLanes, activeGuards, freshUnknown, gaps, brakeDark, laneFailures, hourBucket, cycle,
  });

  /* rechecks + releases */
  const recheckHist = new Map();
  for (const r of receiptsPrev) {
    if (r.kind === 'beat-guard-recheck' && r.note) {
      const gid = (r.note.match(/guard=(\S+)/) || [])[1];
      if (gid) { if (!recheckHist.has(gid)) recheckHist.set(gid, []); recheckHist.get(gid).push({ result: r.decision === 'recheck-clean' ? 'clean' : 'dirty', at: r.at }); }
    }
  }
  const rechecks = activeGuards.map((g) => recheckGuard(g, { freshUnknown, gapsOpen: gaps.length > 0, brakeDarkOpen: brakeDark.length > 0 }));
  const curRecheck = new Map(rechecks.map((r) => [r.guardId, r]));
  const releases = evaluateReleases(activeGuards, recheckHist, curRecheck, nowMs);
  console.log(`[BEAT] decide: closeDecisions=${closeDecisions.length} releases=${releases.length} rechecks=${rechecks.length}`);

  /* ── 5. LEARN + probe ── */
  const guardsNext = buildGuardsDoc(guardsDoc, closeDecisions, releases, nowMs, stagedLanes);
  const probe = DRY ? { guardWorks: null, authenticityGreen: null, baselineAllow: null, error: 'skipped in dry-run', tmp: null } : runGateProbe();
  if (probe.error) runErrors.push(`cycle ${cycle}: gate probe error: ${probe.error}`);
  const authenticityGreen = probe.authenticityGreen === true && probe.baselineAllow === true;
  const guardProbeWorks = probe.guardWorks === true;
  console.log(`[BEAT] learn: probe guardWorks=${probe.guardWorks} baselineAllow=${probe.baselineAllow} authenticityGreen=${probe.authenticityGreen}`);

  /* lane counters from prev beat + this cycle */
  const laneCycles = prevBeat.lanes || {};
  const openContraLanes = [...new Set(contradictions.filter((c) => c.status === 'open' && Array.isArray(c.lanes)).flatMap((c) => c.lanes))];
  const laneWriters = {};
  for (const c of classified) { if (!laneWriters[c.lane] || laneWriters[c.lane].confidence < c.confidence) laneWriters[c.lane] = { writer: c.writer, confidence: c.confidence }; }
  const frontier = computeFrontier({ laneCycles, openContraLanes, laneWriters, authenticityGreen, stagedLanes });

  /* sensors — ציון-הסכמה נע; מחזור-חשוך לא מזיז את-הציון (לעולם לא 0-שקרי) */
  const prevSensors = (prevBeat.sensors) || {};
  const sensors = {};
  for (const n of NODES) {
    const p = prevSensors[n.name] || { score: null, samples: 0 };
    const isCross = n.role === 'chain-cross';
    const live = isCross ? !!(nodeB && nodeB.ok) : !!(nodeA && nodeA.ok);
    const agreed = isCross ? (nodeA && nodeA.ok && nodeB && nodeB.ok ? !rpcSplit : null) : null;
    const obs = live ? (agreed == null ? 1 : (agreed ? 1 : 0)) : null;
    sensors[n.name] = {
      role: n.role,
      score: obs == null ? p.score : +(((p.score == null ? 1 : p.score) * 0.5 + obs * 0.5).toFixed(3)),
      samples: (p.samples || 0) + (live ? 1 : 0),
      lastAgreement: live ? (isCross ? agreed : 'primary-live') : 'unmeasured',
      lastAt: live ? nowIso : (p.lastAt || null),
      ...(live ? {} : { note: 'unmeasured this cycle — score untouched, never zero' }),
    };
  }

  /* ── 6. SELF-MODEL ── */
  const writers = [
    { id: 'dex-grid-ci', kind: 'ci-workflow', patterns: ['limit orders in orderid space 2026MMDDxx; txids in saos-dex/db/grid-ledger.json'], confidence: 0.85, epistemic: 'INFERRED', evidence: [{ source: 'chain-history window', ref: `cycle ${cycle}: ${classified.filter((c) => c.writer === 'dex-grid-ci').length} ops classified dex-grid-ci (orderid-space/ledger)`, at: nowIso }] },
    { id: 'owner-matrix', kind: 'parallel-session', patterns: ['delegate_vesting_shares exactly 48393.301791 VESTS (30 SP × operator matrix)'], confidence: 0.7, epistemic: 'INFERRED', evidence: [{ source: 'chain-history window', ref: `cycle ${cycle}: ${classified.filter((c) => c.writer === 'owner-matrix').length} ops matched matrix amount`, at: nowIso }] },
    { id: 'owner-parallel', kind: 'parallel-session', patterns: ['delegate-0 to hcsoldier1/2/3 (reclaim-lost-soldiers signature; tool exists in repo)'], confidence: 0.6, epistemic: 'INFERRED', evidence: [{ source: 'chain-history window', ref: `cycle ${cycle}: ${classified.filter((c) => c.writer === 'owner-parallel').length} ops matched reclaim signature`, at: nowIso }] },
    { id: 'unknown-writers', kind: 'unknown', patterns: ['micro-orders 2100000xxx (no owning tool in any repo)', 'any capital op with no matching signature'], confidence: 0.2, epistemic: 'OBSERVED', evidence: unknownAll.length ? unknownAll.slice(0, 6).map((c) => ({ source: 'chain-history window', ref: `${c.at} ${c.op} trx=${c.trx} orderid=${c.orderid || '-'}`, at: c.at })) : [{ source: 'chain-history window', ref: `clean measurement: zero unknown-writer capital ops in window (cycle ${cycle})`, at: nowIso }] },
    ...((prev.writers || []).filter((w) => ['github-actions-cron-fleet', 'agent-llm-sessions'].includes(w.id))),
  ];
  const closedAdded = Math.max(0, guardsNext.guards.length - guardsDoc.guards.filter((g) => !releases.some((r) => r.guard.id === g.id)).length);
  const beatSection = {
    protocol: 'SAOS-COGNITION-BEAT/1',
    cycle, at: nowIso, windowHours: WINDOW_H, freshWindowHours: FRESH_H,
    loop: ['observe', 'state-estimate', 'contradictions', 'decide(shrink-only)', 'learn', 'self-model', 'act', 'verify-own-act'],
    chain: chainDark ? { epistemic: 'UNKNOWN', reason: 'both/all nodes failed — never zero' } : { epistemic: 'OBSERVED', primary: primary.node, windowOps: winOps.length, capitalScanned: scanned, fills, unknownWriters: unknownAll.length, freshUnknownWriters: freshUnknown.length, lastIdx: primary.lastIdx },
    sensors,
    decisions: closeDecisions.map((d) => ({ id: d.idempotencyKey.slice(0, 12), decision: d.decision, note: d.note, verification: 'pending' })),
    releases: releases.map((r) => ({ guard: r.guard.id, streak: r.streak })),
    rechecks,
    guards: { activeBefore: activeGuardCount, closedAdded, released: releases.length, activeAfter: guardsNext.guards.length, lanes: guardsNext.guards.map((g) => g.lane + ':' + g.id) },
    lanes: {
      grid: { observedCycles: ((laneCycles.grid || {}).observedCycles || 0) + 1, successfulCycles: ((laneCycles.grid || {}).successfulCycles || 0) + (guardProbeWorks && authenticityGreen ? 1 : 0), lastOutcome: probe.error ? 'probe-error' : (guardProbeWorks ? 'guard-probe-green' : 'guard-probe-failed'), openContradictions: openContraLanes.filter((l) => l === 'grid').length },
      claims: { observedCycles: ((laneCycles.claims || {}).observedCycles || 0) + 1, successfulCycles: ((laneCycles.claims || {}).successfulCycles || 0) + (authenticityGreen ? 1 : 0), lastOutcome: authenticityGreen ? 'authenticity-green' : 'authenticity-unknown', openContradictions: openContraLanes.filter((l) => l === 'claims').length },
      general: { observedCycles: ((laneCycles.general || {}).observedCycles || 0) + 1, successfulCycles: (laneCycles.general || {}).successfulCycles || 0, lastOutcome: 'halted-lane', openContradictions: openContraLanes.filter((l) => l === 'general').length },
    },
    selfLoop: { probe: { guardWorks: probe.guardWorks, authenticityGreen: probe.authenticityGreen, baselineAllow: probe.baselineAllow, error: probe.error || undefined }, lastCommitSha: prevBeat.selfLoop ? prevBeat.selfLoop.lastCommitSha : null, rawSha256Match: prevBeat.selfLoop ? prevBeat.selfLoop.rawSha256Match : null },
    authority: 'mechanism-shrink only — this beat never opens lanes, never transfers, never edits STASIS.json or the directives chain',
  };
  const model = buildModel(prev, {
    nowIso, cycle, steemStasis, domainStasis, dexStasis, chainVerify, domainChain,
    truthGate, ledger: ledgerInfo, activeGuardCount, closedAdded, releasedCount: releases.length,
    contradictions, frontier, writers, custody: { nvZipAtHead: fs.existsSync(nvZip), recoveryMetaPresent: fs.existsSync(path.join(AGENT_DIR, 'recovery-meta.json')), vaultEncCount: vaultEnc.length, problems: custodyProblems, epistemic: 'OBSERVED' },
    runErrors, beat: beatSection,
  });
  const validation = SELFMODEL.validate(model);
  if (!validation.ok) {
    console.error('[BEAT] SELF-MODEL REJECTED BY VALIDATOR — refusing to write a lying model:');
    for (const e of validation.errors) console.error('  - ' + e);
    if (!DRY) process.exit(3);
  }
  if (validation.warnings.length) for (const w of validation.warnings) console.log('[BEAT] selfmodel warning: ' + w);

  /* ── 7. ACT ── */
  const guardsChanged = JSON.stringify(guardsDoc) !== JSON.stringify(guardsNext);
  const organismPath = ORGANISM_FILE, guardsPath = GUARDS_FILE;
  const newCycleReceipt = receipt({
    kind: 'cognition-beat-cycle',
    decision: closeDecisions.length ? 'shrink-applied' : 'observe-and-record',
    authority: closeDecisions.length ? 'mechanism-shrink' : 'free-measure',
    evidence: [
      { source: 'chain-history', ref: chainDark ? 'chain UNMEASURED this cycle' : `window=${winOps.length} ops scanned=${scanned} fills=${fills} unknown=${unknownAll.length} fresh=${freshUnknown.length}`, at: nowIso },
      { source: 'cross-home', ref: `steem=${steemStasis.epistemic} Domain=${domainStasis.epistemic} dex=${dexStasis.epistemic} ledgerTxids=${ledgerTxids ? ledgerTxids.size : 'UNKNOWN'}`, at: nowIso },
      { source: 'agent/cognition/lane-guards.json', ref: `active=${activeGuardCount} closedAdded=${closedAdded} released=${releases.length}`, at: nowIso },
    ],
    preconditions: ['organism.json passed selfmodel validator (SAOS-SELFMODEL/1)', 'guards file written with closed:true entries only'],
    confidence: 0.9,
    expectedOutcome: 'organism.json + lane-guards.json + this receipt committed to origin/main; dashboard renders live self-model',
    alternatives: [],
    idempotencyKey: sha256(['beat-cycle', cycle, hourBucket].join('|')),
    abortConditions: ['selfmodel validator rejection', 'push rejected 3× on non-beat conflict'],
    postconditions: ['origin/main carries cycle ' + cycle + ' artifacts'],
    verificationMethod: 'raw-fetch committed organism.json via GitHub API and compare sha256 to local (external self-check)',
    note: `cycle=${cycle} window=8h unknown-writers=${unknownAll.length} contradictions=${openCount} open/${resolvedCount} resolved frontier=${Object.entries(frontier).map(([l, f]) => l + ':' + f.level).join(' ')} guards=+${closedAdded}/-${releases.length} probe=${probe.error ? 'error' : (guardProbeWorks && authenticityGreen ? 'green' : 'failed')}`,
  });
  const receiptsToWrite = [newCycleReceipt, ...closeDecisions, ...releases.map((r) => r.receipt), ...rechecks.map((r) => receipt({
    kind: 'beat-guard-recheck', decision: r.result === 'clean' ? 'recheck-clean' : 'recheck-dirty', authority: 'free-measure',
    evidence: [{ source: 're-measure', ref: r.detail, at: r.at }], confidence: 0.85,
    expectedOutcome: 'clean streak feeds the 2-consecutive-cycles release rule', idempotencyKey: sha256(['recheck', r.guardId, hourBucket].join('|')),
    note: 'guard=' + r.guardId + ' lane=' + r.lane,
  }))];

  if (DRY) {
    console.log('\n[BEAT] ═══ DRY-RUN — nothing written, nothing committed ═══');
    console.log(JSON.stringify({
      cycle, dry: true, chain: beatSection.chain, sensors: beatSection.sensors,
      contradictions: contradictions.map((c) => ({ id: c.id, title: c.title, status: c.status, epistemic: c.epistemic, confidence: c.confidence, lanes: c.lanes })),
      freshUnknown, olderUnknown,
      decisions: closeDecisions, releases: releases.map((r) => ({ guard: r.guard.id, streak: r.streak })),
      guardsNext, frontier, selfmodelValidation: validation,
      receipts: receiptsToWrite,
      probe: DRY ? undefined : probe,
      commitMessagePlanned: `cognition-beat: cycle #${cycle} · window 8h · unknown-writers=${unknownAll.length} · contradictions=${openCount} open/${resolvedCount} resolved · frontier ${Object.entries(frontier).map(([l, f]) => l + ':' + f.level).join(' ')} · guards: +${closedAdded}/-${releases.length} · [skip ci]`,
    }, null, 2));
    return 0;
  }

  fs.mkdirSync(path.dirname(organismPath), { recursive: true });
  const modelJson = JSON.stringify(model, null, 2) + '\n';
  const prevModelJson = fs.readFileSync(organismPath, 'utf8');
  if (modelJson !== prevModelJson) fs.writeFileSync(organismPath, modelJson);
  if (guardsChanged && guardsWritable) fs.writeFileSync(guardsPath, JSON.stringify(guardsNext, null, 2) + '\n');
  else if (guardsChanged && !guardsWritable) console.log('[BEAT] guards file left untouched (unreadable — tamper evidence preserved; gate is fail-closed regardless)');
  REAPPLY = { 'agent/cognition/organism.json': modelJson, 'agent/cognition/lane-guards.json': JSON.stringify(guardsNext, null, 2) + '\n' };
  appendReceipts(receiptsToWrite);

  const commitMsg = `cognition-beat: cycle #${cycle} · window 8h · unknown-writers=${unknownAll.length} · contradictions=${openCount} open/${resolvedCount} resolved · frontier ${Object.entries(frontier).map(([l, f]) => l + ':' + f.level).join(' ')} · guards: +${closedAdded}/-${releases.length} · [skip ci]`;
  let sha = null;
  try {
    const pub = publish(commitMsg);
    sha = pub.sha;
    console.log(`[BEAT] act: committed ${pub.committed ? pub.sha : '(no diff — HEAD unchanged)'} "${commitMsg}"`);
  } catch (e) {
    console.error('[BEAT] ACT FAILED — commit/push error: ' + String((e && e.message) || e).slice(0, 300));
    runErrors.push(`cycle ${cycle}: publish failed: ${String((e && e.message) || e).slice(0, 200)}`);
    /* fail loudly but leave receipts on disk for forensics */
    process.exitCode = 2;
  }

  /* verify own act externally (raw API sha256) */
  if (sha) {
    const v = await verifyOwnAct(sha, 'agent/cognition/organism.json', ghToken);
    console.log(`[BEAT] verify-own-act: organism.json @${sha.slice(0, 10)} sha256 ${v.confirmed ? 'CONFIRMED' : 'MISMATCH/FAIL ' + (v.error || '')}`);
    const vReceipt = receipt({
      kind: 'beat-verification',
      decision: v.confirmed ? 'verify-own-act-confirmed' : 'verify-own-act-failed',
      authority: 'free-measure',
      evidence: [{ source: 'GitHub contents API (raw)', ref: `organism.json @${sha} local=${v.local ? v.local.slice(0, 16) : '?'} remote=${v.remote ? v.remote.slice(0, 16) : '?'} attempts=${v.attempts != null ? v.attempts : '?'} error=${v.error || 'none'}`, at: iso(Date.now()) }],
      preconditions: ['commit ' + sha + ' is HEAD of origin/main', 'file fetched externally, not from local disk'],
      confidence: v.confirmed ? 0.95 : 0.6,
      expectedOutcome: 'the beat\'s own act (commit) verified by an external read-back',
      alternatives: [],
      idempotencyKey: sha256(['verify', newCycleReceipt.idempotencyKey].join('|')),
      postconditions: ['cycle receipt verification advanced from pending'],
      verificationMethod: 'sha256(local file) == sha256(raw API at ref=commit)',
      note: 'verifies cycle receipt ' + newCycleReceipt.idempotencyKey.slice(0, 12),
    });
    appendReceipts([vReceipt]);
    /* self-model memory: record the verified act (selfLoop) + advance the receipts file,
     * then publish both in the small verify commit — no artifact is left uncommitted. */
    try {
      model.beat.selfLoop = { ...(model.beat.selfLoop || {}), lastCommitSha: sha, rawSha256Match: v.confirmed, verifiedAt: iso(Date.now()), method: 'sha256(local organism.json) == sha256(raw contents API @commit)' };
      const vModelCheck = SELFMODEL.validate(model);
      if (vModelCheck.ok) {
        const modelJson2 = JSON.stringify(model, null, 2) + '\n';
        if (modelJson2 !== fs.readFileSync(organismPath, 'utf8')) fs.writeFileSync(organismPath, modelJson2);
        REAPPLY['agent/cognition/organism.json'] = modelJson2;
      } else {
        runErrors.push(`cycle ${cycle}: post-verify selfmodel update rejected by validator: ${vModelCheck.errors.join(' | ').slice(0, 180)}`);
      }
      const msg2 = `cognition-beat: verify cycle #${cycle} · organism.json sha256 ${v.confirmed ? 'confirmed' : 'MISMATCH'} (raw API read-back) · [skip ci]`;
      const pub2 = publish(msg2);
      console.log(`[BEAT] verify-own-act receipt committed ${pub2.committed ? pub2.sha : '(no diff)'}`);
    } catch (e) {
      console.error('[BEAT] verify-receipt commit failed: ' + String((e && e.message) || e).slice(0, 200));
    }
  }

  /* self-loop closure: previous pending receipts — confirm/failed by this cycle's probe/re-measure */
  const pendingPrev = receiptsPrev.filter((r) => r.verification && r.verification.status === 'pending' && r.kind !== 'cognition-beat-cycle');
  if (pendingPrev.length && !DRY) {
    const verdict = guardProbeWorks && authenticityGreen ? 'confirmed' : 'failed';
    const closureReceipts = pendingPrev.map((r) => receipt({
      kind: 'beat-verification',
      decision: 'previous-receipt-' + verdict,
      authority: 'free-measure',
      evidence: [{ source: '/tmp gate probe + re-measure', ref: `receipt ${r.idempotencyKey ? r.idempotencyKey.slice(0, 12) : '?'} (${r.kind}) → probe guardWorks=${probe.guardWorks} authenticityGreen=${probe.authenticityGreen} baselineAllow=${probe.baselineAllow}`, at: nowIso }],
      confidence: 0.85,
      expectedOutcome: 'append-only self-loop closure: old receipt stays untouched, verdict appended separately with final verification fields',
      alternatives: [],
      idempotencyKey: sha256(['verify', r.idempotencyKey || r.at].join('|')),
      verificationMethod: 'probe results this cycle',
      /* פסק-סופי — לא pending: {status, at, actual, deviation}; השורה-המקורית לעולם לא נכתבת-מחדש */
      verification: {
        method: '/tmp gate probe (stasisHalt on synthetic-guard copy + baseline + forged-STASIS) this cycle',
        status: verdict,
        at: nowIso,
        actual: `guardWorks=${probe.guardWorks} authenticityGreen=${probe.authenticityGreen} baselineAllow=${probe.baselineAllow}${probe.error ? ' probeError=' + probe.error : ''}`,
        deviation: verdict === 'confirmed' ? 'none' : 'probe did not reproduce the receipt expected outcome',
      },
      note: 'verifies ' + (r.idempotencyKey || '').slice(0, 12),
    }));
    appendReceipts(closureReceipts);
    if (closureReceipts.length) console.log(`[BEAT] self-loop: ${closureReceipts.length} pending receipt(s) from previous cycles closed (${verdict})`);
  }

  console.log(`[BEAT] cycle #${cycle} complete — guards active=${guardsNext.guards.length}, frontier=${Object.entries(frontier).map(([l, f]) => l + ':' + f.level).join(' ')}`);
  return process.exitCode || 0;
}

/* pure-function exports for beat-selftest.cjs (no network, no fs side effects) */
module.exports = {
  isCiLadderOrderid, isMicroOrderSpace, classifyOps, splitFreshUnknown,
  buildContradictions, decideShrink, evaluateReleases, recheckGuard,
  computeFrontier, receipt, buildModel, verifyOwnAct, parseStasisDoc,
  buildGuardsDoc, laneFailureStreak,
  WINDOW_H, FRESH_H, TTL_CLOSE_H, TTL_GAP_H, RELEASE_CLEAN_N, LANE_FAIL_N, FRONTIER_REAL_MIN_CYCLES,
};
if (require.main === module) main().then((c) => process.exit(c || 0)).catch((e) => { console.error('[BEAT] FATAL ' + String((e && e.stack) || e).slice(0, 600)); process.exit(1); });
