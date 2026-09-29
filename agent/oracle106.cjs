#!/usr/bin/env node
/* oracle106.cjs — Task 106: אורקל-חי-מתמשך — ציטוטי-asset_price מתעדכנים מדי-שעה.
 *
 * הממצא-החי (2026-09-06): ציטוטי-האורקל-על-הספר נרשמו-חד-פעמית (RECON-102c) —
 * WTRX עמד-מקופא 4-שעות (16:25) בזמן-שהמנוע-סחר-מולו כמו-אורקל-חי. "עוגן-ה-arb
 * = האורקל-החי" (103) לא-היה-חי — היה-קפוא. התיקון: לולאה-שעתית שמנפיקה
 * asset_price חתום (src+ref+at) מ-coingecko — עקרון-102 בקצב-אמת.
 *
 * גבולות-ברזל: אין-המצאת-מחיר (כשל-אינטרנט = דילוג-כן) · refs-חתומי-שעה
 * (dedup-טבעי) · WBLURT נשאר-של-blurt99 (בעלים-יחיד, אין-כפילות-אנקורים).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const AGENT_DIR = __dirname;
const NODE_DIR = path.join(AGENT_DIR, '..', 'sovereign', 'node');
const PENDING = path.join(AGENT_DIR, 'chaintalk_pending.json');
const SNAP = path.join(NODE_DIR, 'state-snapshot.json');
const OUT = path.join(AGENT_DIR, 'oracle106_result.json');
// 8-b: חשבון-הפעולה חובה מה-env — אין ברירת-מחדל, לעולם (המשך 7-c · docs/117o-KEY-INCIDENT.md)
const ACCOUNT = (process.env.AGENT_ACCOUNT || '').toLowerCase();
if (!ACCOUNT) { console.error('usage: AGENT_ACCOUNT=<account> node agent/oracle106.cjs — no default acting account (2026-09-08 incident)'); process.exit(1); }
// LIVE-GATE (Task 28-b): DRY by default — the saosnet beat mutates the live ledger,
// so the shared gate decides whether the child gets --live (--dry always wins). See DAEMONS.md.
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv, { account: ACCOUNT });
const DRY = GATE.dry;

const SYMBOLS = [
  { sym: 'WTRX', id: 'tron' },
  { sym: 'WSTEEM', id: 'steem' },
  { sym: 'WSBD', id: 'steem-dollars' },
  { sym: 'PHIVE', id: 'hive' },
  { sym: 'ENERGY', id: 'steem', note: 'SP≈STEEM 1:1' },
];

const log = (m) => console.log('[oracle106] ' + m);
announceGate(GATE, log);
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return d; } };

function cgPrices(ids) {
  return new Promise((resolve) => {
    const url = 'https://api.coingecko.com/api/v3/simple/price?ids=' + ids.join(',') + '&vs_currencies=usd';
    const go = (left) => {
      const req = https.get(url, { family: 4, headers: { 'User-Agent': 'saos-oracle/106', Accept: 'application/json' } }, (x) => {
        let d = ''; x.on('data', (c) => (d += c)); x.on('end', () => { try { resolve(JSON.parse(d)); } catch (_) { retry(left); } });
      });
      req.on('error', () => retry(left));
      req.setTimeout(15000, () => { req.destroy(); retry(left); });
    };
    const retry = (left) => { if (left > 0) { log('retry (' + left + ')'); setTimeout(() => go(left - 1), 4000); } else resolve(null); };
    go(3);
  });
}

async function main() {
  const t0 = Date.now();
  const sw = readJSON(SNAP, null);
  const bookPx = sw && sw.st ? sw.st.assetPrices || {} : {};
  const px = await cgPrices([...new Set(SYMBOLS.map((s) => s.id))]);
  if (!px) {
    const res = { at: new Date().toISOString(), skipped: 'oracle-unavailable (honest — no invented quotes)' };
    fs.writeFileSync(OUT, JSON.stringify(res, null, 2) + '\n');
    log(res.skipped);
    return;
  }
  const at = new Date().toISOString();
  const bucket = at.slice(0, 13).replace(/[-:T]/g, ''); // שעתי — dedup-טבעי
  const nano = (x) => Math.round(x * 1e9);
  const ops = [];
  const quotes = {};
  for (const s of SYMBOLS) {
    const usd = px[s.id] && px[s.id].usd;
    if (!(usd > 0)) { quotes[s.sym] = { skipped: 'no-quote' }; continue; }
    const v = nano(usd);
    const prev = ((bookPx[s.sym] || {}).px || 0);
    const deltaPct = prev ? +(((v - prev) / prev) * 100).toFixed(2) : null;
    quotes[s.sym] = { usd, prev: prev / 1e9, deltaPct };
    ops.push({
      type: 'asset_price', issuer: ACCOUNT, symbol: s.sym, px: v, unit: 'USD',
      src: 'coingecko:' + s.id, at, ref: 'o106:px:' + s.sym + ':' + bucket,
      note: 'oracle-106 hourly live quote ' + usd + ' USD' + (s.note ? ' · ' + s.note : ''),
    });
  }
  const res = { at, bucket, quotes, ops: ops.length, mission: null };
  if (ops.length) {
    const id = 'ORACLE-106-' + bucket;
    const pf = readJSON(PENDING, { missions: [] });
    pf.missions = (pf.missions || []).filter((m) => m.id !== id);
    pf.missions.push({ id, status: 'pending', issuedAt: at, issuer: ACCOUNT, ops });
    fs.writeFileSync(PENDING, JSON.stringify(pf, null, 2) + '\n');
    log('issued ' + id + ' · ops=' + ops.length);
    spawnSync('node', ['saosnet.cjs'].concat(DRY ? [] : ['--live']), { cwd: NODE_DIR, timeout: 300000, encoding: 'utf8' });
    const m = (readJSON(PENDING, { missions: [] }).missions || []).find((x) => x.id === id);
    res.mission = m ? { status: m.status, ok: (m.results || []).filter((r) => r.ok).length + '/' + (m.results || []).length } : { status: 'missing' };
  }
  fs.writeFileSync(OUT, JSON.stringify(res, null, 2) + '\n');
  log('quotes: ' + JSON.stringify(res.quotes) + ' · mission=' + JSON.stringify(res.mission) + ' · ms=' + (Date.now() - t0));
}

main().catch((e) => { console.error('[oracle106] FAIL: ' + (e && e.message)); process.exit(1); });
