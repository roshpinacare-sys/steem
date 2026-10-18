import fs from 'node:fs';
const TOKEN = fs.readFileSync('/home/z/.git-creds','utf8').match(/https:\/\/[^:]+:([^@]+)@github\.com/)[1];
const H = {Authorization:`Bearer ${TOKEN}`,'Accept':'application/vnd.github+json'};
const REPO='roshpinacare-sys/Autonomy';
for(const w of ['artery-builder','artery-growth']){
  const m=await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${w}.yml/runs?per_page=1`,{headers:H}).then(x=>x.json());
  const r=(m.workflow_runs||[])[0]||{};
  console.log(`${w}: #${r.run_number} ${r.status} ${r.conclusion??''} (${r.created_at})`);
}
