import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { generateSigningIdentity } from '../src/contracts/crypto.js';
import { KeyLifecycleRegistry } from '../src/security/key-lifecycle.js';
import { assessDependencyPolicy } from '../src/supply-chain/dependency-policy.js';
import { signDevelopmentRelease } from '../src/supply-chain/release-manifest.js';
const now = new Date('2026-07-17T00:00:00Z');
function lock(pkg: Record<string, unknown>) { return { name: 'fixture', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'fixture', version: '1.0.0', license: 'MIT' }, 'node_modules/example': { name: 'example', version: '1.2.3', license: 'MIT', resolved: 'https://registry.npmjs.org/example/-/example-1.2.3.tgz', integrity: 'sha512-QUJDRA==', ...pkg } } }; }
function report(pkg: Record<string, unknown>, allowedRegistryHosts?: readonly string[]) { const dir=mkdtempSync(join(tmpdir(),'dep-v25-'));const path=join(dir,'package-lock.json');writeFileSync(path,JSON.stringify(lock(pkg)));return assessDependencyPolicy(path, allowedRegistryHosts===undefined?{}:{allowedRegistryHosts}); }
let archiveResult: { status: string; checks: Record<string, boolean> } | undefined;
function archiveSelftest(){return archiveResult??=JSON.parse(execFileSync('python3',['scripts/archive-selftest-v32.py'],{encoding:'utf8'})) as {status:string;checks:Record<string,boolean>};}

test('exact registry dependency with integrity and no lifecycle script is accepted', () => { assert.equal(report({}).status,'passed'); });
test('install scripts, git sources and missing integrity are rejected', () => { const r=report({hasInstallScript:true,resolved:'git+https://example.com/repo.git',integrity:undefined});assert.equal(r.status,'failed');assert.ok(r.findings.some(f=>f.code==='DEPENDENCY_INSTALL_SCRIPT'));assert.ok(r.findings.some(f=>f.code==='DEPENDENCY_SOURCE_UNSUPPORTED'));assert.ok(r.findings.some(f=>f.code==='DEPENDENCY_INTEGRITY_MISSING')); });
test('non-exact versions fail and missing license remains visible', () => { const r=report({version:'^1.2.3',license:undefined});assert.equal(r.status,'failed');assert.equal(r.missingLicense,1); });
test('explicit allowlisted registry mirror is accepted only with its exact host', () => { const mirror='packages.applied-caas-gateway1.internal.api.openai.org';const pkg={resolved:`https://${mirror}/artifactory/api/npm/npm/example/-/example-1.2.3.tgz`};assert.equal(report(pkg).status,'failed');assert.equal(report(pkg,['registry.npmjs.org',mirror]).status,'passed'); });
test('development release records the v32 clean validation command', () => { const identity=generateSigningIdentity('release-v32');const registry=new KeyLifecycleRegistry();registry.register(identity,{keyId:identity.keyId,familyId:'release',purpose:'release-signer',environment:'test',notBefore:new Date(now.getTime()-1000).toISOString(),notAfter:new Date(now.getTime()+86400000).toISOString()});const release=signDevelopmentRelease({root:resolve('.'),project:'proof-v32',version:'0.16.0',identity,registry,now});assert.equal(release.envelope.payload.buildCommand,'npm ci --ignore-scripts && npm run validate:v32'); });
test('portable archive is deterministic, excludes generated trees and normalizes modes', () => { const r=archiveSelftest();assert.equal(r.status,'passed');assert.equal(r.checks.deterministic,true);assert.equal(r.checks.normalizedModes,true);assert.equal(r.checks.excluded,true); });
test('archive builder rejects source symlinks instead of dereferencing them', () => { const c=archiveSelftest().checks;assert.equal(c.sourceSymlinkRejected,true);assert.equal(c.sourceHardlinkRejected,true); });
test('archive verifier rejects traversal, case collisions, symlinks and executable entries', () => { const c=archiveSelftest().checks;assert.equal(c.traversalRejected,true);assert.equal(c.caseCollisionRejected,true);assert.equal(c.symlinkEntryRejected,true);assert.equal(c.executableEntryRejected,true); });
test('package aliases and shell entrypoints invoke interpreters explicitly', () => { const pkg=JSON.parse(readFileSync('package.json','utf8')) as {scripts:Record<string,string>};for(const [name,command] of Object.entries(pkg.scripts)){if(command.includes('scripts/')&&command.match(/scripts\/[A-Za-z0-9_.-]+\.sh/))assert.match(command,/(?:^|&&|;)\s*bash\s+scripts\//,`script ${name} must invoke bash explicitly`);} });
