// census.mjs — ספירת-workflows-פעילים-בכל-ה-org (t21)
import fs from 'node:fs';
const TOKEN = fs.readFileSync('/home/z/.git-creds','utf8').match(/https:\/\/[^:]+:([^@]+)@github\.com/)[1];
const H = { 'Authorization': `Bearer ${TOKEN}`, 'Accept': 'application/vnd.github+json' };
const f = (url, opts = {}) => fetch(url, { ...opts, signal: AbortSignal.timeout(20_000) });

// org-API חסום-לי (404) → הרשימה-דרך-search-API (אומת-t21)
const sr = await f(`https://api.github.com/search/repositories?q=org:roshpinacare-sys&per_page=100`, { headers: H });
if (!sr.ok) { console.error('search-fail', sr.status); process.exit(1); }
const repos = (await sr.json()).items || [];
console.log(`org repos: ${repos.length}`);

let total = 0, active = 0, perRepo = [];
for (const repo of repos) {
  const r = await f(`https://api.github.com/repos/roshpinacare-sys/${repo.name}/actions/workflows?per_page=100`, { headers: H });
  if (!r.ok) { perRepo.push(`${repo.name}:ERR${r.status}`); continue; }
  const d = await r.json();
  const a = (d.workflows || []).filter(w => w.state === 'active').length;
  total += d.total_count || 0;
  active += a;
  perRepo.push(`${repo.name}:${a}/${d.total_count || 0}`);
}
console.log(`TOTAL workflows: ${total} | active: ${active}`);
console.log(perRepo.join(' '));
