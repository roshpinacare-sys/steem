import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const outputPath = resolve('evidence/generated/V27_POSTGRES_QUALIFICATION.json');
mkdirSync(dirname(outputPath), { recursive: true });
const url = process.env.V27_POSTGRES_URL;
const required = ['psql', 'disposable PostgreSQL 16.x qualification database', 'V27_POSTGRES_URL'];
let report;
try {
  const psqlVersion = execFileSync('psql', ['--version'], { encoding: 'utf8' }).trim();
  if (!url) throw new Error('V27_POSTGRES_URL_missing');
  const migration = spawnSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-X', '-f', 'infra/postgres/v23/001_canonical_runtime.sql'], { encoding: 'utf8', timeout: 90_000 });
  if (migration.error) throw migration.error;
  if (migration.status !== 0) throw new Error(`migration_failed:${migration.stderr || migration.stdout}`);
  const qualification = spawnSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-X', '-At', '-f', 'infra/postgres/v23/qualification.sql'], { encoding: 'utf8', timeout: 90_000 });
  if (qualification.error) throw qualification.error;
  if (qualification.status !== 0) throw new Error(`qualification_failed:${qualification.stderr || qualification.stdout}`);
  const lines = qualification.stdout.trim().split(/\r?\n/).filter(Boolean);
  const parsed = JSON.parse(lines.at(-1));
  report = {
    version: '27.0', ownerRole: 'Durable Runtime Qualification Lead', status: 'implemented-and-exercised-single-database', generatedAt: new Date().toISOString(), psqlVersion, result: parsed,
    evidence: ['infra/postgres/v23/001_canonical_runtime.sql', 'infra/postgres/v23/qualification.sql'],
    exercised: ['migration prerequisites', 'FORCE RLS catalog state', 'tenant-scoped composite foreign keys', 'append-only trigger', 'outbox idempotency uniqueness'],
    limitations: ['not primary/standby', 'not failover/PITR', 'not connection-pool tenant leakage test', 'not load/chaos qualification'], productionQualified: false,
    nextAction: 'Run the primary/standby failover and connection-pool fault suite in dedicated PostgreSQL infrastructure.'
  };
} catch (error) {
  report = {
    version: '27.0', ownerRole: 'Durable Runtime Qualification Lead', status: 'environment-blocked', generatedAt: new Date().toISOString(),
    blocker: error instanceof Error ? error.message : String(error), required,
    schemaPresent: existsSync('infra/postgres/v23/001_canonical_runtime.sql'), qualificationHarnessPresent: existsSync('infra/postgres/v23/qualification.sql'),
    staticContractTests: 'implemented-and-exercised', productionQualified: false,
    nextAction: 'Provide V27_POSTGRES_URL for a disposable PostgreSQL 16.x database, then provide a secondary endpoint for failover qualification.'
  };
}
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(report.status === 'implemented-and-exercised-single-database' ? 0 : 2);
