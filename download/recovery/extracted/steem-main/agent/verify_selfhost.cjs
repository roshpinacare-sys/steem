#!/usr/bin/env node
/**
 * verify_selfhost.cjs — Task 84: the deduction engine that answers the
 * operator's question "does the network sit on its own server?" with
 * evidence, not hope. (מדע ההיסק — the science of deduction)
 *
 * Premises:
 *   P1. A network is SELF-HOSTED iff its sovereign loops (chain beat,
 *       LIVING-ATTEST, git push) demonstrably execute while every
 *       sandbox-owned process is dead — or, generally, from an executor
 *       that is NOT the sandbox.
 *   P2. The only witnesses that cannot lie live outside the sandbox:
 *       the chains (attest history, public RPC) and origin/main (commit
 *       stream). Local pid/log files CAN lie (a snapshot restores them).
 *   P3. Every executor leaves a fingerprint:
 *         sandbox → local daemon pid + local log mtimes
 *         cloud   → commits authored by cloud-heart[bot] + Actions runs
 *   ∴ Verdict := correlate attest/commit freshness × executor fingerprints.
 *
 * Evidence collected (keyless, except an optional Actions read):
 *   1. LIVING-ATTEST — latest broadcast on Steem/Hive (chain_attest.cjs)
 *   2. origin/main   — recent commit authors + timestamps (git log)
 *   3. local executor  — daemon pid alive? (pgrep)
 *   4. cloud executor  — Actions runs via API when agent/.env carries
 *                        GITHUB_TOKEN; the latest cloud-heart-report artifact
 *                        is downloaded and its `takeover` flag is the EXECUTION
 *                        evidence (an alive-path run only watches — a takeover
 *                        run actually runs the network)
 *   5. drill window    — agent/selfhost_drill.json {killedAt, revivedAt}:
 *                        the sandbox executor deliberately stopped; an attest
 *                        broadcast INSIDE the window cannot have come from the
 *                        sandbox (it was dead) — the strongest possible proof.
 *
 * Verdicts (honest, mutually exclusive):
 *   SELF-HOSTED-PROVEN       — cloud fingerprint fresh AND chain advanced
 *                              (attest fresh); if a drill window matched,
 *                              proof.whileSandboxDead = true.
 *   CLOUD-TAKEOVER-PENDING   — attest fresh but local daemon dead → the
 *                              cloud will take over within ≤30 min.
 *   SANDBOX-PRIMARY          — everything fresh, sandbox-driven, cloud
 *                              watching (standby verified via Actions).
 *   DARK                     — nothing fresh anywhere → network down.
 *
 * Usage: node agent/verify_selfhost.cjs   → one JSON line on stdout
 *        + agent/selfhost_verdict.json (runtime noise, never committed)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const AGENT_DIR = __dirname;
const ROOT = path.resolve(AGENT_DIR, '..');
const VERDICT_FILE = path.join(AGENT_DIR, 'selfhost_verdict.json');
const DRILL_FILE = path.join(AGENT_DIR, 'selfhost_drill.json');
const ACCOUNT = (process.env.SAOS_ATTEST_ACCOUNT || 'headcorner').toLowerCase();

const ATTEST_FRESH_MIN = 95;   // = CLOUD_STALE_MIN (3 missed 30-min cycles)
const CLOUD_FINGERPRINT_H = 24; // a cloud-heart[bot] commit newer than this = recent cloud execution

function sh(cmd, opts = {}) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8', timeout: opts.timeout || 20_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (_) { return ''; }
}

function envToken() {
  try {
    const m = fs.readFileSync(path.join(AGENT_DIR, '.env'), 'utf8').match(/^GITHUB_TOKEN=(\S+)\s*$/m);
    return m ? m[1] : null;
  } catch (_) { return null; }
}

function ageMin(iso) {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? (Date.now() - t) / 60000 : Infinity;
}

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; } }

/** Download cloud-heart-report artifacts from recent completed runs — the
 *  EXECUTION evidence: takeover:true means the cloud actually ran the network
 *  (seal-open → agent cycle → beat --live → attest → push). Alive-path runs
 *  only watch. Returns ALL reports found (newest first) — a scheduled
 *  alive-report must not shadow a takeover report (drill D-2 lesson).
 *  Auth failures / missing artifacts degrade to []. */
