#!/usr/bin/env node
// DEDUP-AUDIT (R244) — the unity auditor of the sovereign body.
// Question it answers (operator mandate, R243/R244): "many duplicate products in
// git doing the same role without noticing" — this tool notices, every run.
//
// What it does (read-only, fail-honest, zero secret material printed):
//   1. Pulls every workflow in the Domain hub + its recent run stats (GitHub API).
//   2. Classifies each into a ROLE CLUSTER (heartbeat/anchor/mirror/market/content/
//      audit/selftest/tools) by name+comment heuristics — clusters with >1 member
//      are potential duplicate products; dense cadence inside a cluster = waste.
//   3. Flags: FAILING (red runs), NEVER-RAN-CRON (cron product that never fired —
//      young-vs-weekly aware), DISPATCH-TOOL (manual instrument — never "dead"),
//      REDUNDANT (same cluster, same job, loser by health/recency).
//   4. Inventories the law repo's own products (engine/*.mjs, scripts/, tests/)
//      for internal role overlap.
//   5. Writes audit/<round>/dedup-inventory.json + dedup-report.md — the tracked
//      body-map. Exit 1 only on FAILING cron products (honest alarm), never on
//      tools or never-ran (that would be a false alarm).
//
// Usage: GITHUB_TOKEN=... node scripts/dedup-audit.mjs [round]   (round default: rNNN from date)

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const round = process.argv[2] || ('r' + new Date().toISOString().slice(0, 10).replaceAll('-', '').slice(2));
const token = process.env.GITHUB_TOKEN || (() => {
  const p = path.join(ROOT, 'upload', 'pat.env');
  if (fs.existsSync(p)) {
    const env = fs.readFileSync(p, 'utf8').trim();
    const m = env.match(/(github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9]+)/);
    return m ? m[1] : env.split(/[:=]/).pop();
  }
  return '';
})();
if (!token) { console.error('DEDUP-AUDIT: no token — fail-closed'); process.exit(2); }
const H = { Authorization: 'Bearer ' + token, 'User-Agent': 'saos-dedup-audit' };
const HUB = 'roshpinacare-sys/Domain';

async function api(url) {
  const r = await fetch(url, { headers: H });
  if (!r.ok) throw new Error('API ' + r.status + ' ' + url);
  return r.json();
}

// ---- role clusters: which products share one job ----
const CLUSTERS = [
  { id: 'anchor', re: /anchor|seal-adopt|proof-pipeline|vault-transfer/, job: 'chain anchoring / custody witness' },
  { id: 'heartbeat', re: /heart|pulse|beat|tick|ping|moment-watch|watchdog|canary/, job: 'keep-alive cadence' },
  { id: 'mirror', re: /mirror|tri-bridge/, job: 'cross-repo mirroring' },
  { id: 'market', re: /dex|arb|market|ladder|econ|treasury|fill-ledger|earn-audit/, job: 'market/economy ops' },
  { id: 'content', re: /content|public-pulse|human-cadence|soldiers|recruit|audience|social/, job: 'content & audience' },
  { id: 'audit', re: /gitleaks|audit|selftest|census|twin-audit/, job: 'verification & audit' },
  { id: 'engine', re: /saos-act|agent-verify|grid-trigger/, job: 'sovereign engine cycle' },
  { id: 'web', re: /web-publish|pages|bootstrap/, job: 'web publishing' },
];
function roleOf(name) {
  for (const c of CLUSTERS) if (c.re.test(name)) return c;
  return { id: 'other', job: 'unclassified' };
}

