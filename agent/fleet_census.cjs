#!/usr/bin/env node
/**
 * fleet_census.cjs — 117p8-R5: מפת-חומרים (Material Map) של-כל-התיקיות-והשרשראות.
 *
 * המפעיל ביקש: "תבחן את כלל התיקיות — יש לנו חומר טוב למימוש — מה הפוטנציאל הכי גדול"
 * הכלי סורק: תיקיות-המערכת, מנועי-המדינה (deposits/microdex/yield/bridge/gas_tank),
 * הכספת, והשרשראות החיות (Steem+Hive: יתרות, תגמולים-ממתינים, הקצאות, סמכויות).
 *
 * פלט: agent/fleet_census_report.json + תדריך-מסוכם-לקונסולה (רק-קידומות-מפתחות, אם-בכלל)
 * חוק-ברזל: אפס-סודות-בפלט.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const out = { at: new Date().toISOString(), folders: {}, engines: {}, vault: {}, chains: { steem: {}, hive: {} }, material: [] };

/* ── תיקיות ── */
const DIRS = ['agent', 'agent/lib', 'agent/rescue', 'agent/keys', 'sovereign/core', 'sovereign/genesis', 'sovereign/recovery', 'sovereign/spec', 'sovereign/node', 'scripts', 'mini-services', 'tests', 'db', 'prisma', 'upload', 'docs', 'download', 'public', 'src'];
for (const d of DIRS) {
  try {
    const p = path.join(ROOT, d);
    if (!fs.existsSync(p)) continue;
    const files = fs.readdirSync(p).filter(f => !f.startsWith('.'));
    let bytes = 0;
    for (const f of files) { try { const s = fs.statSync(path.join(p, f)); if (s.isFile()) bytes += s.size; } catch (_) { } }
    out.folders[d] = { files: files.length, kb: Math.round(bytes / 1024) };
  } catch (_) { }
}

/* ── מנועי-מדינה ── */
const rd = p => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch (_) { return null; } };
const dep = rd('sovereign/node/deposits-state.json');
if (dep) out.engines.deposits = { tick: dep.tick, chains: Object.keys(dep.rpcHealth || {}).length };
const mx = rd('agent/microdex_state.json');
if (mx) out.engines.microdex = { day: mx.day, beats: mx.beats, opsToday: mx.opsToday };
const yl = rd('agent/yield_state.json');
if (yl) out.engines.yield = { day: yl.day, feesTotal: yl.feesTotal, totalPaid: yl.totalPaid };
const br = rd('agent/bridge_state.json');
if (br) out.engines.bridge = { anchoredTotal: br.anchoredTotal, lastSteemIdx: br.lastSteemIdx };
const gt = rd('agent/gas_tank.json');
if (gt) out.engines.gas_tank = { currency: gt.currency, credits: gt.credits, debits: gt.debits };

/* ── כספת (מבנה-בלבד) ── */
try {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'agent/keys/vault.json'), 'utf8'));
  out.vault.accounts = (v.accounts || []).map(a => ({ username: a.username, tier: a.tier, mode: a.mode, keysCount: Object.keys(a.keys || {}).length, chains: Object.keys(a.chains || {}) }));
  out.vault.hasEnc = fs.existsSync(path.join(ROOT, 'agent/keys/vault.enc'));
} catch (e) { out.vault.error = e.message.slice(0, 100); }

