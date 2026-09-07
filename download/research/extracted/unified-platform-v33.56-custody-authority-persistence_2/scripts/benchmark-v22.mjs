import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const iterations=Number.parseInt(process.env.V22_BENCHMARK_ITERATIONS??'7',10);
const samples=[];
for(let index=0;index<iterations;index+=1){
 const started=performance.now();
 const result=spawnSync(process.execPath,['dist/src/cli/demo-v22.js'],{encoding:'utf8',maxBuffer:8*1024*1024,env:{...process.env,NODE_ENV:'benchmark'}});
 const durationMs=performance.now()-started;
 let payload=null; try{payload=JSON.parse(result.stdout)}catch{}
 samples.push({iteration:index+1,durationMs,exitCode:result.status,parsed:payload!==null,evidenceCompleteness:payload?.evidenceCompleteness?.status,offlineVerified:payload?.offlineVerification?.ok,restoredTrust:payload?.incidentToRecertification?.restoredStatus,structuralReductionPercent:payload?.decisionBrief?.structuralReductionPercent});
}
const values=samples.map((sample)=>sample.durationMs).sort((a,b)=>a-b); const percentile=(q)=>values[Math.min(values.length-1,Math.ceil(q*values.length)-1)];
const report={version:'22.0',status:samples.every((sample)=>sample.exitCode===0&&sample.parsed&&sample.evidenceCompleteness==='PASS'&&sample.offlineVerified&&sample.restoredTrust==='TRUSTED')?'passed':'failed',classification:'local-development-benchmark-only',iterations,milliseconds:{min:values[0],median:percentile(.5),p95:percentile(.95),max:values.at(-1)},valueSignals:{decisionBriefStructuralReductionProxyPercent:samples[0]?.structuralReductionPercent,limitation:'Structural information-count proxy, not measured human time or usability evidence.'},environment:{node:process.version,host:'single local process'},limitations:['Not a load test','No PostgreSQL','No qualified untrusted-code isolation','No human workflow timing'],samples};
const output=resolve('evidence/generated/v22-local-efficiency.json'); mkdirSync(dirname(output),{recursive:true}); writeFileSync(output,JSON.stringify(report,null,2)+'\n'); console.log(JSON.stringify(report,null,2)); if(report.status!=='passed')process.exit(1);
