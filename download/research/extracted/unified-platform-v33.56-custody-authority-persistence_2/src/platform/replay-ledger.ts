import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { canonicalJson, sha256 } from '../contracts/crypto.js';
import type { ReplayConsumption, ReplayLedger } from '../contracts/replay.js';
export type { ReplayConsumption, ReplayLedger } from '../contracts/replay.js';
export class InMemoryReplayLedger implements ReplayLedger{readonly #consumed=new Set<string>();tryConsume(input:ReplayConsumption){validateConsumption(input);if(this.#consumed.has(input.replayKey))return false;this.#consumed.add(input.replayKey);return true;}has(key:string){validateReplayKey(key);return this.#consumed.has(key);}}
export class FileReplayLedger implements ReplayLedger{
 readonly #root:string; constructor(root:string){if(root.trim()==='')throw new Error('replay_ledger_root_required');this.#root=resolve(root);mkdirSync(this.#root,{recursive:true,mode:0o700});fsyncDirectory(this.#root);}
 tryConsume(input:ReplayConsumption):boolean{validateConsumption(input);const directory=this.#entryDirectory(input.replayKey);try{mkdirSync(directory,{mode:0o700});}catch(error){if(isAlreadyExists(error))return false;throw error;}fsyncDirectory(this.#root);const record={version:1,replayKeyDigest:sha256({domain:'evidence-replay-ledger-v1',replayKey:input.replayKey}),tenantRef:sha256({tenantId:input.tenantId}).slice(0,24),subjectRef:sha256({subjectId:input.subjectId}).slice(0,24),evidenceRoot:input.evidenceRoot,consumedAt:input.consumedAt,...(input.consumerId===undefined?{}:{consumerRef:sha256({consumerId:input.consumerId}).slice(0,24)})};const path=join(directory,'consumption.json');const fd=openSync(path,'wx',0o600);try{writeFileSync(fd,`${canonicalJson(record)}\n`,'utf8');fsyncSync(fd);}finally{closeSync(fd);}fsyncDirectory(directory);return true;}
 has(key:string){validateReplayKey(key);return existsSync(this.#entryDirectory(key));}
 read(key:string):unknown{validateReplayKey(key);const path=join(this.#entryDirectory(key),'consumption.json');if(!existsSync(path))return this.has(key)?{status:'consumed-metadata-incomplete'}:null;return JSON.parse(readFileSync(path,'utf8'));}
 #entryDirectory(key:string){return join(this.#root,sha256({domain:'evidence-replay-ledger-v1',replayKey:key}));}
}
function validateConsumption(input:ReplayConsumption){validateReplayKey(input.replayKey);if(input.tenantId.trim()===''||input.subjectId.trim()===''||!/^[a-f0-9]{64}$/.test(input.evidenceRoot))throw new Error('replay_consumption_identity_invalid');if(!Number.isFinite(Date.parse(input.consumedAt)))throw new Error('replay_consumption_time_invalid');if(input.consumerId!==undefined&&input.consumerId.trim()==='')throw new Error('replay_consumer_invalid');}
function validateReplayKey(key:string){if(key.trim()===''||key.length>1024)throw new Error('replay_key_invalid');}
function fsyncDirectory(path:string){const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
function isAlreadyExists(error:unknown):boolean{return error instanceof Error&&'code'in error&&(error as NodeJS.ErrnoException).code==='EEXIST';}
