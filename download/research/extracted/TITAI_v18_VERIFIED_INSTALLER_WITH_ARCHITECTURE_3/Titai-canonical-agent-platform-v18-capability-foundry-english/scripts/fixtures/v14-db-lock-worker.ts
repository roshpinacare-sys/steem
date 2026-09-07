import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const [action,databasePath,signalPath,holdRaw]=process.argv.slice(2); if(!action||!databasePath) throw new Error('missing_args');
const db=new DatabaseSync(databasePath); db.exec('PRAGMA busy_timeout=2000');
try{
 if(action==='hold'){
  db.exec('BEGIN IMMEDIATE'); db.prepare("INSERT INTO lock_probe(value) VALUES ('holder')").run(); if(signalPath) writeFileSync(signalPath,'locked\n'); await new Promise(r=>setTimeout(r,Number(holdRaw??500))); db.exec('COMMIT'); console.log(JSON.stringify({ok:true,action}));
 }else if(action==='write'){
  const started=performance.now(); db.prepare("INSERT INTO lock_probe(value) VALUES ('contender')").run(); console.log(JSON.stringify({ok:true,action,waitMs:Math.round(performance.now()-started)}));
 }else throw new Error('unsupported');
}catch(error){try{db.exec('ROLLBACK')}catch{} console.log(JSON.stringify({ok:false,error:error instanceof Error?error.message:String(error)}));process.exitCode=2;}finally{db.close();}
