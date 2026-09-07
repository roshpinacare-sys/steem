import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('Linux namespace, chroot, seccomp and rlimit prototype contains bounded attacks', { timeout: 30_000 }, () => {
  const result = spawnSync('bash', ['scripts/run-linux-isolation-v19.sh'], { encoding: 'utf8', timeout: 25_000 });
  assert.equal(result.status, 0, result.stderr);
  for (const marker of [
    'allowed=allowed:pass', 'network=network:blocked', 'process=process:blocked',
    'hostfile=hostfile:hidden', 'memory=memory:blocked', 'disk=disk:blocked', 'ptrace=ptrace:blocked',
  ]) assert.match(result.stdout, new RegExp(marker));
  assert.match(result.stdout, /"status": "passed"/);
  assert.match(result.stdout, /"seccomp-denylist-not-allowlist"/);
});
