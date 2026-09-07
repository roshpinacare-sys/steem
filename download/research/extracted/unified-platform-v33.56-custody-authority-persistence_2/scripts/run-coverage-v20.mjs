import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const testsRoot = resolve('dist/tests');
const excluded = new Set([
  'wasm-capability-runner.test.js','wasm-isolation.test.js','web-server.test.js','linux-isolation.test.js',
  'multiprocess.test.js','web-workflow.test.js','private-pilot-server.test.js','private-server-config.test.js',
  'repository-change.test.js','session-archiver.test.js',
]);
const files = readdirSync(testsRoot).filter((name)=>name.endsWith('.test.js')&&!excluded.has(name)).sort().map((name)=>join(testsRoot,name));
const result=spawnSync('timeout',['--signal=KILL','150s',process.execPath,'--test','--test-concurrency=1','--test-force-exit','--experimental-test-coverage',...files],{
  encoding:'utf8',maxBuffer:64*1024*1024,env:{...process.env,NODE_OPTIONS:'',NODE_ENV:'test'},
});
const output=`${result.stdout??''}${result.stderr??''}`;
mkdirSync('evidence/generated',{recursive:true});
writeFileSync('evidence/generated/v20-coverage.log',output);
process.stdout.write(output);
const timedOut=result.status===124||result.status===137||result.signal==='SIGKILL';
const metadata={version:'20.0',status:result.status===0&&!timedOut?'passed':timedOut?'timed-out':'failed',scope:'stable in-process contracts, local persistence, security, governance and adapter tests',includedTestFiles:files.map((f)=>f.split('/').at(-1)),excludedTestFiles:[...excluded].sort(),reason:'Node experimental coverage excludes process-group, HTTP server, namespace, WebAssembly worker and repository-execution lanes. Those are validated in the complete sharded correctness suite.',exitCode:result.status,signal:result.signal};
writeFileSync('evidence/generated/v20-coverage-scope.json',`${JSON.stringify(metadata,null,2)}\n`);
if(metadata.status!=='passed')process.exit(1);
