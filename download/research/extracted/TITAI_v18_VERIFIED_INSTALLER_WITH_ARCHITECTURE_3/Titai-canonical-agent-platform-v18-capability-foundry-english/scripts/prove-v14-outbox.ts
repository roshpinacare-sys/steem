import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openSQLite } from "../src/lib/db/sqlite-client";
import { applyCanonicalMigrations } from "../src/lib/db/migrations";
interface Result { ok: boolean; action: string; messages?: Array<{id:number; idempotencyKey:string}>; published?: boolean; error?: string }
const root=mkdtempSync(join(tmpdir(),"titai-v14-outbox-")); const databasePath=join(root,"outbox.sqlite"); const barrier=join(root,"barrier");
const sqlite=openSQLite(databasePath,{driver:"node:sqlite"}); applyCanonicalMigrations({client:sqlite,migrationsFolder:resolve("drizzle")});
sqlite.prepare(`INSERT INTO durable_outbox (idempotency_key,aggregate_type,aggregate_id,type,payload,status,attempts,available_at,lease_owner,lease_token,lease_expires_at,last_error,created_at,published_at) VALUES (?,?,?,?,?,'pending',0,?,NULL,0,NULL,NULL,?,NULL)`).run("v14-outbox-key","run","run-v14","run.completed",JSON.stringify({runId:"run-v14"}),Date.parse("2026-07-11T12:59:00Z"),Date.parse("2026-07-11T12:59:00Z")); sqlite.close();
const tsx=resolve("node_modules/tsx/dist/cli.mjs"), workerFile=resolve("scripts/fixtures/v14-outbox-process-worker.ts");
function child(args:string[]):Promise<Result>{return new Promise((res,rej)=>{const p=spawn(process.execPath,[tsx,"--tsconfig","tsconfig.scripts.json",workerFile,...args],{cwd:process.cwd(),env:{...process.env,NODE_NO_WARNINGS:"1"},stdio:["ignore","pipe","pipe"]});let o="",e="";p.stdout.on("data",d=>o+=d);p.stderr.on("data",d=>e+=d);p.on("exit",()=>{const line=o.trim().split(/\r?\n/).filter(Boolean).at(-1);if(!line)return rej(new Error(`no_output:${e}`));try{res(JSON.parse(line));}catch{rej(new Error(`bad_output:${o}:${e}`));}});});}
try{
 writeFileSync(barrier,"wait\n"); const a=child(["claim",databasePath,"publisher-a","0",barrier]); const b=child(["claim",databasePath,"publisher-b","0",barrier]); await new Promise(r=>setTimeout(r,100)); writeFileSync(barrier,"go\n"); const [ra,rb]=await Promise.all([a,b]);
 const total=(ra.messages?.length??0)+(rb.messages?.length??0); if(total!==1) throw new Error(`outbox_duplicate_claim:${JSON.stringify({ra,rb})}`);
 const winner=ra.messages?.length?"publisher-a":"publisher-b"; const loser=winner==="publisher-a"?"publisher-b":"publisher-a"; const id=(ra.messages?.[0]??rb.messages?.[0])!.id;
 const publish=await child(["publish",databasePath,winner,String(id)]); const duplicate=await child(["publish",databasePath,loser,String(id)]);
 if(!publish.published||duplicate.published) throw new Error(`outbox_publish_idempotency_failed:${JSON.stringify({publish,duplicate})}`);
 const report={schemaVersion:1,generatedAt:new Date().toISOString(),passed:true,claimers:{ra,rb},winner,publish,duplicate}; const out=resolve("docs/canonical/evidence/v14");mkdirSync(out,{recursive:true});writeFileSync(join(out,"multiprocess-outbox-proof.json"),JSON.stringify(report,null,2)+"\n");
 console.log("v14 outbox proof passed: exactly one process claimed and only the lease owner published.");
}finally{rmSync(root,{recursive:true,force:true});}
