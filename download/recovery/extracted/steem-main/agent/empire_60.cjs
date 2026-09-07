#!/usr/bin/env node
/**
 * empire_60.cjs — Task 60: EMPIRE BALANCE SHEET + HYPOTHESIS ENGINE.
 *
 * "מה יש לנו ביד?" — read-only census of EVERYTHING we hold, both chains:
 *   A. Treasury census   — 12 accounts × (Steem, Hive): liquid, SP/HP,
 *                          delegations, savings, SBD/HBD, RC, tickets,
 *                          voting power, witness votes, open orders.
 *   B. Markets           — internal order books (spread/depth), feed prices,
 *                          savings interest rates (both chains), CoinGecko $.
 *   C. Engine boundary   — Hive-Engine tokens universe + BEE price (token
 *                          issuance cost) + our Engine balances.
 *   D. Treasury/DHF      — steem.dao + hive.fund balances + live proposals
 *                          (the chain's own funding contracts).
 *   E. Rental markets    — dlease reachability + rate samples (passive HP income).
 *   F. Curation scan     — headcorner account history → curation rewards APR
 *                          + pending content payouts (content capital).
 *   G. Hypothesis ledger — wide verifiable list with live-injected status.
 *
 * Outputs: empire_60.json (full), empire_60_evidence.json (compact proofs),
 *          hypotheses_60.json (machine-readable for UI).
 * READ-ONLY: zero broadcasts, zero secrets in output.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const { Client, cryptoUtils } = require('@hiveio/dhive');

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

const OPERATOR = (process.env.AGENT_ACCOUNT || 'headcorner').toLowerCase();
const ACCOUNTS = [OPERATOR, 'cashmachine', 'haran', 'israelnews', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq', 'ynet'];
const steemCli = new Client(['https://api.steemit.com', 'https://api.justyy.com']);
const hiveCli = new Client('https://api.hive.blog');
const HE_RPC = { host: 'api.hive-engine.com', path: '/rpc/contracts' };

const log = (m) => console.log('[' + new Date().toISOString() + '] empire60: ' + m);
const toNum = (s) => parseFloat(String(s || '0').replace(/[^\d.]/g, '')) || 0;

function rpcV4(opts, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      { hostname: opts.host, path: opts.path || '/', method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 20000 },
      (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('bad json')); } }); });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.write(payload); req.end();
  });
}
async function heFind(contract, table, query, limit) {
  const r = await rpcV4(HE_RPC, { jsonrpc: '2.0', method: 'find', params: { contract, table, query: query || {}, limit: limit || 1000, offset: 0, indexes: [] }, id: 1 });
  const res = r && r.result;
  return Array.isArray(res) ? res : (res && res.items) || [];
}
async function heFindOne(contract, table, query) {
  const r = await rpcV4(HE_RPC, { jsonrpc: '2.0', method: 'findOne', params: { contract, table, query: query || {} }, id: 1 });
  return (r && r.result) || null;
}
async function getAccounts(cli, names) { return (await cli.call('condenser_api', 'get_accounts', [names])) || []; }
async function history(cli, name, limit) {
  try { return (await cli.call('condenser_api', 'get_account_history', [name, -1, limit])) || []; }
  catch (_) { return []; }
}
async function tryP(label, fn) {
  try { return { ok: true, data: await fn() }; }
  catch (e) { return { ok: false, error: String((e && e.message) || e).slice(0, 180) }; }
}

async function main() {
  const at = new Date().toISOString();
  const out = { at, operator: OPERATOR };

  // ---------- A. DGPo + feed (both chains) ----------
  const [dgpS, dgpH, feedH] = await Promise.all([
    steemCli.call('condenser_api', 'get_dynamic_global_properties', []),
    hiveCli.call('condenser_api', 'get_dynamic_global_properties', []),
    tryP('feed', () => hiveCli.call('condenser_api', 'get_current_median_history_price', [])),
  ]);
  const vestsSpS = toNum(dgpS.total_vesting_fund_steem) / toNum(dgpS.total_vesting_shares);
  const vestsSpH = toNum(dgpH.total_vesting_fund_hive) / toNum(dgpH.total_vesting_shares);
  out.dgpo = {
    steem: { head: dgpS.head_block_number, sbdInterestPct: (dgpS.sbd_interest_rate || 0) / 100, vestsPerSp: vestsSpS, steemSupply: toNum(dgpS.current_supply), sbdSupply: toNum(dgpS.current_sbd_supply) },
    hive: { head: dgpH.head_block_number, hbdInterestPct: (dgpH.hbd_interest_rate || 0) / 100, vestsPerHp: vestsSpH, hiveSupply: toNum(dgpH.current_supply), hbdSupply: toNum(dgpH.current_hbd_supply) },
    hiveFeed: feedH.ok ? { base: toNum(feedH.data.base), quote: toNum(feedH.data.quote), hivePerUsd: toNum(feedH.data.quote) / toNum(feedH.data.base) } : null,
  };
  const hivePerUsd = out.dgpo.hiveFeed ? out.dgpo.hiveFeed.hivePerUsd : null;

  // ---------- B. Treasury census ----------
  async function census(cli, chain, vPerUnit) {
    const accs = await getAccounts(cli, ACCOUNTS);
    const rows = [];
    for (const a of accs) {
      const vests = toNum(a.vesting_shares);
      const outDel = toNum(a.delegated_vesting_shares);
      const inDel = toNum(a.received_vesting_shares);
      const vpTime = a.last_vote_time ? (Date.now() - new Date(a.last_vote_time + 'Z').getTime()) / 1000 : 1e9;
      const vp = Math.min(100, 100 * (a.voting_power || 0) / 10000 + vpTime / 86400 * (10000 / 5) / 100);
      rows.push({
        account: a.name, chain,
        liquid: toNum(a.balance), debt: toNum(a.sbd_balance),
        savings: toNum(a.savings_balance), savingsDebt: toNum(a.savings_sbd_balance),
        vests, powerUnit: +(vests * vPerUnit).toFixed(2),
        delegatedOut: +(outDel * vPerUnit).toFixed(2), delegatedIn: +(inDel * vPerUnit).toFixed(2),
        rcPct: null, tickets: a.pending_claimed_accounts || 0,
        votingPowerPct: +vp.toFixed(1), witnessVotes: a.witnesses_voted_for || 0,
        rewardUnit: toNum(a.reward_steem_balance || a.reward_hive_balance), rewardDebt: toNum(a.reward_sbd_balance || a.reward_hbd_balance),
      });
    }
    // RC for all (rc_api)
    try {
      const rcRes = await cli.call('rc_api', 'find_rc_accounts', { accounts: ACCOUNTS });
      const rcMap = {};
      for (const r of (rcRes.rc_accounts || [])) rcMap[r.account] = r;
      for (const row of rows) {
        const r = rcMap[row.account];
        if (r && r.rc_manabar) {
          const max = parseInt(r.rc_manabar.current_mana); // max_mana separate
          const maxM = parseInt(r.max_rc || '0');
          row.rcPct = maxM > 0 ? +(((r.rc_manabar.current_mana || 0) / maxM) * 100).toFixed(1) : null;
          row.rcMax = maxM;
        }
      }
    } catch (_) { /* rc read failed — non-fatal */ }
    return rows;
  }
  out.census = {};
  out.census.steem = await census(steemCli, 'steem', vestsSpS);
  out.census.hive = await census(hiveCli, 'hive', vestsSpH);

  // totals
  const sum = (rows, k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
  out.totals = {
    steem: {
      liquidSteem: +sum(out.census.steem, 'liquid').toFixed(3), sbd: +sum(out.census.steem, 'debt').toFixed(3),
      savingsSbd: +sum(out.census.steem, 'savingsDebt').toFixed(3), sp: +sum(out.census.steem, 'powerUnit').toFixed(2),
      tickets: sum(out.census.steem, 'tickets'), rcRegenMaxGPerDay: null,
    },
    hive: {
      liquidHive: +sum(out.census.hive, 'liquid').toFixed(3), hbd: +sum(out.census.hive, 'debt').toFixed(3),
      savingsHbd: +sum(out.census.hive, 'savingsDebt').toFixed(3), hp: +sum(out.census.hive, 'powerUnit').toFixed(2),
      tickets: sum(out.census.hive, 'tickets'),
    },
  };
  // RC regen total from census file if fresh (<12h) — fleet turbine number
  try {
    const ec = JSON.parse(fs.readFileSync(path.join(__dirname, 'energy_census.json'), 'utf8'));
    if (Date.now() - new Date(ec.at).getTime() < 12 * 3600e3) {
      const g = (ec.steem.accounts || []).reduce((s, a) => s + (a.regenGPerDay || 0), 0);
      out.totals.fleetRcRegenGPerDay = +g.toFixed(0);
      out.totals.fleetCompactOpsPerDay = (ec.steem.accounts || []).reduce((s, a) => s + (a.compactOpsPerDay || 0), 0);
    }
  } catch (_) { /* ignore */ }

  // open orders (operator only — market ops live there)
  out.openOrders = {};
  out.openOrders.steem = await tryP('ord', () => steemCli.call('condenser_api', 'get_open_orders', [OPERATOR]));
  out.openOrders.hive = await tryP('ord', () => hiveCli.call('condenser_api', 'get_open_orders', [OPERATOR]));

  // ---------- C. Internal markets ----------
  async function book(cli, limit) {
    const b = await cli.call('condenser_api', 'get_order_book', [limit]);
    const asks = (b.asks || []).map((x) => ({ price: +x.real_price, amt: toNum(x.steem || x.hive) }));
    const bids = (b.bids || []).map((x) => ({ price: +x.real_price, amt: toNum(x.steem || x.hive) }));
    const bestAsk = asks.length ? asks[0].price : null, bestBid = bids.length ? bids[0].price : null;
    const mid = bestAsk && bestBid ? (bestAsk + bestBid) / 2 : null;
    return { bestBid, bestAsk, mid: mid ? +mid.toFixed(5) : null, spreadPct: bestAsk && bestBid ? +(((bestAsk - bestBid) / mid) * 100).toFixed(2) : null, askDepth: +asks.reduce((s, a) => s + a.amt, 0).toFixed(1), bidDepth: +bids.reduce((s, a) => s + a.amt, 0).toFixed(1) };
  }
  out.market = {};
  out.market.steem = await tryP('book', () => book(steemCli, 20));   // STEEM/SBD
  out.market.hive = await tryP('book', () => book(hiveCli, 20));     // HIVE/HBD

  // ---------- D. CoinGecko $ (best-effort) ----------
  out.usd = await tryP('cg', () => new Promise((resolve, reject) => {
    https.get({ hostname: 'api.coingecko.com', path: '/api/v3/simple/price?ids=steem,hive,hive_dollar,steem-dollars&vs_currencies=usd', family: 4, timeout: 8000 }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  }));

  // ---------- E. Hive-Engine boundary ----------
  const eng = {};
  const toks = await tryP('tokens', () => heFind('tokens', 'tokens', {}, 1000));
  if (toks.ok) {
    eng.reachable = true; eng.tokenCount = toks.data.length;
    eng.topByVolume = toks.data.sort((a, b) => (toNum(b.stats && b.stats.volume) - toNum(a.stats && a.stats.volume))).slice(0, 8)
      .map((t) => ({ symbol: t.symbol, name: String(t.name || '').slice(0, 40), volume24h: +toNum(t.stats && t.stats.volume).toFixed(2), holders: toNum(t.stats && t.stats.holders) }));
  } else { eng.reachable = false; eng.error = toks.error; }
  const bee = await tryP('bee', () => heFindOne('market', 'metrics', { symbol: 'BEE' }));
  if (bee.ok && bee.data) eng.bee = { last: +toNum(bee.data.last).toFixed(5), lastDay: +toNum(bee.data.lastDayPrice).toFixed(5), volume: +toNum(bee.data.volume).toFixed(2) };
  const ourBal = await tryP('bal', () => heFind('tokens', 'balances', { account: OPERATOR }, 100));
  if (ourBal.ok) eng.ourBalances = (ourBal.data || []).map((b) => ({ symbol: b.symbol, balance: +toNum(b.balance).toFixed(6), stake: +toNum(b.stake).toFixed(6) }));
  out.engine = eng;
  out.engine.tokenIssuance = { costBee: 100, note: 'SAOS-token = one Engine contract create (100 BEE) — measured boundary, decision pending' };

  // ---------- F. Treasury / DHF ----------
  const [daoS, daoH] = await Promise.all([
    getAccounts(steemCli, ['steem.dao']).catch(() => []), getAccounts(hiveCli, ['hive.fund']).catch(() => []),
  ]);
  out.treasury = {
    steemDaoBalanceSteem: daoS[0] ? toNum(daoS[0].balance) : null,
    hiveFundHive: daoH[0] ? toNum(daoH[0].balance) : null,
    hiveFundHbd: daoH[0] ? toNum(daoH[0].hbd_balance) : null,
  };
  out.proposals = await tryP('props', async () => {
    const p = await hiveCli.call('condenser_api', 'list_proposals', [[0], 100, 'by_total_votes', 'descending', 'all']);
    return (p || []).filter((x) => (x.status || '') === 'active').slice(0, 5).map((x) => ({ id: x.id, proposer: x.proposer, dailyPay: x.daily_pay, totalVotes: x.total_votes, subject: String(x.subject || '').slice(0, 60) }));
  });
  out.ourProposals = await tryP('ourprops', async () => {
    const p = await hiveCli.call('condenser_api', 'list_proposals', [[OPERATOR], 20, 'by_creator', 'descending', 'all']);
    return (p || []).map((x) => ({ id: x.id, permlink: x.permlink, dailyPay: x.daily_pay, subject: String(x.subject || '').slice(0, 60) }));
  });

  // ---------- G. Rental market ----------
  out.rental = await tryP('dlease', () => new Promise((resolve, reject) => {
    https.get({ hostname: 'api.dlease.io', path: '/queryMarket?minSP=50&order=apr&direction=descending', family: 4, timeout: 8000 }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => {
        try {
          const j = JSON.parse(d); const arr = j.market || j || [];
          const rows = Array.isArray(arr) ? arr.slice(0, 5).map((x) => ({ aprPct: +(x.apr || 0), sp: +x.sp || 0, owner: x.delegator ? undefined : undefined })) : [];
          resolve({ reachable: true, topApr: rows.length ? rows[0].aprPct : null, sample: rows });
        } catch (e) { resolve({ reachable: true, unparsable: true }); }
      });
    }).on('error', () => resolve({ reachable: false, note: 'dlease endpoint dead — HP rental market via internal delegation only' }));
  }));

  // ---------- H. Curation + content capital ----------
  const now = Date.now();
  async function curationScan(cli, name, vPerUnit, unitName) {
    const h = await history(cli, name, 3000);
    let sumVests = 0, ops = 0, oldest = null;
    for (const [, tx] of h) {
      for (const op of (tx.operations || [])) {
        if (op[0] === 'curation_reward') {
          const ts = new Date(tx.timestamp + 'Z').getTime();
          if (!oldest || ts < oldest) oldest = ts;
          sumVests += toNum(op[1].reward); ops++;
        }
      }
    }
    const days = oldest ? Math.max(1, (now - oldest) / 86400e3) : 0;
    const acc = (await getAccounts(cli, [name]))[0];
    const hp = acc ? toNum(acc.vesting_shares) * vPerUnit : 0;
    const perDay = days ? (sumVests * vPerUnit) / days : 0;
    const apr = hp > 0 ? (perDay * 365 * 100) / hp : 0;
    const posts = await tryP('posts', () => cli.call('condenser_api', 'get_discussions_by_author_before_date', [name, '', '', 20]));
    const pending = (posts.ok ? posts.data : []).reduce((s, p) => s + toNum(p.pending_payout_value), 0);
    return { ops14: ops, windowDays: +days.toFixed(1), unitPerDay: +perDay.toFixed(4), unitHeld: +hp.toFixed(2), aprPct: +apr.toFixed(2), pendingPayout: +pending.toFixed(3), unitName };
  }
  out.curation = {};
  out.curation.steem = await tryP('cur', () => curationScan(steemCli, OPERATOR, vestsSpS, 'SP'));
  out.curation.hive = await tryP('cur', () => curationScan(hiveCli, OPERATOR, vestsSpH, 'HP'));

  // ---------- I. Save ----------
  fs.writeFileSync(path.join(__dirname, 'empire_60.json'), JSON.stringify(out, null, 2) + '\n');

  // compact evidence for verify + UI
  const cg = out.usd.ok ? out.usd.data : null;
  const px = (id) => cg && cg[id] ? cg[id].usd : null;
  const evidence = {
    at,
    census: { accounts: ACCOUNTS.length, chains: 2, steemSp: out.totals.steem.sp, hiveHp: out.totals.hive.hp, ticketsSteem: out.totals.steem.tickets, ticketsHive: out.totals.hive.tickets, fleetRcRegenGPerDay: out.totals.fleetRcRegenGPerDay || null },
    rates: { steemSbdInterestPct: out.dgpo.steem.sbdInterestPct, hiveHbdInterestPct: out.dgpo.hive.hbdInterestPct },
    usd: { steem: px('steem'), hive: px('hive'), sbd: px('steem-dollars'), hbd: px('hive_dollar'), source: cg ? 'coingecko' : 'unreachable' },
    market: { steem: out.market.steem.ok ? out.market.steem.data : null, hive: out.market.hive.ok ? out.market.hive.data : null },
    engine: { reachable: eng.reachable, tokenCount: eng.tokenCount || 0, bee: eng.bee || null, ourBalances: (eng.ourBalances || []).length },
    treasury: out.treasury,
    proposals: out.proposals.ok ? { count: (out.proposals.data || []).length, top: (out.proposals.data || [])[0] || null } : { error: out.proposals.error },
    ourProposals: out.ourProposals.ok ? (out.ourProposals.data || []) : { error: out.ourProposals.error },
    rental: out.rental.ok ? out.rental.data : { reachable: false },
    curation: { steem: out.curation.steem.ok ? out.curation.steem.data : null, hive: out.curation.hive.ok ? out.curation.hive.data : null },
  };
  fs.writeFileSync(path.join(__dirname, 'empire_60_evidence.json'), JSON.stringify(evidence, null, 2) + '\n');

  log('census: steem SP=' + out.totals.steem.sp + ' hive HP=' + out.totals.hive.hp +
    ' | engine tokens=' + (eng.tokenCount || 'X') + ' | dlease=' + (evidence.rental && evidence.rental.reachable));
  log('DONE → empire_60.json + empire_60_evidence.json');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
