import fs from 'fs';
const TOKEN = fs.readFileSync('/home/z/.git-creds','utf8').match(/https:\/\/[^:]+:([^@]+)@github\.com/)[1];
const H = {Authorization:`Bearer ${TOKEN}`,'Accept':'application/vnd.github+json'};
const repos=await fetch('https://api.github.com/orgs/roshpinacare-sys/repos?per_page=100',{headers:H}).then(x=>x.json());
const list=Array.isArray(repos)?repos:[];
for(const repo of list){
  const r=await fetch(`https://api.github.com/repos/${repo.full_name}/actions/runs?created=2026-10-17T23:15:00Z..2026-10-17T23:45:00Z&per_page=10`,{headers:H}).then(x=>x.json());
  for(const run of (r.workflow_runs||[])) console.log(repo.full_name, '|', run.name, '|', run.conclusion, '|', run.created_at.slice(11,16));
}
