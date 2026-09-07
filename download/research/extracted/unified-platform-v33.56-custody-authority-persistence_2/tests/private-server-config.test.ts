import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('v20 PostgreSQL schema adds identity, sessions, artifacts, trust, passport and audit with RLS', () => {
  const sql = readFileSync('infra/postgres/v20/001_canonical_runtime.sql', 'utf8');
  for (const table of ['tenants', 'users', 'memberships', 'private_sessions', 'artifact_records', 'trust_snapshots', 'action_passports', 'audit_records']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  for (const table of ['memberships', 'private_sessions', 'artifact_records', 'trust_snapshots', 'action_passports', 'audit_records']) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
  }
  assert.match(sql, /trust_snapshots_append_only/);
  assert.match(sql, /audit_records_append_only/);
  assert.match(sql, /CHECK \(retention IN \('standard','long-term','legal-hold'\)\)/);
});

test('private-server configuration passes static security validation', () => {
  const output = execFileSync('node', ['scripts/validate-private-server-config.mjs'], { encoding: 'utf8' });
  const report = JSON.parse(output) as { status: string; failures: string[]; limitations: string[] };
  assert.equal(report.status, 'passed');
  assert.deepEqual(report.failures, []);
  assert.equal(report.limitations.includes('runtime-not-exercised-in-current-environment'), true);
});

test('PostgreSQL qualification runner reports an explicit environment blocker when psql is absent', () => {
  const result = spawnSync(process.execPath, ['scripts/qualify-postgres-v20.mjs'], { encoding: 'utf8', env: { ...process.env, PATH: '/nonexistent' } });
  assert.equal(result.status, 2);
  const report = JSON.parse(result.stdout) as { status: string; schemaPresent: boolean };
  assert.equal(report.status, 'environment-blocked');
  assert.equal(report.schemaPresent, true);
});

test('v20 Linux isolation adds immutable input permissions and root manifest', { timeout: 30_000 }, () => {
  const result = spawnSync('bash', ['scripts/run-linux-isolation-v20.sh'], { encoding: 'utf8', timeout: 25_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"status": "passed"/);
  assert.match(result.stdout, /"rootManifestDigest": "[a-f0-9]{64}"/);
  assert.match(result.stdout, /immutable-input-permissions/);
  assert.match(result.stdout, /seccomp-denylist-not-allowlist/);
});
