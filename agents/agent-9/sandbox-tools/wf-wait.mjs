import fs from 'fs';
const TOKEN = fs.readFileSync('/home/z/.git-creds','utf8').match(/https:\/\/[^:]+:([^@]+)@github\.com/)[1];
const H = {Authorization:`Bearer ${TOKEN}`,'Accept':'application/vnd.github+json'};
const REPO='roshpinacare-sys/Autonomy';
for(const w of process.argv.slice(2)){
  const d=await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${w}.yml/runs?per_page=1`,{headers:H}).then(x=>x.json());
  const r=d.workflow_runs?.[0];
  console.log(`${w}: ${r?(r.conclusion||r.status):'none'} (head_sha ${r?.head_sha?.slice(0,7)})`);
}