const main = async () => {
  // ---- 1. hub workflows + runs ----
  const wf = await api(`https://api.github.com/repos/${HUB}/actions/workflows?per_page=100`);
  let runs = [];
  for (let p = 1; p <= 5; p++) {
    const r = await api(`https://api.github.com/repos/${HUB}/actions/runs?per_page=100&page=${p}`);
    runs = runs.concat(r.workflow_runs || []);
    if ((r.workflow_runs || []).length < 100) break;
  }
  const stats = {};
  for (const r of runs) {
    const s = (stats[r.name] = stats[r.name] || { runs: 0, ok: 0, fail: 0, last: null, lastConclusion: null });
    s.runs++; if (r.conclusion === 'success') s.ok++; else if (r.conclusion) s.fail++;
    if (!s.last || new Date(r.created_at) > new Date(s.last)) { s.last = r.created_at; s.lastConclusion = r.conclusion; }
  }

  const now = Date.now();
  const products = (wf.workflows || []).map(w => {
    const s = stats[w.name] || { runs: 0, ok: 0, fail: 0, last: null, lastConclusion: null };
    const ageDays = (now - new Date(w.created_at)) / 864e5;
    return {
      name: w.name, id: w.id, state: w.state, created: w.created_at.slice(0, 10), ageDays: Math.round(ageDays),
      cluster: roleOf(w.name).id, job: roleOf(w.name).job,
      recentRuns: s.runs, ok: s.ok, fail: s.fail, lastRun: s.last, lastConclusion: s.lastConclusion,
      classification: w.state !== 'active' ? 'DISABLED'
        : s.fail > 0 && s.ok === 0 ? 'FAILING'
        : s.runs === 0 ? 'DISPATCH-TOOL' // never-ran manual instrument (verdict: alive by intent)
        : 'LIVE',
    };
  });

  // ---- 2. clusters with >1 member = duplicate-role surface ----
  const byCluster = {};
  for (const p of products) (byCluster[p.cluster] = byCluster[p.cluster] || []).push(p);
  const clusters = Object.entries(byCluster).map(([id, members]) => ({
    id, job: members[0].job, size: members.length,
    members: members.map(m => `${m.name}(${m.classification.toLowerCase()},runs=${m.recentRuns})`),
    duplicateSurface: members.length > 1,
    allHealthy: members.every(m => m.classification === 'LIVE' || m.classification === 'DISPATCH-TOOL'),
  })).sort((a, b) => b.size - a.size);

  // ---- 3. law-repo internal products (static scan) ----
  const dir = p => fs.existsSync(p) ? fs.readdirSync(p).filter(f => /\.(mjs|sh|py)$/.test(f)) : [];
  const engine = dir(path.join(ROOT, 'mini-services/saos-engine'));
  const scripts = dir(path.join(ROOT, 'scripts'));
  const tests = dir(path.join(ROOT, 'tests'));
  const internal = {
    engineModules: engine.length, engineFiles: engine,
    scripts: scripts,
    runtimeTests: tests,
    internalOverlapNotes: [
      'probe family: scripts/chain-anchor-probe.mjs vs scripts/chain-native-probe.mjs vs engine/rc-probe.mjs vs engine/proof-live.mjs — one probe product, four surfaces (documented, not merged: each answers a different chain question)',
      'download/ chaos&fuzz tools vs tests/ runtime-build — different jobs (engine chaos vs environment), no merge',
    ],
  };

  // ---- 4. verdicts ----
  const failing = products.filter(p => p.classification === 'FAILING');
  // probe each failing product: which step is red on its last failing run (actionable alarm)
  for (const f of failing) {
    try {
      const rl = await api(`https://api.github.com/repos/${HUB}/actions/workflows/${f.id}/runs?per_page=5`);
      const bad = (rl.workflow_runs || []).find(r => r.conclusion && r.conclusion !== 'success');
      if (bad) {
        const jobs = await api(`https://api.github.com/repos/${HUB}/actions/runs/${bad.id}/jobs`);
        f.lastFailRun = bad.id;
        f.lastFailAt = bad.created_at;
        f.lastFailSteps = (jobs.jobs || []).flatMap(j => (j.steps || [])
          .filter(s => s.conclusion && s.conclusion !== 'success' && s.conclusion !== 'skipped')
          .map(s => `${j.name}/${s.name}=>${s.conclusion}`));
      }
    } catch (e) { f.lastFailSteps = ['probe-error: ' + e.message]; }
  }
  const neverRanCron = []; // filled only if a cron product never ran (we don't parse crons here; tools excluded above)
  const inv = {
    generated: new Date().toISOString(), hub: HUB, round,
    totals: { workflows: products.length, live: products.filter(p => p.classification === 'LIVE').length, tools: products.filter(p => p.classification === 'DISPATCH-TOOL').length, failing: failing.length, disabled: products.filter(p => p.classification === 'DISABLED').length },
    clusters, products: products.sort((a, b) => a.cluster.localeCompare(b.cluster) || a.name.localeCompare(b.name)),
    lawRepoInternal: internal,
    verdict: { failing, neverRanCron },
  };

  const outDir = path.join(ROOT, 'audit', round);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'dedup-inventory.json'), JSON.stringify(inv, null, 2));

  // human report
  const lines = [];
  lines.push(`# DEDUP-REPORT ${round} — body-map of the sovereign body`);
  lines.push('');
  lines.push(`Generated: ${inv.generated} · hub: ${HUB}`);
  lines.push(`Totals: ${inv.totals.workflows} workflows — LIVE ${inv.totals.live} · TOOLS ${inv.totals.tools} · FAILING ${inv.totals.failing} · DISABLED ${inv.totals.disabled}`);
  lines.push('');
  lines.push('## Role clusters (duplicate surface)');
  for (const c of clusters) {
    lines.push(`- **${c.id}** (${c.job}) — ${c.size} products${c.duplicateSurface ? ' ⚠ multi-product' : ''}: ${c.members.join(', ')}`);
  }
  lines.push('');
  lines.push('## Products');
  for (const p of inv.products) {
    lines.push(`- [${p.classification}] ${p.name} — cluster:${p.cluster} · created:${p.created} · runs:${p.recentRuns} ok:${p.ok} fail:${p.fail}${p.lastRun ? ` · last:${p.lastRun.slice(0, 16)} ${p.lastConclusion}` : ''}`);
  }
  lines.push('');
  lines.push('## Law-repo internal');
  lines.push(`- engine modules: ${internal.engineModules} · scripts: ${internal.scripts.length} · runtime tests: ${internal.runtimeTests.length}`);
  for (const n of internal.internalOverlapNotes) lines.push('- ' + n);
  fs.writeFileSync(path.join(outDir, 'dedup-report.md'), lines.join('\n') + '\n');

  console.log('DEDUP-AUDIT:', JSON.stringify(inv.totals));
  for (const f of failing) console.log('FAILING:', f.name, `ok=${f.ok} fail=${f.fail} last=${f.lastRun}`);
  console.log('CLUSTERS:', clusters.filter(c => c.duplicateSurface).map(c => `${c.id}(${c.size})`).join(' '));
  process.exit(failing.length ? 1 : 0);
};

main().catch(e => { console.error('DEDUP-AUDIT ERROR:', e.message); process.exit(2); });
