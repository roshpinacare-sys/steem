#!/usr/bin/env node
/**
 * cloud_heartbeat.cjs — Task 83: CLOUD-HEART (ALWAYS-UP layer L6).
 *
 * The executor that lives OUTSIDE the sandbox. GitHub Actions runs this on a
 * schedule (every 30 min, .github/workflows/cloud-heart.yml). The sandbox is
 * no longer a single point of failure — it is only the PRIMARY runner:
 *
 *   every run:
 *     1. read the LIVING-ATTEST from Steem/Hive (keyless, public RPC)
 *     2. fresh attest (< CLOUD_STALE_MIN, default 95 min = 3 missed cycles)
 *          → verdict SANDBOX-ALIVE → verify + report, touch NOTHING (exit 0)
 *     3. stale / missing → verdict SANDBOX-DOWN → TAKEOVER:
 *          a. write cloud_takeover.json (committed later — the sandbox sees it
 *             after its guardian re-syncs and stands its ECON loops down)
 *          b. fleet_vault --open  (zero-touch key restore from the in-repo seal)
 *          c. ONCE=1 node agent.cjs   (one full cycle of every loop, honest
 *             DRY/REAL per restored .env)
 *          d. wait for saosnet quiesce (no concurrent chain writers)
 *          e. saosnet.cjs --beat --live  (synchronous heartbeat block + anchor)
 *          f. chain_attest broadcast  (leadership marker ON-CHAIN)
 *          g. gitkeeper  (commit + push everything to origin/main)
 *
 * Leader election = on-chain attest freshness. The chain itself is the judge —
 * no config, no coordination service, no trust between runners.
 *
 * Honest boundary: during a takeover window the ECON loops (liq / microdex /
 * yield / merchant / paymaster) stand down (see agent.cjs cloudEconPaused) —
 * a revived sandbox and a finishing cloud window must never double-fire
 * economic actions. Claims/curation keep their own daily caps.
 *
 * Usage:
 *   node agent/cloud_heartbeat.cjs                 # normal (watch or take over)
 *   CLOUD_FORCE_TAKEOVER=1 node agent/cloud_heartbeat.cjs   # drill: force takeover path
 *   CLOUD_ALIVE_ONLY=1  node agent/cloud_heartbeat.cjs      # drill: force alive path (never acts)
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { readLatestAttest } = require('./chain_attest.cjs');

const AGENT_DIR = __dirname;
const ROOT = path.resolve(AGENT_DIR, '..');
const NODE_DIR = path.join(ROOT, 'sovereign', 'node');
const REPORT = path.join(AGENT_DIR, 'cloud_heart_report.json');
const TAKEOVER = path.join(AGENT_DIR, 'cloud_takeover.json');
const SUMMARY = process.env.GITHUB_STEP_SUMMARY || null;

const STALE_MIN = Number(process.env.CLOUD_STALE_MIN || 95);
const ACCOUNT = (process.env.SAOS_ATTEST_ACCOUNT || 'headcorner').toLowerCase();
const FORCE = !!process.env.CLOUD_FORCE_TAKEOVER;
const ALIVE_ONLY = !!process.env.CLOUD_ALIVE_ONLY;

const out = [];
function log(msg) {
  const line = '[' + new Date().toISOString() + '] cloud-heart: ' + msg;
  out.push(line);
  try { console.log(line); } catch (_) {}
}

function sh(cmd, opts = {}) {
  const r = spawnSync('bash', ['-lc', cmd], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: opts.timeout || 120_000,
    maxBuffer: 64 * 1024 * 1024,
    env: Object.assign({}, process.env, opts.env || {}),
  });
  return {
    status: r.status,
    stdout: (r.stdout || '').slice(-4000),
    stderr: (r.stderr || '').slice(-2000),
  };
}

function localHeight() {
  try {
    const st = JSON.parse(fs.readFileSync(path.join(NODE_DIR, 'state.json'), 'utf8'));
    return { height: st.height || 0, stateRoot: String(st.stateRoot || '') };
  } catch (_) { return null; }
}

function ageMin(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / 60000;
}

/** Wait until the saosnet writer is done: no live saosnet.cjs process AND
 *  its log stable for 15s. (avoids concurrent chain.json writers) */
