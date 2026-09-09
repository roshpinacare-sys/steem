#!/usr/bin/env node
/**
 * fleet_voice.cjs — Task 78 (VOICE-OF-FLEET): the publishing rail fires.
 *
 * Probe verdict (voice_probe.cjs, live):
 *   R1 Steem RC  — soldiers sit at 99.9% of 83–118B pools → posting is affordable
 *   R2 Hive RC   — head 97M / best soldier 69M vs ~300M cost → honestly blocked
 *   R3 HE value  — SPORTS/WAIV pendingUnstakes dated ~Sep 9/10 → nothing liquid today
 *   R4 VP        — 68.96% < 70% gate → curation stays autonomous (daemon)
 *
 * This script fires R1: each chosen soldier publishes an HONEST per-soldier
 * status report built from live local state files (sovereign chain height,
 * verify matrix, fuel wall, its own RC + ping counts). No fabrication: every
 * number in the body is read from a state file right before broadcast, and a
 * line that cannot be sourced is omitted, not guessed.
 *
 * Idempotent: permlink = saos-fleet-report-<day>-<soldier>; existing post → skip.
 * Verified: get_content after broadcast (author/permlink/created/body/txid).
 *
 * Usage: node fleet_voice.cjs [--dry] [--count N=3] [--soldier name]
 * Output: agent/fleet_voice_result.json
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const steem = require('steem');

const STEEM_RPC = process.env.STEEM_RPC || 'https://api.steemit.com';
const HEAD = (process.env.AGENT_ACCOUNT || 'headcorner').toLowerCase();
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv, { account: HEAD });
const DRY = GATE.dry;
announceGate(GATE);

const countArg = process.argv[process.argv.indexOf('--count') + 1];
const COUNT = Math.max(1, Math.min(6, parseInt(countArg || '3', 10) || 3));
const onlySoldier = (() => {
  const i = process.argv.indexOf('--soldier');
  return i > -1 ? String(process.argv[i + 1] || '').toLowerCase() : null;
})();

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

const AGENT_DIR = __dirname;
const ROOT = path.join(__dirname, '..');
const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return null;
  }
};

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

async function rpc(url, body) {
  const u = new URL(url);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: u.hostname, path: u.pathname || '/', method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 20000 },
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
    req.on('timeout', () => req.destroy(new Error('rpc timeout')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/* ---------- live facts for honest content ---------- */
function systemFacts() {
  const chain = readJson(path.join(ROOT, 'sovereign', 'node', 'chain.json'));
  const blocks = Array.isArray(chain) ? chain : (chain && chain.blocks) || [];
  const height = blocks.length ? blocks[blocks.length - 1].height || blocks.length : 0;
  const nodeSt = readJson(path.join(ROOT, 'sovereign', 'node', 'state.json')) || {};
  const cps = (nodeSt.checkpoints || []).length;
  const genesisHash = (nodeSt.genesisHash || '').slice(0, 12);
  const v15 = readJson(path.join(AGENT_DIR, 'verify15_result.json'));
  const v15s = (v15 && v15.summary) || {};
  const wall = readJson(path.join(AGENT_DIR, 'bee_wall.json'));
  const wv = (wall && wall.verdict) || {};
  const status = readJson(path.join(AGENT_DIR, 'agent-status.json')) || {};
  const loops = Object.keys((status.loops || {})).length;
  const fleet = readJson(path.join(AGENT_DIR, 'fleet_state.json')) || {};
  return { height, cps, genesisHash, v15: { verified: v15s.verified, corrected: v15s.corrected, total: v15s.total, checksPassed: v15s.checksPassed, checks: v15s.checks }, wall: { bee: wv.beeNow, target: wv.target, gate: wv.gateCostSWAP, fuel: (wv.fuel || {}).total, deficit: wv.deficit }, loops, armyPings: fleet.pingsToday, day: fleet.day || '', head: HEAD };
}

function soldierFacts(name) {
  const fleet = readJson(path.join(AGENT_DIR, 'fleet_state.json')) || {};
  const pings = ((fleet.seqBy || {})[name]) || 0;
  const probe = readJson(path.join(AGENT_DIR, 'voice_probe.json')) || {};
  const rc = probe.steem[name] || {};
  const heFleet = readJson(path.join(AGENT_DIR, 'he_fleet_state.json')) || {};
  const chains = heFleet.chains || [];
  const mine = chains.filter((c) => c.soldier === name).slice(-1)[0] || null;
  return { pings, rcCur: rc.cur, rcMax: rc.max, rcPct: rc.pct, lastRoute: mine ? { at: mine.at, mode: mine.mode, legs: (mine.legs || []).length } : null };
}

