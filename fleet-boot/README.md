# fleet-boot — self-healing boot kit

Restored 2026-11-01 after the deep wipe that destroyed `/home/z/my-project/fleet`
(including this beat code, which until now was never committed anywhere — the
root cause of every "DISARMED streak": the tree existed only in ephemeral storage).

## Contents
- `boot-fleet.sh` — idempotent self-boot: recreates the `/home/z/fleet` entry
  symlink; if the workspace itself was wiped, re-materializes it from this repo
  (clone `saos-cockpit`, reinstall `saos-dex/beat-loop.sh`).
- `saos-dex/beat-loop.sh` — one grid beat per invocation: custody judge →
  dispatch Domain `dex-grid.yml` → verdict line (ARMED-LIVE / ARMED-WAITING / DISARMED).
- `askpass.sh` — supplies the owner GitHub token from the local secret file at
  clone/push time; never embeds or prints key material.

## Recovery contract
`bash fleet-boot/boot-fleet.sh` must always end with `boot-fleet: entry=OK`
or an honest error. Never fake a verdict.
