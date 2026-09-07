import { readFileSync } from 'node:fs';
import { KeyRegistry, sha256 } from '../dist/src/contracts/crypto.js';
const value=JSON.parse(readFileSync(new URL('../release-evidence/v33.18/V33_18_DISTRIBUTED_LEASE_AUTHORITY_PROOF.json',import.meta.url),'utf8'));
const env=value.proofEnvelope.signedProof;const registry=new KeyRegistry();registry.registerExported(value.proofEnvelope.publicKey);
const{proofDigest,...material}=env.payload;
const valid=registry.verifyAt(env,'2026-07-21T23:20:00.000Z')&&sha256(material)===proofDigest&&env.payload.version==='33.18'&&env.payload.controllerProcessCount===2&&env.payload.raceWinnerCount===1&&env.payload.takeoverCount===12&&env.payload.staleFenceRejectionCount===12&&env.payload.partitionFailureObserved===true&&env.payload.rollbackRejectedByMonotonicWitness===true&&env.payload.finalFenceToken===13&&env.payload.productionAuthority==='NONE'&&env.payload.externalEffectsExecuted===0&&env.payload.productionPromotion==='blocked';
console.log(JSON.stringify({version:'33.18',valid,proofDigest},null,2));process.exit(valid?0:1);