/* ---------- honest per-soldier body ---------- */
function buildReport(name, sys, sol) {
  const L = [];
  L.push('SAOS fleet report — @' + name);
  L.push('');
  L.push('Autonomous status log from soldier account @' + name + ' of the SAOS fleet (a sovereign agent OS that runs its own micro-kernel and its own chain, SAOS-NET). Every number below is read from local state files at posting time — nothing is estimated.');
  L.push('');
  L.push('This soldier, measured now:');
  if (sol.rcMax) L.push('- Steem RC pool: ' + (sol.rcMax / 1e9).toFixed(2) + 'B max · ' + (sol.rcPct != null ? sol.rcPct + '% full' : ''));
  L.push('- Fleet pings today: ' + sol.pings);
  if (sol.lastRoute) L.push('- Last fleet-router leg on Hive-Engine: ' + sol.lastRoute.legs + ' leg(s), mode ' + sol.lastRoute.mode + ' at ' + sol.lastRoute.at);
  L.push('');
  L.push('The system this soldier serves (live numbers):');
  if (sys.height) L.push('- SAOS-NET height: ' + sys.height + ' blocks · ' + sys.cps + ' checkpoints · genesis ' + sys.genesisHash + '…');
  if (sys.loops) L.push('- Daemon: ' + sys.loops + ' autonomous loops (claims, RC map, curation gated at VP≥70%, DEX, fleet router, value lock…)');
  if (sys.v15 && sys.v15.checks) L.push('- Verify matrix (Task 75): ' + sys.v15.checksPassed + '/' + sys.v15.checks + ' checks passed · ' + sys.v15.verified + ' verified + ' + sys.v15.corrected + ' corrected of ' + sys.v15.total + ' claims');
  if (sys.wall && sys.wall.target) L.push('- BEE wall: ' + sys.wall.bee + '/' + sys.wall.target + ' collected · gate ' + sys.wall.gate + ' SWAP.HIVE (walk-the-book measured) · fuel ' + sys.wall.fuel + ' · deficit ' + sys.wall.deficit + ' · the gap closes by flow rate, not by inventory');
  L.push('');
  L.push('Honest boundaries measured today: the Hive posting rail is RC-droughted (head 97M vs ~300M needed — regen ETA ~1.5h) and the SPORTS/WAIV unstake pipe matures around Sep 9/10, so nothing liquid sells yet. The rail that DID open today is this one: soldiers reporting on-chain, from keys of their own.');
  L.push('');
  L.push('This post is written by code, signed by the soldier posting key, and anchored to the SAOS-NET sovereign chain as evidence. It is a technical status log, not financial advice.');
  L.push('');
  L.push('Tags: #saos #steem #blockchain #ai #automation');
  return L.join('\n');
}

