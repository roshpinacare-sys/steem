import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const root = 'infra/sovereign-production-v32_13';

test('sovereign production kit is complete, non-secret and explicit about external qualification', () => {
  const required = [
    `${root}/README.md`, `${root}/service-map.json`, `${root}/topology.example.json`, `${root}/compose.qualification.yaml`,
    `${root}/postgres/001_efficiency_fabric.sql`, `${root}/systemd/sovereign-app.service`, `${root}/policies/routing-policy.example.json`,
    `${root}/policies/capacity-policy.example.json`, `${root}/runtime/capacity-snapshot.example.json`, `${root}/runtime/burst-offers.example.json`,
    `${root}/systemd/sovereign-capacity-planner.service`, `${root}/systemd/sovereign-capacity-planner.timer`,
  ];
  for (const path of required) assert.equal(existsSync(path), true, path);
  const combined = required.map((path) => readFileSync(path, 'utf8')).join('\n');
  assert.doesNotMatch(combined, /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16}|(?:^|\n)\s*(?:POSTGRES_PASSWORD|PASSWORD)\s*=\s*(?!\/run\/secrets|\$|<)[^\s]+/i);
  assert.doesNotMatch(combined, /:latest\b/);
  assert.match(combined, /external multi-host production qualification not executed/i);
  assert.match(combined, /POSTGRES_PASSWORD_FILE/);
});

test('efficiency PostgreSQL schema enforces FORCE RLS, tenant policies, restricted semantic denial and append-only cost evidence', () => {
  const sql = readFileSync(`${root}/postgres/001_efficiency_fabric.sql`, 'utf8');
  for (const table of ['sovereign_cache_entries','sovereign_work_dedup','sovereign_capacity_budgets','sovereign_cost_events']) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
  }
  assert.match(sql, /CREATE POLICY tenant_isolation/);
  assert.match(sql, /sensitivity <> 'RESTRICTED' OR semantic_tokens = '\[\]'::jsonb/);
  assert.match(sql, /sovereign_cost_append_only/);
  assert.match(sql, /PRIMARY KEY \(tenant_id, work_key\)/);
});

test('service map consolidates paid services but preserves unavoidable regulated and global boundaries', () => {
  const map = JSON.parse(readFileSync(`${root}/service-map.json`, 'utf8')) as { nativeServices: { implementation: string }[]; unavoidableExternalBoundaries: string[]; productionBlockers: string[] };
  assert.ok(map.nativeServices.length >= 10);
  for (const service of map.nativeServices) assert.equal(existsSync(service.implementation), true, service.implementation);
  assert.deepEqual(map.unavoidableExternalBoundaries, ['public email deliverability','SMS carrier delivery','regulated payment rails','global anycast edge when geographically required']);
  assert.ok(map.productionBlockers.length >= 4);
});
