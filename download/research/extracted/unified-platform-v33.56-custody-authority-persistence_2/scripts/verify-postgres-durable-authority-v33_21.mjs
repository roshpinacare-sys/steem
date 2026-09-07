import { readFileSync } from 'node:fs';
import { KeyRegistry, sha256 } from '../dist/src/contracts/crypto.js';
import { verifyPostgresMigrationChainV33_21 } from '../dist/src/app/postgres-durable-authority-v33_21.js';
const base='release-evidence/v33.21';
const load=(name)=>JSON.parse(readFileSync(`${base}/${name}`,'utf8'));
const keys=load('V33_21_PROOF_PUBLIC_KEYS.json');const registry=new KeyRegistry();for(const key of keys.keys)registry.registerExported(key);
const proof=load('V33_21_POSTGRES_DURABLE_AUTHORITY_PROOF.json');const trace=load('V33_21_POSTGRES_ADAPTER_TRACE.json');const challenge=load('V33_21_EXTERNAL_QUALIFICATION_CHALLENGE.json');const observations=load('V33_21_SYNTHETIC_OPERATOR_OBSERVATIONS.json');const verdict=load('V33_21_POSTGRES_QUALIFICATION_VERDICT.json');const migrationManifest=load('V33_21_POSTGRES_MIGRATION_MANIFEST.json');const kit=load('V33_21_POSTGRES_OPERATOR_KIT_MANIFEST.json');
const errors=[];
for(const envelope of [proof,trace,challenge,verdict,...observations])if(!registry.verify(envelope))errors.push(`signature_invalid:${envelope.issuerKeyId}`);
const pd=proof.payload;const {proofDigest,...proofMaterial}=pd;if(sha256(proofMaterial)!==proofDigest)errors.push('proof_digest_invalid');
const td=trace.payload;const {traceDigest,...traceMaterial}=td;if(sha256(traceMaterial)!==traceDigest)errors.push('trace_digest_invalid');
if(pd.status!=='POSTGRES_DURABLE_AUTHORITY_ADAPTER_AND_OPERATOR_KIT_PROVEN_LOCALLY'||pd.evidenceClass!=='LOCAL_POSTGRESQL_CONTRACT_AND_EXTERNAL_OPERATOR_KIT'||pd.migrationCount!==3||pd.livePostgresQualified!==false||pd.livePostgresConnectionAttempted!==false||pd.syntheticObservationAcceptedCount!==0||pd.qualificationVerdict!=='EXTERNAL_QUALIFICATION_REQUIRED'||pd.externalEffectsExecuted!==0||pd.productionAuthority!=='NONE'||pd.productionPromotion!=='blocked')errors.push('proof_boundary_invalid');
if(verdict.payload.status!=='EXTERNAL_QUALIFICATION_REQUIRED'||verdict.payload.acceptedObservationIds.length!==0||verdict.payload.productionAuthority!=='NONE')errors.push('synthetic_gate_invalid');
if(challenge.payload.syntheticEvidenceAccepted!==false||challenge.payload.sameHostEvidenceAccepted!==false||challenge.payload.requiredIndependentHosts!==2||challenge.payload.requiredIndependentOperators!==2)errors.push('challenge_boundary_invalid');
if(trace.payload.calls.at(-1)?.sql!=='COMMIT'||trace.payload.released!==true||trace.payload.receipt.externalEffectsExecuted!==0)errors.push('adapter_trace_invalid');
if(migrationManifest.version!=='33.21'||migrationManifest.migrations.length!==3||migrationManifest.productionAuthority!=='NONE')errors.push('migration_manifest_invalid');
if(kit.version!=='33.21'||kit.credentialsEmbedded!==false||kit.livePostgresQualified!==false||kit.productionAuthority!=='NONE')errors.push('operator_kit_boundary_invalid');
const migrations=migrationManifest.migrations.map((item)=>({version:'33.21',migrationId:item.migrationId,ordinal:item.ordinal,description:item.description,sql:readFileSync(`external-qualification/v33.21/postgresql/${item.file}`,'utf8'),previousMigrationDigest:item.previousMigrationDigest,migrationDigest:item.migrationDigest}));try{verifyPostgresMigrationChainV33_21(migrations);}catch(error){errors.push(`migration_chain_invalid:${error instanceof Error?error.message:String(error)}`);}
const result={version:'33.21',status:errors.length===0?'passed':'failed',errors,productionAuthority:'NONE',productionPromotion:'blocked'};console.log(JSON.stringify(result,null,2));if(errors.length)process.exit(1);
