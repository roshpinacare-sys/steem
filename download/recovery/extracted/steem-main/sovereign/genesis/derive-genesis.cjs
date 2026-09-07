#!/usr/bin/env node
/* derive-genesis.cjs — SAOS-NET Task 68: הג'נזיס שנגזר-מראיות.
 *
 * "המערכת שנחליף בהמשך" נולדת ממצב-אמיתי: הסקריפט קורא את ה-replay
 * המאומת של האימפריה (דקס רב-חשבוני + עגונים + מיקרו-דקס + case66)
 * מה-Console-API המקומי, ובונה genesis.json — מצב-הפתיחה של SAOS-NET.
 *
 * כל-מספר נושא מקור (sources) — מאיזה-API ומתי. ה-genesisHash =
 * stateRoot(ג'נזיס) = sha256 קנוני — זה-שיעוגן on-chain ע"י הצומת.
 *
 * שימוש: node derive-genesis.cjs --live [--out ../genesis/genesis.json]
 * בלי --live → פלט-לקונסולה בלבד (DRY).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const K = require(path.join(__dirname, '..', 'core', 'kernel.cjs'));

const LIVE = process.argv.includes('--live');
const LOCAL_API = 'http://127.0.0.1:3000';
const OUT = path.join(__dirname, '..', 'genesis', 'genesis.json');
const ISSUER = 'headcorner';

async function localJson(p, timeoutMs = 45000) {
  const res = await fetch(LOCAL_API + p, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error('local api ' + p + ' → ' + res.status);
  return res.json();
}

async function main() {
  const t0 = Date.now();
  console.log('=== SAOS-NET genesis derivation · ' + (LIVE ? 'LIVE' : 'DRY') + ' ===');

  // ── 1. אוצר + בריכה + ספר מה-replay-הרב-חשבוני
  const dex = await localJson('/api/ops/saos/dex?username=' + ISSUER);
  const mine = dex.mine || {};
  const pool = (dex.pools || []).find((p) => p.pair === 'SAOS:STEEM') || null;
  if (!pool) throw new Error('SAOS:STEEM pool not found in replay');

  // ── 2. עגונים — ספק-היצע/גיבוי/מחזיקים
  const wrapped = await localJson('/api/ops/saos/wrapped?username=' + ISSUER, 60000);
  const assets = (wrapped.assets || []).filter((a) => a && a.symbol);

  // ── 3. מיקרו-דקס + case66 — הקשר-חי
  const [microdex, case66] = await Promise.allSettled([
    localJson('/api/ops/sovereign/microdex'),
    localJson('/api/ops/sovereign/case66'),
  ]);
  const md = microdex.status === 'fulfilled' ? microdex.value : null;
  const c66 = case66.status === 'fulfilled' ? case66.value : null;

  // ── 4. צרוף-רוסטר: מחזיקי-LP + מחזיקי-עגונים + חיילי-מיקרו-דקס
  const roster = new Set([ISSUER]);
  for (const h of pool.lp || []) roster.add(String(h.account || '').toLowerCase());
  for (const a of assets) for (const h of a.holders || []) roster.add(String(h.account || '').toLowerCase());
  for (const s of Object.keys((md && md.state && md.state.bySoldier) || {})) roster.add(String(s).toLowerCase());
  roster.delete(''); roster.delete('null');
  const names = [...roster];
  console.log('roster: ' + names.length + ' accounts → ' + names.join(' '));

  // ── 5. יתרות-SAOS לכל חשבון (ה-replay יודע לכל-אחד; אוצר קורא-כבר-יש)
  const balances = {}; // name → {saos, lpShares}
  for (const h of pool.lp || []) {
    const n = String(h.account || '').toLowerCase();
    if (!n) continue;
    balances[n] = balances[n] || { saos: 0, lpShares: 0 };
    balances[n].lpShares = (balances[n].lpShares || 0) + (Number(h.shares) || 0);
  }
  for (const name of names) {
    if (name === ISSUER) continue;
    balances[name] = balances[name] || { saos: 0, lpShares: 0 };
  }
  balances[ISSUER] = balances[ISSUER] || { saos: 0, lpShares: 0 };
  balances[ISSUER].saos = (Number(mine.saosLiquid) || 0) + (Number(mine.saosLocked) || 0);
  const issuerLp = (pool.lp || []).find((h) => String(h.account).toLowerCase() === ISSUER);
  if (issuerLp) balances[ISSUER].lpShares = Number(issuerLp.shares) || 0;

  // ── 5b. יתרות-חיילים במקביל (דקס-ריפליי ~7.5ש׳ לקריאה — רץ ב-4-מסילות)
  {
    const soldiers = names.filter((n) => n !== ISSUER);
    let done = 0;
    const CONC = 4;
    const queue = [...soldiers];
    const worker = async () => {
      while (queue.length) {
        const name = queue.shift();
        try {
          const d = await localJson('/api/ops/saos/dex?username=' + name, 45000);
          const m = d.mine || {};
          balances[name].saos = Math.max(balances[name].saos, (Number(m.saosLiquid) || 0) + (Number(m.saosLocked) || 0));
        } catch (e) { console.log('  soldier ' + name + ' dex read failed: ' + e.message); }
        done++;
        if (done % 4 === 0) console.log('  soldier balances ' + done + '/' + soldiers.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONC, soldiers.length) }, worker));
  }

  // ── 6. בניית המצב (הכל µ-שלמים דרך הקרנל)
  const state = {
    meta: {
      issuer: ISSUER,
      supply: 0,
      derivedAt: new Date().toISOString(),
      lastHeartbeat: 'genesis-derived-from-live-replay · microdex opsToday=' + ((md && md.state && md.state.opsToday) || 0) +
        ' · soldiersActive=' + Object.keys((md && md.state && md.state.bySoldier) || {}).length +
        ' · feesCaptured=' + ((wrapped.fees && wrapped.fees.totalCaptured) || 0) + ' STEEM',
    },
    accounts: {},
    orders: [],
    nextOrder: 1,
    pool: {
      saos: K.µ(pool.saos), steem: K.µ(pool.steem),
      lpSupply: Math.round((pool.lpSupply || 0) * 1e6), feeBps: pool.feeBps || 30,
      locked: K.µ(pool.locked || 0),
    },
    fees: {
      total: K.µ((pool.feesSaos || 0) + (wrapped.fees && wrapped.fees.totalCaptured || 0)),
      toLp: K.µ((wrapped.fees && wrapped.fees.lp) || 0),
      toTreasury: K.µ((wrapped.fees && wrapped.fees.treasury) || 0),
    },
    wrapped: {},
    attests: {},
    checkpoints: [],
  };
  for (const name of names) {
    const b = balances[name] || { saos: 0, lpShares: 0 };
    state.accounts[name] = {
      saos: K.µ(b.saos), steem: 0, lockedSaos: 0, lockedSteem: 0,
      lp: Math.round((b.lpShares || 0) * 1e6), wrapped: {}, credits: 0,
    };
    state.meta.supply += K.µ(b.saos);
  }
  // נכסי-צד-שרשרת של האוצר (STEEM-credit נמדד) — יתרת-STEEM ריבונית מוצהרת
  state.accounts[ISSUER].steem = K.µ((Number(mine.steemCredit) || 0) + (Number(mine.steemLocked) || 0));

  // עגונים → wrapped + יתרות-מחזיקים
  for (const a of assets) {
    const sym = String(a.symbol).toUpperCase();
    const b = a.backing || {};
    const locked = (Number(b.lockedSbd) || 0) + (Number(b.lockedHive) || 0) + (Number(b.lockedSp) || 0) + (Number(b.lockedSteem) || 0);
    state.wrapped[sym] = {
      locked: K.µ(locked), supply: K.µ(Number(a.supply) || 0),
      redeemed: K.µ(Number(a.redeemed) || 0), unlocked: K.µ(Number(a.unlocked) || 0),
      refs: (b.refs || []).slice(-64).reduce((m, r) => (m[String(r).slice(0, 40)] = true, m), {}),
    };
    for (const h of a.holders || []) {
      const n = String(h.account || '').toLowerCase();
      if (!n || !(Number(h.balance) > 0)) continue;
      state.accounts[n] = state.accounts[n] || { saos: 0, steem: 0, lockedSaos: 0, lockedSteem: 0, lp: 0, wrapped: {}, credits: 0 };
      state.accounts[n].wrapped[sym] = K.µ(Number(h.balance));
    }
  }

  const stateRoot = K.stateRoot(state);
  const genesis = {
    netVersion: 'saos-net/0',
    time: new Date().toISOString(),
    genesisHash: stateRoot,
    sources: {
      dex: { url: '/api/ops/saos/dex', fetchedAt: dex.fetchedAt || null, note: 'multi-account replay of saos/v1 bus' },
      wrapped: { url: '/api/ops/saos/wrapped', fetchedAt: wrapped.fetchedAt || null, note: 'wrap replay: lock→mint→…→burn' },
      microdex: { url: '/api/ops/sovereign/microdex', fetchedAt: (md && md.at) || null },
      case66: { url: '/api/ops/sovereign/case66', fetchedAt: (c66 && c66.at) || null },
    },
    counts: {
      accounts: Object.keys(state.accounts).length,
      wrappedSymbols: Object.keys(state.wrapped).length,
      poolLpSupplyUlp: state.pool.lpSupply,
      lpHolders: Object.values(state.accounts).filter((a) => a.lp > 0).length,
    },
    state,
  };

  console.log('supply: ' + state.meta.supply / 1000 + ' SAOS across ' + Object.keys(state.accounts).length + ' accounts');
  console.log('pool: ' + state.pool.saos / 1000 + ' SAOS / ' + state.pool.steem / 1000 + ' STEEM · lpSupply ' + state.pool.lpSupply / 1e6);
  console.log('wrapped: ' + Object.entries(state.wrapped).map(([s, w]) => s + '=' + w.supply / 1000).join(' '));
  console.log('GENESIS-STATE-ROOT: ' + stateRoot);

  if (!LIVE) { console.log('[DRY] genesis.json not written'); return; }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(genesis, null, 2));
  console.log('written → ' + OUT + ' (' + Math.round(fs.statSync(OUT).size / 1024) + 'KB · ' + (Date.now() - t0) + 'ms)');
}

main().catch((e) => { console.error('FATAL ' + ((e && e.message) || e)); process.exit(1); });
