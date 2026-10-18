import fs from 'node:fs';
const TOKEN = fs.readFileSync('/home/z/.git-creds','utf8').match(/https:\/\/[^:]+:([^@]+)@github\.com/)[1];
const H = {Authorization:`Bearer ${TOKEN}`,'Accept':'application/vnd.github+json'};
const REPO='roshpinacare-sys/Autonomy';
for(const w of ['artery-pacer','artery-treasury','artery-growth']){
  const e=await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${w}.yml/enable`,{method:'PUT',headers:H});
  const m=await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${w}.yml`,{headers:H}).then(x=>x.json());
  const d=await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${m.id}/dispatches`,{method:'POST',headers:H,body:JSON.stringify({ref:'main'})});
  const s=await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${w}.yml`,{headers:H}).then(x=>x.json());
  console.log(`${w}: enable=${e.status} dispatch=${d.status} state=${s.state}`);
}
