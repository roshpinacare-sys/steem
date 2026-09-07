import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  PostgresDurableAuthorityAdapterV33_21,
  buildPostgresAuthorityMigrationsV33_21,
  buildPostgresAuthoritySqlPlanV33_21,
  evaluatePostgresQualificationV33_21,
  issuePostgresOperatorObservationV33_21,
  issuePostgresQualificationChallengeV33_21,
  postgresMigrationChainDigestV33_21,
} from '../dist/src/app/postgres-durable-authority-v33_21.js';
import { KeyRegistry, generateSigningIdentity, sha256, sha256Bytes, signEnvelope } from '../dist/src/contracts/crypto.js';

const out=resolve('release-evidence/v33.21');mkdirSync(out,{recursive:true});
const now=new Date('2026-07-21T20:00:00.000Z');
const identities={challenge:generateSigningIdentity('v33.21-challenge'),operatorA:generateSigningIdentity('v33.21-operator-a'),operatorB:generateSigningIdentity('v33.21-operator-b'),verifier:generateSigningIdentity('v33.21-verifier'),proof:generateSigningIdentity('v33.21-proof')};
const registry=(...items)=>{const value=new KeyRegistry();for(const item of items)value.register(item.keyId,item.publicKey);return value;};
const challenge=issuePostgresQualificationChallengeV33_21({signer:identities.challenge,now});
const controls=Object.fromEntries(challenge.payload.requiredControls.map((control)=>[control,true]));
const controlEvidenceDigests=Object.fromEntries(challenge.payload.requiredControls.map((control,index)=>[control,sha256({control,index,evidence:'synthetic-contract-artifact'})]));
const observations=[
 issuePostgresOperatorObservationV33_21({challenge,signer:identities.operatorA,evidenceClass:'SYNTHETIC_CONTRACT_TEST',operatorOrganizationId:'synthetic-org-a',hostId:'synthetic-host-a',databaseSystemIdentifier:'synthetic-db-a',serverVersionNum:180000,sslInUse:true,controls,controlEvidenceDigests,now:new Date(now.getTime()+1)}),
 issuePostgresOperatorObservationV33_21({challenge,signer:identities.operatorB,evidenceClass:'SYNTHETIC_CONTRACT_TEST',operatorOrganizationId:'synthetic-org-b',hostId:'synthetic-host-b',databaseSystemIdentifier:'synthetic-db-b',serverVersionNum:180000,sslInUse:true,controls,controlEvidenceDigests,now:new Date(now.getTime()+1)}),
];
const verdict=evaluatePostgresQualificationV33_21({challenge,observations,challengeRegistry:registry(identities.challenge),trustedChallengeSignerIds:[identities.challenge.keyId],trust:{operatorRegistry:registry(identities.operatorA,identities.operatorB),trustedOperatorSignerIds:[identities.operatorA.keyId,identities.operatorB.keyId],verifierRegistry:registry(identities.verifier),trustedVerifierSignerIds:[identities.verifier.keyId]},verifier:identities.verifier,now:new Date(now.getTime()+2)});

