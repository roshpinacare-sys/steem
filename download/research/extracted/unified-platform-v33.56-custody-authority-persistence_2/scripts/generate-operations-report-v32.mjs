import { mkdirSync,readFileSync,writeFileSync } from 'node:fs';
const read=n=>JSON.parse(readFileSync(`evidence/generated/${n}`,'utf8'));
const proof=read('V32_CREDENTIAL_SOVEREIGNTY_PROOF.json');
let postgres={status:'not-run'};try{postgres=read('V32_POSTGRES_QUALIFICATION.json')}catch{}
const actions=[
 {priority:'P0',category:'STOP',ownerRole:'Durable Runtime Lead',reason:'PostgreSQL primary/standby and PITR are not externally qualified',runbook:'V33_EXTERNAL_QUALIFICATION_RUNBOOK.md',completionEvidence:'independent multi-host failover and restore report'},
 {priority:'P0',category:'VERIFY',ownerRole:'Key Custody Lead',reason:'Local file anchor cannot resist joint rollback of bundle and anchor',runbook:'V33_EXTERNAL_QUALIFICATION_RUNBOOK.md',completionEvidence:'HSM or external monotonic witness proof'},
 {priority:'P1',category:'VERIFY',ownerRole:'Security Review Lead',reason:'Root custodian independence is configured and tested locally, not independently audited',runbook:'V33_EXTERNAL_QUALIFICATION_RUNBOOK.md',completionEvidence:'external custodian and penetration assessment'},
 {priority:'P1',category:'MONITOR',ownerRole:'Product Research Lead',reason:'Human and commercial value remains unmeasured',runbook:'V32_HUMAN_PILOT_PROTOCOL.json',completionEvidence:'consented comparative pilot results'},
];
const report={version:'32.0',status:'passed',promotion:'blocked',proofStatus:proof.status,postgresStatus:postgres.status,actions,credentialSovereignty:{selfIssuanceRejected:proof.results.selfIssuanceRejected,custodianThresholdRejected:proof.results.sameCustodianThresholdRejected,offlineImportDigestMatches:proof.results.offlineImportDigestMatches,rollbackDetected:proof.results.independentAnchorRollbackDetected,historicalRevocationSemantics:proof.results.historicalSignatureValidBeforeEffectiveRevocation&&proof.results.signatureBlockedAfterEffectiveRevocation,externalMutationsExecuted:proof.results.externalMutationsExecuted},limitations:proof.limitations};mkdirSync('evidence/generated',{recursive:true});writeFileSync('evidence/generated/V32_OPERATIONAL_ACTION_CENTER.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
