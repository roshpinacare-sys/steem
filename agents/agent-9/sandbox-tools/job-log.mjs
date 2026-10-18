import fs from 'fs';
const TOKEN = fs.readFileSync('/home/z/.git-creds','utf8').match(/https:\/\/[^:]+:([^@]+)@github\.com/)[1];
const H = {Authorization:`Bearer ${TOKEN}`,'Accept':'application/vnd.github+json'};
const REPO='roshpinacare-sys/Autonomy';
const [wf,n]=process.argv.slice(2);
const d=await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${wf}/runs?per_page=10`,{headers:H}).then(x=>x.json());
const runs=(d.workflow_runs||[]).filter(r=>r.conclusion&&r.conclusion!=='success');
const run=runs[(parseInt(n)||1)-1];
console.log(`run #${run.run_number} ${run.conclusion} id=${run.id}`);
const j=await fetch(`https://api.github.com/repos/${REPO}/actions/runs/${run.id}/jobs?per_page=5`,{headers:H}).then(x=>x.json());
for(const job of (j.jobs||[])){
  if(job.conclusion==='success') continue;
  console.log(`--- job "${job.name}" id=${job.id} ${job.conclusion}`);
  const lr=await fetch(`https://api.github.com/repos/${REPO}/actions/jobs/${job.id}/logs`,{headers:H,redirect:'follow'});
  const log=await lr.text();
  const lines=log.split('\n').filter(l=>/leak-scan|אין|נחסם|✖|⊘|key-pointer|targets/i.test(l));
  console.log(lines.slice(-20).join('\n').replace(/[A-Za-z0-9_+\/=-]{40,}/g,'<REDACTED>'));
}
