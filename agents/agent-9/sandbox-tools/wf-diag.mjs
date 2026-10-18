import fs from 'fs';
const TOKEN = fs.readFileSync('/home/z/.git-creds','utf8').match(/https:\/\/[^:]+:([^@]+)@github\.com/)[1];
const H = {Authorization:`Bearer ${TOKEN}`,'Accept':'application/vnd.github+json'};
const REPO='roshpinacare-sys/Autonomy';
const targets=process.argv.slice(2);
for (const wf of targets){
  const r=await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${wf}/runs?per_page=5`,{headers:H});
  const d=await r.json();
  console.log(`\n=== ${wf} (total ${d.total_count}) ===`);
  for(const run of (d.workflow_runs||[]).slice(0,4)){
    console.log(`  #${run.run_number} ${run.conclusion||run.status} ${run.created_at}`);
    if(run.conclusion && run.conclusion!=='success'){
      const j=await fetch(`https://api.github.com/repos/${REPO}/actions/runs/${run.id}/jobs?per_page=3`,{headers:H}).then(x=>x.json());
      for(const job of (j.jobs||[]).slice(0,2)){
        const step=(job.steps||[]).find(s=>s.conclusion && s.conclusion!=='success' && s.conclusion!=='skipped');
        console.log(`     job="${job.name}" concl=${job.conclusion} failStep="${step?step.name:'-'}"`);
      }
    }
  }
}