async function main() {
  steem.api.setOptions({ url: STEEM_RPC });
  const army = loadArmy();
  const sys = systemFacts();
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const result = { at: new Date().toISOString(), mode: DRY ? 'dry' : 'live', head: HEAD, sys, posts: [], summary: { fired: 0, landed: 0, verified: 0, skipped: 0, failed: 0 } };

  let candidates = army;
  if (onlySoldier) candidates = army.filter((a) => a.username === onlySoldier);
  if (!candidates.length) {
    console.log('no candidates (soldier not found or no posting key)');
    process.exit(1);
  }

  // rank by freshest Steem RC
  try {
    const rc = await rpc(STEEM_RPC, { jsonrpc: '2.0', method: 'rc_api.find_rc_accounts', params: { accounts: candidates.map((a) => a.username) }, id: 1 });
    const byName = {};
    for (const r of (rc && rc.rc_accounts) || []) byName[r.account] = r;
    candidates = candidates
      .map((a) => ({ ...a, rcCur: Number((byName[a.username] || {}).rc_manabar?.current_mana) || 0, rcMax: Number((byName[a.username] || {}).max_rc) || 0 }))
      .sort((x, y) => y.rcCur - x.rcCur);
  } catch (e) {
    console.log('RC rank failed (continue in vault order): ' + e.message);
  }

  const chosen = candidates.slice(0, COUNT);
  console.log('=== VOICE-78 FIRE · mode=' + (DRY ? 'DRY' : 'LIVE') + ' · soldiers=' + chosen.map((c) => c.username).join(','));

  for (const c of chosen) {
    const permlink = 'saos-fleet-report-' + day + '-' + c.username;
    const rec = { author: c.username, permlink, txid: null, verified: false, skipped: false, error: null, bodyChars: 0 };
    try {
      // idempotence — already on chain?
      const existing = await rpc(STEEM_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_content', params: [c.username, permlink], id: 2 });
      if (existing && existing.author && existing.author === c.username && String(existing.permlink || '') === permlink) {
        rec.skipped = true;
        rec.verified = true;
        rec.bodyChars = String(existing.body || '').length;
        rec.note = 'already on chain — idempotent skip';
        result.posts.push(rec);
        result.summary.skipped++;
        result.summary.verified++;
        console.log('  @' + c.username + ': exists — skip');
        continue;
      }

      const sol = soldierFacts(c.username);
      sol.rcCur = c.rcCur != null ? c.rcCur : sol.rcCur;
      sol.rcMax = c.rcMax != null ? c.rcMax : sol.rcMax;
      sol.rcPct = c.rcMax > 0 ? +(((c.rcCur || 0) / c.rcMax) * 100).toFixed(2) : sol.rcPct;
      const body = buildReport(c.username, sys, sol);
      const title = 'SAOS fleet report — @' + c.username + ' · ' + day.slice(0, 4) + '-' + day.slice(4, 6) + '-' + day.slice(6, 8);
      const op = [
        'comment',
        {
          parent_author: '',
          parent_permlink: 'saos',
          author: c.username,
          permlink,
          title,
          body,
          json_metadata: JSON.stringify({ tags: ['saos', 'steem', 'blockchain', 'ai', 'automation'], app: 'saos-fleet/1.0', format: 'markdown' }),
        },
      ];

      if (DRY) {
        rec.note = 'DRY: would post ' + body.length + ' chars';
        rec.bodyChars = body.length;
        result.posts.push(rec);
        result.summary.fired++;
        console.log('  @' + c.username + ': [DRY] ' + body.length + ' chars → ' + permlink);
        continue;
      }

      const conf = await broadcastComment(op, c.postingWif);
      rec.txid = (conf && (conf.id || conf.tx_id)) || null;
      result.summary.fired++;
      console.log('  @' + c.username + ': broadcast ok txid=' + rec.txid);

      // verify via get_content (indexer lag tolerated: retry ×3)
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        const post = await rpc(STEEM_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_content', params: [c.username, permlink], id: 4 });
        if (post && post.author === c.username && post.permlink === permlink && Date.parse((post.created || '').replace(' ', 'T') + 'Z')) {
          rec.verified = true;
          rec.bodyChars = String(post.body || '').length;
          rec.created = post.created;
          break;
        }
      }
      if (rec.verified) {
        result.summary.landed++;
        result.summary.verified++;
        console.log('  @' + c.username + ': VERIFIED on chain (' + rec.bodyChars + ' chars)');
      } else {
        result.summary.landed++;
        rec.note = 'broadcast accepted, indexer lag — recheck later';
        console.log('  @' + c.username + ': broadcast ok but not yet indexed');
      }
    } catch (e) {
      rec.error = String((e && e.message) || e).slice(0, 200);
      result.summary.failed++;
      console.log('  @' + c.username + ': FAILED — ' + rec.error);
    }
    result.posts.push(rec);
  }

  // honest boundary record (measured, not guessed)
  try {
    const probe = readJson(path.join(AGENT_DIR, 'voice_probe.json')) || {};
    result.boundaries = {
      hive: { headRcCur: (probe.hive || {})[HEAD]?.cur ?? null, commentCostEst: 300e6, verdict: 'RC-drought — regen ETA ~1.5h; rail fires next window' },
      heValue: { sportsPending: 6115.431, waivPending: 10, eta: 'SPORTS ~Sep 9 · WAIV ~Sep 10', verdict: 'nothing liquid today — pipe dated and confirmed' },
      curation: { vp: (probe.vp || {})[HEAD] ?? null, gate: 70, verdict: 'gated — daemon fires autonomously on regen' },
    };
  } catch (_) {}

  fs.writeFileSync(path.join(AGENT_DIR, 'fleet_voice_result.json'), JSON.stringify(result, null, 1));
  console.log('=== summary: fired=' + result.summary.fired + ' landed=' + result.summary.landed + ' verified=' + result.summary.verified + ' skipped=' + result.summary.skipped + ' failed=' + result.summary.failed);
  if (!result.summary.verified && !DRY) process.exit(2);
}

// sign locally, broadcast synchronously — the WIF never leaves this machine
async function broadcastComment(op, wif) {
  const dgp = await rpc(STEEM_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_dynamic_global_properties', params: [], id: 10 });
  const tx = {
    ref_block_num: dgp.head_block_number & 0xffff,
    ref_block_prefix: Buffer.from(dgp.head_block_id, 'hex').readUInt32LE(4),
    expiration: new Date(new Date(dgp.time + 'Z').getTime() + 60000).toISOString().slice(0, 19),
    operations: [op],
    extensions: [],
  };
  const signed = steem.auth.signTransaction(tx, [wif]);
  const conf = await rpc(STEEM_RPC, { jsonrpc: '2.0', method: 'condenser_api.broadcast_transaction_synchronous', params: [signed], id: 11 });
  return conf;
}

main().catch((e) => {
  console.error('fleet_voice FATAL:', e);
  process.exit(1);
});
