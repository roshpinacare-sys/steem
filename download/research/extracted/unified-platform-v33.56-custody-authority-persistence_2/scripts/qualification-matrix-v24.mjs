import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
function load(name) { const path = resolve('evidence/generated', name); return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null; }
const postgres = load('V24_POSTGRES_QUALIFICATION.json');
const isolation = load('V24_LINUX_ISOLATION.json');
const pilot = load('V24_HUMAN_PILOT_PROTOCOL.json');
const performance = load('V24_LOCAL_PERFORMANCE.json');
const dr = load('V24_LOCAL_DR_REHEARSAL.json');
const tests = load('V24_TEST_RESULTS.json');
const mutation = load('V24_MUTATION_RESULTS.json');
const quality = load('V24_TEST_QUALITY_AUDIT.json');
const matrix = [
  { gate: 'Complete local test execution', status: tests?.status === 'passed' && tests?.totals?.failed === 0 ? 'implemented-and-exercised' : 'not-qualified', evidence: 'evidence/generated/V24_TEST_RESULTS.json', blocker: tests?.status === 'passed' ? null : 'fresh complete test execution absent or failing' },
  { gate: 'Test authenticity and mutation resistance', status: mutation?.status === 'passed' && quality?.status === 'passed' ? 'implemented-and-exercised' : 'not-qualified', evidence: ['evidence/generated/V24_MUTATION_RESULTS.json', 'evidence/generated/V24_TEST_QUALITY_AUDIT.json'], blocker: mutation?.status === 'passed' && quality?.status === 'passed' ? null : 'mutation or quality gate not passing' },
  { gate: 'PostgreSQL durable runtime', status: postgres?.status ?? 'environment-blocked', evidence: 'evidence/generated/V24_POSTGRES_QUALIFICATION.json', blocker: postgres?.status === 'implemented-and-exercised-single-database' ? 'primary/standby still unqualified' : postgres?.blocker ?? 'qualification not executed' },
  { gate: 'Multi-host failover', status: process.env.V24_POSTGRES_SECONDARY_URL ? 'ready-to-exercise' : 'environment-blocked', evidence: 'target-environment runner required', blocker: 'secondary PostgreSQL endpoint and fault-injection authority unavailable' },
  { gate: 'Qualified untrusted-code isolation', status: isolation?.status === 'passed-single-host-research-proof' ? 'single-host-research-proof' : 'not-qualified', evidence: 'evidence/generated/V24_LINUX_ISOLATION.json', blocker: 'no independent security review; target production kernel/container boundary not supplied' },
  { gate: 'Real KMS/HSM', status: process.env.V24_KMS_KEY_URI ? 'ready-to-integrate' : 'environment-blocked', evidence: 'src/security/attested-kms-adapter.ts', blocker: 'no authorized KMS/HSM endpoint, key policy, or audit trail' },
  { gate: 'Human pilot', status: pilot?.status ?? 'protocol-not-generated', evidence: 'evidence/generated/V24_HUMAN_PILOT_PROTOCOL.json', blocker: 'no consented participants observed in this execution environment' },
  { gate: 'Local disaster recovery rehearsal', status: dr?.status ?? 'not-executed', evidence: 'evidence/generated/V24_LOCAL_DR_REHEARSAL.json', blocker: 'still not PostgreSQL PITR or multi-region recovery' },
  { gate: 'Production SLO evidence', status: performance?.status === 'passed-local-only' ? 'local-evidence-only' : 'not-qualified', evidence: 'evidence/generated/V24_LOCAL_PERFORMANCE.json', blocker: 'no qualified multi-host workload or production traffic' },
  { gate: 'External penetration test', status: 'environment-blocked', evidence: null, blocker: 'no independent assessor report supplied' },
  { gate: 'Licensing resolution', status: 'environment-blocked', evidence: null, blocker: 'source archives and legal review not supplied in the canonical workspace' },
];
const hardFailures = matrix.filter((item) => item.status === 'not-qualified');
const report = { version: '24.0', ownerRole: 'Qualification Board', readiness: hardFailures.length === 0 ? 'Integrated Pilot' : 'Below Integrated Pilot', productionPromotion: 'blocked', generatedAt: new Date().toISOString(), matrix, counts: Object.fromEntries([...new Set(matrix.map((item) => item.status))].map((status) => [status, matrix.filter((item) => item.status === status).length])), hardFailures: hardFailures.map((item) => item.gate), limitations: ['A ready-to-exercise gate is not an exercised or qualified gate.', 'Local proof cannot satisfy production runtime, security, human-use, or regulatory qualification.'] };
const output = resolve('evidence/generated/V24_QUALIFICATION_MATRIX.json'); mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`); console.log(JSON.stringify({ readiness: report.readiness, productionPromotion: report.productionPromotion, counts: report.counts, hardFailures: report.hardFailures }, null, 2)); if (hardFailures.length) process.exit(1);
