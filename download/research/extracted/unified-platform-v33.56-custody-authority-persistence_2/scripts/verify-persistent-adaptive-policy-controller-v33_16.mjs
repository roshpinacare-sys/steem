import { readFileSync } from 'node:fs';
import { KeyRegistry, sha256 } from '../dist/src/contracts/crypto.js';
const doc=JSON.parse(readFileSync('release-evidence/v33.16/V33_16_PERSISTENT_ADAPTIVE_POLICY_CONTROLLER_PROOF.json','utf8'));
const {proofEnvelope,...proof}=doc;const {proofDigest,...material}=proof;const keys=new KeyRegistry();keys.registerExported(proofEnvelope.publicKey);
const valid=sha256(material)===proofDigest&&proofEnvelope.signedProof.payload.proofDigest===proofDigest&&sha256(proofEnvelope.signedProof.payload)===sha256(proof)&&keys.verifyAt(proofEnvelope.signedProof,'2026-07-21T20:30:00.000Z');
console.log(JSON.stringify({version:'33.16',valid,signer:proofEnvelope.signedProof.issuerKeyId,proofDigest},null,2));if(!valid)process.exit(1);
