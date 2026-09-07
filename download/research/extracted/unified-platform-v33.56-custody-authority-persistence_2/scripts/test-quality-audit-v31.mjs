import ts from 'typescript';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
const root=resolve('.'), testsRoot=join(root,'tests'), issues=[], files=[], titles=[];
for(const name of readdirSync(testsRoot).filter(v=>v.endsWith('.test.ts')).sort()){
  const path=join(testsRoot,name), text=readFileSync(path,'utf8'), source=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  let testsDeclared=0,assertCalls=0,subprocessReferences=0;
  function visit(node){
    if(ts.isCallExpression(node)){
      if(ts.isIdentifier(node.expression)&&['test','it'].includes(node.expression.text)){const first=node.arguments[0];if(first&&(ts.isStringLiteral(first)||ts.isNoSubstitutionTemplateLiteral(first))){testsDeclared++;titles.push({title:first.text,path:relative(root,path)});}}
      if(ts.isPropertyAccessExpression(node.expression)&&ts.isIdentifier(node.expression.expression)&&node.expression.expression.text==='assert')assertCalls++;
      if(ts.isIdentifier(node.expression)&&['spawn','spawnSync','execFile','execFileSync'].includes(node.expression.text))subprocessReferences++;
    }
    if(ts.isPropertyAccessExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='test'&&['skip','todo','only'].includes(node.name.text))issues.push({severity:'high',path:relative(root,path),issue:'hidden_or_focused_test',member:node.name.text});
    ts.forEachChild(node,visit);
  }
  visit(source); const record={path:relative(root,path),testsDeclared,assertCalls,subprocessReferences,bytes:Buffer.byteLength(text)};files.push(record);
  if(!testsDeclared)issues.push({severity:'high',path:record.path,issue:'no_test_declarations'});
  if(!assertCalls)issues.push({severity:'high',path:record.path,issue:'no_assert_calls'});
  if(/assert\.ok\(true\)/.test(text))issues.push({severity:'high',path:record.path,issue:'trivial_assertion'});
  if(/await\s+new\s+Promise\([^\n]+setTimeout/.test(text))issues.push({severity:'medium',path:record.path,issue:'fixed_sleep_dependency'});
  if(subprocessReferences>0&&!/timeout|deadline|spawnSync|execFileSync|close\(|kill|wait/i.test(text))issues.push({severity:'medium',path:record.path,issue:'subprocess_without_visible_timeout_or_cleanup'});
}
const grouped=new Map();for(const row of titles)grouped.set(row.title,[...(grouped.get(row.title)??[]),row.path]);const duplicateTitles=[];for(const[title,paths]of[...grouped.entries()].sort())if(paths.length>1){duplicateTitles.push({title,paths});issues.push({severity:'medium',path:paths.join(','),issue:'duplicate_test_title',title});}
const active=['scripts/run-tests-v31-parallel.py','scripts/run-coverage-v31.mjs','scripts/run-automation-mutation-v31.py'];for(const p of active){try{if(readFileSync(p,'utf8').includes('--test-force-exit'))issues.push({severity:'high',path:p,issue:'force_exit_in_active_v31_runner'});}catch{}}
for(const dir of ['src','tests'])for(const name of walk(join(root,dir)).filter(p=>p.endsWith('.ts'))){const text=readFileSync(name,'utf8');if(/sha256\s*\(\s*(?:readFileSync|Buffer\.|[A-Za-z_$][\w$]*(?:Bytes|Buffer|Ciphertext|moduleBytes))/.test(text)&&!name.endsWith('canonical-json-hardening-v26.test.ts')&&!name.endsWith('core-security-telemetry-edge-v27.test.ts'))issues.push({severity:'high',path:relative(root,name),issue:'binary_data_passed_to_structured_sha256'});}
const pkg=JSON.parse(readFileSync('package.json','utf8'));if(pkg.scripts?.test!=='npm run test:v31'||pkg.scripts?.validate!=='npm run validate:v31')issues.push({severity:'high',path:'package.json',issue:'active_alias_not_v31'});for(const[name,command]of Object.entries(pkg.scripts??{}))if(/scripts\/[\w.-]+\.sh/.test(command)&&!/(?:^|&&|;)\s*bash\s+scripts\//.test(command))issues.push({severity:'high',path:'package.json',issue:'shell_script_without_explicit_interpreter',script:name});
for(const name of walk(join(root,'scripts')).filter(p=>p.endsWith('.sh'))){const text=readFileSync(name,'utf8');if(/^\s*"\$ROOT\/scripts\/[^"]+\.sh"/m.test(text))issues.push({severity:'high',path:relative(root,name),issue:'nested_shell_script_without_explicit_interpreter'});}
const critical=issues.filter(i=>['critical','high'].includes(i.severity)), medium=issues.filter(i=>i.severity==='medium');const report={version:'31.0',status:critical.length===0&&medium.length===0?'passed':'failed',parser:'TypeScript AST plus active-runner, binary-domain, shell-portability and package-alias audits',filesAudited:files.length,testsDeclared:files.reduce((s,r)=>s+r.testsDeclared,0),assertCalls:files.reduce((s,r)=>s+r.assertCalls,0),criticalOrHighIssues:critical.length,mediumIssues:medium.length,duplicateTitles,issues,files,runnerChecks:{activeV31ForceExitForbidden:true,subprocessTimeoutAndCleanupHeuristic:true,duplicateTitleAudit:true,binaryHashDomainAudit:true,explicitShellInterpreterAudit:true,activeAliasAudit:true},limitations:['Static analysis complements but does not replace execution, mutation, leak detection or manual review.']};mkdirSync('evidence/generated',{recursive:true});writeFileSync('evidence/generated/V31_TEST_QUALITY_AUDIT.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,filesAudited:report.filesAudited,testsDeclared:report.testsDeclared,assertCalls:report.assertCalls,criticalOrHighIssues:report.criticalOrHighIssues,mediumIssues:report.mediumIssues},null,2));if(report.status!=='passed')process.exit(1);
function walk(dir){const out=[];for(const e of readdirSync(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())out.push(...walk(p));else if(e.isFile())out.push(p);}return out;}
