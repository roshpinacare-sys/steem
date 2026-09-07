import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { openOrCreatePrivatePilotContext } from '../dist/src/app/private-pilot-context.js';
import { WorkflowService } from '../dist/src/web/workflow-service.js';

const iterations=Number.parseInt(process.env.V20_BENCHMARK_ITERATIONS??'5',10); const samples=[];
for(let i=0;i<iterations;i+=1){
 const root=mkdtempSync(join(tmpdir(),'v20-benchmark-')); const now=new Date('2026-07-17T12:00:00.000Z');
 const bootstrapStart=performance.now(); const context=openOrCreatePrivatePilotContext(join(root,'pilot'),'benchmark private keystore passphrase',now); const bootstrapMs=performance.now()-bootstrapStart;
 const service=new WorkflowService(join(root,'workflow'),now,[],{tenantId:'tenant-1',subjectId:'operator-1',builderId:'operator-1',passportSigner:context.passportSigner,keyRegistry:context.keyRegistry,repositoryTrust:'trusted-fixture',now:()=>now}); const fixture=service.fixture();
 const start=performance.now(); const intake=await service.intake({sourceRepository:fixture.repositoryPath,objective:fixture.objective,targetFile:fixture.targetFile,allowedFiles:fixture.allowedFiles,exactBefore:fixture.exactBefore,exactAfter:fixture.exactAfter,testCommand:fixture.testCommand,planId:`v20-bench-${i}`,idempotencyKey:`v20-bench-${i}`}); const intakeMs=performance.now()-start;
 const executeStart=performance.now(); const execution=await service.execute(String(intake.sessionId)); const executeMs=performance.now()-executeStart;
 const reviewStart=performance.now(); service.review(String(intake.sessionId),'reviewer-1'); service.rollback(String(intake.sessionId)); const reviewRollbackMs=performance.now()-reviewStart;
 samples.push({bootstrapMs,intakeMs,executeMs,reviewRollbackMs,totalMs:performance.now()-bootstrapStart,testsPassed:execution.testExecution?.passed===true});
}
function p(values,q){const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.max(0,Math.ceil(q*sorted.length)-1))]}
const totals=samples.map(s=>s.totalMs); const report={version:'20.0',status:'local-development-benchmark-only',iterations,allTestsPassed:samples.every(s=>s.testsPassed),milliseconds:{min:Math.min(...totals),median:p(totals,.5),p95:p(totals,.95),max:Math.max(...totals)},environment:{node:process.version,storage:'local-filesystem-encrypted-keystore-and-git',database:'SQLite/local proof only'},limitations:['single-host','small-disposable-repository','not-load-capacity-or-multi-user-test','not-production-SLO-evidence'],samples};
const output=resolve('evidence/generated/v20-local-performance.json');mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
