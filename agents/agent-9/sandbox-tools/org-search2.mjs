import fs from 'fs';
const TOKEN = fs.readFileSync('/home/z/.git-creds','utf8').match(/https:\/\/[^:]+:([^@]+)@github\.com/)[1];
const H = {Authorization:`Bearer ${TOKEN}`,'Accept':'application/vnd.github+json'};
for(const q of ['org:roshpinacare-sys office3d filename:.yml','org:roshpinacare-sys "office3d" path:.github','org:roshpinacare-sys "fresh room bundle"']){
  const r=await fetch(`https://api.github.com/search/code?q=${encodeURIComponent(q)}&per_page=15`,{headers:H}).then(x=>x.json());
  console.log(`"${q}" → ${r.total_count}`);
  for(const it of (r.items||[]).slice(0,8)) console.log('  ', it.repository.full_name, it.path);
}
