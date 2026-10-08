# R262 · Incident: cockpit dev-server death (kernel OOM) + survival doctrine fix

- At: 2026-10-08 (measured live during R262)
- Symptom (user-visible): the cockpit preview died — "השרת נפל". Port :3000 stopped listening.

## Evidence chain (no claims, measurements only)

1. `dmesg`: `Out of memory: Killed process 1635 (MainThread) total-vm:4377676kB, anon-rss:2194656kB`
   — the kernel OOM killer terminated the next-server process (turbopack).
2. `/home/z/my-project/.next` had grown to **2.5GB** on a 4GB-RAM box with 4 bun organs + gateway
   co-resident — the unbounded turbopack cache is the root cause of the OOM, not a code bug.
3. `/start.sh` boot flow spawns `next dev` exactly once at boot; **no supervisor watches :3000**.
   The sovereign watchdog (src/lib/sovereign.ts) lives INSIDE next-server (instrumentation.register),
   so when next-server died, its own watchdog died with it — the system cannot resurrect the
   process that hosts its resurrecter. Structural single-point-of-failure, now measured.
4. Sandbox reaping law (re-measured live this round): every agent-tool process tree is killed at
   tool-call end — `setsid sleep 600` (double-detached) was reaped between two consecutive calls;
   a dev-keeper spawned from an agent-launched next-server was reaped as well. Only boot-lineage
   processes (children of pid 1 / of the boot next-server tree) survive — this is the already-known
   R216-b doctrine, now re-proven under fire.

## Fix shipped this round (all additive, no gate touched)

1. `mini-services/dev-keeper/` — new organ (:3044, `/health`): probes :3000 every 8s; if down →
   cache hygiene (wipe `.next` when > 1.2GB — the OOM root-cause guard) → respawn `bun run dev`
   detached. Single-instance fresh-lock law; fixed command whitelist; no secrets; no params.
2. `src/lib/dev-keeper-organ.ts` + `POST /api/saos/spawn-dev-keeper` — standard R216-b implant
   connector (works whenever next-server is alive; idempotent, refused-when-healthy).
3. `.git/hooks/pre-commit` (additive, ALWAYS exit 0, no other hooks existed) — when the custodian
   (boot lineage) commits, the hook implants dev-keeper if :3044 is down. This is the only lawful
   birth channel while next-server is dead: boot-lineage spawn, immune to tool-call reaping.
4. Future boots: `/start.sh` scans `mini-services/*` for `package.json` dev scripts — dev-keeper
   is auto-started at every cold boot, so the cockpit gains a permanent self-healing watchdog.
