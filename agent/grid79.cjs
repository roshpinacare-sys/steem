#!/usr/bin/env node
/**
 * grid79.cjs — Task 79 (SOVEREIGN GRID): turn the fleet from a metaphor into a
 * measured distributed validator grid. Three live phases, one evidence file.
 *
 *   A) CENSUS   — 13 nodes: SP/VP/RC (Steem) + RC (Hive). The grid's metabolic table.
 *   B) QUORUM   — FULL-grid parallel attestation: every node signs the SAME
 *                 checkpointHash (CP@108 = 61313f79…). Quorum v0 needs 3 —
 *                 this sweep takes 13. Per-node RC cost + ack latency + txid
 *                 verification via condenser get_transaction.
 *   C) SCAN     — parallel data-plane: 12 soldiers, 12 DIFFERENT slices
 *                 (10 HE books + 2 chain-head scouts), each node measures its
 *                 own slice and signs a gridscan op. Proves parallel WORK,
 *                 not just parallel signatures.
 *   D) INFERENCE— cost/op, sustainable ops/day per node, parallel speedup
 *                 (seq-equivalent vs measured wall), VP-eligible curation breadth.
 *
 * Usage: node grid79.cjs [--dry] [--skip-scan]
 * Output: agent/grid79_result.json
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const steem = require('steem');

const STEEM_RPC = 'https://api.steemit.com';
const STEEM_NODES = ['https://api.steemit.com', 'https://api.justyy.com', 'https://steem.61bts.com'];
const HIVE_RPC = 'https://api.hive.blog';
const HE_RPC = 'https://api.hive-engine.com/rpc/contracts';
const HEAD = (process.env.AGENT_ACCOUNT || 'headcorner').toLowerCase();
const NET = 'saos-net/0';
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv, { account: HEAD });
const DRY = GATE.dry;
announceGate(GATE);

const SKIP_SCAN = process.argv.includes('--skip-scan');

function loadDotEnv(dir) {
  const envPath = path.join(dir, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadDotEnv(__dirname);

const amt = (s) => parseFloat(String(s || '0')) || 0;

function loadArmy() {
  const out = [];
  try {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8'));
    for (const a of v.accounts || []) {
      if (!a || !a.username) continue;
      const u = String(a.username).toLowerCase();
      if (u === HEAD) continue;
      const delegated = a.mode === 'operator-delegated';
      out.push({
        username: u,
        postingWif: delegated ? (process.env.POSTING_WIF || '') : ((a.keys && a.keys.posting && a.keys.posting.wif) || ''),
      });
    }
  } catch (_) {}
  try {
    const files = fs
      .readdirSync(path.join(__dirname, 'keys'))
      .filter((f) => f.endsWith('.json') && f !== 'vault.json');
    for (const f of files) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', f), 'utf8'));
        const u = String((j && j.name) || '').toLowerCase();
        const wif = j && j.keys && j.keys.posting && j.keys.posting.wif;
        if (u && wif && u !== HEAD && !out.find((o) => o.username === u)) out.push({ username: u, postingWif: wif });
      } catch (_) {}
    }
  } catch (_) {}
  return out.filter((a) => a.postingWif);
}

function rpcNode(node, method, params, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const u = new URL(node);
    const payload = JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 });
    const req = https.request(
      { hostname: u.hostname, path: u.pathname || '/', method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(d);
            if (j.error) return reject(new Error(j.error.message || 'rpc error'));
            resolve(j.result);
          } catch (_) {
            reject(new Error('bad rpc: ' + d.slice(0, 100)));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

const heFind = async (contract, table, query, limit = 5) => {
  const r = await rpcNode(HE_RPC, 'find', { contract, table, query, limit }, 15000);
  return (r && r.rows) || [];
};

const netOp = (payload, signer) => ['custom_json', {
  required_auths: [], required_posting_auths: [signer], id: 'saos',
  json: JSON.stringify(Object.assign({ protocol: 'saos:net/v1', time: new Date().toISOString() }, payload)),
}];

async function broadcastWif(op, wif) {
  const dgp = await rpcNode(STEEM_RPC, 'condenser_api.get_dynamic_global_properties', []);
  const tx = {
    ref_block_num: dgp.head_block_number & 0xffff,
    ref_block_prefix: Buffer.from(dgp.head_block_id, 'hex').readUInt32LE(4),
    expiration: new Date(new Date(dgp.time + 'Z').getTime() + 60000).toISOString().slice(0, 19),
    operations: [op],
    extensions: [],
  };
  const signed = steem.auth.signTransaction(tx, [wif]);
  const conf = await rpcNode(STEEM_RPC, 'condenser_api.broadcast_transaction_synchronous', [signed]);
  return { txid: (conf && (conf.id || conf.tx_id)) || null };
}

async function verifySteem(txid) {
  for (let attempt = 0; attempt < 4; attempt++) {
    for (const node of STEEM_NODES) {
      try {
        const r = await rpcNode(node, 'condenser_api.get_transaction', [txid], 15000);
        if (r && r.transaction_id) return { verified: true, node: new URL(node).hostname, block: r.block || null };
      } catch (_) {}
    }
    if (attempt < 3) await new Promise((res) => setTimeout(res, 6000));
  }
  return { verified: false, node: null, block: null };
}

/* ─────────────── PHASE A — CENSUS ─────────────── */
async function census(nodes) {
  const names = [HEAD, ...nodes.map((n) => n.username)];
  const steemAcc = {};
  try {
    const accs = await rpcNode(STEEM_RPC, 'condenser_api.get_accounts', [names]);
    for (const a of accs || []) {
      const effective = amt(a.vesting_shares) - amt(a.delegated_vesting_shares) + amt(a.received_vesting_shares);
      const sp = effective / 1e6 * 481.5; // vest→SP approx (measured scaling at census time)
      const maxMana = effective * 1e6;
      const cur = amt(a.voting_manabar && a.voting_manabar.current_mana);
      steemAcc[a.name] = {
        sp: +sp.toFixed(3),
        vp: maxMana > 0 ? +((cur / maxMana) * 100).toFixed(2) : null,
      };
    }
  } catch (e) { census.errSteemAccounts = String(e.message || e).slice(0, 100); }
  const steemRc = {};
  try {
    const rc = await rpcNode(STEEM_RPC, 'rc_api.find_rc_accounts', { accounts: names });
    for (const r of (rc && rc.rc_accounts) || []) {
      const max = Number(r.max_rc) || 0;
      steemRc[r.account] = {
        cur: Number(r.rc_manabar && r.rc_manabar.current_mana) || 0,
        max,
        pct: max > 0 ? +(((Number(r.rc_manabar && r.rc_manabar.current_mana) || 0) / max) * 100).toFixed(2) : 0,
      };
    }
  } catch (e) { census.errSteemRc = String(e.message || e).slice(0, 100); }
  const hiveRc = {};
  try {
    const rc = await rpcNode(HIVE_RPC, 'rc_api.find_rc_accounts', { accounts: names }, 20000);
    for (const r of (rc && rc.rc_accounts) || []) {
      const max = Number(r.max_rc) || 0;
      hiveRc[r.account] = {
        cur: Number(r.rc_manabar && r.rc_manabar.current_mana) || 0,
        max,
        pct: max > 0 ? +(((Number(r.rc_manabar && r.rc_manabar.current_mana) || 0) / max) * 100).toFixed(2) : 0,
      };
    }
  } catch (e) { census.errHiveRc = String(e.message || e).slice(0, 100); }
  return { steemAcc, steemRc, hiveRc };
}

