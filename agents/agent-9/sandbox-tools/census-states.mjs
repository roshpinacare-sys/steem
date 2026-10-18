// census-states.mjs — סיווג-workflows-מנוטרלים-לפי-סיבה (t21 — כנות-לפני-פעולה)
import fs from 'node:fs';
const TOKEN = fs.readFileSync('/home/z/.git-creds','utf8').match(/https:\/\/[^:]+:([^@]+)@github\.com/)[1];
const H = { 'Authorization': `Bearer ${TOKEN}`, 'Accept': 'application/vnd.github+json' };
const f = (url, opts = {}) => fetch(url, { ...opts, signal: AbortSignal.timeout(20_000) });

const sr = await f(`https://api.github.com/search/repositories?q=org:roshpinacare-sys&per_page=100`, { headers: H });
const repos = (await sr.json()).items || [];

const states = {};
const dead = [];
for (const repo of repos) {
  const r = await f(`https://api.github.com/repos/roshpinacare-sys/${repo.name}/actions/workflows?per_page=100`, { headers: H });
  if (!r.ok) continue;
  const d = await r.json();
  for (const w of (d.workflows || [])) {
    states[w.state] = (states[w.state] || 0) + 1;
    if (w.state !== 'active') dead.push(`${repo.name} | ${w.state} | ${w.path}`);
  }
}
console.log('=== סיווג-states ===');
console.log(JSON.stringify(states, null, 1));
console.log('\n=== מנוטרלים לפי-repo ===');
console.log(dead.join('\n'));
