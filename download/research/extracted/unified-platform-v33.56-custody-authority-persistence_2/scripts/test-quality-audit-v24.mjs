import ts from 'typescript';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root=resolve('.'); const testsRoot=join(root,'tests'); const issues=[]; const files=[]; const titles=[];
for(const name of readdirSync(testsRoot).filter((value)=>value.endsWith('.test.ts')).sort()){
  const path=join(testsRoot,name); const text=readFileSync(path,'utf8'); const source=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  let testsDeclared=0,assertCalls=0,subprocessReferences=0;
  function visit(node){
    if(ts.isCallExpression(node)){
      if(ts.isIdentifier(node.expression)&&['test','it'].includes(node.expression.text)){
        const first=node.arguments[0];
        if(first&&(ts.isStringLiteral(first)||ts.isNoSubstitutionTemplateLiteral(first))){testsDeclared+=1;titles.push({title:first.text,path:relative(root,path)});}
      }
      if(ts.isPropertyAccessExpression(node.expression)&&ts.isIdentifier(node.expression.expression)&&node.expression.expression.text==='assert')assertCalls+=1;
      if(ts.isIdentifier(node.expression)&&['spawn','spawnSync','execFile','execFileSync'].includes(node.expression.text))subprocessReferences+=1;
    }
    if(ts.isPropertyAccessExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='test'&&['skip','todo','only'].includes(node.name.text))issues.push({severity:'high',path:relative(root,path),issue:'hidden_or_focused_test',member:node.name.text});
    ts.forEachChild(node,visit);
  }
  visit(source);
  const record={path:relative(root,path),testsDeclared,assertCalls,subprocessReferences,bytes:Buffer.byteLength(text)}; files.push(record);
  if(testsDeclared===0)issues.push({severity:'high',path:record.path,issue:'no_test_declarations'});
  if(assertCalls===0)issues.push({severity:'high',path:record.path,issue:'no_assert_calls'});
  if(/assert\.ok\(true\)/.test(text))issues.push({severity:'high',path:record.path,issue:'trivial_assertion'});
  if(/await\s+new\s+Promise\([^\n]+setTimeout/.test(text))issues.push({severity:'medium',path:record.path,issue:'fixed_sleep_dependency'});
  if(subprocessReferences>0&&!/timeout|deadline|spawnSync|close\(|kill/i.test(text))issues.push({severity:'medium',path:record.path,issue:'subprocess_without_visible_timeout_or_cleanup'});
}
const grouped=new Map(); for(const row of titles)grouped.set(row.title,[...(grouped.get(row.title)??[]),row.path]);
const duplicateTitles=[]; for(const [title,paths] of [...grouped.entries()].sort())if(paths.length>1){duplicateTitles.push({title,paths});issues.push({severity:'medium',path:paths.join(','),issue:'duplicate_test_title',title});}
for(const relativePath of ['scripts/run-tests-v24-parallel.py','scripts/run-coverage-v24.mjs','scripts/run-mutation-v24.py','scripts/validate-v24.py']){
  const path=join(root,relativePath); try{if(readFileSync(path,'utf8').includes('--test-force-exit'))issues.push({severity:'high',path:relativePath,issue:'force_exit_in_active_v24_runner'});}catch{}
}
const critical=issues.filter((item)=>['critical','high'].includes(item.severity)); const medium=issues.filter((item)=>item.severity==='medium');
const report={version:'24.0',status:critical.length===0?'passed':'failed',parser:'TypeScript AST for real test declarations and assertions',filesAudited:files.length,testsDeclared:files.reduce((sum,row)=>sum+row.testsDeclared,0),assertCalls:files.reduce((sum,row)=>sum+row.assertCalls,0),criticalOrHighIssues:critical.length,mediumIssues:medium.length,duplicateTitles,issues,files,runnerChecks:{activeV24ForceExitForbidden:true,subprocessTimeoutAndCleanupHeuristic:true,duplicateTitleAudit:true,templateStringFalsePositivesExcluded:true},limitations:['Static AST audit does not replace execution, mutation testing, leak detection or manual test review.']};
mkdirSync(join(root,'evidence','generated'),{recursive:true});writeFileSync(join(root,'evidence','generated','V24_TEST_QUALITY_AUDIT.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,filesAudited:report.filesAudited,testsDeclared:report.testsDeclared,assertCalls:report.assertCalls,criticalOrHighIssues:report.criticalOrHighIssues,mediumIssues:report.mediumIssues},null,2));if(report.status!=='passed')process.exit(1);