/* ─────────────── PHASE C-assignments — gridscan slices ─────────────── */
const SCAN_PLAN = [
  { sym: 'SPORTS', role: 'book' }, { sym: 'WAIV', role: 'book' }, { sym: 'CENT', role: 'book' },
  { sym: 'BEE', role: 'book' }, { sym: 'AFIT', role: 'book' }, { sym: 'PIZZA', role: 'book' },
  { sym: 'POSH', role: 'book' }, { sym: 'VKBT', role: 'book' }, { sym: 'LEO', role: 'book' },
  { sym: 'SWAP.HIVE', role: 'book' },
];

async function measureSlice(assign) {
  const t0 = Date.now();
  if (assign.role === 'book') {
    const [bids, asks] = await Promise.all([
      heFind('market', 'buyBook', { symbol: assign.sym }, 3),
      heFind('market', 'sellBook', { symbol: assign.sym }, 3),
    ]);
    const bid = (bids || []).map((b) => ({ p: parseFloat(b.price), q: parseFloat(b.quantity) })).filter((x) => x.p > 0).sort((a, b) => b.p - a.p)[0] || null;
    const ask = (asks || []).map((s) => ({ p: parseFloat(s.price), q: parseFloat(s.quantity) })).filter((x) => x.p > 0).sort((a, b) => a.p - b.p)[0] || null;
    return {
      kind: 'book', sym: assign.sym,
      bid: bid ? bid.p : null, bidQty: bid ? bid.q : null,
      ask: ask ? ask.p : null, askQty: ask ? ask.q : null,
      depthBids: (bids || []).length, depthAsks: (asks || []).length,
      measureMs: Date.now() - t0,
    };
  }
  if (assign.role === 'headblock-steem') {
    const d = await rpcNode(STEEM_RPC, 'condenser_api.get_dynamic_global_properties', []);
    return { kind: 'headblock', chain: 'steem', head: d.head_block_number, time: d.time, measureMs: Date.now() - t0 };
  }
  if (assign.role === 'headblock-hive') {
    const d = await rpcNode(HIVE_RPC, 'condenser_api.get_dynamic_global_properties', []);
    return { kind: 'headblock', chain: 'hive', head: d.head_block_number, time: d.time, measureMs: Date.now() - t0 };
  }
  throw new Error('unknown role');
}

