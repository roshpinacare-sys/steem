import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { KeyRegistry, sha256 } from '../dist/src/contracts/crypto.js';
import { verifyControlledHumanUxPilotVerdictV33_30 } from '../dist/src/app/controlled-human-ux-pilot-v33_30.js';
const root=resolve('.'); const read=(name)=>JSON.parse(readFileSync(resolve(root,'release-evidence/v33.30',name),'utf8'));
const keys=read('V33_30_PROOF_PUBLIC_KEYS.json'); const registries=new Map();
for(const row of keys){const r=new KeyRegistry();r.registerExported(row);registries.set(row.role,r);}
const protocol=read('V33_30_UX_PILOT_PROTOCOL.json'); const verdict=read('V33_30_SYNTHETIC_UX_VERDICT.json'); const continuity=read('V33_30_METRIC_CONTINUITY_RECEIPT.json'); const proof=read('V33_30_CONTROLLED_HUMAN_UX_PILOT_PROOF.json');
const vr=registries.get('verifier');verifyControlledHumanUxPilotVerdictV33_30({verdict,verifierRegistry:vr,trustedVerifierIds:[verdict.issuerKeyId],expectedProtocolDigest:protocol.payload.protocolDigest});
for(const [envelope,role,digestField] of [[continuity,'continuity','continuityDigest'],[proof,'proof','proofDigest']]){const r=registries.get(role);if(!r.verifyAt(envelope,envelope.payload.generatedAt??'2026-07-22T11:00:00.000Z'))throw new Error(`${role}_signature_invalid`);const {[digestField]:digest,...material}=envelope.payload;if(digest!==sha256(material))throw new Error(`${role}_digest_invalid`);}
if(verdict.payload.evidenceClass!=='SIMULATED_CONTRACT_TEST'||verdict.payload.humanPilotPassed||verdict.payload.status!=='HUMAN_UX_PILOT_REQUIRED')throw new Error('synthetic_boundary_invalid');
if(proof.payload.externalHumanParticipants!==0||proof.payload.humanPilotPassed||proof.payload.productionPromotion!=='blocked'||proof.payload.externalEffectsExecuted!==0)throw new Error('proof_boundary_invalid');
if(continuity.payload.metricInventoryCount!==54||continuity.payload.parameterCount!==14||Object.values(continuity.payload.externalProgress).some(v=>v!==0))throw new Error('metric_continuity_invalid');
console.log(JSON.stringify({status:'passed',syntheticVerdict:verdict.payload.status,humanPilotPassed:false,metrics:proof.payload.syntheticMetrics,externalHumanParticipants:0,metricInventoryCount:54,parameterCount:14,productionPromotion:'blocked'},null,2));
