import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const tools = ['psql','postgres','docker','podman','wasmtime','wasmer','firecracker','bwrap','clang','wasm-ld','chromium','playwright','git','openssl','cosign','syft','grype','otelcol','unshare','prlimit'];
const probe = {};
for (const tool of tools) {
  try { probe[tool] = { available: true, path: execFileSync('sh',['-lc',`command -v ${tool}`],{encoding:'utf8'}).trim() }; }
  catch { probe[tool] = { available: false }; }
}
const report = { version:'20.0', generatedAt:new Date().toISOString(), node:process.version, tools:probe, blockers:Object.entries(probe).filter(([,v])=>!v.available).map(([k])=>k) };
mkdirSync('evidence/generated',{recursive:true});
writeFileSync('evidence/generated/environment-v22.json',JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify(report,null,2)+'\n');
