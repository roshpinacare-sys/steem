import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const load=(name)=>existsSync(`evidence/generated/${name}`)?JSON.parse(readFileSync(`evidence/generated/${name}`,'utf8')):{};
const tests=load('V27_TEST_RESULTS.json');
const coverage=load('V27_COVERAGE_REPORT.json');
const architecture=load('V27_ARCHITECTURE_INTEGRITY.json');
const mutation=load('V27_MUTATION_RESULTS.json');
const design=load('V27_DESIGN_CLOSURE.json');
const invariants=load('V27_INVARIANT_COVERAGE.json');
const completeness=load('V27_ENGINEERING_COMPLETENESS.json');
const supply=load('V27_SUPPLY_CHAIN_REPORT.json');
const pg=load('V27_POSTGRES_QUALIFICATION.json');
const isolation=load('V27_LINUX_ISOLATION.json');
const pilot=load('V27_HUMAN_PILOT_PROTOCOL.json');
const local=[
 {gate:'Complete local correctness suite',pass:tests.status==='passed'&&tests.totals?.failed===0,evidence:'V27_TEST_RESULTS.json'},
 {gate:'High-coverage branch and function validation',pass:coverage.status==='passed'&&coverage.current?.linePercent>=99&&coverage.current?.branchPercent>=91&&coverage.current?.functionPercent>=98.5,evidence:'V27_COVERAGE_REPORT.json'},
 {gate:'Acyclic tested architecture and capability closure',pass:architecture.status==='PASS'&&architecture.metrics?.sourceCycleCount===0&&architecture.metrics?.untestedSourceCount===0&&architecture.metrics?.closedCapabilityPathCount===architecture.metrics?.capabilityPathCount,evidence:'V27_ARCHITECTURE_INTEGRITY.json'},
 {gate:'Authentic targeted mutation resistance',pass:mutation.status==='passed'&&mutation.mutantsSurvived===0&&mutation.invalidKills===0,evidence:'V27_MUTATION_RESULTS.json'},
 {gate:'Design-to-evidence closure',pass:design.status==='passed'&&design.blocked===0,evidence:'V27_DESIGN_CLOSURE.json'},
 {gate:'Critical invariant closure',pass:invariants.status==='passed'&&invariants.fullyCovered===invariants.invariants,evidence:'V27_INVARIANT_COVERAGE.json'},
 {gate:'Repository engineering completeness',pass:completeness.status==='passed',evidence:'V27_ENGINEERING_COMPLETENESS.json'},
 {gate:'Portable deterministic delivery policy',pass:['passed','passed-with-advisory-environment-blocked'].includes(supply.status),evidence:'V27_SUPPLY_CHAIN_REPORT.json'},
];
const matrix=[...local.map(row=>({...row,status:row.pass?'implemented-and-exercised':'not-qualified'})),
 {gate:'Registry vulnerability advisory availability',status:supply.npmAudit?.status==='passed'?'implemented-and-exercised':supply.npmAudit?.status==='failed'?'not-qualified':'environment-blocked',evidence:'V27_SUPPLY_CHAIN_REPORT.json',blocker:supply.npmAudit?.blocker},
 {gate:'PostgreSQL durable runtime',status:pg.status??'environment-blocked',evidence:'V27_POSTGRES_QUALIFICATION.json',blocker:pg.blocker},
 {gate:'Multi-host failover and PITR',status:'environment-blocked',evidence:null,blocker:'no primary/standby endpoints or failure-injection authority'},
 {gate:'Qualified untrusted-code isolation',status:isolation.status==='passed-single-host-research-proof'?'research-proof-only':'not-qualified',evidence:'V27_LINUX_ISOLATION.json'},
 {gate:'Authorized KMS/HSM custody',status:'environment-blocked',evidence:null,blocker:'no authorized endpoint or custody authority'},
 {gate:'Measured human pilot',status:pilot.status??'protocol-ready-not-executed',evidence:'V27_HUMAN_PILOT_PROTOCOL.json'},
 {gate:'Independent penetration assessment',status:'environment-blocked',evidence:null,blocker:'no independent assessor'},
 {gate:'Licensing resolution',status:'environment-blocked',evidence:null,blocker:'source archives and legal review absent'},
 {gate:'Multi-host production SLO and disaster recovery',status:'environment-blocked',evidence:null,blocker:'local benchmarks and file recovery are not production SLO/PITR evidence'},
];
const localFailures=local.filter(row=>!row.pass).map(row=>row.gate);
const report={version:'27.0',ownerRole:'Independent Qualification Board',readiness:localFailures.length?'Below Integrated Pilot':'Integrated Pilot',productionPromotion:'blocked',generatedAt:new Date().toISOString(),matrix,counts:Object.fromEntries([...new Set(matrix.map(row=>row.status))].map(status=>[status,matrix.filter(row=>row.status===status).length])),hardFailures:localFailures,assistantBoundary:'Governed model and engineering assistant remain proposal-only, research-ceiling, independently reviewed and unable to mutate files or approve their own output.',limitations:['Local closure is not external certification.','Ready-to-exercise is not exercised.','Production runtime, security, human-use, legal and multi-host evidence remain blocked.']};
const output=resolve('evidence/generated/V27_QUALIFICATION_MATRIX.json');mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({readiness:report.readiness,productionPromotion:report.productionPromotion,counts:report.counts,hardFailures:report.hardFailures},null,2));if(localFailures.length)process.exit(1);
