// mass-revive.mjs — היפוך מתקפת סגירה המונית: re-enable לכל workflow שאינו פעיל
// סמכות: פקודת הבעלים "מפעיל הכל... לא סגירה" — enable הוא המוטציה היחידה; איסור מוחלט על disable
// שימוש: node mass-revive.mjs Autonomy [Domain ...]
import fs from 'node:fs';
const TOKEN = fs.readFileSync('/home/z/.git-creds','utf8').match(/https:\/\/[^:]+:([^@]+)@github\.com/)[1];
const H = { 'Authorization': `Bearer ${TOKEN}`, 'Accept': 'application/vnd.github+json' };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const repos = process.argv.slice(2).length ? process.argv.slice(2) : ['Autonomy', 'Domain'];
const forensics = [];

for (const REPO of repos) {
  const r = await fetch(`https://api.github.com/repos/roshpinacare-sys/${REPO}/actions/workflows?per_page=100`, { headers: H });
  if (!r.ok) { console.log(`${REPO}: census FAIL http=${r.status}`); continue; }
  const d = await r.json();
  const dead = (d.workflows || []).filter(w => w.state !== 'active');
  console.log(`${REPO}: total=${d.total_count} dead=${dead.length} states=${[...new Set(dead.map(w=>w.state))].join(',')}`);
  let ok = 0, fail = [];
  for (const w of dead) {
    forensics.push({ repo: REPO, path: w.path, state: w.state, id: w.id, at: new Date().toISOString() });
    const e = await fetch(`https://api.github.com/repos/roshpinacare-sys/${REPO}/actions/workflows/${w.id}/enable`, { method: 'PUT', headers: H });
    if (e.status === 204) ok++; else fail.push(`${w.path}(${e.status})`);
    await sleep(120);
  }
  console.log(`${REPO}: re-enabled ok=${ok}/${dead.length}${fail.length ? ' FAILED=' + fail.join(',') : ''}`);
}
fs.writeFileSync('/home/z/my-project/tmp/attack2-forensics.json', JSON.stringify({ at: new Date().toISOString(), reversed: forensics }, null, 2));
console.log(`forensics written: ${forensics.length} entries -> tmp/attack2-forensics.json`);
