/**
 * tests/v271.test.cjs — V271 Structural Regression Tests
 * CommonJS format, zero new npm deps.
 * Validates: version stamps, new file presence (both src/lib and lib),
 *            migration table count, server wiring markers, endpoint list.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let passed = 0, failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log('  ✓', message);
    passed++;
  } else {
    console.error('  ✗', message);
    failed++;
  }
}

function fileExists(relPath) {
  return fs.existsSync(path.join(ROOT, relPath));
}

function fileContains(relPath, substring) {
  try {
    return fs.readFileSync(path.join(ROOT, relPath), 'utf8').includes(substring);
  } catch (_) { return false; }
}

console.log('\n=== V271 Structural Regression Tests ===\n');

// ── Version stamps ──────────────────────────────────────────────────────────
console.log('Version stamps:');
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert(pkg.version === '271.0.0', `package.json version = 271.0.0 (got ${pkg.version})`);
  assert(typeof pkg.scripts['test:v271'] === 'string', 'package.json has test:v271 script');
} catch (e) {
  assert(false, `package.json readable: ${e.message}`);
}

try {
  const identity = JSON.parse(fs.readFileSync(path.join(ROOT, '.agent-identity.json'), 'utf8'));
  assert(identity.version === '271.0.0' || identity.ecosVersion === 'V271', '.agent-identity.json version = 271.0.0');
} catch (e) {
  assert(false, `.agent-identity.json readable: ${e.message}`);
}

// ── New modules exist (src/lib AND lib mirror, R3) ───────────────────────────
console.log('\nNew versioned module files (R3 — both src/lib and lib):');
const v271Modules = ['postgresAuditBloomAdapter271', 'consolidatedProviderRegistry271'];
for (const mod of v271Modules) {
  assert(fileExists(`src/lib/${mod}.js`), `src/lib/${mod}.js exists`);
  assert(fileExists(`lib/${mod}.js`),     `lib/${mod}.js exists (mirror)`);
}

// ── DB files ─────────────────────────────────────────────────────────────────
console.log('\nDatabase persistence foundation:');
assert(fileExists('db/migration_phase46.sql'), 'db/migration_phase46.sql exists');
assert(fileExists('db/creditReserveRepo.js'),  'db/creditReserveRepo.js exists');
assert(fileExists('db/reputationRepo.js'),     'db/reputationRepo.js exists');

// 12 expected tables
const SQL_TABLES = [
  'credit_reserve', 'credits_issued', 'breakage_cohorts', 'reputation_events',
  'sybil_evaluations', 'x402_receipts', 'agent_receipts', 'audit_bloom_state',
  'program_missions', 'onboarding_sessions', 'quadratic_rounds', 'splits'
];
for (const tbl of SQL_TABLES) {
  assert(fileContains('db/migration_phase46.sql', `CREATE TABLE IF NOT EXISTS ${tbl}`), `migration: table ${tbl}`);
}

// ── Server wiring markers ────────────────────────────────────────────────────
console.log('\nServer wiring markers:');
assert(fileContains('ecos-api-server.js', '_wireV271CanonicalPatchChain271'), 'server: _wireV271CanonicalPatchChain271 present');
assert(fileContains('ecos-api-server.js', '_wireConsolidatedRegistry271'),   'server: _wireConsolidatedRegistry271 present');
assert(fileContains('ecos-api-server.js', '_wireUnifiedHealth271'),          'server: _wireUnifiedHealth271 present');
assert(fileContains('ecos-api-server.js', '_wireBloomFirewallCrossRef271'),  'server: _wireBloomFirewallCrossRef271 present');
assert(fileContains('ecos-api-server.js', '_wireApply271'),                  'server: _wireApply271 helper present');
assert(fileContains('ecos-api-server.js', '_wireStateful271'),               'server: _wireStateful271 helper present');

// ── V271 endpoints ────────────────────────────────────────────────────────────
console.log('\nV271 endpoint declarations:');
const ENDPOINTS = [
  '/api/v271/providers/registry',
  '/api/v271/providers/contracts',
  '/api/v271/providers/validate',
  '/api/v271/health/unified',
  '/api/v271/health/summary',
  '/api/v271/admin/summary',
  '/api/v271/audit/bloom-firewall-check',
  '/api/v271/audit/bloom-firewall-stats',
];
for (const ep of ENDPOINTS) {
  assert(fileContains('ecos-api-server.js', ep), `endpoint declared: ${ep}`);
}

// ── consolidatedProviderRegistry271 module shape ─────────────────────────────
console.log('\nconsolidatedProviderRegistry271 module shape:');
try {
  const reg = require(path.join(ROOT, 'src/lib/consolidatedProviderRegistry271.js'));
  assert(typeof reg.PROVIDER_CONTRACTS_271 === 'object',             'exports PROVIDER_CONTRACTS_271');
  assert(typeof reg.validateProvider271 === 'function',              'exports validateProvider271');
  assert(typeof reg.validateAllProviders271 === 'function',          'exports validateAllProviders271');
  assert(typeof reg.safeProvider271 === 'function',                  'exports safeProvider271');
  assert(typeof reg.createConsolidatedProviderRegistry271 === 'function', 'exports createConsolidatedProviderRegistry271');
  const contractCount = Object.keys(reg.PROVIDER_CONTRACTS_271).length;
  assert(contractCount === 22, `PROVIDER_CONTRACTS_271 has 22 entries (got ${contractCount})`);
} catch (e) {
  assert(false, `consolidatedProviderRegistry271 loadable: ${e.message}`);
}

// ── postgresAuditBloomAdapter271 module shape ─────────────────────────────────
console.log('\npostgresAuditBloomAdapter271 module shape:');
try {
  const adapter = require(path.join(ROOT, 'src/lib/postgresAuditBloomAdapter271.js'));
  assert(typeof adapter.createPostgresAuditBloomAdapter271 === 'function', 'exports createPostgresAuditBloomAdapter271');
  // Test that it requires a pool
  try {
    adapter.createPostgresAuditBloomAdapter271(null);
    assert(false, 'throws on null pool');
  } catch (e) {
    assert(e.message.includes('pool'), `throws on null pool: ${e.message}`);
  }
} catch (e) {
  assert(false, `postgresAuditBloomAdapter271 loadable: ${e.message}`);
}

// ── Release documentation ─────────────────────────────────────────────────────
console.log('\nRelease documentation:');
assert(fileExists('CHANGELOG_V271.md'),          'CHANGELOG_V271.md present');
assert(fileExists('AI_PROTOCOL_V271.md'),        'AI_PROTOCOL_V271.md present');
assert(fileExists('NEXT_SESSION_PROMPT_V271.md'),'NEXT_SESSION_PROMPT_V271.md present');

// ── Sacred files untouched (R1) ───────────────────────────────────────────────
console.log('\nSacred files integrity (R1):');
assert(fileExists('src/lib/fiatLedger.js'), 'src/lib/fiatLedger.js exists');
assert(fileExists('src/lib/auditLog.js'),   'src/lib/auditLog.js exists');
assert(!fileContains('src/lib/fiatLedger.js', 'V271'), 'fiatLedger.js does not mention V271 (untouched)');
assert(!fileContains('src/lib/auditLog.js',   'V271'), 'auditLog.js does not mention V271 (untouched)');

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
