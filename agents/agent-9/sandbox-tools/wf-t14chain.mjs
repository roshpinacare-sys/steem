import fs from 'node:fs';
const TOKEN = fs.readFileSync('/home/z/.git-creds','utf8').match(/https:\/\/[^:]+:([^@]+)@github\.com/)[1];
const H = {Authorization:`Bearer ${TOKEN}`,'Accept':'application/vnd.github+json'};
const REPO='roshpinacare-sys/Autonomy';
const j=await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/artery-pacer.yml/runs?per_page=4`,{headers:H}).then(x=>x.json());
(j.workflow_runs||[]).forEach(r=>console.log(`pacer #${r.run_number} ${r.event} ${r.status} ${r.conclusion??''} @${r.created_at.slice(11,19)}Z`));
const b=await fetch(`https://raw.githubusercontent.com/${REPO}/main/receipts/pacer/latest.json`).then(x=>x.json()).catch(()=>null);
if(b)console.log(`pacer receipt: checked=${b.checked} stale=${(b.stale||[]).length} dispatched=${(b.dispatched||[]).filter(d=>d.ok).length} skipped=${b.skipped}`);
