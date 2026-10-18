import fs from 'fs';
const TOKEN = fs.readFileSync('/home/z/.git-creds','utf8').match(/https:\/\/[^:]+:([^@]+)@github\.com/)[1];
const H = {Authorization:`Bearer ${TOKEN}`,'Accept':'application/vnd.github+json'};
const REPO='roshpinacare-sys/Autonomy';
// owner order 2026-10-17: activate — not close/shrink (public repo = 0 minutes)
const enable=['artery-defi','artery-desk','artery-wallet','claims-intake','estate-relay','estate-vault','fleet-heal','key-proof','sovereign-decider'];
for(const w of enable){
  const r=await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${w}.yml/enable`,{method:'PUT',headers:H});
  console.log(`${w}: ${r.status} ${r.status===204?'ENABLED':''}`);
}
// re-arm hive-probe schedule (toggle; it missed its daily slot while schedule was stale)
for(const [w,act] of [['hive-probe','disable'],['hive-probe','enable']]){
  const r=await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${w}.yml/${act}`,{method:'PUT',headers:H});
  console.log(`${w} ${act}: ${r.status}`);
}
// verify
const d=await fetch(`https://api.github.com/repos/${REPO}/actions/workflows?per_page=100`,{headers:H}).then(x=>x.json());
const dis=(d.workflows||[]).filter(w=>w.state!=='active').map(w=>w.path);
console.log(`now disabled: ${dis.length} ${JSON.stringify(dis)}`);
