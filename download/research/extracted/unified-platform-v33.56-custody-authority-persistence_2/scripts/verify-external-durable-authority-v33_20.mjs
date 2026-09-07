import { readFileSync } from 'node:fs';
import { KeyRegistry, sha256 } from '../dist/src/contracts/crypto.js';
const proof=JSON.parse(readFileSync(new URL('../release-evidence/v33.20/V33_20_EXTERNAL_DURABLE_AUTHORITY_PROOF.json',import.meta.url),'utf8'));
const trace=JSON.parse(readFileSync(new URL('../release-evidence/v33.20/V33_20_DURABLE_AUTHORITY_TRACE.json',import.meta.url),'utf8'));
const challenge=JSON.parse(readFileSync(new URL('../release-evidence/v33.20/V33_20_EXTERNAL_QUALIFICATION_CHALLENGE.json',import.meta.url),'utf8'));
const envelope=proof.proofEnvelope?.signedProof;const key=proof.proofEnvelope?.publicKey;
if(!envelope||!key)throw new Error('proof_envelope_missing');
const registry=new KeyRegistry();registry.registerExported(key);
if(!registry.verifyAt(envelope,new Date()))throw new Error('proof_signature_invalid');
const {proofDigest,...material}=envelope.payload;if(sha256(material)!==proofDigest)throw new Error('proof_digest_invalid');
if(envelope.payload.version!=='33.20'||envelope.payload.status!=='EXTERNAL_DURABLE_AUTHORITY_REFERENCE_PROVEN_LOCALLY'||envelope.payload.evidenceClass!=='LOCAL_SUPERVISORD_TWO_DAEMON_SQLITE_WAL_REFERENCE'||envelope.payload.managedAuthorityDaemonCount!==2||envelope.payload.serviceManager!=='SUPERVISORD'||envelope.payload.controllerRaceSingleWinner!==true||envelope.payload.fenceBeforeRestart!==1||envelope.payload.fenceAfterRestart!==2||envelope.payload.oldIdentityRejectedAfterRotation!==true||envelope.payload.authorityIntegrityVerified!==true||envelope.payload.externalQualificationAccepted!==false||envelope.payload.externalEffectsExecuted!==0||envelope.payload.productionAuthority!=='NONE'||envelope.payload.productionPromotion!=='blocked')throw new Error('proof_boundary_invalid');
const traceRegistry=new KeyRegistry();traceRegistry.registerExported(trace.observerPublicKey);
for(const event of trace.events){if(!traceRegistry.verifyAt(event,event.payload.observedAt))throw new Error('lifecycle_signature_invalid');const {receiptDigest,...eventMaterial}=event.payload;if(sha256(eventMaterial)!==receiptDigest)throw new Error('lifecycle_digest_invalid');if(event.payload.productionAuthority!=='NONE'||event.payload.externalEffectsExecuted!==0)throw new Error('lifecycle_boundary_invalid');}
const {traceDigest,...traceMaterial}=trace;if(sha256(traceMaterial)!==traceDigest)throw new Error('trace_digest_invalid');
const {challengeDigest,...challengeMaterial}=challenge;if(sha256(challengeMaterial)!==challengeDigest||challenge.syntheticOrSingleHostEvidenceAccepted!==false||challenge.requiredIndependentHosts!==2||challenge.productionAuthority!=='NONE')throw new Error('challenge_invalid');
console.log(JSON.stringify({status:'passed',version:'33.20',proofDigest,traceDigest,challengeDigest,lifecycleReceipts:trace.events.length},null,2));
