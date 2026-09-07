import { createPrivateKey, createPublicKey } from 'node:crypto';
import { createSignedJournalEntryV33_46 } from '../dist/src/supply-chain/durable-transaction-coordinator-v33_46.js';
const chunks=[];for await(const c of process.stdin)chunks.push(c);const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
const identity={keyId:input.keyId,privateKey:createPrivateKey({key:Buffer.from(input.privateKeyPkcs8,'base64'),type:'pkcs8',format:'der'}),publicKey:createPublicKey({key:Buffer.from(input.publicKeySpki,'base64'),type:'spki',format:'der'})};
const entries=[];let predecessor=input.entries[0]?.predecessorEntryDigest??null;for(const row of input.entries){const entry=createSignedJournalEntryV33_46({...row,predecessorEntryDigest:predecessor,signer:identity,eventTime:new Date(row.eventTime)});entries.push(entry);predecessor=entry.payload.entryDigest;}
process.stdout.write(JSON.stringify({pid:process.pid,term:input.term,entries}));
