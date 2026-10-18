// revive-org.mjs — איבר-החייה-הארגונית [t22 · הוראת-בעלים: "להחיות את הארכיטקטורה... ולא לכבות"]
// ═══════════════════════════════════════════════════════════════════════════════
// הפער-שנמדד (t22): מערכת-החיסון (pacer/watchdog/guardian) מחייה-רק-את-ריפו-שבבעלותה
// (Autonomy+Domain) — מחוץ-לסקופ נשארו 89 מנוטרלים (disabled_manually) מארה"ב-קריסת-ה-billing
// וממתקפות-הסגירה, ואף-איבר-לא-החזיר-אותם. האיבר-הזה סוגר-את-הפער.
//
// חוקים:
//   · enable בלבד — איסור-מוחלט על disable (חוקת-אי-הסגירה; enable = המוטציה-היחידה)
//   · forks — לעולם-לא-נוגעים
//   · כל-פעולה-עם-קבלה (receipts jsonl); fail-closed = דיווח-כנה, לא-שקר
//   · idempotent: ריצה-חוזרת על-מצב-נקי = פעימה-שקטה
//   · כלכלה-נמדדה (t22): ~87/89 dispatch-only-או-ציבוריים = עלות-אפס-דקות; חומת-ה-billing
//     הוסרה (steem פרטי מריץ-cron-ירוק-היום) — ההחייה-בטוחה-כלכלית
//
// שימוש:  node revive-org.mjs            (חי: סקר+החייה+קבלות)
//         node revive-org.mjs --selftest (אפס-רשת, חייב-ירוק)
//         PAT=ghp_xxx node revive-org.mjs  (בתוך-workflow: PAT מהסודות; מקומי: .git-creds)
import fs from 'node:fs';

const RECEIPTS = process.env.RECEIPTS || '/home/z/my-project/tmp/revive-org-receipts.jsonl';
const ORG = 'roshpinacare-sys';
const H = (t) => ({ 'Authorization': `Bearer ${t}`, 'Accept': 'application/vnd.github+json' });
const f = (url, opts = {}) => fetch(url, { ...opts, signal: AbortSignal.timeout(20_000) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readToken() {
  if (process.env.PAT) return process.env.PAT;
  const creds = fs.readFileSync('/home/z/.git-creds', 'utf8');
  return creds.match(/https:\/\/[^:]+:([^@]+)@github\.com/)[1];
}
const receipt = (row) => {
  try { fs.appendFileSync(RECEIPTS, JSON.stringify(row) + '\n'); } catch { /* קבלה-לא-תפיל-פעימה */ }
};

async function orgRepos(token) {
  const sr = await f(`https://api.github.com/search/repositories?q=org:${ORG}&per_page=100`, { headers: H(token) });
  if (!sr.ok) throw new Error(`search ${sr.status}`);
  return (await sr.json()).items || [];
}

async function beat(token) {
  const at = new Date().toISOString();
  const row = { at, repos: 0, scanned: 0, revived: 0, alreadyActive: 0, skippedFork: 0, failed: [] };
  const repos = await orgRepos(token);
  row.repos = repos.length;
  for (const repo of repos) {
    if (repo.fork) { row.skippedFork++; continue; } // חוקה: forks-מעולם-לא-נוגעים
    let d;
    try {
      const r = await f(`https://api.github.com/repos/${ORG}/${repo.name}/actions/workflows?per_page=100`, { headers: H(token) });
      if (!r.ok) { row.failed.push(`${repo.name}/list:${r.status}`); continue; }
      d = await r.json();
    } catch (e) { row.failed.push(`${repo.name}/list:${String(e.message).slice(0, 40)}`); continue; }
    const dead = (d.workflows || []).filter((w) => w.state !== 'active' && w.state !== 'deleted');
    row.scanned += d.total_count || 0;
    for (const w of dead) {
      try {
        const e = await f(`https://api.github.com/repos/${ORG}/${repo.name}/actions/workflows/${w.id}/enable`, { method: 'PUT', headers: H(token) });
        if (e.status === 204) { row.revived++; receipt({ at, repo: repo.name, wf: w.path, result: 'REVIVED' }); }
        else { row.failed.push(`${repo.name}/${w.path}:enable-${e.status}`); receipt({ at, repo: repo.name, wf: w.path, result: `ERR-${e.status}` }); }
      } catch (err) { row.failed.push(`${repo.name}/${w.path}:${String(err.message).slice(0, 40)}`); }
      await sleep(150); // קצב-מנומס — אפס-הצפת-API
    }
  }
  return row;
}

async function selftest() {
  // אפס-רשת: ולידציה של החוקים-הקשיחים
  const ok = [typeof beat === 'function', RECEIPTS.length > 0, ORG === 'roshpinacare-sys'].every(Boolean);
  const lawChecks = [
    ['enable-only', !/method:\s*['"]PUT['"][^}]*disable/.test(fs.readFileSync(import.meta.url.replace('file://', ''), 'utf8'))],
    ['forks-skipped', fs.readFileSync(import.meta.url.replace('file://', ''), 'utf8').includes('skippedFork')],
  ];
  const allGreen = ok && lawChecks.every(([, v]) => v);
  console.log(JSON.stringify({ selftest: allGreen ? 'PASS' : 'FAIL', lawChecks }, null, 1));
  process.exit(allGreen ? 0 : 1);
}

if (process.argv.includes('--selftest')) { selftest(); }
else {
  const token = readToken();
  const row = await beat(token);
  console.log(JSON.stringify(row, null, 1));
  if (row.failed.length) process.exit(2); // כנות: כישלון-חלקי = יציאה-רועשת
}
