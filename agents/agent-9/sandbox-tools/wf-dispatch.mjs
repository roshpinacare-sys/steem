import fs from 'fs';
const TOKEN = fs.readFileSync('/home/z/.git-creds','utf8').match(/https:\/\/[^:]+:([^@]+)@github\.com/)[1];
const H = {Authorization:`Bearer ${TOKEN}`,'Accept':'application/vnd.github+json'};
const REPO='roshpinacare-sys/Autonomy';
for(const w of process.argv.slice(2)){
  const m=await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${w}.yml`,{headers:H}).then(x=>x.json());
  const r=await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${m.id}/dispatches`,{method:'POST',headers:H,body:JSON.stringify({ref:'main'})});
  console.log(`${w}: dispatch=${r.status} ${r.status===204?'OK':''}`);
}
