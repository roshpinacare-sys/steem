import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('v23 Linux isolation uses a default-deny syscall allowlist and blocks added escape surfaces', { timeout: 30_000 }, () => {
  const result = spawnSync('bash', ['scripts/run-linux-isolation-v23.sh'], { encoding: 'utf8', timeout: 25_000 });
  assert.equal(result.status, 0, result.stderr);
  for (const marker of ['allowed=allowed:pass','network=network:blocked','process=process:blocked','hostfile=hostfile:hidden','memory=memory:blocked','disk=disk:blocked','ptrace=ptrace:blocked','exec=exec:blocked','uname=uname:blocked']) {
    assert.match(result.stdout, new RegExp(marker));
  }
  assert.match(result.stdout, /seccomp-default-deny-rlimit-v23/);
  assert.doesNotMatch(result.stdout, /seccomp-denylist-not-allowlist/);
  assert.match(result.stdout, /kernel-4\.4-no-landlock/);
});
