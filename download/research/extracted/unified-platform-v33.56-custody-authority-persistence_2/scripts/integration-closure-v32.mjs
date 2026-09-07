import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const read=(name)=>JSON.parse(readFileSync(`evidence/generated/${name}`,'utf8'));
const architecture=read('V32_ARCHITECTURE_INTEGRITY.json');
const proof=read('V32_CREDENTIAL_SOVEREIGNTY_PROOF.json');
const mutation=read('V32_CREDENTIAL_SOVEREIGNTY_MUTATION_RESULTS.json');
const edges=[
 ['Root key pins','Issuer grants','root authorization and exact custodian policy'],
 ['Issuer grants','Reviewer credentials','grant digest, tenant, scope and acceptance-time binding'],
 ['Issuer grants','Provider credentials','grant digest, model invocation scope and acceptance-time binding'],
 ['Reviewer credentials','Independent review','rotation, targeted revocation and organization identity'],
 ['Provider credentials','Model boundary','provider/key/model/tenant authorization and rotation'],
 ['Key registry','Historical evidence','effective-time revocation preserves prior verification and blocks later trust'],
 ['Trust state','Threshold bundle','two distinct custodians and exact externally pinned root fingerprints'],
 ['Threshold bundle','Offline import','public keys, grants, credentials, revocations and acceptance times'],
 ['Bundle store','Predecessor chain','idempotency, fork and rollback rejection through API'],
 ['Bundle store','Independent anchor','single-store rollback detection after restart'],
 ['Pending intent','Crash recovery','bundle-write/anchor-advance recovery and tamper rejection'],
 ['Credential controls','Mutation laboratory','sixteen dedicated authentic kills'],
 ['Credential controls','Architecture gate','zero source cycles and portable credential sovereignty capability path'],
 ['Credential proof','Operational boundary','zero external mutations and explicit local-anchor limitation'],
];
const closed=edges.map(([source,destination,control],i)=>({edgeId:`V32-E${String(i+1).padStart(2,'0')}`,source,destination,control,status:'closed',evidenceRefs:['V32_CREDENTIAL_SOVEREIGNTY_PROOF.json','V32_CREDENTIAL_SOVEREIGNTY_MUTATION_RESULTS.json','V32_ARCHITECTURE_INTEGRITY.json']}));
const passed=architecture.status==='PASS'&&proof.status==='passed'&&mutation.status==='passed'&&mutation.survivors===0&&mutation.invalidKills===0&&architecture.metrics.closedCapabilityPathCount===architecture.metrics.capabilityPathCount;
const report={version:'32.0',status:passed?'passed':'failed',classification:'credential-sovereignty-integration-closure',summary:{edges:closed.length,closed:closed.filter(x=>x.status==='closed').length,externalMutationsExecuted:proof.results.externalMutationsExecuted,capabilityPaths:architecture.metrics.capabilityPathCount,closedCapabilityPaths:architecture.metrics.closedCapabilityPathCount},edges:closed,limitations:proof.limitations};
mkdirSync('evidence/generated',{recursive:true});writeFileSync('evidence/generated/V32_INTEGRATION_CLOSURE.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!passed)process.exit(1);
