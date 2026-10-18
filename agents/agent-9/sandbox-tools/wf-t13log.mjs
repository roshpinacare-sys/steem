import fs from 'node:fs';
const TOKEN = fs.readFileSync('/home/z/.git-creds','utf8').match(/https:\/\/[^:]+:([^@]+)@github\.com/)[1];
const H = {Authorization:`Bearer ${TOKEN}`};
const REPO='roshpinacare-sys/Autonomy';
const m=await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/artery-growth.yml/runs?per_page=1`,{headers:H}).then(x=>x.json());
const r=m.workflow_runs[0];
const jobs=await fetch(`https://api.github.com/repos/${REPO}/actions/runs/${r.id}/jobs`,{headers:H}).then(x=>x.json());
for(const j of jobs.jobs){
  const log=await fetch(`https://api.github.com/repos/${REPO}/actions/jobs/${j.id}/logs`,{headers:H}).then(x=>x.text());
  const lines=log.split('\n').filter(l=>/growth-watch|CLOSURE|⚠|covenant|defect|Error|signal/i.test(l)&&!/^(remote|Resolving|Reusing)/.test(l));
  console.log(lines.slice(0,25).map(l=>l.replace(/^.*?Z /,'')).join('\n'));
}
