import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const evidenceDir = resolve(root, "docs/canonical/evidence/v16/offline-install");
mkdirSync(evidenceDir, { recursive: true });
const preparedCache = resolve(process.env.TITAI_OFFLINE_CACHE ?? join(root, ".offline-build", "npm-cache"));
const bundleDir = resolve(process.env.TITAI_OFFLINE_BUNDLE_DIR ?? join(root, ".offline-build", "bundle"));
const cleanRoot = mkdtempSync(join(tmpdir(), "titai-v16-offline-install-"));
const sourceDir = join(cleanRoot, "source");

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out=[];
  for (const name of readdirSync(dir)) {
    const path=join(dir,name); const info=statSync(path);
    if (info.isDirectory()) out.push(...walk(path)); else if (info.isFile()) out.push(path);
  }
  return out;
}
function sha(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function run(name, command, args, options={}) {
  const started=performance.now();
  const result=spawnSync(command,args,{cwd:options.cwd??root,env:{...process.env,...options.env},encoding:"utf8",maxBuffer:64*1024*1024});
  const record={name,command:[command,...args],exitCode:result.status??1,durationMs:Math.round(performance.now()-started),stdout:result.stdout??"",stderr:result.stderr??""};
  writeFileSync(join(evidenceDir,`${name}.json`),`${JSON.stringify({...record,stdoutSha256:createHash("sha256").update(record.stdout).digest("hex"),stderrSha256:createHash("sha256").update(record.stderr).digest("hex")},null,2)}\n`);
  if (record.exitCode!==0) throw new Error(`${name}_failed:${record.exitCode}`);
  return record;
}
function copySource() {
  const exclusions=new Set(["node_modules",".next",".offline-build","data"]);
  mkdirSync(sourceDir,{recursive:true});
  for (const name of readdirSync(root)) {
    if (exclusions.has(name)) continue;
    const from=join(root,name), to=join(sourceDir,name);
    cpSync(from,to,{recursive:true,preserveTimestamps:true,filter:(src)=>!src.includes(`${join(root,"docs","canonical","evidence","v16","offline-install")}`)});
  }
}
try {
  rmSync(bundleDir,{recursive:true,force:true}); mkdirSync(bundleDir,{recursive:true});
  const defaultCache = resolve(process.env.TITAI_SOURCE_NPM_CACHE ?? join(process.env.HOME ?? "", ".npm"));
  if (!existsSync(preparedCache) || walk(preparedCache).length === 0) {
    if (!existsSync(defaultCache)) throw new Error("verified_source_npm_cache_missing");
    rmSync(preparedCache,{recursive:true,force:true});
    cpSync(defaultCache,preparedCache,{recursive:true,preserveTimestamps:true});
  }
  run("verify-prepared-cache","npm",["cache","verify","--cache",preparedCache],{cwd:root});
  copySource();
  const attemptLog=join(evidenceDir,"offline-network-attempts.jsonl");
  writeFileSync(attemptLog,"");
  const preload=resolve(root,"scripts/network-audit-preload.cjs");
  const offlineEnv={
    npm_config_offline:"true",
    npm_config_audit:"false",
    npm_config_fund:"false",
    npm_config_update_notifier:"false",
    npm_config_proxy:"http://127.0.0.1:9",
    npm_config_https_proxy:"http://127.0.0.1:9",
    TITAI_NETWORK_ATTEMPT_LOG:attemptLog,
    NODE_OPTIONS:`--require=${preload}`,
  };
  run("offline-npm-ci","npm",["ci","--offline","--ignore-scripts","--no-audit","--no-fund","--cache",preparedCache],{cwd:sourceDir,env:offlineEnv});
  run("offline-typecheck","npm",["run","typecheck"],{cwd:sourceDir,env:offlineEnv});
  const sovereignTests = readdirSync(join(sourceDir,"tests")).filter((name)=>name.startsWith("sovereign-") && name.endsWith(".test.ts")).sort().map((name)=>`tests/${name}`);
  run("offline-sovereignty-tests",process.execPath,["scripts/run-complete-tests.mjs",...sovereignTests],{cwd:sourceDir,env:{...offlineEnv,TITAI_TEST_EVIDENCE_DIR:"docs/canonical/evidence/v16/offline-isolated-tests",TITAI_TEST_CONCURRENCY:"2"}});
  const attempts=readFileSync(attemptLog,"utf8").trim().split(/\n/).filter(Boolean).map((line)=>JSON.parse(line));
  const remoteAttempts=attempts.filter((item)=>{
    const target=String(item.target??item.host??item.hostname??"");
    return target && !/localhost|127\.0\.0\.1|::1/.test(target);
  });
  const cacheFiles=walk(preparedCache).map((path)=>({path:relative(preparedCache,path).replaceAll("\\","/"),bytes:statSync(path).size,sha256:sha(path)}));
  const packageFiles=["package.json","package-lock.json"].map((name)=>({path:name,bytes:statSync(join(root,name)).size,sha256:sha(join(root,name))}));
  const manifest={preparation:{sourceCache:"pre-existing verified npm content-addressable cache",networkAcquisitionPerformedByProof:false},format:"titai-offline-install-manifest",version:1,createdAt:new Date().toISOString(),nodeRequirement:readFileSync(join(root,".nvmrc"),"utf8").trim(),packageManager:`npm ${process.env.npm_config_user_agent??"unknown"}`,cache:{files:cacheFiles.length,bytes:cacheFiles.reduce((sum,file)=>sum+file.bytes,0),entries:cacheFiles},sourceControlFiles:packageFiles,commands:{install:"npm ci --offline --ignore-scripts --no-audit --no-fund --cache ./npm-cache",verify:["npm run typecheck","npm run test:sovereignty"]},network:{instrumentedAttempts:attempts.length,remoteAttempts:remoteAttempts.length},limitations:["A compatible Node.js runtime must be installed or supplied as a separately verified platform artifact.","The dependency cache must be prepared and verified before disconnection; this proof performs no acquisition during the offline install phase.","Package lifecycle scripts remain disabled; native optional drivers use the Node built-in SQLite fallback."]};
  writeFileSync(join(bundleDir,"OFFLINE_INSTALL_MANIFEST.json"),`${JSON.stringify(manifest,null,2)}\n`);
  writeFileSync(join(bundleDir,"CACHE_LOCATION.txt"),`${preparedCache}\n`);
  for (const name of ["package.json","package-lock.json",".nvmrc"]) cpSync(join(root,name),join(bundleDir,name));
  writeFileSync(join(bundleDir,"INSTALL.txt"),["TITAI v16 offline dependency installation","","Requirements:",`- Node.js ${manifest.nodeRequirement}` ,"- npm included with Node.js","","Command:",manifest.commands.install.replace("./npm-cache", preparedCache),"","Verification:",...manifest.commands.verify.map((item)=>`- ${item}`),""].join("\n"));
  const summary={format:"titai-offline-install-evidence",version:1,preparedCache,bundleDir,cleanSource:sourceDir,cleanSourceRetainedForInspection:true,offlineInstallPassed:true,typecheckPassed:true,sovereigntyTestsPassed:true,networkAttempts:attempts.length,remoteAttempts:remoteAttempts.length,cacheFiles:cacheFiles.length,cacheBytes:manifest.cache.bytes,manifestSha256:sha(join(bundleDir,"OFFLINE_INSTALL_MANIFEST.json"))};
  writeFileSync(join(evidenceDir,"summary.json"),`${JSON.stringify(summary,null,2)}\n`);
  console.log(JSON.stringify(summary));
} finally {
  // Cleanup is intentionally not on the critical proof path: removing a large
  // temporary node_modules tree can exceed restricted execution windows.
  // The retained path is outside the release source and is reported in evidence.
}
