import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { release } from 'node:os';
const tools = ['psql','postgres','initdb','docker','podman','wasmtime','wasmer','firecracker','bwrap','firejail','clang','wasm-ld','chromium','playwright','git','openssl','cosign','syft','grype','otelcol','unshare','prlimit','perf','strace','hyperfine','taskset','flock'];
const probe = {};
for (const tool of tools) {
  try { probe[tool] = { available: true, path: execFileSync('sh',['-lc',`command -v ${tool}`],{encoding:'utf8'}).trim() }; }
  catch { probe[tool] = { available: false }; }
}
let cgroupMode = 'unknown';
try { cgroupMode = execFileSync('sh',['-lc',"test -f /sys/fs/cgroup/cgroup.controllers && echo v2 || echo v1"],{encoding:'utf8'}).trim(); } catch {}
const report = {
  version:'26.0', generatedAt:new Date().toISOString(), node:process.version, kernel:release(), cgroupMode,
  tools:probe,
  blockers:Object.entries(probe).filter(([,v])=>!v.available).map(([k])=>k),
  qualificationImplications:{
    postgres: probe.psql?.available && probe.postgres?.available ? 'locally-available' : 'environment-blocked',
    isolation: probe.unshare?.available ? 'single-host-research-possible' : 'environment-blocked',
    realKmsHsm: 'not-probed-no-authorized-endpoint',
    multiHost: 'not-available'
  }
};
mkdirSync('evidence/generated',{recursive:true});
writeFileSync('evidence/generated/V26_ENVIRONMENT_PROBE.json',JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify(report,null,2)+'\n');
