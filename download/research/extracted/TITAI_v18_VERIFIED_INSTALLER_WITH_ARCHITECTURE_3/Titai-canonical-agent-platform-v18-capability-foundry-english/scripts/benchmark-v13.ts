import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { evaluatePilotRunFacts } from "@/lib/release/pilot-run-gates";
import { decideResourceAccess } from "@/lib/auth/authorization";
import { createDurableApprovalWait, resolveDurableApprovalWait } from "@/lib/durable/approval-continuation";

function percentile(values: number[], p: number) { const sorted = [...values].sort((a,b)=>a-b); return sorted[Math.min(sorted.length-1, Math.ceil(sorted.length*p)-1)] ?? 0; }
function measure(name: string, n: number, fn: () => void) { const values=[]; for(let i=0;i<n;i++){const s=performance.now();fn();values.push(performance.now()-s);} return {name,iterations:n,p50Ms:+percentile(values,.5).toFixed(4),p95Ms:+percentile(values,.95).toFixed(4),p99Ms:+percentile(values,.99).toFixed(4),maxMs:+Math.max(...values).toFixed(4)}; }
const hashFacts = { runStatus:"completed",tenantId:"tenant",workspaceId:"workspace",runnerMode:"durable_default",durableJobStatus:"completed",durableReceiptStatuses:["completed"],approvalStatuses:["approved"],artifactCount:1,acceptedVerificationCount:1,releaseHashBound:true,modelRoutingObserved:true,governedMemoryObserved:true,capabilityDecisionObserved:true };
const wait=createDurableApprovalWait({id:"a",jobId:"j",runId:"r",stepId:"s",toolCallId:"t",requestedBy:"agent",requestedAt:"2026-07-11T00:00:00Z",expiresAt:"2026-07-11T00:05:00Z"});
const results=[
 measure("pilot_readiness_11_gates",10000,()=>{evaluatePilotRunFacts(hashFacts)}),
 measure("tenant_authorization_decision",20000,()=>{decideResourceAccess({id:"u",role:"member",tenantId:"t",workspaceId:"w"},{ownerId:"u",tenantId:"t",workspaceId:"w",visibility:"private"},"read")}),
 measure("approval_compare_and_set",10000,()=>{resolveDurableApprovalWait(wait,{decision:"approved",actorId:"u",expectedRevision:0,now:new Date("2026-07-11T00:01:00Z")})}),
];
const report={schemaVersion:1,generatedAt:new Date().toISOString(),environment:{node:process.version,platform:process.platform,arch:process.arch},disclaimer:"Deterministic local microbenchmarks. They exclude database, browser, model, network, and production workload latency.",results};
const out=path.join(process.cwd(),"docs/canonical/evidence/v13");fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,"performance-microbenchmarks.json"),JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