function fetchCloudReports(token) {
  const found = [];
  try {
    const base = 'https://api.github.com/repos/dudududi144-source/steem';
    const H = '-H "Authorization: Bearer ' + token + '"';
    const runs = JSON.parse(sh('curl -s -m 20 ' + H + ' "' + base + '/actions/runs?per_page=10"'));
    const completed = (runs.workflow_runs || []).filter((r) => r.status === 'completed').slice(0, 5);
    for (const run of completed) {
      try {
        const arts = JSON.parse(sh('curl -s -m 20 ' + H + ' "' + base + '/actions/runs/' + run.id + '/artifacts"'));
        const art = (arts.artifacts || []).find((a) => a.name === 'cloud-heart-report' && !a.expired);
        if (!art) continue;
        sh('curl -sL -m 30 ' + H + ' "' + art.archive_download_url + '" -o /tmp/saos_report.zip');
        const raw = sh('unzip -p /tmp/saos_report.zip cloud_heart_report.json 2>/dev/null || python3 -c "import zipfile;print(zipfile.ZipFile(\'/tmp/saos_report.zip\').read(zipfile.ZipFile(\'/tmp/saos_report.zip\').namelist()[0]).decode())"');
        try { fs.unlinkSync('/tmp/saos_report.zip'); } catch (_) {}
        const report = JSON.parse(raw);
        found.push({
          run: { id: run.id, event: run.event, head: String(run.head_sha || '').slice(0, 7), at: run.run_started_at },
          report: {
            takeover: !!report.takeover, verdict: report.verdict, at: report.at, runner: report.runner,
            postHeight: report.postHeight ? report.postHeight.height : null,
            attest: report.onChainAttest ? { chain: report.onChainAttest.chain, txid: String(report.onChainAttest.txid).slice(0, 16), height: report.onChainAttest.height, at: report.onChainAttest.at } : null,
            steps: (report.steps || []).map((s) => s.step + (s.ok ? '✓' : '✗')).join('·'),
          },
        });
      } catch (_) { /* one unreadable artifact must not kill the scan */ }
      if (found.length >= 3) break;
    }
  } catch (_) {}
  found.sort((a, b) => new Date(b.report.at) - new Date(a.report.at));
  return found;
}

