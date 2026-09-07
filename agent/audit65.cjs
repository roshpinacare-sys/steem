#!/usr/bin/env node
/* audit65.cjs — Task 65: סקר-מלאי חי "מה יש לנו ביד" — קריאה-בלבד.
 *
 * מודד על-השרשרת (אפס-סיפורים):
 *   1. צי 12 חשבונות × 2 שרשראות — RC%, יתרות, פנדינג, SP/HP
 *   2. דקס ריבוני — replay מה-API המקומי (ספר, בריכות, fills, עמלות)
 *   3. wrapped — נכסים, גיבויים, יחסים
 *   4. טביעת-רגל על-השרשרת — מספר-אירועים ב-48ש׳ לכל חשבון
 *   5. גילוי חוסמים — RC-אוצר, BEE/100, תקציבי-ברזל
 * אין שידורים, אין מפתחות בלוג.
 */
'use strict';
const fs = require('fs');
const path = require('path');

function loadDotEnv(dir) {
  const envPath = path.join(dir, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('='); if (eq <= 0) continue;
    const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadDotEnv(__dirname);

function rpc(url, body) {
  const u = new URL(url); const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = require('https').request({ hostname: u.hostname, path: u.pathname || '/', method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 20000 }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => {
        try { const j = JSON.parse(d); if (j.error) return reject(new Error(j.error.message || 'rpc error')); resolve(j.result); }
        catch (_) { reject(new Error('bad rpc: ' + d.slice(0, 120))); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject);
    req.write(payload); req.end();
  });
}
const STEEM = 'https://api.steemit.com';
const HIVE = 'https://api.hive.blog';
const sApi = (m, p) => rpc(STEEM, { jsonrpc: '2.0', method: m, params: p, id: 1 });
const hApi = (m, p) => rpc(HIVE, { jsonrpc: '2.0', method: m, params: p, id: 1 });

const NAMES = ['headcorner', 'cashmachine', 'haran', 'israelnews', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq', 'ynet'];
const OUT = path.join(__dirname, 'audit65.json');
const n1 = (x) => (x / 1e9).toFixed(2) + 'G';

async function rcRow(api, name) {
  try {
    const r = await api('rc_api.find_rc_accounts', { accounts: [name] });
    const row = r && r.rc_accounts && r.rc_accounts[0];
    if (!row) return null;
    const max = parseFloat(row.max_rc), cur = parseFloat(row.rc_manabar.current_mana);
    return { pct: max > 0 ? (cur / max) * 100 : 0, max, cur };
  } catch (_) { return null; }
}

async function foot48(name) {
  // מספר-אירועים ב-48ש׳ האחרונים (מדוד מהשרשרת)
  try {
    const raw = await sApi('condenser_api.get_account_history', [name, -1, 100]);
    if (!Array.isArray(raw)) return { n: 0, types: {} };
    const cutoff = new Date(Date.now() - 48 * 3600 * 1000);
    const types = {}; let n = 0;
    for (const [, e] of raw) {
      if (!e || !e.timestamp) continue;
      if (new Date(e.timestamp + 'Z') < cutoff) break;
      n++;
      const t = e.op && e.op[0];
      types[t] = (types[t] || 0) + 1;
    }
    return { n, types };
  } catch (_) { return { n: 0, types: {} }; }
}

async function main() {
  const t0 = Date.now();
  const out = { at: new Date().toISOString(), fleet: {}, dex: null, wrapped: null, limits: {}, foot: {} };

  // ── 1. צי × 2 שרשראות ──
  const [sAcc, hAcc] = await Promise.all([
    sApi('condenser_api.get_accounts', [NAMES]).catch(() => null),
    hApi('condenser_api.get_accounts', [NAMES]).catch(() => null),
  ]);
  const [sRcs, hRcs] = await Promise.all([
    sApi('rc_api.find_rc_accounts', { accounts: NAMES }).catch(() => null),
    hApi('rc_api.find_rc_accounts', { accounts: NAMES }).catch(() => null),
  ]);
  const sRcMap = new Map(((sRcs && sRcs.rc_accounts) || []).map((r) => [r.account, r]));
  const hRcMap = new Map(((hRcs && hRcs.rc_accounts) || []).map((r) => [r.account, r]));
  for (const nm of NAMES) {
    const s = (sAcc || []).find((a) => a.name === nm) || null;
    const h = (hAcc || []).find((a) => a.name === nm) || null;
    const sr = sRcMap.get(nm), hr = hRcMap.get(nm);
    const vestsS = s ? parseFloat(s.vesting_shares) : 0;
    const totVests = vestsS + (s ? parseFloat(s.delegated_vesting_shares.replace('-', '') ) || 0 : 0);
    out.fleet[nm] = {
      steem: {
        liq: s ? parseFloat(s.balance) : null,
        sbd: s ? parseFloat(s.sbd_balance) : null,
        vests: vestsS,
        spTotal: s ? parseFloat((s.vesting_shares || '0').split(' ')[0]) + parseFloat((s.received_vesting_shares || '0').split(' ')[0]) - parseFloat((s.delegated_vesting_shares || '0').split(' ')[0]) : null,
        rcPct: sr ? (parseFloat(sr.rc_manabar.current_mana) / parseFloat(sr.max_rc)) * 100 : null,
      },
      hive: {
        liq: h ? parseFloat(h.balance) : null,
        hbd: h ? parseFloat(h.hbd_balance) : null,
        hp: h ? parseFloat((h.vesting_shares || '0').split(' ')[0]) - parseFloat((h.delegated_vesting_shares || '0').split(' ')[0]) + parseFloat((h.received_vesting_shares || '0').split(' ')[0]) : null,
        rcPct: hr ? (parseFloat(hr.rc_manabar.current_mana) / parseFloat(hr.max_rc)) * 100 : null,
      },
    };
  }

  // ── 4. טביעת-רגל 48ש׳ (Steem) — רק ה-6 הראשיים כדי לחסוך-קריאות ──
  for (const nm of NAMES.slice(0, 12)) out.foot[nm] = await foot48(nm);

  // ── 2. דקס מה-API המקומי ──
  try {
    const r = await fetch('http://127.0.0.1:3000/api/ops/saos/dex?username=headcorner');
    out.dex = await r.json();
  } catch (e) { out.dex = { err: String(e.message || e).slice(0, 100) }; }

  // ── 3. wrapped מה-API ──
  try {
    const r = await fetch('http://127.0.0.1:3000/api/ops/saos/wrapped');
    out.wrapped = await r.json();
  } catch (e) { out.wrapped = { err: String(e.message || e).slice(0, 100) }; }

  // ── 5. חוסמים ──
  const hc = out.fleet.headcorner || {};
  out.limits.headcornerRcSteem = hc.steem ? hc.steem.rcPct : null;
  out.limits.headcornerRcHive = hc.hive ? hc.hive.rcPct : null;
  try {
    const w = JSON.parse(fs.readFileSync(path.join(__dirname, 'wrapped_state.json'), 'utf8'));
    out.limits.wrappedOpsToday = w.opsToday;
    out.limits.wrappedDay = w.day;
  } catch (_) {}
  try {
    const g = JSON.parse(fs.readFileSync(path.join(__dirname, 'he_genesis_state.json'), 'utf8'));
    out.limits.genesis = { bee: g.bee || g.beeBalance || null, steps: g.stepsDone || g.steps || null };
  } catch (_) {}

  out.ms = Date.now() - t0;
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  // סיכום קונסולה — בלי-מפתחות
  console.log('=== AUDIT-65 · ' + out.at + ' · ' + out.ms + 'ms ===');
  for (const nm of NAMES) {
    const f = out.fleet[nm];
    if (!f || !f.steem) continue;
    console.log(
      '@' + nm.padEnd(12) +
      ' STEEM ' + (f.steem.liq ?? '—').toString().padStart(6) +
      ' SBD ' + (f.steem.sbd ?? '—').toString().padStart(6) +
      ' SP~' + Math.round(f.steem.spTotal || 0).toString().padStart(6) +
      ' RC ' + (f.steem.rcPct == null ? '—' : f.steem.rcPct.toFixed(1) + '%').padStart(7) +
      ' | HIVE ' + (f.hive.liq ?? '—') + ' HP~' + Math.round(f.hive.hp || 0) +
      ' RC ' + (f.hive.rcPct == null ? '—' : f.hive.rcPct.toFixed(1) + '%')
    );
  }
  console.log('foot48: ' + NAMES.map((n) => n + '=' + (out.foot[n] ? out.foot[n].n : '?')).join(' '));
  if (out.dex && !out.dex.err) {
    const d = out.dex;
    const bal = (d.balances || []).filter((b) => (b.saos || 0) > 0 || (b.credit || 0) > 0);
    console.log('DEX: openOrders=' + (d.stats ? d.stats.openOrders : '?') +
      ' tradesTotal=' + (d.stats ? d.stats.tradesTotal : '?') +
      ' vol24hSaos=' + (d.stats ? d.stats.vol24hSaos : '?') +
      ' pools=' + (d.pools || []).length +
      ' holders=' + bal.length +
      ' solvency=' + JSON.stringify(d.solvency));
    for (const b of bal.slice(0, 14)) console.log('  bal @' + b.account + ' SAOS=' + b.saos + ' credit=' + b.credit);
    for (const p of d.pools || []) console.log('  pool ' + p.pair + ' saos=' + p.saos + ' steem=' + p.steem + ' swaps=' + p.swaps + ' fees=' + p.feesSaos + '/' + p.feesSteem + ' lpSupply=' + p.lpSupply);
  }
  console.log('written: audit65.json');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
