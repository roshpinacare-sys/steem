import fs from 'fs';
const TOKEN = fs.readFileSync('/home/z/.git-creds','utf8').match(/https:\/\/[^:]+:([^@]+)@github\.com/)[1];
const H = {Authorization:`Bearer ${TOKEN}`,'Accept':'application/vnd.github+json'};
const r=await fetch('https://api.github.com/repos/roshpinacare-sys/Autonomy/actions/workflows?per_page=100',{headers:H});
const d=await r.json();
const dis=(d.workflows||[]).filter(w=>w.state!=='active');
console.log(`total=${d.total_count} disabled=${dis.length}`);
for(const w of dis) console.log(`  DISABLED: ${w.path} name="${w.name}" id=${w.id}`);
