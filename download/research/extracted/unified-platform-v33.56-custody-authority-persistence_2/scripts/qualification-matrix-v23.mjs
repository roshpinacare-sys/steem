import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const command = (name) => spawnSync('bash', ['-lc', `command -v ${name}`], { encoding: 'utf8' }).status === 0;
const isolation = spawnSync('bash', ['scripts/run-linux-isolation-v23.sh'], { encoding: 'utf8', timeout: 30_000 });
const matrix = [
  { gate: 'PostgreSQL durable runtime', status: command('psql') && process.env.V23_POSTGRES_URL ? 'ready-to-exercise' : 'environment-blocked', evidence: 'infra/postgres/v23/001_canonical_runtime.sql', blocker: command('psql') ? 'V23_POSTGRES_URL missing' : 'psql and PostgreSQL server unavailable' },
  { gate: 'Multi-host failover', status: process.env.V23_POSTGRES_SECONDARY_URL ? 'ready-to-exercise' : 'environment-blocked', evidence: 'target runner required', blocker: 'secondary PostgreSQL endpoint unavailable' },
  { gate: 'Qualified untrusted-code isolation', status: isolation.status === 0 ? 'single-host-research-proof' : 'broken', evidence: 'scripts/run-linux-isolation-v23.sh', blocker: 'no independent security review; kernel lacks Landlock and delegated cgroup v2' },
  { gate: 'Real KMS/HSM', status: process.env.V23_KMS_KEY_URI ? 'ready-to-integrate' : 'environment-blocked', evidence: 'src/security/attested-kms-adapter.ts', blocker: 'no authorized KMS/HSM endpoint or key' },
  { gate: 'Human pilot', status: 'protocol-ready-not-executed', evidence: 'evidence/generated/V23_HUMAN_PILOT_PROTOCOL.json', blocker: 'no consented participants in execution environment' },
  { gate: 'External penetration test', status: 'environment-blocked', evidence: null, blocker: 'no independent assessor report supplied' },
  { gate: 'Licensing resolution', status: 'environment-blocked', evidence: null, blocker: 'source archives and legal review not supplied in v22 workspace' },
  { gate: 'Production SLO evidence', status: 'local-evidence-only', evidence: 'evidence/generated/V23_LOCAL_SLO_MEASUREMENTS.json', blocker: 'no qualified multi-host environment' },
];
const report = { version: '23.0', readiness: 'Integrated Pilot', productionPromotion: 'blocked', generatedAt: new Date().toISOString(), matrix, counts: Object.fromEntries([...new Set(matrix.map((item) => item.status))].map((status) => [status, matrix.filter((item) => item.status === status).length])) };
const output = resolve('evidence/generated/V23_QUALIFICATION_MATRIX.json'); mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`); console.log(JSON.stringify(report, null, 2));
