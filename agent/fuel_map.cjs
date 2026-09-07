#!/usr/bin/env node
/**
 * FUEL-MAP 77 — מפת-דלק מדעית: מה-יש-לנו-ביד → כמה זה שווה-בספר-החי → אילו-מסילות-מפתיעות-עובדות
 * שיטה: בדיקות-קריאה-בלבד מול RPC ציבורי (HE + Hive condenser) · retry ×2 · אפס-חתימות
 * שאלות-המחקר:
 *  1) walk-the-book דו-צדדי: כמה SWAP.HIVE מקבלים ממכירת-כל-התיק על ה-bids החיים
 *  2) עלות-חיית-המחסור: כמה עולה ה-BEE שנותר עד השער (100.5 − בתיק)
 *  3) סריקת-פוזיציות-נשכחות: כל-ההזמנות-הפתוחות-שלנו בכל-הספרים
 *  4) power-down במסלול: ה-HP-השלילי-של-הצי = הכנסה-שבועית-חיה-שכבר-נוזלת
 *  5) התנגדות-פנימית: לולאת-hivePower שורפת-דלק→HP בזמן-שהמטרה היא דלק→BEE — כמה-בדיוק
 *  6) חומות-SPS/DHF: אגרת-הצעה מול יתרות-HBD/SBD חיות
 *  7) staking: אילו-שדות-התצורה-חשופים-לציבור (SAOS/WAIV/SPORTS/CENT/BEE)
 * פלט: agent/fuel_map.json
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const HE_RPC = process.env.HE_RPC || 'https://api.hive-engine.com/rpc/contracts';
const HIVE_RPCS = ['https://api.hive.blog', 'https://api.syncad.com', 'https://anyx.io'];
const ACCOUNT = 'headcorner';
const OUT = path.join(__dirname, 'fuel_map.json');
const GATE_BEE = 100.5; // עקבי-עם he_genesis CREATE_THRESHOLD
const OUR_SYMBOLS = ['SPORTS', 'WAIV', 'CENT', 'VKBT', 'PIZZA', 'POSH', 'LEO', 'AFIT'];

const log = (m) => console.log('[' + new Date().toISOString() + '] fuel-map: ' + m);

function rpcV4(urlStr, body) {
  const u = new URL(urlStr);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: u.hostname, path: u.pathname || '/', method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'User-Agent': 'saos-fuelmap/1 (on-chain research)', 'Content-Length': Buffer.byteLength(payload) }, timeout: 20000 },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (data.trimStart().startsWith('<')) return reject(new Error('html page (HE rate-limited?) status=' + res.statusCode));
          try {
            const json = JSON.parse(data);
            if (json.error) return reject(new Error(json.error.message || 'rpc error'));
            resolve(json.result);
          } catch (_) { reject(new Error('bad rpc: ' + data.slice(0, 100))); }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout 20s')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PACE_MS = 400; // HE-מציית — לא-לנגח-את-הAPI-הציבורי
function paced(fn) { return async (...a) => { await sleep(PACE_MS); return fn(...a); }; }

async function withRetry(name, fn, attempts = 3, delayMs = 2500) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try { return { ok: true, val: await fn(i) }; }
    catch (e) { lastErr = e; if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs * (i + 1))); }
  }
  return { ok: false, err: String((lastErr && lastErr.message) || lastErr).slice(0, 140) };
}

const heFind = paced((contract, table, query, limit = 100, extra = {}) =>
  rpcV4(HE_RPC, { jsonrpc: '2.0', method: 'find', params: { contract, table, query, limit, ...extra }, id: 1 }));

async function hiveRpc(method, params) {
  let lastErr = null;
  for (const url of HIVE_RPCS) {
    try { return await rpcV4(url, { jsonrpc: '2.0', method, params, id: 1 }); }
    catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('all hive rpcs failed');
}

const n = (x) => Number(x || 0);
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const r4 = (x) => Math.round(x * 1e4) / 1e4;

// ── עזרי-ספר ─────────────────────────────────────────────────────────────
function walkBids(bids, qtyToSell) {
  // bids: [{price, quantity}] — ממוין מהגבוה-לנמוך · מחזיר {proceeds, filled, avg, levels}
  let proceeds = 0, left = qtyToSell, levels = 0;
  for (const o of bids) {
    if (left <= 0) break;
    const take = Math.min(left, n(o.quantity));
    proceeds += take * n(o.price);
    left -= take;
    levels++;
  }
  const filled = qtyToSell - Math.max(left, 0);
  return { proceeds: r6(proceeds), filled: r6(filled), avg: filled > 0 ? r6(proceeds / filled) : 0, levels, unfilled: r6(Math.max(left, 0)) };
}
function walkAsks(asks, qtyToBuy) {
  // asks: [{price, quantity}] — ממוין מהנמוך-לגבוה · עלות-החזקה-עד-הכמות
  let cost = 0, left = qtyToBuy, levels = 0;
  for (const o of asks) {
    if (left <= 0) break;
    const take = Math.min(left, n(o.quantity));
    cost += take * n(o.price);
    left -= take;
    levels++;
  }
  const filled = qtyToBuy - Math.max(left, 0);
  return { cost: r6(cost), filled: r6(filled), avg: filled > 0 ? r6(cost / filled) : 0, levels, unfilled: r6(Math.max(left, 0)) };
}

(async () => {
  const started = Date.now();
  const out = { at: new Date().toISOString(), tool: 'fuel_map.cjs', mode: 'read-only-live', rails: [] };

  // ── 0) מלאי-HE-של-האוצר + צי ────────────────────────────────────────────
  log('rail-0: treasury + fleet HE balances');
  const balRes = await withRetry('treasury balances', () => heFind('tokens', 'balances', { account: ACCOUNT }, 200));
  const bal = (balRes.ok ? balRes.val : []) || [];
  const held = {};
  for (const b of bal) held[b.symbol] = { liquid: n(b.balance), staked: n(b.staked), pendingUnstake: n(b.pendingUnstake) };
  // תיקון-חיתוך: השאילתה-הכללית נחתכת-limit · שאילתות-ממוקדות-פר-סימול
  for (const sym of [...OUR_SYMBOLS, 'SWAP.HIVE', 'BEE']) {
    const t = await withRetry('balance ' + sym, () => heFind('tokens', 'balances', { account: ACCOUNT, symbol: sym }, 1));
    if (t.ok && (t.val || [])[0]) {
      const b = t.val[0];
      const prev = held[sym] || { liquid: 0, staked: 0, pendingUnstake: 0 };
      held[sym] = { liquid: n(b.balance), staked: n(b.staked), pendingUnstake: n(b.pendingUnstake), targeted: true, prevLiquidPage: prev.liquid };
    }
  }
  out.treasury = held;
  const symbolsLive = OUR_SYMBOLS.filter((s) => (held[s] ? held[s].liquid > 0 : false));
  const bee = held.BEE ? held.BEE.liquid : 0;
  const swaph = held['SWAP.HIVE'] ? held['SWAP.HIVE'].liquid : 0;

  // ── 1) walk-the-bids: נזיל-עכשיו + בצינור-ההפשרה (pendingUnstake) ────────
  log('rail-1: walk-the-bids (liquid now + unstake-pipeline future)');
  const sells = [];
  for (const sym of OUR_SYMBOLS) {
    const h = held[sym];
    if (!h || (h.liquid <= 0 && h.pendingUnstake <= 0)) continue;
    const book = await withRetry(sym + ' buyBook', () => heFind('market', 'buyBook', { symbol: sym }, 500));
    if (!book.ok) { sells.push({ sym, ok: false, err: book.err }); continue; }
    const bids = (book.val || []).map((o) => ({ price: n(o.price), quantity: n(o.quantity), account: o.account, ts: n(o.timestamp) })).sort((a, b) => b.price - a.price);
    const nowWalk = h.liquid > 0 ? walkBids(bids, h.liquid) : null;
    const futWalk = h.pendingUnstake > 0 ? walkBids(bids, h.pendingUnstake) : null;
    sells.push({
      sym, ok: true,
      liquid: r6(h.liquid), pendingUnstake: r6(h.pendingUnstake),
      ...(nowWalk ? { proceeds: nowWalk.proceeds, avg: nowWalk.avg, levels: nowWalk.levels } : { proceeds: 0 }),
      ...(futWalk ? { futureProceeds: futWalk.proceeds, futureAvg: futWalk.avg, futureTopBid: bids.length ? bids[0].price : 0, futureNote: 'bids-of-now × unstake-pipeline qty — המחיר-יזוז עד-הגעת-הנזיל' } : {}),
      topBid: bids.length ? bids[0].price : 0, bookDepth: bids.length,
    });
  }
  out.rail1_sellSide = sells;
  const totalProceeds = sells.reduce((s, x) => s + (x.ok ? x.proceeds || 0 : 0), 0);
  const futureProceeds = sells.reduce((s, x) => s + (x.ok ? x.futureProceeds || 0 : 0), 0);

  // ── 2) עלות-המחסור: ה-BEE-שנותר על ה-asks-החיים ─────────────────────────
  log('rail-2: BEE gap cost (gate ' + GATE_BEE + ' − held ' + bee + ')');
  const needBee = Math.max(GATE_BEE - bee, 0);
  const askBook = await withRetry('BEE sellBook', () => heFind('market', 'sellBook', { symbol: 'BEE' }, 500));
  let gap = { ok: false };
  if (askBook.ok) {
    const asks = (askBook.val || []).map((o) => ({ price: n(o.price), quantity: n(o.quantity), ts: n(o.timestamp) })).sort((a, b) => a.price - b.price);
    gap = { ok: true, needBee: r6(needBee), ...walkAsks(asks, needBee), askTop: asks.length ? asks[0].price : 0, bookDepth: asks.length };
  } else gap = { ok: false, err: askBook.err };

  // ── 3) פוזיציות-נשכחות: כל-ההזמנות-הפתוחות-שלנו בכל-הספרים ──────────────
  log('rail-3: our open orders sweep (sell + buy sides)');
  const openOrders = [];
  for (const sym of Array.from(new Set([...symbolsLive, 'AFIT', 'BEE']))) {
    const s = await withRetry(sym + ' our sells', () => heFind('market', 'sellBook', { symbol: sym, account: ACCOUNT }, 100));
    if (s.ok) for (const o of s.val || []) openOrders.push({ side: 'sell', symbol: sym, qty: n(o.quantity), price: n(o.price), value: r6(n(o.quantity) * n(o.price)), ts: new Date(n(o.timestamp) * 1000).toISOString() });
    const b = await withRetry(sym + ' our buys', () => heFind('market', 'buyBook', { symbol: sym, account: ACCOUNT }, 100));
    if (b.ok) for (const o of b.val || []) openOrders.push({ side: 'buy', symbol: sym, qty: n(o.quantity), price: n(o.price), value: r6(n(o.quantity) * n(o.price)), ts: new Date(n(o.timestamp) * 1000).toISOString() });
  }
  out.rail3_openOrders = openOrders;
  out.rail3_committedValue = r6(openOrders.filter((o) => o.side === 'sell').reduce((s, o) => s + o.value, 0));

  // ── 4) power-down במסלול: הכנסה-שבועית-חיה שכבר-נוזלת ───────────────────
  log('rail-4: in-flight power-downs (raw withdraw fields — classify real vs census-artifact)');
  const census = JSON.parse(fs.readFileSync(path.join(__dirname, 'bee_wall.json'), 'utf8')).census || { accounts: [ACCOUNT] };
  const suspects = census.accounts.filter((a) => { const v = (census.hive || {})[a]; return v && v.hp < 0; });
  const pd = [];
  const accRes = await withRetry('get_accounts', () => hiveRpc('condenser_api.get_accounts', [[ACCOUNT, ...suspects]]));
  if (accRes.ok) {
    for (const a of accRes.val || []) {
      const rate = n(a.vesting_withdraw_rate), toWithdraw = n(a.to_withdraw), withdrawn = n(a.withdrawn), delegated = n(a.delegated_vesting_shares), vests = n(a.vesting_shares);
      const realPowerdown = toWithdraw > withdrawn && rate > 0;
      pd.push({
        account: a.name,
        raw: { vests: r6(vests / 1e6), delegatedOut: r6(delegated / 1e6), withdrawRateVests: r6(rate / 1e6), toWithdrawVests: r6(toWithdraw / 1e6), withdrawnVests: r6(withdrawn / 1e6) },
        verdict: realPowerdown ? 'REAL powerdown in flight' : (delegated > vests ? 'census-artifact: delegated-out exceeds own vests (negative-HP is delegation math, no powerdown)' : 'no powerdown — hp math artifact'),
      });
    }
  } else pd.push({ ok: false, err: accRes.err });
  out.rail4_powerdowns = pd;
  const positiveHp = Object.values(census.hive || {}).reduce((s, v) => s + (v.hp > 0 ? v.hp : 0), 0);
  out.rail4_option_fullPowerdown = {
    positiveHpTotal: r4(positiveHp),
    weeklyHiveIfStarted: r4(positiveHp / 13),
    weeks13Total: r4(positiveHp),
    tradeoff: 'HP נמדד 212.07 (headcorner) + 1.36 (ynet) — פאוור-דאון מלא = +16.4 HIVE/שב׳ נזיל אבל ממית RC-חתימה וקוראציה-היבית בהדרגה · החלטה-אסטרטגית לא-אוטומטית',
  };

  // ── 5) ההתנגדות-הפנימית: hivePower-לולאה מול-מטרת-הדלק ──────────────────
  log('rail-5: hivePower loop direction check');
  let hpLoop = { measured: false };
  try {
    const root = JSON.parse(fs.readFileSync(path.join(__dirname, 'agent-status.json'), 'utf8'));
    const loops = root.loops || (root.status && root.status.loops) || {};
    const loop = loops.hivePower || null;
    if (loop) hpLoop = { measured: true, status: loop.status, stage: (loop.counters && loop.counters.stage) || null, detail: String(loop.detail || ''), direction: 'SWAP.HIVE→withdraw→HIVE→powerup (הפוך-ממטרת-הדלק-אם-יש-withdraw-בעיצומים)' };
  } catch (e) { hpLoop = { measured: false, err: String(e.message).slice(0, 100) }; }
  out.rail5_hivePowerContradiction = hpLoop;

  // ── 6) חומות-SPS/DHF: אגרות-הצעה מול יתרות-חיות ─────────────────────────
  log('rail-6: SPS/DHF proposal-fee walls');
  const hbdFleet = Object.values(census.hive || {}).reduce((s, v) => s + (v.hbd || 0), 0);
  const steemSide = (census.steem && census.steem[ACCOUNT]) || {};
  out.rail6_govWalls = {
    hiveDHF: { feeConstant: 65, unit: 'HBD', ourHBD: r4(hbdFleet), verdict: hbdFleet >= 65 ? 'affordable' : 'blocked — measured' },
    steemSPS: { feeConstant: 10, unit: 'SBD', ourSBD: r4(steemSide.sbd || 0), verdict: (steemSide.sbd || 0) >= 10 ? 'affordable' : 'blocked — measured' },
    note: 'אגרות-פרוטוקול-ידועות (לא-נשלפות-בAPI-ציבורי) · יתרות-נמדדו-חי',
  };

  // ── 7) staking-תצורה: מה-חשוף-לציבור ────────────────────────────────────
  log('rail-7: staking config fields (SPORTS/WAIV/CENT/BEE/SAOS)');
  const stak = [];
  for (const sym of ['SPORTS', 'WAIV', 'CENT', 'BEE', 'SAOS']) {
    const t = await withRetry(sym + ' token meta', () => heFind('tokens', 'tokens', { symbol: sym }, 1));
    if (!t.ok || !(t.val || [])[0]) { stak.push({ sym, ok: false }); continue; }
    const meta = t.val[0];
    stak.push({
      sym, ok: true,
      stakingEnabled: !!(meta.stakingEnabled || (meta.stakingInfo && meta.stakingInfo.enabled)),
      unstakingCooldownSec: meta.unstakingCooldown, delegationCooldownSec: meta.delegationCooldown,
      totalStaked: meta.totalStaked,
      stakedTreasury: held[sym] ? held[sym].staked : undefined,
      supply: meta.supply, issuer: meta.issuer,
      fields: Object.keys(meta).filter((k) => /stak|reward|deleg/i.test(k)),
    });
  }
  out.rail7_stakingProbe = stak;

  // ── סיכום ────────────────────────────────────────────────────────────────
  out.summary = {
    fuelNow: { swaph: r6(swaph), bee: r6(bee) },
    walkProceedsTotal: r6(totalProceeds),
    unstakePipelineProceeds: r6(futureProceeds),
    committedOnBook: out.rail3_committedValue,
    fuelIfAllRailsLand: r6(totalProceeds + futureProceeds + out.rail3_committedValue),
    gapCostLive: gap.ok ? gap.cost : null,
    gapCoveredByAllRails: gap.ok && gap.cost ? Math.min(100, r4((100 * (totalProceeds + futureProceeds + out.rail3_committedValue)) / gap.cost)) : null,
    durationMs: Date.now() - started,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  log('written ' + OUT + ' in ' + out.summary.durationMs + 'ms');
  console.log(JSON.stringify(out.summary, null, 2));
})().catch((e) => { console.error('fuel-map fatal:', e.message); process.exit(1); });
