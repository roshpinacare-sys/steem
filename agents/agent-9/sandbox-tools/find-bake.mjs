import fs from 'fs';
const TOKEN = fs.readFileSync('/home/z/.git-creds','utf8').match(/https:\/\/[^:]+:([^@]+)@github\.com/)[1];
const H = {Authorization:`Bearer ${TOKEN}`,'Accept':'application/vnd.github+json'};
const repos=await fetch('https://api.github.com/orgs/roshpinacare-sys/repos?per_page=100&type=public',{headers:H}).then(x=>x.json());
for(const repo of (Array.isArray(repos)?repos:repos.repositories||[])){
  const r=await fetch(`https://api.github.com/repos/${repo.full_name}/contents/.github/workflows`,{headers:H});
  if(!r.ok) continue;
  for(const f of await r.json()){
    if(!/office|3d|bake|room/i.test(f.name)) continue;
    const c=await fetch(f.url,{headers:H}).then(x=>x.json());
    const s=Buffer.from(c.content,'base64').toString('utf8');
    if(/office-3d bake|office3d|Domain\/office3d/i.test(s)) console.log('MATCH:', repo.full_name, f.name);
  }
}
console.log('scan done');
