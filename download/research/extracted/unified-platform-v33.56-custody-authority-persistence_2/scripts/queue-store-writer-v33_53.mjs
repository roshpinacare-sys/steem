import { readFileSync, writeFileSync, openSync, fsyncSync, closeSync, mkdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const [source, initialDestination, postDestination, storeId] = process.argv.slice(2);
if (!source || !initialDestination || !postDestination || !storeId) throw new Error('usage: source initialDestination postDestination storeId');
const bytes=readFileSync(source);const digest=createHash('sha256').update(bytes).digest('hex');
for(const destination of [initialDestination,postDestination]){mkdirSync(dirname(destination),{recursive:true});writeFileSync(destination,bytes);const fd=openSync(destination,'r');fsyncSync(fd);closeSync(fd);const dfd=openSync(dirname(destination),'r');fsyncSync(dfd);closeSync(dfd);const reread=readFileSync(destination);if(!reread.equals(bytes))throw new Error('readback_mismatch');}
const root=resolve('.');console.log(JSON.stringify({storeId,processId:process.pid,source:relative(root,resolve(source)),initialDestination:relative(root,resolve(initialDestination)),postDestination:relative(root,resolve(postDestination)),byteLength:bytes.length,sha256:digest,fileFsync:true,directoryFsync:true,rereadVerified:true}));