/* ── שרשראות ── */
function rpc(url, body) {
  return new Promise((res, rej) => {
    const u = new URL(url); const p = JSON.stringify(body);
    const q = https.request({ hostname: u.hostname, path: u.pathname || '/', method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(p) }, timeout: 25000 }, r => {
      let d = ''; r.on('data', c => (d += c)); r.on('end', () => { try { const j = JSON.parse(d); j.error ? rej(new Error(j.error.message)) : res(j.result); } catch (e) { rej(new Error('bad rpc')); } });
    });
    q.on('timeout', () => q.destroy(new Error('timeout'))); q.on('error', rej); q.write(p); q.end();
  });
}
const NAMES = ['headcorner', 'cashmachine', 'haran', 'israelnews', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq', 'ynet'];

async function steemCensus() {
  const accs = await rpc('https://api.steemit.com', { jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [NAMES], id: 1 });
  let sp = 0, liq = 0, unclaimed = 0;
  out.chains.steem.accounts = accs.map(a => {
    const vest = parseFloat(a.vesting_shares), spOwn = vest / 1e6;
    const delOut = parseFloat(a.delegated_vesting_shares || '0') / 1e6;
    const hasR = parseFloat(a.reward_steem_balance) > 0 || parseFloat(a.reward_sbd_balance) > 0 || parseFloat(a.reward_vesting_balance) > 0;
    sp += spOwn; liq += parseFloat(a.balance);
    if (hasR) unclaimed++;
    return {
      name: a.name, sp: +spOwn.toFixed(3), delegatedOut: +delOut.toFixed(3), liquid: a.balance,
      unclaimedRewards: hasR ? { steem: a.reward_steem_balance, vest: a.reward_vesting_balance } : null,
      rcMana: (a.rc_manabar && a.rc_manabar.current_mana) || null
    };
  });
  out.chains.steem.totals = { sp: +sp.toFixed(2), liquid: +liq.toFixed(3), accountsWithUnclaimed: unclaimed };
}
async function hiveCensus() {
  const accs = await rpc('https://api.hive.blog', { jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [NAMES], id: 1 });
  let hp = 0, unclaimed = 0;
  out.chains.hive.accounts = accs.map(a => {
    const vest = parseFloat(a.vesting_shares), hpOwn = vest / 1e6 * (a.vesting_exchange_rate ? parseFloat(a.vesting_exchange_rate) : 1);
    const hasR = parseFloat(a.reward_hive_balance) > 0 || parseFloat(a.reward_hbd_balance) > 0 || parseFloat(a.reward_vesting_balance) > 0;
    hp += vest / 1e6; if (hasR) unclaimed++;
    return { name: a.name, vests: vest, liquid: a.balance, unclaimedRewards: hasR ? { hive: a.reward_hive_balance, vest: a.reward_vesting_balance } : null };
  });
  out.chains.hive.totals = { vests: +hp.toFixed(2), accountsWithUnclaimed: unclaimed };
}

(async () => {
  const rs = await Promise.allSettled([steemCensus(), hiveCensus()]);
  rs.forEach((r, i) => { if (r.status === 'rejected') out.chains[i === 0 ? 'steem' : 'hive'].error = r.reason.message.slice(0, 120); });

  /* ── מפת-חומרים ── */
  const st = out.chains.steem;
  if (st.accounts) {
    const head = st.accounts.find(a => a.name === 'headcorner');
    if (head && head.unclaimedRewards) out.material.push({ kind: 'claimable-rewards', chain: 'steem', who: 'headcorner', what: head.unclaimedRewards, action: 'claim_rewards (posting+active)', risk: 'none' });
    if (head) out.material.push({ kind: 'free-sp', chain: 'steem', who: 'headcorner', what: (head.sp - head.delegatedOut).toFixed(2) + 'SP uncommitted', action: 'endowments for new fleet', risk: 'none' });
    const dust = st.accounts.filter(a => a.name !== 'headcorner' && parseFloat(a.liquid) >= 0.01).length;
    if (dust) out.material.push({ kind: 'dust', chain: 'steem', who: dust + ' soldiers', what: '~0.01 STEEM each (keys not on-chain — inaccessible)', action: 'none (documented)', risk: 'none' });
  }
  const hv = out.chains.hive;
  if (hv.totals) out.material.push({ kind: 'context', chain: 'hive', what: hv.totals.vests + ' VESTS total — too thin for claims; fleet runs on own posting keys (saos swarm live)', action: 'keep operating', risk: 'none' });
  if (out.engines.deposits) out.material.push({ kind: 'engine', what: 'deposits tick=' + out.engines.deposits.tick + ' chains=' + out.engines.deposits.chains + '/10', action: 'running', risk: 'none' });

  fs.writeFileSync(path.join(__dirname, 'fleet_census_report.json'), JSON.stringify(out, null, 1));

  /* תדריך */
  console.log('=== FLEET CENSUS ===');
  console.log('folders scanned:', Object.keys(out.folders).length);
  console.log('engines:', JSON.stringify(out.engines));
  console.log('vault:', out.vault.accounts ? out.vault.accounts.length + ' accounts, enc=' + out.vault.hasEnc : 'ERR');
  if (st.totals) console.log('STEEM: SP=' + st.totals.sp + ' liquid=' + st.totals.liquid + ' unclaimed=' + st.totals.accountsWithUnclaimed);
  if (hv.totals) console.log('HIVE: vests=' + hv.totals.vests + ' unclaimed=' + hv.totals.accountsWithUnclaimed);
  console.log('MATERIAL MAP:');
  out.material.forEach(m => console.log(' •', m.kind + ':', JSON.stringify(m.what || m.what || '').slice(0, 90), '→', m.action));
  const stErr = st.error || (hv || {}).error;
  if (stErr) console.log('chain-warn:', stErr);
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });
