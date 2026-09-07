import ts from 'typescript';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { validateArchitectureIntegrity } from '../dist/src/validation/architecture-integrity.js';

const root = resolve('.');
const sourceFiles = ts.sys.readDirectory(root, ['.ts'], ['node_modules','dist','.cache'], ['src/**/*.ts','tests/**/*.ts']).map((file) => resolve(file)).sort();
const ids = new Set(sourceFiles.map(toId));
const nodes = sourceFiles.map((path) => {
  const id = toId(path); const isTest = id.startsWith('tests/');
  const isEntry = id.startsWith('src/cli/') || id === 'src/web/server.ts';
  return { nodeId: id, layer: isTest ? 'tests' : id.split('/')[1] ?? 'unknown', kind: isTest ? 'TEST' : isEntry ? 'ENTRYPOINT' : 'SOURCE', imports: importsOf(path) };
});
const allLayers = [...new Set(nodes.map((node) => node.layer))].sort();
const policy = {
  contracts: ['contracts'], governance: ['governance'], security: ['contracts','security'], runtime: ['contracts','runtime','security'], artifacts: ['artifacts','contracts'], capabilities: ['capabilities','contracts'],
  platform: ['artifacts','contracts','platform','security','runtime'], agents: ['agents','contracts','ai'], ai: ['ai','contracts'], operations: ['contracts','operations','platform','ai'],
  product: ['contracts','repository','product','ai'], repository: ['artifacts','contracts','product','repository','security','ai'], validation: ['contracts','validation'],
  'supply-chain': ['contracts','security','supply-chain'], isolation: ['contracts','isolation','security'], app: ['agents','ai','app','artifacts','capabilities','contracts','operations','platform','product','runtime','security'],
  web: ['ai','app','contracts','operations','product','repository','security','web'], cli: allLayers, tests: allLayers,
};
const capabilityPaths = [
  path('governed-model-module',['src/ai/governed-model-orchestrator.ts','src/contracts/canonical.ts','src/contracts/crypto.ts'],['tests/governed-model-orchestrator-v27.test.ts'],'model-run receipt signature and proposal-only action center'),
  path('governed-engineering-assistant',['src/app/governed-engineering-assistant.ts','src/ai/governed-model-orchestrator.ts','src/agents/governed-agent.ts','src/operations/operator-action-center.ts'],['tests/governed-engineering-assistant-v27.test.ts'],'signed review packet connecting model analysis to canonical agent proposals without execution'),
  path('evidence-completeness-gate',['src/platform/evidence-completeness.ts','src/platform/test-execution-provenance.ts','src/platform/replay-ledger.ts'],['tests/evidence-completeness.test.ts'],'promotion gate blocks incomplete evidence'),
  path('incident-to-recertification',['src/platform/incident-recertification.ts','src/platform/recertification-case-store.ts','src/platform/capability-trust.ts'],['tests/recertification-persistence-v26.test.ts','tests/recertification-store-edge-v27.test.ts'],'operational recertification action'),
  path('governed-change-agent',['src/agents/governed-agent.ts','src/agents/agent-proposal-store.ts'],['tests/governed-agent-binding-v26.test.ts'],'independent review before bounded write'),
  path('review-preserving-domain-admission',['src/platform/domain-pack-generator.ts','src/platform/domain-pack.ts'],['tests/domain-pack-admission-v26.test.ts'],'dual-review admission gate'),
  path('durable-runtime',['src/runtime/engine.ts','src/runtime/sqlite-store.ts','src/runtime/postgres-store.ts'],['tests/durable.test.ts','tests/postgres-branch-matrix-v27.test.ts'],'lease, fence, outbox and rollback controls'),
  path('operational-assurance',['src/operations/telemetry.ts','src/operations/action-ledger.ts','src/operations/operator-action-center.ts'],['tests/telemetry-hardening-v25.test.ts','tests/operational-action-ledger-v25.test.ts'],'fail-closed operational action center'),
  path('branch-security-closure',['src/agents/governed-agent.ts','src/contracts/canonical.ts','src/platform/incident-recertification.ts','src/security/private-identity.ts','src/security/attested-kms-adapter.ts'],['tests/governed-agent-branch-v28.test.ts','tests/canonical-branch-v28.test.ts','tests/incident-recertification-branch-v28.test.ts','tests/private-identity-branch-v28.test.ts','tests/attested-kms-branch-v28.test.ts'],'96 percent branch gate plus dedicated authentic mutation controls'),
];
const report = validateArchitectureIntegrity({ nodes, allowedLayerDependencies: policy, capabilityPaths });
const unresolvedFromParser = nodes.flatMap((node) => node.imports.filter((dependency) => !ids.has(dependency)).map((dependency) => ({ node: node.nodeId, dependency })));
const output = { version:'28.0', generatedAt:new Date().toISOString(), repositoryRoot:'.', parser:'TypeScript AST local import/export graph', ...report, parserUnresolved:unresolvedFromParser, policy, limitations:['Dynamic imports and runtime string-based loading require separate tests.','Entrypoints are exempt from direct unit-test reachability but are validated by browser/CLI lanes.','Architecture closure is repository-local and does not qualify external infrastructure.'] };
mkdirSync('evidence/generated',{recursive:true}); writeFileSync('evidence/generated/V28_ARCHITECTURE_INTEGRITY.json',JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({status:output.status,metrics:output.metrics,findings:output.findings,graphDigest:output.graphDigest},null,2));
if(output.status!=='PASS'||unresolvedFromParser.length>0) process.exit(1);

function importsOf(path) {
  const source = ts.createSourceFile(path, readFileSync(path,'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS); const result=[];
  for(const statement of source.statements){
    let specifier;
    if(ts.isImportDeclaration(statement)||ts.isExportDeclaration(statement)) specifier=statement.moduleSpecifier;
    if(specifier&&ts.isStringLiteral(specifier)&&specifier.text.startsWith('.')){
      const resolved=resolveLocal(dirname(path),specifier.text); if(resolved) result.push(toId(resolved)); else result.push(`UNRESOLVED:${toId(path)}:${specifier.text}`);
    }
  }
  return [...new Set(result)].sort();
}
function resolveLocal(base,specifier){
  const raw=resolve(base,specifier); const candidates=[];
  if(specifier.endsWith('.js')) candidates.push(raw.slice(0,-3)+'.ts');
  candidates.push(raw,`${raw}.ts`,resolve(raw,'index.ts'));
  return candidates.find((candidate)=>existsSync(candidate));
}
function toId(path){return relative(root,path).replaceAll('\\','/');}
function path(capabilityId,componentIds,requiredTestIds,operationalControl){return{capabilityId,componentIds,requiredTestIds,evidenceRefs:[`evidence/generated/V28_ARCHITECTURE_INTEGRITY.json#${capabilityId}`],operationalControl,limitations:['local-proof','external-qualification-pending']};}