async function main() {
  const evidence = { at: new Date().toISOString(), account: '@' + ACCOUNT };

  // 1. the chain witness (cannot lie)
  try {
    const { readLatestAttest } = require('./chain_attest.cjs');
    const attest = await readLatestAttest(ACCOUNT);
    if (attest) {
      evidence.attest = { height: attest.height, chain: attest.chain, txid: String(attest.txid || '').slice(0, 16), at: attest.at, ageMin: Math.round(ageMin(attest.at)) };
      evidence.attestFresh = ageMin(attest.at) < ATTEST_FRESH_MIN;
    }
  } catch (e) { evidence.attestError = String((e && e.message) || e).slice(0, 80); }

  // 2. origin/main commit stream (cannot lie)
  try {
    // (84) the format MUST be shell-quoted — bare | pipes break under /bin/sh
    //      (drill-found: the cloud fingerprint cell stayed silently empty)
    const log = sh('git log -40 --format="%an|%cI|%h|%s"');
    const commits = log.split('\n').filter(Boolean).map((l) => {
      const [an, ci, h, ...rest] = l.split('|');
      return { author: an, at: ci, hash: h, subject: rest.join('|').slice(0, 60) };
    });
    const cloud = commits.filter((c) => c.author === 'cloud-heart[bot]');
    evidence.localDaemon = { alive: /\d/.test(sh('pgrep -f "node agent.cjs"')) };
    if (cloud.length) {
      evidence.cloudExecutor = { commits: cloud.length, last: cloud[0], ageMin: Math.round(ageMin(cloud[0].at)) };
      evidence.cloudFresh = ageMin(cloud[0].at) < CLOUD_FINGERPRINT_H * 60;
    } else evidence.cloudExecutor = null;
    evidence.lastCommit = commits[0] || null;
  } catch (_) { /* no git */ }

  // 3. the cloud witness (Actions) — optional, needs the sealed token
  const tok = envToken();
  if (tok) {
    try {
      const out = sh('curl -s -m 20 -H "Authorization: Bearer ' + tok + '" "https://api.github.com/repos/dudududi144-source/steem/actions/runs?per_page=5"');
      const j = JSON.parse(out);
      const runs = (j.workflow_runs || []).map((r) => ({ id: r.id, event: r.event, status: r.status, conclusion: r.conclusion, at: r.run_started_at, head: String(r.head_sha || '').slice(0, 7) }));
      evidence.actions = { total: j.total_count ?? null, runs };
    } catch (e) { evidence.actions = { error: 'unreadable' }; }
    const cr = fetchCloudReports(tok);
    if (cr.length) {
      evidence.cloudReports = cr;
      const takeovers = cr.filter((x) => x.report.takeover);
      const newestTakeover = takeovers[0] || null;
      evidence.cloudReport = newestTakeover || cr[0];
      evidence.cloudReportAgeMin = Math.round(ageMin(evidence.cloudReport.report.at));
      evidence.cloudExecutedRecently = !!newestTakeover && evidence.cloudReportAgeMin < CLOUD_FINGERPRINT_H * 60;
    }
  } else evidence.actions = { skipped: 'no GITHUB_TOKEN in .env' };

  // 4. the drill window (sandbox executor deliberately stopped). Proof rule:
  //    a CLOUD report with takeover:true whose report.at falls INSIDE the
  //    window — GitHub produced it, it says the cloud ran the network, and the
  //    sandbox executor was verifiably dead. (Public chain-history indexes lag
  //    minutes, and a resurrected LOCAL daemon can also attest inside the
  //    window — so attest-in-window alone cannot discriminate; the artifact
  //    can. Drill D-2 lesson.)
  const drill = readJson(DRILL_FILE);
  if (drill && drill.killedAt) {
    evidence.drill = {
      killedAt: drill.killedAt,
      revivedAt: drill.revivedAt || null,
      sandboxDeadNow: !drill.revivedAt && !evidence.localDaemon?.alive,
    };
    const t0 = new Date(drill.killedAt).getTime() - 2 * 60_000; // clock skew margin
    const t1 = drill.revivedAt ? new Date(drill.revivedAt).getTime() + 5 * 60_000 : Date.now();
    const inWindow = (iso) => { const t = new Date(iso).getTime(); return Number.isFinite(t) && t >= t0 && t <= t1; };
    const takeoverReports = (evidence.cloudReports || []).filter((x) => x.report.takeover);
    const takeoverInWindow = takeoverReports.find((x) => inWindow(x.report.at)) || null;
    evidence.drill.attestInsideWindow = !!(evidence.attest && inWindow(evidence.attest.at));
    evidence.drill.actionsRunInsideWindow = !!((evidence.actions?.runs || []).some((r) => inWindow(r.at)));
    evidence.drill.cloudReportInsideWindow = !!takeoverInWindow;
    if (takeoverInWindow) evidence.drill.takeoverRun = takeoverInWindow.run;
    evidence.drill.proof = !!takeoverInWindow && evidence.drill.actionsRunInsideWindow;
  }

  // ∴ THE VERDICT
  const attestFresh = !!evidence.attestFresh;
  const daemonAlive = !!evidence.localDaemon?.alive;
  const drillProof = !!evidence.drill?.proof;
  const cloudExec = !!evidence.cloudExecutedRecently;

  let verdict;
  if (attestFresh && (cloudExec || drillProof)) {
    verdict = 'SELF-HOSTED-PROVEN';
  } else if (attestFresh && !daemonAlive) {
    verdict = 'CLOUD-TAKEOVER-PENDING';
  } else if (attestFresh && daemonAlive) {
    verdict = 'SANDBOX-PRIMARY' + (evidence.actions && evidence.actions.runs ? ' · CLOUD-STANDBY' : '');
  } else {
    verdict = 'DARK';
  }

  evidence.verdict = verdict;
  evidence.deduction = {
    attestFresh, sandboxDaemonAlive: daemonAlive,
    cloudExecutionEvidence: cloudExec || drillProof,
    viaDrillWindow: drillProof,
    viaCloudReport: cloudExec,
  };

  const out = JSON.stringify(evidence, null, 2) + '\n';
  try { fs.writeFileSync(VERDICT_FILE, out); } catch (_) {}
  console.log(JSON.stringify(evidence));
  return evidence;
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error('FATAL: ' + ((e && e.message) || e)); process.exit(1); });
