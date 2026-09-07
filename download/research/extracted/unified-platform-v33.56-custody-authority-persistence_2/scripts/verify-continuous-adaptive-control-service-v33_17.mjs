import { readFileSync } from 'node:fs';
import { KeyRegistry, sha256 } from '../dist/src/contracts/crypto.js';
const path=new URL('../release-evidence/v33.17/V33_17_CONTINUOUS_ADAPTIVE_CONTROL_SERVICE_PROOF.json',import.meta.url);
const value=JSON.parse(readFileSync(path,'utf8')); const env=value.proofEnvelope.signedProof; const registry=new KeyRegistry(); registry.registerExported(value.proofEnvelope.publicKey);
const {proofDigest,...material}=env.payload; const valid=registry.verifyAt(env,env.payload.version==='33.17'?'2026-07-21T22:30:00.000Z':new Date().toISOString())&&sha256(material)===proofDigest&&env.payload.externalEffectsExecuted===0&&env.payload.productionPromotion==='blocked';
console.log(JSON.stringify({version:'33.17',valid,proofDigest},null,2)); process.exit(valid?0:1);
