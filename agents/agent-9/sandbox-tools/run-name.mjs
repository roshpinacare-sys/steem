import fs from 'fs';
const TOKEN = fs.readFileSync('/home/z/.git-creds','utf8').match(/https:\/\/[^:]+:([^@]+)@github\.com/)[1];
const H = {Authorization:`Bearer ${TOKEN}`,'Accept':'application/vnd.github+json'};
const r=await fetch('https://api.github.com/repos/roshpinacare-sys/Domain/actions/runs/39079062588',{headers:H}).then(x=>x.json());
console.log('workflow:', r.name, '| path:', r.path, '| event:', r.event, '| head:', r.head_sha?.slice(0,7));
