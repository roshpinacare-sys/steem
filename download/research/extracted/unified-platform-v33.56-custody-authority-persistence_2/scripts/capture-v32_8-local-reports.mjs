import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const root=resolve('.');const out=resolve(process.env.V32_6_RUN_DIR || (process.env.V32_6_RUN_ID ? join('evidence/runs', process.env.V32_6_RUN_ID) : 'evidence/generated'));mkdirSync(out,{recursive:true});
const identity=JSON.parse(execFileSync('python3',['scripts/test_ops_context_v32_6.py','--identity'],{cwd:root,encoding:'utf8'}));
for(const name of ['V32_COVERAGE_REPORT.json','V32_COVERAGE_SCOPE.json','V32_TEST_QUALITY_AUDIT.json','V32_ARCHITECTURE_INTEGRITY.json']){
 const source=join(root,'evidence/generated',name);if(!existsSync(source))throw new Error(`v32_8_local_report_missing:${name}`);
 const report=JSON.parse(readFileSync(source,'utf8'));writeFileSync(join(out,name),JSON.stringify({...report,...identity,capturedAt:new Date().toISOString()},null,2)+'\n');
}
