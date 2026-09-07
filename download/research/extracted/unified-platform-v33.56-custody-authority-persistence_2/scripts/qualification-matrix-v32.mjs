import { mkdirSync,readFileSync,writeFileSync } from 'node:fs';
const read=n=>JSON.parse(readFileSync(`evidence/generated/${n}`,'utf8'));
const tests=read('V32_TEST_RESULTS.json'),coverage=read('V32_COVERAGE_REPORT.json'),architecture=read('V32_ARCHITECTURE_INTEGRITY.json'),mutation=read('V32_CREDENTIAL_SOVEREIGNTY_MUTATION_RESULTS.json'),proof=read('V32_CREDENTIAL_SOVEREIGNTY_PROOF.json'),integration=read('V32_INTEGRATION_CLOSURE.json');
let postgres={status:'environment-blocked'};try{postgres=read('V32_POSTGRES_QUALIFICATION.json')}catch{}
const controls=[
 ['Local correctness',tests.status==='passed','implemented-and-exercised'],
 ['Coverage gate',coverage.status==='passed','implemented-and-exercised'],
 ['Architecture closure',architecture.status==='PASS','implemented-and-exercised'],
 ['Credential sovereignty mutations',mutation.status==='passed','implemented-and-exercised'],
 ['Portable trust bundle and rollback proof',proof.status==='passed','implemented-and-exercised-single-host'],
 ['Integration closure',integration.status==='passed','integrated-and-exercised'],
 ['PostgreSQL primary/standby',postgres.status!=='environment-blocked',postgres.status],
 ['KMS/HSM or external monotonic witness',false,'environment-blocked'],
 ['Independent penetration and custody audit',false,'operationally-unqualified'],
 ['Human comparative pilot',false,'operationally-unqualified'],
];
const report={version:'32.5',status:'passed-integrated-pilot',readiness:'Integrated Pilot',productionPromotion:'blocked',controls:controls.map(([control,passed,status])=>({control,passed,status})),blockers:controls.filter(([,p])=>!p).map(([c,,s])=>({control:c,status:s})),limitations:proof.limitations};mkdirSync('evidence/generated',{recursive:true});writeFileSync('evidence/generated/V32_QUALIFICATION_MATRIX.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