function waitSaosnetQuiesce(maxSec) {
  const logPath = path.join(NODE_DIR, 'saosnet.log');
  const t0 = Date.now();
  let lastSize = -1, lastChange = Date.now();
  while ((Date.now() - t0) / 1000 < maxSec) {
    // any live saosnet process wins first
    let busy = false;
    try {
      for (const d of fs.readdirSync('/proc')) {
        if (!/^\d+$/.test(d)) continue;
        let cmd = '';
        try { cmd = fs.readFileSync('/proc/' + d + '/cmdline', 'utf8').replace(/\0/g, ' '); } catch (_) { continue; }
        if (cmd.includes('saosnet.cjs') && !cmd.includes('cloud_heartbeat')) { busy = true; break; }
      }
    } catch (_) { break; }
    if (!busy) {
      try {
        const sz = fs.statSync(logPath).size;
        if (sz !== lastSize) { lastSize = sz; lastChange = Date.now(); }
        else if (Date.now() - lastChange > 15_000) return true; // stable 15s
      } catch (_) { return true; }
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
  }
  return false;
}

async function main() {
  log('CLOUD-HEART start · account=@' + ACCOUNT + ' · stale-gate=' + STALE_MIN + 'min' + (FORCE ? ' · FORCE-TAKEOVER' : '') + (ALIVE_ONLY ? ' · ALIVE-ONLY' : ''));

  const head = sh('git rev-parse --short HEAD');
  const headCommit = (head.stdout || '').trim();
  log('checked out origin/main @ ' + headCommit);

  // 1. keyless read of the living attest (the public chains are the judge)
  let attest = null;
  try { attest = await readLatestAttest(ACCOUNT); } catch (e) { log('attest read error: ' + ((e && e.message) || e)); }
  const local = localHeight();

  // 1b. second, independent liveness signal: gitkeeper pushes every 30m
  //     (chain.json changes on every beat → origin/main always moves while
  //     the sandbox lives). Public Steem history indexes lag minutes —
  //     attest-readback alone would false-positive a takeover. Both stale → down.
  const lastCommitIso = (sh('git log -1 --format=%cI').stdout || '').trim();
  const GIT_STALE_MIN = Number(process.env.CLOUD_GIT_STALE_MIN || 75);
  const gitStaleMin = ageMin(lastCommitIso);

  const staleMin = attest ? ageMin(attest.at) : Infinity;
  const attestFresh = attest && staleMin < STALE_MIN;
  const gitFresh = Number.isFinite(gitStaleMin) && gitStaleMin < GIT_STALE_MIN;
  const alive = ALIVE_ONLY || (!FORCE && (attestFresh || gitFresh));
  const verdict = alive
    ? 'SANDBOX-ALIVE (' + (attestFresh ? 'attest ' + Math.round(staleMin) + 'min' : '') + (attestFresh && gitFresh ? ' + ' : '') + (gitFresh ? 'git ' + Math.round(gitStaleMin) + 'min' : '') + ' fresh)'
    : (FORCE
      ? 'SANDBOX-DOWN (DRILL-FORCED takeover — live signals were ' + (attest ? 'attest ' + Math.round(staleMin) + 'min' : 'no attest') + ' / git ' + Math.round(gitStaleMin) + 'min)'
      : (attest ? 'SANDBOX-DOWN (attest ' + Math.round(staleMin) + 'min + git ' + Math.round(gitStaleMin) + 'min stale)' : 'SANDBOX-DOWN (no attest on chain; git ' + Math.round(gitStaleMin) + 'min stale)'));
  log('verdict: ' + verdict);
  if (attest) log('on-chain: h' + attest.height + ' · ' + String(attest.stateRoot).slice(0, 12) + '… · ' + attest.chain + ' ' + String(attest.txid || '').slice(0, 12) + '… · at ' + attest.at);

  const report = {
    at: new Date().toISOString(),
    runner: process.env.CLOUD_HEART ? 'github-actions' : 'local',
    head: headCommit,
    verdict,
    onChainAttest: attest ? { height: attest.height, stateRoot: String(attest.stateRoot).slice(0, 16), at: attest.at, chain: attest.chain, txid: attest.txid } : null,
    localCheckout: local,
    staleMin: Number.isFinite(staleMin) ? Math.round(staleMin) : null,
    gitLastCommit: lastCommitIso || null,
    gitStaleMin: Number.isFinite(gitStaleMin) ? Math.round(gitStaleMin) : null,
    steps: [],
  };

  if (alive) {
    // ── alive path: verify only. The sandbox is primary; the cloud must NOT
    //    double-beat or double-act. Zero writes to chain state. ──
    report.takeover = false;
    const behind = attest && local && attest.height > local.height
      ? (attest.height - local.height)
      : 0;
    report.checkoutBehindAttest = behind;
    log('checkout vs on-chain bar: ' + (local ? 'local h' + local.height : 'no local state') + (behind ? ' — BEHIND by ' + behind + ' blocks (guardian/heal will re-sync on next sandbox boot)' : ' — current'));
    log('alive path done — cloud stands down, nothing touched');
  } else {
    // ── takeover path: the network must not stop just because a sandbox died ──
    report.takeover = true;
    log('TAKEOVER: the sandbox heartbeat is stale — the cloud takes command');

    // a. takeover marker FIRST (committed at step g; sandbox stands ECON down on sight)
    try {
      fs.writeFileSync(TAKEOVER, JSON.stringify({
        at: new Date().toISOString(),
        runner: report.runner,
        reason: verdict,
        lastAttest: attest ? { height: attest.height, at: attest.at } : null,
      }, null, 2) + '\n');
      report.steps.push({ step: 'takeover-marker', ok: true });
      log('takeover marker written');
    } catch (e) {
      report.steps.push({ step: 'takeover-marker', ok: false, err: String((e && e.message) || e) });
    }

    // b. zero-touch key restore from the in-repo seal
    if (fs.existsSync(path.join(AGENT_DIR, 'fleet_keys.enc'))) {
      const open = sh('node agent/fleet_vault.cjs --open', { timeout: 60_000 });
      const ok = open.status === 0;
      report.steps.push({ step: 'seal-open', ok, out: (open.stdout + open.stderr).slice(-300) });
      log('seal-open: ' + (ok ? 'OK — fleet keys restored (zero-touch)' : 'FAILED: ' + (open.stderr || open.stdout).slice(-150)));
    } else {
      report.steps.push({ step: 'seal-open', ok: false, out: 'no seal in repo — honest DRY mode' });
      log('no fleet_keys.enc in repo — running keyless (monitor mode), network still beats');
    }

    // c. one full cycle of every loop (ONCE mode — no singleton, exits by itself)
    const once = sh('ONCE=1 node agent/agent.cjs', { timeout: 11 * 60_000 });
    report.steps.push({ step: 'agent-once', ok: once.status === 0, out: (once.stdout + once.stderr).slice(-500) });
    log('agent once-cycle: ' + (once.status === 0 ? 'done' : 'exit ' + once.status));

    // d. wait until no other chain writer, then e. one synchronous beat
    waitSaosnetQuiesce(240);
    const beat = sh('cd sovereign/node && node saosnet.cjs --beat --live', { timeout: 5 * 60_000 });
    report.steps.push({ step: 'saosnet-beat', ok: beat.status === 0, out: (beat.stdout + beat.stderr).slice(-400) });
    log('saosnet beat --live: ' + (beat.status === 0 ? 'advanced' : 'exit ' + beat.status + ' — ' + (beat.stderr || beat.stdout).slice(-120)));

    // f. broadcast the leadership attest (the chain learns the cloud took over)
    const at = sh('node agent/chain_attest.cjs', { timeout: 3 * 60_000 });
    const atOk = at.status === 0;
    report.steps.push({ step: 'chain-attest', ok: atOk, out: (at.stdout + at.stderr).slice(-400) });
    log('chain attest: ' + (atOk ? 'broadcast ✓' : 'skipped/failed — ' + (at.stderr || at.stdout).slice(-120)));

    // g. commit + push everything (the cloud era state lives on origin/main)
    //    (84) the cloud-heart[bot] identity is set ONLY on the real cloud runner
    //    (CLOUD_HEART=1) — a local takeover drill must keep committing as the
    //    local identity, otherwise cloud fingerprints get forged forever
    //    (the 2026-09-05 incident: a local drill left the bot identity in
    //    .git/config and sandbox commits wore cloud fingerprints)
    if (process.env.CLOUD_HEART === '1') {
      sh('git config user.name "roshpinacare-sys" && git config user.email "cloud-heart[bot]@users.noreply.github.com"', { timeout: 15_000 });
    }
    const gk = sh('node agent/gitkeeper.cjs', { timeout: 3 * 60_000 });
    report.steps.push({ step: 'gitkeeper', ok: gk.status === 0, out: (gk.stdout + gk.stderr).slice(-400) });
    log('gitkeeper: ' + (gk.stdout || '').split('\n').filter((l) => l.includes('pushed') || l.includes('BLOCKED') || l.includes('clean')).slice(-1)[0] || 'done');

    report.postHeight = localHeight();
    if (report.postHeight) log('post-takeover height: ' + report.postHeight.height);
  }

  // report + step summary (report is gitkeeper-noise; txids/heights live on-chain and in git history)
  try { fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n'); } catch (_) {}
  if (SUMMARY) {
    try {
      const lines = [
        '## CLOUD-HEART report',
        '',
        '| field | value |',
        '|---|---|',
        '| verdict | **' + verdict + '** |',
        '| runner | ' + report.runner + ' |',
        '| HEAD | ' + headCommit + ' |',
        '| on-chain attest | ' + (report.onChainAttest ? 'h' + report.onChainAttest.height + ' @ ' + report.onChainAttest.chain + ' (' + report.onChainAttest.at + ')' : 'none') + ' |',
        '| takeover | ' + (report.takeover ? 'YES — cloud took command' : 'no — sandbox primary') + ' |',
        '',
        'Steps: ' + (report.steps.map((s) => s.step + (s.ok ? ' ✓' : ' ✗')).join(' · ') || 'verify-only'),
      ];
      fs.appendFileSync(SUMMARY, lines.join('\n') + '\n');
    } catch (_) {}
  }
  log('report written · verdict=' + verdict);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { log('FATAL: ' + ((e && e.message) || e)); process.exit(1); });
