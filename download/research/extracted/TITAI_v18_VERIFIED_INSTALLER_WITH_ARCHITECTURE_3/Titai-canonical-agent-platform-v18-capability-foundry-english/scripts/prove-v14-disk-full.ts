import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const root=mkdtempSync(join(tmpdir(),"titai-v14-disk-full-")); const path=join(root,"quota.sqlite");
try{
 const db=new DatabaseSync(path); db.exec("PRAGMA journal_mode=DELETE; CREATE TABLE artifacts(id INTEGER PRIMARY KEY, content BLOB NOT NULL);");
 const pages=Number((db.prepare("PRAGMA page_count").get() as {page_count:number|bigint}).page_count); db.exec(`PRAGMA max_page_count=${pages+1}`);
 let error=""; try{db.exec("BEGIN IMMEDIATE");db.prepare("INSERT INTO artifacts(content) VALUES (?)").run(Buffer.alloc(1024*1024));db.exec("COMMIT");}catch(e){error=e instanceof Error?e.message:String(e);try{db.exec("ROLLBACK")}catch{}}
 const count=Number((db.prepare("SELECT COUNT(*) AS n FROM artifacts").get() as {n:number|bigint}).n); db.close();
 if(!/full/i.test(error)||count!==0)throw new Error(`disk_full_not_atomic:${JSON.stringify({error,count})}`);
 const report={schemaVersion:1,generatedAt:new Date().toISOString(),passed:true,error,rowCountAfterRollback:count,pageBudget:pages+1};const out=resolve("docs/canonical/evidence/v14");mkdirSync(out,{recursive:true});writeFileSync(join(out,"disk-full-proof.json"),JSON.stringify(report,null,2)+"\n");console.log("v14 disk-full proof passed: SQLITE_FULL was explicit and the transaction left zero partial artifacts.");
}finally{rmSync(root,{recursive:true,force:true});}
