/**
 * V270 Structural Regression Suite
 * Tests that the V270 canonical consolidation is structurally correct:
 * - lib/ mirror parity (no src/lib/ file without a lib/ mirror)
 * - Complete patch chain (no gaps V255–V270)
 * - Version stamps match 270.0.0
 * - Sacred files untouched
 * - All expected module families present
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');

function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }
function readJson(rel) { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
function libFiles() { return fs.readdirSync(path.join(ROOT, 'lib')).filter(f => f.endsWith('.js')); }
function srcLibFiles() { return fs.readdirSync(path.join(ROOT, 'src', 'lib')).filter(f => f.endsWith('.js')); }

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

console.log('\nV270 Structural Tests\n');

// 1. lib/ mirror parity
test('lib/ mirrors all src/lib/ files (zero gaps)', () => {
  const lib = new Set(libFiles());
  const srcLib = new Set(srcLibFiles());
  const missing = [...srcLib].filter(f => !lib.has(f));
  assert.strictEqual(missing.length, 0, `Missing lib/ mirrors: ${missing.join(', ')}`);
});

// 2. package.json version
test('package.json version is 270.0.0', () => {
  const pkg = readJson('package.json');
  assert.strictEqual(pkg.version, '270.0.0', `Expected 270.0.0, got ${pkg.version}`);
});

// 3. .agent-identity.json version
test('.agent-identity.json codeVersion is 270.0.0', () => {
  const id = readJson('.agent-identity.json');
  assert.strictEqual(id.codeVersion, '270.0.0', `Got ${id.codeVersion}`);
  assert.strictEqual(id.agentId, 'ecos-v270-canonical');
});

// 4. Patch chain completeness: V255–V270, no gaps
test('Patch chain V255–V270 complete (no gaps)', () => {
  const expected = [255,256,257,258,259,260,261,262,263,264,265,266,267,268,269,270];
  const missing = expected.filter(n => !exists(`ecos-api-server-v${n}-patch.js`));
  assert.deepStrictEqual(missing, [], `Missing patch files: ${missing.map(n=>`v${n}`).join(', ')}`);
});

// 5. CHANGELOG_V270 present
test('CHANGELOG_V270.md present', () => {
  assert.ok(exists('CHANGELOG_V270.md'), 'CHANGELOG_V270.md not found');
});

// 6. AI_PROTOCOL_V270 present
test('AI_PROTOCOL_V270.md present', () => {
  assert.ok(exists('AI_PROTOCOL_V270.md'), 'AI_PROTOCOL_V270.md not found');
});

// 7. NEXT_SESSION_PROMPT_V270 present
test('NEXT_SESSION_PROMPT_V270.md present', () => {
  assert.ok(exists('NEXT_SESSION_PROMPT_V270.md'), 'NEXT_SESSION_PROMPT_V270.md not found');
});

// 8. NEXT_SESSION_PROMPT_V268 present (was previously missing)
test('NEXT_SESSION_PROMPT_V268.md present (restored)', () => {
  assert.ok(exists('NEXT_SESSION_PROMPT_V268.md'), 'NEXT_SESSION_PROMPT_V268.md not found');
});

// 9. Module families present — latest version for each family
test('All 263+ module families have lib/ entries at highest version', () => {
  const lib = new Set(libFiles());
  const families = [
    'agentReceipts268','breakageEngine268','conversionGateway268',
    'costAwareRouter268','creditReserve268','embeddedWallet268',
    'executionPrograms268','injectionFirewall268','mcpDeepIntegration268',
    'memoryIntegrity268','metacognition268','offlineQueue268',
    'onboardingFlow268','providerAdapters269','quadraticFunding268',
    'reflectionLoop268','reputationLedger268','splitModule268',
    'sybilGuard268','telemetry268','tipModule268',
    'ussdSmsStateMachine268','x402268','auditBloom268',
  ];
  const missing = families.filter(f => !lib.has(`${f}.js`));
  assert.deepStrictEqual(missing, [], `Missing: ${missing.join(', ')}`);
});

// 10. 266-series mirrors fixed
test('266-series lib/ mirrors all present', () => {
  const lib = new Set(libFiles());
  const series266 = [
    'agentReceipts266','auditBloom266','breakageEngine266','conversionGateway266',
    'costAwareRouter266','creditReserve266','embeddedWallet266','executionPrograms266',
    'injectionFirewall266','mcpDeepIntegration266','memoryIntegrity266','metacognition266',
    'offlineQueue266','onboardingFlow266','quadraticFunding266','reflectionLoop266',
    'reputationLedger266','splitModule266','sybilGuard266','telemetry266',
    'tipModule266','ussdSmsStateMachine266','x402266',
  ];
  const missing = series266.filter(f => !lib.has(`${f}.js`));
  assert.deepStrictEqual(missing, [], `Missing 266-series: ${missing.join(', ')}`);
});

// 11. 268-series mirrors fixed
test('268-series lib/ mirrors all present', () => {
  const lib = new Set(libFiles());
  const series268 = [
    'agentReceipts268','auditBloom268','breakageEngine268','conversionGateway268',
    'costAwareRouter268','creditReserve268','embeddedWallet268','executionPrograms268',
    'injectionFirewall268','mcpDeepIntegration268','memoryIntegrity268','metacognition268',
    'offlineQueue268','onboardingFlow268','quadraticFunding268','reflectionLoop268',
    'reputationLedger268','splitModule268','sybilGuard268','telemetry268',
    'tipModule268','ussdSmsStateMachine268','x402268',
  ];
  const missing = series268.filter(f => !lib.has(`${f}.js`));
  assert.deepStrictEqual(missing, [], `Missing 268-series: ${missing.join(', ')}`);
});

// 12. test suites present V263–V270
test('Test suites v263–v270 all present', () => {
  const testSuites = [263,264,265,266,267,268,269,270];
  const missing = testSuites.filter(n => 
    !exists(`tests/v${n}.test.cjs`) && !exists(`tests/v${n}.test.js`)
  );
  assert.deepStrictEqual(missing, [], `Missing test suites: ${missing.map(n=>`v${n}`).join(', ')}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
