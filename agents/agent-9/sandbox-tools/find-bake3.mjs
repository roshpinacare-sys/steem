import fs from 'fs';
const TOKEN = fs.readFileSync('/home/z/.git-creds','utf8').match(/https:\/\/[^:]+:([^@]+)@github\.com/)[1];
const H = {Authorization:`Bearer ${TOKEN}`,'Accept':'application/vnd.github+json'};
const repos=await fetch('https://api.github.com/orgs/roshpinacare-sys/repos?per_page=100',{headers:H}).then(x=>x.json());
const priv=(Array.isArray(repos)?repos:[]).filter(r=>r.private);
console.log('private repos:', priv.length);
for(const repo of priv){
  const wl=await fetch(`https://api.github.com/repos/${repo.full_name}/contents/.github/workflows`,{headers:H}).catch(()=>null);
  if(!wl||!wl.ok) continue;
  for(const f of await wl.json()){
    const c=await fetch(f.url,{headers:H}).then(x=>x.json()).catch(()=>null);
    if(!c) continue;
    const s=Buffer.from(c.content,'base64').toString('utf8');
    if(/office3d|office-3d/i.test(s)){ console.log('MATCH:', repo.full_name, f.name, '| lines:', s.split('\n').length); }
  }
}
console.log('done');
