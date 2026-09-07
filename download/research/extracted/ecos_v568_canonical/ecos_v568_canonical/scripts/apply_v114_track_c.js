'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function read(p) { return fs.readFileSync(path.join(root, p), 'utf8'); }
function write(p, s) { fs.writeFileSync(path.join(root, p), s); }
function edit(p, pairs) {
  let s = read(p);
  for (const [find, replace] of pairs) {
    if (!s.includes(find)) throw new Error('Missing target in ' + p + ': ' + find.slice(0, 80));
    s = s.replace(find, replace);
  }
  write(p, s);
}

const pkg = JSON.parse(read('package.json'));
pkg.version = '114.0.0';
pkg.description = 'ECOS V114: P10 hardening and Compliance Proxy with audited AI routing, snapshot listing, OpenAPI coverage, and EU AI Act export.';
write('package.json', JSON.stringify(pkg, null, 2) + '\n');

const spec = JSON.parse(read('docs/openapi.json'));
spec.info = spec.info || {};
spec.info.version = '114.0.0';
spec.info.description = 'ECOS API — V114 P10 hardening and Compliance Proxy';
write('docs/openapi.json', JSON.stringify(spec, null, 2) + '\n');

const engineSpec = JSON.parse(read('engine/spec.json'));
engineSpec.version = 'V114';
write('engine/spec.json', JSON.stringify(engineSpec, null, 2) + '\n');

edit('tests/version.test.js', [
  ['Version tests — V113', 'Version tests — V114'],
  ["describe('Version V113', () => {", "describe('Version V114', () => {"],
  ["it('GET /api/v1/health returns version V112', async () => {", "it('GET /api/v1/health returns version V114', async () => {"],
  ['expect(versionStr).toMatch(/V113|113/);', 'expect(versionStr).toMatch(/V114|114/);'],
  ["it('package.json version is 112.0.0', async () => {", "it('package.json version is 114.0.0', async () => {"],
  ["expect(pkg.version).toBe('113.0.0');", "expect(pkg.version).toBe('114.0.0');"],
]);

let server = read('ecos-api-server.js');
server = server.replace(/version:\s*'V113'/g, "version: 'V114'");
server = server.replace(/version:\s*'113\.0\.0'/g, "version: '114.0.0'");
server = server.replace(/version:\s*'V112'/g, "version: 'V114'");
server = server.replace(/ECOS API Server — V102/g, 'ECOS API Server — V114');
write('ecos-api-server.js', server);

let readme = read('README.md');
readme = readme.replace('### V100 Milestone Release', '### V114 Canonical Release');
readme = readme.replace('| Self-Refinement Agent | `lib/selfRefinementAgent.js` | 2-pass LLM quality loop (V100) |', '| Self-Refinement Agent | `lib/selfRefinementAgent.js` | 2-pass LLM quality loop (V100) |\n| Compliance Proxy | `lib/complianceProxy.js` | V114 audited external AI routing with confidence gating and HITL escalation |');
readme = readme.replace('# Edit .env — set LLM_PROVIDER, VALIDATOR_JWT_SECRET, ECOS_DEPOSIT_API_KEY', '# Edit .env — set LLM_PROVIDER, VALIDATOR_JWT_SECRET, ECOS_DEPOSIT_API_KEY, ECOS_PROXY_API_KEY');
readme = readme.replace('| `ECOS_DEPOSIT_API_KEY` | — | API key protecting `POST /api/v1/deposit` | **Yes** |', '| `ECOS_DEPOSIT_API_KEY` | — | API key protecting `POST /api/v1/deposit` | **Yes** |\n| `ECOS_PROXY_API_KEY` | — | API key protecting V114 Compliance Proxy routes | **Yes** |\n| `ECOS_SNAPSHOT_INTERVAL_MINUTES` | `60` | Snapshot auto-save interval used by the P9/P10 state engine | No |');
readme = readme.replace('| `GET` | `/api/v1/export/audit-report` | Full audit report (JSON or CSV) |', '| `GET` | `/api/v1/export/audit-report` | Full audit report (JSON or CSV) |\n| `POST` | `/api/v1/memory/compact` | Compact memory substrate entries with V114 rate limiting |\n| `GET` | `/api/v1/snapshot/list` | List available state snapshots |\n| `GET` | `/api/v1/audit/eu-ai-act-report` | EU AI Act report as JSON or text export via `?format=pdf` |\n| `POST` | `/api/v1/proxy/complete` | V114 Compliance Proxy completion with audit/HITL controls |\n| `GET` | `/api/v1/proxy/stats` | Compliance Proxy runtime statistics |\n| `GET` | `/api/v1/proxy/config` | Compliance Proxy policy and auth configuration |');
if (!readme.includes('## V114 Release Notes')) {
  readme += '\n\n---\n\n## V114 Release Notes\n\n**V114** closes the P10 hardening gap log by adding rate limits to P9 endpoints, updating the OpenAPI surface, introducing `GET /api/v1/snapshot/list`, adding EU AI Act text export through `?format=pdf`, and shipping the audited Compliance Proxy at `/api/v1/proxy/*`. The release preserves the sacred ledger and audit modules unchanged.\n';
}
write('README.md', readme);

