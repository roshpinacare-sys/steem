import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const tools = ['psql', 'postgres', 'docker', 'podman', 'wasmtime', 'wasmer', 'firecracker', 'bwrap', 'unshare', 'gcc', 'clang', 'wasm-ld', 'chromium'];
const found = {};
for (const tool of tools) {
  const probe = spawnSync('sh', ['-lc', `command -v ${tool} || true`], { encoding: 'utf8' });
  found[tool] = probe.stdout.trim() || null;
}
let namespace = { status: 'BLOCKED_ENVIRONMENT', detail: 'unshare unavailable' };
if (found.unshare !== null) {
  const probe = spawnSync(found.unshare, ['--user', '--map-root-user', '--net', 'true'], { encoding: 'utf8' });
  namespace = probe.status === 0
    ? { status: 'AVAILABLE', detail: 'user and network namespaces available' }
    : { status: 'BLOCKED_ENVIRONMENT', detail: (probe.stderr || probe.stdout).trim() };
}
const playwrightProbe = spawnSync('python3', ['-c', 'import playwright; print("available")'], { encoding: 'utf8' });
let cgroup = { status: 'BLOCKED_ENVIRONMENT', detail: 'cgroup filesystem unavailable' };
try {
  const mode = statSync('/sys/fs/cgroup').mode;
  const mounts = readFileSync('/proc/mounts', 'utf8').split('\n').filter((line) => line.includes('/sys/fs/cgroup'));
  cgroup = {
    status: 'BLOCKED_ENVIRONMENT',
    detail: `cgroup exists but no delegated writable v2 subtree was qualified; mode=${mode.toString(8)} mounts=${mounts.length}`,
  };
} catch {}
const report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  tools: found,
  pythonPlaywright: playwrightProbe.status === 0 ? 'AVAILABLE' : 'BLOCKED_ENVIRONMENT',
  chromiumLoopbackNavigation: 'BLOCKED_BY_ADMINISTRATOR_POLICY',
  postgres: found.psql && found.postgres ? 'AVAILABLE' : 'BLOCKED_ENVIRONMENT',
  rootlessContainer: found.docker || found.podman ? 'AVAILABLE' : 'BLOCKED_ENVIRONMENT',
  wasiComponentRuntime: found.wasmtime || found.wasmer ? 'AVAILABLE' : 'BLOCKED_ENVIRONMENT',
  wasmCoreToolchain: found.clang && found['wasm-ld'] ? 'AVAILABLE' : 'BLOCKED_ENVIRONMENT',
  microvm: found.firecracker ? 'AVAILABLE' : 'BLOCKED_ENVIRONMENT',
  linuxNamespace: namespace,
  cgroupDelegation: cgroup,
  rule: 'Unavailable candidates are blocked, never counted as passing.',
};
const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(here, '..', 'evidence', 'generated', 'environment-probe.json');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
