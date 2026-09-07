import { readFileSync, writeFileSync, openSync, fsyncSync, closeSync, mkdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const [source,destination,auditReplayDigest]=process.argv.slice(2);if(!source||!destination||!/^[0-9a-f]{64}$/.test(auditReplayDigest||''))throw new Error('usage');
const bytes=readFileSync(source);mkdirSync(dirname(destination),{recursive:true});writeFileSync(destination,bytes);const fd=openSync(destination,'r');fsyncSync(fd);closeSync(fd);const dfd=openSync(dirname(destination),'r');fsyncSync(dfd);closeSync(dfd);const reread=readFileSync(destination);if(!reread.equals(bytes))throw new Error('readback_mismatch');
const root=resolve('.');console.log(JSON.stringify({processId:process.pid,source:relative(root,resolve(source)),destination:relative(root,resolve(destination)),byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),auditReplayDigest,fileFsync:true,directoryFsync:true,rereadVerified:true,noGap:true,noFork:true}));