async function main() {
  steem.api.setOptions({ url: STEEM_RPC });
  const army = loadArmy();
  const nodes = [ { username: HEAD, postingWif: process.env.POSTING_WIF || '' }, ...army ].filter((n) => n.postingWif);
  const startedAt = new Date().toISOString();
  const result = { at: startedAt, sweep: 'grid-79', mode: DRY ? 'dry' : 'live', nodes: nodes.map((n) => n.username), phases: {} };

  /* ── A: census ── */
  const c = await census(nodes);
  result.phases.census = c;
  const cEligible = nodes.filter((n) => (c.steemRc[n.username] || {}).pct >= 40).length;
  console.log('A/census: ' + nodes.length + ' nodes · RC≥40%: ' + cEligible);

  /* ── target checkpoint ── */
  const nodeSt = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'sovereign', 'node', 'state.json'), 'utf8'));
  const cps = nodeSt.checkpoints || [];
  const cp = cps[cps.length - 1];
  if (!cp || !cp.checkpointHash) {
    console.error('no checkpoint in state.json — abort');
    process.exit(1);
  }
  result.target = { height: cp.height, stateRoot: cp.stateRoot, checkpointHash: cp.checkpointHash, priorAttests: (cp.attests || []).map((a) => a.by) };
  const round = Math.floor(cp.height / 12);
  console.log('target CP@' + cp.height + ' · cpHash=' + cp.checkpointHash.slice(0, 16) + '… · prior attests=' + (cp.attests || []).length);

  /* ── B: full-grid parallel quorum ── */
  const rcBefore = {};
  for (const n of nodes) rcBefore[n.username] = (c.steemRc[n.username] || {}).cur || 0;
  const tAttestStart = Date.now();
  const attestResults = await Promise.all(nodes.map(async (n, i) => {
    await new Promise((r) => setTimeout(r, i * 400)); // gentle stagger inside the parallel wave
    const t0 = Date.now();
    if (DRY) return { node: n.username, dry: true, ackMs: null, txid: null };
    try {
      const payload = { action: 'attest', net: NET, height: cp.height, round, checkpointHash: cp.checkpointHash, stateRoot: cp.stateRoot, validator: n.username, sweep: 'grid-79' };
      const { txid } = await broadcastWif(netOp(payload, n.username), n.postingWif);
      return { node: n.username, ackMs: Date.now() - t0, txid };
    } catch (e) {
      return { node: n.username, ackMs: Date.now() - t0, error: String((e && e.message) || e).slice(0, 160) };
    }
  }));
  const wallAttestMs = Date.now() - tAttestStart;
  const rcAfter = {};
  try {
    const rc = await rpcNode(STEEM_RPC, 'rc_api.find_rc_accounts', { accounts: nodes.map((n) => n.username) });
    for (const r of (rc && rc.rc_accounts) || []) rcAfter[r.account] = Number(r.rc_manabar && r.rc_manabar.current_mana) || 0;
  } catch (_) {}
  for (const r of attestResults) {
    const before = rcBefore[r.node] || 0;
    const after = rcAfter[r.node];
    if (after != null) {
      const regenPerMs = ((c.steemRc[r.node] || {}).max || 0) / (5 * 24 * 3600 * 1000);
      const cost = before - after + regenPerMs * (Date.now() - tAttestStart);
      r.rcCost = Math.max(0, Math.round(cost));
    }
    if (r.txid && !DRY) {
      const v = await verifySteem(r.txid);
      r.verified = v.verified;
      r.verifiedBy = v.node;
      r.block = v.block;
    }
  }
  result.phases.quorum = {
    wave: 'parallel-stagger-400ms',
    wallMs: wallAttestMs,
    seqEquivalentMs: attestResults.reduce((s, r) => s + (r.ackMs || 0), 0),
    signed: attestResults.filter((r) => r.txid).length,
    verified: attestResults.filter((r) => r.verified).length,
    of: nodes.length,
    quorumV0Required: 3,
    results: attestResults,
  };
  console.log('B/quorum: signed=' + result.phases.quorum.signed + '/' + nodes.length + ' · verified=' + result.phases.quorum.verified + ' · wall=' + (wallAttestMs / 1000).toFixed(1) + 's');

  /* ── C: parallel data-plane scan ── */
  if (!SKIP_SCAN) {
    const scouts = army.slice(0, 12);
    const plan = [
      ...SCAN_PLAN.slice(0, Math.min(10, scouts.length)).map((s, i) => ({ node: scouts[i], role: 'book', sym: s.sym })),
      scouts[10] ? { node: scouts[10], role: 'headblock-steem' } : null,
      scouts[11] ? { node: scouts[11], role: 'headblock-hive' } : null,
    ].filter(Boolean);
    const tScanStart = Date.now();
    const scanResults = await Promise.all(plan.map(async (p, i) => {
      await new Promise((r) => setTimeout(r, i * 400));
      const t0 = Date.now();
      if (DRY) return { node: p.node.username, role: p.role, sym: p.sym || null, dry: true };
      try {
        const m = await measureSlice(p);
        const payload = Object.assign({ action: 'gridscan', net: NET, validator: p.node.username, sweep: 'grid-79' }, m);
        const { txid } = await broadcastWif(netOp(payload, p.node.username), p.node.postingWif);
        return Object.assign({}, m, { node: p.node.username, ackMs: Date.now() - t0, txid });
      } catch (e) {
        return { node: p.node.username, role: p.role, sym: p.sym || null, error: String((e && e.message) || e).slice(0, 160), ackMs: Date.now() - t0 };
      }
    }));
    const wallScanMs = Date.now() - tScanStart;
    for (const r of scanResults) if (r.txid && !DRY) {
      const v = await verifySteem(r.txid);
      r.verified = v.verified; r.verifiedBy = v.node; r.block = v.block;
    }
    result.phases.scan = {
      plan: plan.map((p) => ({ node: p.node.username, role: p.role, sym: p.sym || null })),
      wallMs: wallScanMs,
      landed: scanResults.filter((r) => r.txid).length,
      verified: scanResults.filter((r) => r.verified).length,
      of: plan.length,
      results: scanResults,
    };
    console.log('C/scan: landed=' + result.phases.scan.landed + '/' + plan.length + ' · verified=' + result.phases.scan.verified + ' · wall=' + (wallScanMs / 1000).toFixed(1) + 's');
  }

  /* ── D: inference from measurement ── */
  if (!DRY) {
    const q = result.phases.quorum;
    const costs = q.results.filter((r) => r.rcCost != null).map((r) => r.rcCost);
    const costAttest = costs.length ? Math.round(costs.reduce((s, x) => s + x, 0) / costs.length) : null;
    const scanCosts = (result.phases.scan ? result.phases.scan.results.filter((r) => r.rcCost == null && false) : []);
    const speedup = q.seqEquivalentMs > 0 ? +(q.seqEquivalentMs / q.wallMs).toFixed(2) : null;
    // sustainable capacity: regen/day per node = max/5 ; ops/day = regen / cost
    const rcMaxes = nodes.map((n) => (c.steemRc[n.username] || {}).max || 0);
    const regenDay = rcMaxes.reduce((s, m) => s + m / 5, 0);
    const capacityOpsDay = costAttest ? Math.floor(regenDay / costAttest) : null;
    const vpEligible = nodes.filter((n) => ((c.steemAcc[n.username] || {}).vp || 0) >= 70).length;
    const armySp = nodes.slice(1).reduce((s, n) => s + ((c.steemAcc[n.username] || {}).sp || 0), 0);
    result.inference = {
      costPerAttestRc: costAttest,
      costSample: costs.length,
      gridRegenPerDayRc: Math.round(regenDay),
      sustainableOpsPerDay: capacityOpsDay,
      parallelSpeedup: speedup,
      vpEligibleNow: vpEligible,
      armySpTotal: +armySp.toFixed(3),
      headSp: +((c.steemAcc[HEAD] || {}).sp || 0).toFixed(3),
      notes: [
        'regen model: Steem RC = 100%/5d (steady-state assumption)',
        'speedup = sum(ackMs) / wall(parallel) — the grid beats its own sequential shadow',
        'capacity = Σ regen/day ÷ measured cost/op — grid metabolic ceiling',
      ],
    };
    console.log('D/inference: cost/op=' + costAttest + ' RC · speedup=' + speedup + '× · capacity=' + capacityOpsDay + ' ops/day · VP≥70: ' + vpEligible + '/' + nodes.length);
  }

  fs.writeFileSync(path.join(__dirname, 'grid79_result.json'), JSON.stringify(result, null, 1));
  console.log('evidence → agent/grid79_result.json');
}

main().catch((e) => {
  console.error('grid79 FATAL:', e);
  process.exit(1);
});
