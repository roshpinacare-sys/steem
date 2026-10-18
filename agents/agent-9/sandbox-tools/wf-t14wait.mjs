import fs from 'node:fs';
const TOKEN = fs.readFileSync('/home/z/.git-creds','utf8').match(/https:\/\/[^:]+:([^@]+)@github\.com/)[1];
const H = {Authorization:`Bearer ${TOKEN}`,'Accept':'application/vnd.github+json'};
const REPO='roshpinacare-sys/Autonomy';
for(const w of ['artery-pacer','artery-treasury','artery-growth','artery-builder']){
  const j=await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${w}.yml/runs?per_page=1`,{headers:H}).then(x=>x.json());
  const r=(j.workflow_runs||[])[0]||{};
  console.log(`${w}: #${r.run_number} ${r.status} ${r.conclusion??''} (${(r.created_at||'').slice(11,19)}Z)`);
}
// treasury forensics measured?
const fx=await fetch(`https://raw.githubusercontent.com/${REPO}/main/receipts/treasury/latest.json`).then(x=>x.json());
console.log('treasury: SP='+fx.treasurySp, 'healthy='+fx.healthy, 'flow48h.ok='+fx.flow48h?.ok, 'outEvents='+fx.flow48h?.outEvents, 'inEvents='+fx.flow48h?.inEvents);
if(fx.flow48h?.events?.length) fx.flow48h.events.slice(0,5).forEach(e=>console.log(' ', e.ts, e.op, e.dir, e.counterparty, String(e.vests).slice(0,24)));
