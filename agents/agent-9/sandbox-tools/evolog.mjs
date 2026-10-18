import fs from 'fs';
const TOKEN = fs.readFileSync('/home/z/.git-creds','utf8').match(/https:\/\/[^:]+:([^@]+)@github\.com/)[1];
const H = {Authorization:`Bearer ${TOKEN}`,'Accept':'application/vnd.github+json'};
const d=await fetch('https://api.github.com/repos/roshpinacare-sys/Autonomy/actions/workflows/world-evolver.yml/runs?per_page=3',{headers:H}).then(x=>x.json());
const run=d.workflow_runs[0];
console.log('run', run.run_number, run.conclusion, run.id);
const j=await fetch(`https://api.github.com/repos/roshpinacare-sys/Autonomy/actions/runs/${run.id}/jobs?per_page=3`,{headers:H}).then(x=>x.json());
for(const job of (j.jobs||[])){
  console.log('job:', job.name, job.conclusion);
  for(const s of (job.steps||[])) console.log('  ', s.name.slice(0,50), '→', s.conclusion);
  const log=await fetch(`https://api.github.com/repos/roshpinacare-sys/Autonomy/actions/jobs/${job.id}/logs`,{headers:H}).then(x=>x.text()).catch(()=>'');
  const lines=log.split('\n').filter(l=>/world|clone|push|diff|unchanged|honest/i.test(l) && !/Get|Set|Download/i.test(l));
  console.log(lines.slice(-14).join('\n').replace(/[A-Za-z0-9_+\/=-]{45,}/g,'<TOK>'));
}