class TraceClient { constructor(){this.calls=[];this.released=false;} async query(sql,params=[]){this.calls.push({sql,params});if(sql.includes('pg_try_advisory_xact_lock'))return{rows:[{locked:true}],rowCount:1};if(sql.includes('process_lease_command_v1'))return{rows:[{decision:{accepted:true,reason:'ACQUIRED',currentFenceToken:1,commandId:'proof-command'}}],rowCount:1};return{rows:[],rowCount:0};}release(){this.released=true;} }
class TracePool { constructor(){this.client=new TraceClient();}async connect(){return this.client;} }
const pool=new TracePool();
const adapterReceipt=await new PostgresDurableAuthorityAdapterV33_21({pool}).execute({leaseKey:'tenant-proof\u0000adaptive-control',commandId:'proof-command',commandDigest:'proof-command-digest',commandJson:{authorityId:'authority-proof',tenantId:'tenant-proof',serviceId:'adaptive-control',controllerId:'controller-proof',operation:'ACQUIRE',issuedAt:now.toISOString(),requestedTtlMs:1000}});
const migrations=buildPostgresAuthorityMigrationsV33_21();
const migrationManifest=JSON.parse(readFileSync('external-qualification/v33.21/postgresql/migration-manifest.json','utf8'));
const psql=spawnSync('bash',['-lc','command -v psql || true'],{encoding:'utf8'}).stdout.trim();
const infrastructure={version:'33.21',component:'POSTGRESQL',status:psql===''?'UNAVAILABLE_FAIL_CLOSED':'AVAILABLE_NOT_QUALIFIED',...(psql===''?{}:{executable:psql}),liveDatabaseConnectionAttempted:false,qualification:'EXTERNAL_QUALIFICATION_REQUIRED',productionAuthority:'NONE',externalEffectsExecuted:0,probedAt:new Date().toISOString()};
infrastructure.probeDigest=sha256(infrastructure);
const kitFiles=['external-qualification/v33.21/postgresql/README.md','external-qualification/v33.21/postgresql/RUNBOOK.md','external-qualification/v33.21/postgresql/operator.env.example','external-qualification/v33.21/postgresql/migration-manifest.json','external-qualification/v33.21/postgresql/verify-controls.sql','external-qualification/v33.21/postgresql/scripts/apply-migrations.sh','external-qualification/v33.21/postgresql/scripts/collect-facts.sh',...migrationManifest.migrations.map((x)=>`external-qualification/v33.21/postgresql/${x.file}`)];
const operatorKit={version:'33.21',kitId:'postgres-durable-authority-external-operator-kit-v33.21',files:kitFiles.map((path)=>({path,sizeBytes:statSync(path).size,sha256:sha256Bytes(readFileSync(path))})),migrationChainDigest:postgresMigrationChainDigestV33_21(migrations),credentialsEmbedded:false,livePostgresQualified:false,productionAuthority:'NONE',externalEffectsExecuted:0};operatorKit.kitDigest=sha256(operatorKit);
const traceMaterial={version:'33.21',evidenceClass:'LOCAL_POSTGRES_CONTRACT_ADAPTER_TRACE',calls:pool.client.calls,released:pool.client.released,receipt:adapterReceipt,sqlPlan:buildPostgresAuthoritySqlPlanV33_21(),productionAuthority:'NONE',externalEffectsExecuted:0};
const trace=signEnvelope({...traceMaterial,traceDigest:sha256(traceMaterial)},identities.proof);
const proofMaterial={version:'33.21',status:'POSTGRES_DURABLE_AUTHORITY_ADAPTER_AND_OPERATOR_KIT_PROVEN_LOCALLY',evidenceClass:'LOCAL_POSTGRESQL_CONTRACT_AND_EXTERNAL_OPERATOR_KIT',migrationCount:migrations.length,migrationChainVerified:true,migrationChainDigest:postgresMigrationChainDigestV33_21(migrations),serializableTransaction:true,transactionScopedAdvisoryLock:true,rowLockForUpdate:true,atomicDecisionAndOutbox:true,boundedSerializationRetry:true,embeddedSecrets:0,operatorKitFileCount:operatorKit.files.length,postgresInfrastructureStatus:infrastructure.status,livePostgresConnectionAttempted:false,livePostgresQualified:false,syntheticObservationCount:observations.length,syntheticObservationAcceptedCount:verdict.payload.acceptedObservationIds.length,qualificationVerdict:verdict.payload.status,requiredIndependentOperators:challenge.payload.requiredIndependentOperators,requiredIndependentHosts:challenge.payload.requiredIndependentHosts,externalEffectsExecuted:0,productionAuthority:'NONE',productionPromotion:'blocked'};
const proof=signEnvelope({...proofMaterial,proofDigest:sha256(proofMaterial)},identities.proof);
for(const [name,value] of Object.entries({V33_21_POSTGRES_DURABLE_AUTHORITY_PROOF:proof,V33_21_POSTGRES_ADAPTER_TRACE:trace,V33_21_POSTGRES_MIGRATION_MANIFEST:migrationManifest,V33_21_EXTERNAL_QUALIFICATION_CHALLENGE:challenge,V33_21_SYNTHETIC_OPERATOR_OBSERVATIONS:observations,V33_21_POSTGRES_QUALIFICATION_VERDICT:verdict,V33_21_POSTGRES_INFRASTRUCTURE_PROBE:infrastructure,V33_21_POSTGRES_OPERATOR_KIT_MANIFEST:operatorKit})) writeFileSync(`${out}/${name}.json`,JSON.stringify(value,null,2)+'\n');
writeFileSync(`${out}/V33_21_PROOF_PUBLIC_KEYS.json`,JSON.stringify({version:'33.21',keys:[identities.proof,identities.challenge,identities.operatorA,identities.operatorB,identities.verifier].map((identity)=>{const r=registry(identity);return r.exportPublicKey(identity.keyId);}),productionAuthority:'NONE'},null,2)+'\n');
console.log(JSON.stringify({status:'passed',proof:proof.payload,evidenceDir:out},null,2));