const changelog = [
  '# ECOS Changelog — V114', '',
  '**Version:** 114.0.0  ',
  '**Date:** 2026-05-29  ',
  '**Previous:** V113 (113.0.0)  ',
  '**Build:** ecos_v114_canonical.zip', '',
  '## Summary', '',
  'V114 closes the P10 production-hardening targets left after V113 and adds the new Compliance Proxy product surface. The release keeps the sacred files untouched while making the P9 endpoints safer and better documented.', '',
  '| Track | Status | Deliverables |', '|---|---:|---|',
  '| Track A — P10 hardening | Complete | Rate limits for memory compaction, EU AI Act report, and snapshot listing; OpenAPI coverage; snapshot list API; EU AI Act text export via `?format=pdf`. |',
  '| Track B — Compliance Proxy | Complete | `lib/complianceProxy.js`, `/api/v1/proxy/complete`, `/api/v1/proxy/stats`, `/api/v1/proxy/config`, web `/proxy` page, tests, and docs. |',
  '| Track C — Versioning | Complete | `package.json` 114.0.0, OpenAPI 114.0.0, README updates, context updates, and V114 changelog. |', '',
  '## New API surface', '',
  '| Method | Path | Purpose |', '|---|---|---|',
  '| `POST` | `/api/v1/proxy/complete` | Execute an AI completion through confidence gating, HITL escalation, and `PROXY_CALL` audit logging. |',
  '| `GET` | `/api/v1/proxy/stats` | Return in-memory proxy usage counters. |',
  '| `GET` | `/api/v1/proxy/config` | Return proxy policy and API-key mode. |',
  '| `GET` | `/api/v1/snapshot/list` | Return available snapshots from state and file sources. |',
  '| `GET` | `/api/v1/audit/eu-ai-act-report?format=pdf` | Return a downloadable text compliance artifact. |', '',
  '## Security and operations', '',
  'The proxy should be protected in production with `ECOS_PROXY_API_KEY`. Completion traffic is limited to 60 requests per IP per minute, while hardening endpoints retain tighter P10 limits.', '',
  '## Sacred file status', '',
  '| File | Status | MD5 |', '|---|---|---|',
  '| `lib/fiatLedger.js` | Unchanged | `563e9b1f9e67091a5b6527c0a92568e5` |',
  '| `lib/auditLog.js` | Unchanged | `e5a5c2c27801d2d03991bc8e5a1df8cb` |', ''
].join('\n');
write('docs/CHANGELOG_V114.md', changelog);

