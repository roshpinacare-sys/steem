import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const evidence = resolve('evidence/generated/postgres-v22-qualification.json');
mkdirSync(dirname(evidence), { recursive: true });
const url = process.env.V20_POSTGRES_URL;
let report;
try {
  execFileSync('psql', ['--version'], { stdio: 'pipe' });
  if (!url) throw new Error('V20_POSTGRES_URL_missing');
  execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-f', 'infra/postgres/v20/001_canonical_runtime.sql'], { stdio: 'pipe' });
  const output = execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-Atc', "SELECT count(*) FROM pg_tables WHERE schemaname='public';"], { encoding: 'utf8' }).trim();
  report = { status: 'schema-exercised', tableCount: Number(output), faultSuite: 'not-yet-multi-host', limitations: ['requires dedicated fault workers for strong qualification'] };
} catch (error) {
  report = { status: 'environment-blocked', blocker: error instanceof Error ? error.message : String(error), required: ['psql', 'PostgreSQL 16.4 server', 'V20_POSTGRES_URL'], schemaPresent: existsSync('infra/postgres/v20/001_canonical_runtime.sql') };
}
writeFileSync(evidence, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
process.exit(report.status === 'schema-exercised' ? 0 : 2);
