import fs from 'fs';
const TOKEN = fs.readFileSync('/home/z/.git-creds','utf8').match(/https:\/\/[^:]+:([^@]+)@github\.com/)[1];
const H = {Authorization:`Bearer ${TOKEN}`,'Accept':'application/vnd.github+json'};
const q=encodeURIComponent('org:roshpinacare-sys "office-3d bake"');
const r=await fetch(`https://api.github.com/search/code?q=${q}&per_page=20`,{headers:H}).then(x=>x.json());
console.log('total:',r.total_count);
for(const it of (r.items||[]).slice(0,10)) console.log(' ', it.repository.full_name, it.path);
