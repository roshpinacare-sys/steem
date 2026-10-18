import fs from 'node:fs';
const TOKEN = fs.readFileSync('/home/z/.git-creds','utf8').match(/https:\/\/[^:]+:([^@]+)@github\.com/)[1];
const H = {Authorization:`Bearer ${TOKEN}`,'Accept':'application/vnd.github+json'};
const REPO='roshpinacare-sys/Autonomy';
for(const w of ['value-scan','artery-grid','artery-wallet','artery-fleet','sovereign-state','artery-watch']){
  const j=await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${w}.yml/runs?per_page=5`,{headers:H}).then(x=>x.json());
  const runs=(j.workflow_runs||[]).map(r=>`${r.run_number}:${r.event}:${r.status}:${r.conclusion??'-'}@${r.created_at.slice(11,16)}Z`).join(' | ');
  console.log(`${w}: ${runs||'NO RUNS'}`);
}
