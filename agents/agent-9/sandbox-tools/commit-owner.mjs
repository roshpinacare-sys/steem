import fs from 'fs';
const TOKEN = fs.readFileSync('/home/z/.git-creds','utf8').match(/https:\/\/[^:]+:([^@]+)@github\.com/)[1];
const H = {Authorization:`Bearer ${TOKEN}`,'Accept':'application/vnd.github+json'};
const sha='577645e4e759ec6f2eb1f0101b2b80a0f97d83a0';
const r=await fetch(`https://api.github.com/repos/roshpinacare-sys/Domain/commits/${sha}/check-runs`,{headers:H}).then(x=>x.json());
for(const c of (r.check_runs||[])) console.log('check-run:', c.name, '| app:', c.app?.slug, '| url:', c.details_url);