const migration = [
  '# ECOS V114 Migration Notes', '',
  'V114 is a no-schema release. Upgrade by replacing the application files, installing dependencies if needed, and restarting the API/web processes.', '',
  '## Environment additions', '',
  '| Variable | Required | Purpose |', '|---|---:|---|',
  '| `ECOS_PROXY_API_KEY` | Production yes | Protects `/api/v1/proxy/*` routes with `X-API-Key` or Bearer auth. |', '',
  '## Verification', '',
  'Run the following checks after deployment:', '',
  '```bash', 'npm test', 'node scripts/check-sacred-files.js', 'curl http://localhost:3000/api/v1/snapshot/list', 'curl -H "X-API-Key: $ECOS_PROXY_API_KEY" http://localhost:3000/api/v1/proxy/config', '```', '',
  '## Rollback', '',
  'No database rollback is required because V114 does not add migrations. Restore the V113 application archive if rollback is necessary.', ''
].join('\n');
write('MIGRATION_NOTES_V114.md', migration);

let context = read('UPDATED_CLAUDE_CONTEXT.md');
context = context.replace('VERSION         : V113', 'VERSION         : V114');
context = context.replace('BUILD_TAG       : ecos_v113_canonical.zip', 'BUILD_TAG       : ecos_v114_canonical.zip');
context = context.replace('PHASE           : P9 CLOSED — P10 / STR-02 next', 'PHASE           : P10 CLOSED — STR-02 / beachhead acquisition next');
context = context.replace('TEST_COUNT      : ~690+ (all V112 + 30 new V113 tests)', 'TEST_COUNT      : ~690+ plus V114 proxy/P10 hardening tests');
context = context.replace('LAST_SESSION_BY : Replit Agent — V113 Implementation Session', 'LAST_SESSION_BY : Manus — V114 Implementation Session');
context = context.replace('### ⏳ בתור — V114\n- STR-02: Design partner acquisition (3-5 paying customers) — **TOP PRIORITY**\n- STR-05: Beachhead vertical selection + lock-in\n- P10-01: Rate limiting on V113 endpoints\n- P10-02: OpenAPI spec update to V113\n- P10-03: Snapshot list API\n- P10-05: EU AI Act report PDF export', '### ✅ הושלם — P10 (V114)\n- P10-01: Rate limiting on V113/P9 endpoints → V114\n- P10-02: OpenAPI spec update → V114\n- P10-03: Snapshot list API → V114\n- P10-05: EU AI Act report text export via `?format=pdf` → V114\n- P10-07: Compliance Proxy (`/api/v1/proxy/*`) → V114\n\n### ⏳ בתור — V115\n- STR-02: Design partner acquisition (3-5 paying customers) — **TOP PRIORITY**\n- STR-05: Beachhead vertical selection + lock-in');
context = context.replace('CHANGELOG_V109.md CHANGELOG_V110.md', 'CHANGELOG_V109.md CHANGELOG_V110.md CHANGELOG_V113.md CHANGELOG_V114.md');
write('UPDATED_CLAUDE_CONTEXT.md', context);

let briefing = read('AI_PARTNER_BRIEFING.md');
briefing = briefing.replace('## מצב נוכחי — V107', '## מצב נוכחי — V114');
briefing = briefing.replace('| VERSION | 107.0.0 |', '| VERSION | 114.0.0 |');
briefing = briefing.replace('| PHASE | P5-SCALE |', '| PHASE | P10 CLOSED — Compliance Proxy shipped; STR-02 acquisition next |');
briefing = briefing.replace('lib/:         fiatLedger★, auditLog★, selfRefinement, calibrator,\n              intelligenceRegistry, memorySubstrate, agentRuntime,', 'lib/:         fiatLedger★, auditLog★, complianceProxy, selfRefinement, calibrator,\n              intelligenceRegistry, memorySubstrate, agentRuntime,');
write('AI_PARTNER_BRIEFING.md', briefing);

console.log('V114 Track C updates applied');
