import fs from 'node:fs';
const TOKEN = fs.readFileSync('/home/z/.git-creds','utf8').match(/https:\/\/[^:]+:([^@]+)@github\.com/)[1];
const H = {Authorization:`Bearer ${TOKEN}`,'Accept':'application/vnd.github+json'};
const REPO='roshpinacare-sys/Autonomy';
// workflow census
let page=1, active=0, disabled=[];
for(;;){
  const j=await fetch(`https://api.github.com/repos/${REPO}/actions/workflows?per_page=100&page=${page}`,{headers:H}).then(x=>x.json());
  for(const w of (j.workflows||[])) if(w.path.startsWith('.github/workflows/')) w.state==='active'?active++:disabled.push(w.path);
  if(!(j.workflows||[]).length) break; page++; if(page>5) break;
}
console.log(`Autonomy census: active=${active} disabled=${disabled.length}${disabled.length?' '+disabled.join(','):''}`);
// growth receipt from origin
const g=await fetch(`https://raw.githubusercontent.com/${REPO}/main/receipts/growth/latest.json`,{headers:H}).then(x=>x.json());
console.log(`growth receipt: ok=${g.ok} signals=${(g.signals||[]).length} wf.active=${g.checks?.workflows?.active} live=${JSON.stringify(g.checks?.live)}`);
// builder receipt from origin (VM run)
const b=await fetch(`https://raw.githubusercontent.com/${REPO}/main/receipts/builder/latest.json`,{headers:H}).then(x=>x.json());
console.log(`builder receipt: ok=${b.ok} tasks=${(b.tasks||[]).join(',')} pushed=${b.ship?.pushed} liveVerified=${b.liveVerified} noop=${b.noop}`);
