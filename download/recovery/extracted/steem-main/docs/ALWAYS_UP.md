# ALWAYS-UP — the never-fall doctrine (Tasks 82 + 83)

> "שלא ניפול יותר לעולם" — the operator's directive. This document is the
> engineering answer: **six** independent, drill-proven layers. No layer trusts
> another; each is verifiable alone. Task 83 added the layer that lives
> OUTSIDE the sandbox.

## The threat model (what actually happens)

| Threat | Reality |
|---|---|
| Sandbox restored to an OLD snapshot | happened daily before Task 82 (code reverted, keys wiped, chain state rolled back) |
| Keys wiped with the machine | every reset destroyed agent/keys + agent/.env (they are never in git — iron law) |
| Daemon dies / double-spawns | respawn races produced duplicate beats and ghost processes |
| "Everything is lost" | only true if work is never pushed |

## The six layers (all drill-proven, no claims)

### L1 — gitkeeper: the work always lives on origin
- Every daemon cycle (30m): `git add -A` → **SECRET GATE** (WIF/token patterns abort the commit) → commit → `git push origin main`.
- Noise filter keeps runtime locks/reports out of history. `fleet_keys.enc` (AES ciphertext) is exempt from the plaintext gate.
- Origin/main is therefore **the single truth** — at most 30 minutes of work is ever at risk.
- Verify: `agent/gitkeeper_state.json` (result=committed, pushed=true).

### L2 — guardian: anti-rollback + self-heal (agent/guardian.cjs)
- Runs on **every** Next.js server boot (src/instrumentation.ts → lib/guardian-boot-node.ts), before every dev (`package.json` dev script), and every 10 min from the daemon loop.
- `git fetch` → if HEAD is behind/diverged from origin/main: stash local noise (never destroyed) → **`git reset --hard origin/main`** → recycle the daemon (in-memory code is pre-heal) → healDaemon respawns fresh.
- Self-heal: missing node_modules → bun/npm install · missing .env → honest DRY skeleton · dead daemon → respawn (verified alive) · stale chain (>20 min, no daemon) → sovereign beat.
- **Drill A (2026-09-05)**: reset --hard to 47fa4e9 (pre-attest old snapshot) → `ROLLBACK-HEALED` 47fa4e9 → 0749da7 in **5.04 s**, daemon respawned (pid 8399), chain continued 220→251.
- Verify: `agent/guardian_result.json` after any boot.

### L3 — fleet vault: zero-touch fleet restore (agent/fleet_vault.cjs)
- `--seal`: vault.json + keys/*.json + .env → AES-256-GCM (scrypt KDF, random 256-bit pass) → `agent/fleet_keys.enc` + meta (committed to the **private** repo; ciphertext + pass in-repo is the documented availability tradeoff — plaintext never leaves the machine).
- Auto-seal fires whenever the live keys/.env are newer than the seal.
- On any reset where keys are gone but the seal exists → **decrypt + verbatim restore (atomic tmp+rename, mode 600)** → daemon respawns → the whole fleet is back **without the operator**.
- **Drill B (2026-09-05, run twice)**: `rm -rf agent/keys` → guardian → `FLEET-RESTORED-FROM-SEAL(zero-touch)` → vault.json byte-identical (10 accounts), .env restored with REAL mode intact, single daemon respawn (pid 9644).
- Operator's total future involvement after a wipe: **none** (paste master key once per era; auto-seal takes it from there).

### L4 — singleton daemon (agent.cjs)
- `.daemon.lock` (live-pid check, released on shutdown) — a second daemon self-exits instead of double-beating/double-broadcasting.
- Verified live: `node agent.cjs` while one runs → `[singleton] daemon already alive (pid …) — exiting`.
- Army load retries ×3 on torn reads (a concurrent restore used to silently produce army=0 and mute the fleet).

### L5 — LIVING-ATTEST: the chains remember (agent/chain_attest.cjs)
- Every 30 m: height + stateRoot + lastBlockHash + driving git-commit → custom_json **id=saos.attest.v1** (active authority, local sign) on **Steem + Hive**.
- The heartbeat is public, permanent, third-party-checkable — a total wipe of this machine cannot erase the network's resume: the latest expected height/stateRoot live ON-CHAIN, forever.
- `node chain_attest.cjs --read`: scans account history for the latest attest → verdict (LIVE-CURRENT / LOCAL-BEHIND / ROOT-MISMATCH / LOCAL-MISSING / NO-ATTEST) → writes `sovereign/node/RECOVERY_POINTER.json` (the recovery bar). Guardian's healChain invokes it when chain.json is lost.
- **Live evidence (2026-09-05)**: steem `634b65e2…` + hive `325e7504…` (block 109651027) + daemon-driven steem `3958d3c8…`, `5dbf4f2a…` (h233), steem `228d37dd…` + hive `9a419784…` (h238, 2/2 chains); read-back verdict **LIVE-CURRENT**. Identity anchors (saos.id.v1, EIP-191): steem `3aa56af2…`, `1238108b…`.
- **RC-race lesson**: Hive returned an RC-mana error while the tx actually landed → errored broadcasts are treated as *uncertain*; account history is the only judge.

### L6 — CLOUD-HEART: the executor OUTSIDE the sandbox (Task 83)
- **L1–L5 all ran INSIDE the sandbox. A dead sandbox meant nothing runs.** The fix is structural: `.github/workflows/cloud-heart.yml` runs `agent/cloud_heartbeat.cjs` on **GitHub's cloud every 30 minutes** (plus manual dispatch), for free (~1 min on the alive path → ≈750 Actions-minutes/month on a private repo).
- **Leader election by freshness, two independent signals**: on-chain attest < 95 min (3 missed cycles) **OR** last gitkeeper push < 75 min (chain.json moves on every beat → origin/main always moves while the sandbox lives).
  - **SANDBOX-ALIVE** → the cloud verifies (keyless: reads the attest via public RPC), writes a report artifact, touches NOTHING. The sandbox is primary.
  - **SANDBOX-DOWN** (both signals stale) → **TAKEOVER**: write `agent/cloud_takeover.json` (committed) → `fleet_vault --open` (**zero-touch fleet-key restore from the in-repo AES seal — no operator, no secrets service**) → one full cycle of every loop (`ONCE=1 node agent.cjs`) → wait for saosnet quiesce → synchronous `saosnet.cjs --beat --live` → broadcast the leadership attest (the chain learns the cloud took over) → gitkeeper commit+push. **The network does not stop because a sandbox died.**
- **Command-handover discipline**: all **7 economic loops** (liq, microdex, yield, merchant, paymaster, valueLock, wrapped) check `cloudEconPaused()` (fresh `cloud_takeover.json` < 50 min) and stand down — a revived sandbox and a finishing cloud window can never double-fire money actions. Claims/curation keep their own daily caps; the sandbox reclaims command automatically once its attest/git are fresh again.
- **Public-steem-history lesson (Task 83)**: `get_account_history` caps at **100 ops** on Steem condenser nodes (500 → hard error on ALL nodes → silent Hive fallback → a fresh attest looked stale to the cloud judge). Fixed: adaptive paging (hive 500 / steem 100×8). **Read-back also lags minutes behind head** — hence the second, git-based liveness signal.
- **Drill C-1 (alive, 2026-09-05)**: keyless read → SANDBOX-ALIVE → zero writes. **Drill C-2 (forced takeover)**: marker → seal-open OK → full cycle 47 s → beat **h271→h286** → attest **steem cf76e238…** (landed block 109317845) → **18 files pushed** — end-to-end in 3 minutes. Read-back later confirmed the cloud's attest (h286 @ 15:39) once the history index caught up.
- Verify: `node agent/cloud_heartbeat.cjs` locally, or GitHub → **Actions → cloud-heart** (every run leaves a report artifact + step summary).

### L7 — SELF-HOST verdict: "does the network sit on its own server?" — proven by deduction (Task 84)
- **The question the operator kept asking**: not "can it fail over?" but "is it, right now, verifiably running on its own server?". Answered by `agent/verify_selfhost.cjs` — a deduction engine over witnesses that CANNOT lie: the LIVING-ATTEST on Steem/Hive (public RPC), the origin/main commit stream (cloud-heart[bot] fingerprints), the local daemon pid, and the GitHub Actions report artifacts (`takeover:true` = the cloud actually RAN the network; an alive-path run only watches).
- **Verdicts**: `SELF-HOSTED-PROVEN` (chain advanced + cloud-execution evidence) · `CLOUD-TAKEOVER-PENDING` (sandbox dead, takeover ≤30 min away) · `SANDBOX-PRIMARY · CLOUD-STANDBY` (sandbox drives, cloud watching) · `DARK` (nothing fresh anywhere). Surfaced live in Console → מערכת → "שרת-עצמי" (`/api/ops/selfhost`).
- **Drill D — the definitive experiment (2026-09-05, 16:38Z)**: local daemon killed (pgrep-verified) → `workflow_dispatch mode=takeover` → cloud run 33978481410: takeover-marker ✓ → seal-open ✓ (zero-touch key restore ON THE CLOUD) → full agent cycle ✓ (econ stand-down discipline held) → **saosnet beat ✓ 316→326** (on-chain explorer-pub txid 8aa7c176…) → chain-attest ✓ steem **89266b2f…** → gitkeeper push ✓ → commit **49dced8 authored cloud-heart[bot]** on origin/main. The network demonstrably ran — chain, attest, git — while its sandbox executor was dead. Verdict flipped to SELF-HOSTED-PROVEN with the takeover run inside the recorded kill/revive window.
- **Two real bugs the drill caught (and their structural fixes)**: (1) `saosnet.cjs` could not resolve `steem` on a cloud checkout (only agent/ deps are installed) → MODULE_NOT_FOUND, the beat silently no-oped in drill D-1 → fixed with an `agent/node_modules` require-fallback that works on ANY checkout shape. (2) The cloud's gitkeeper push lost a race to a local-runner push (`! [rejected] fetch first`) and its evidence commit died with the ephemeral runner → `pushWithHeal()`: on rejection `fetch + reset --soft origin + re-commit` — a state-snapshot repo wants last-writer-wins, never a JSON merge. Also: forced-takeover verdicts now say "DRILL-FORCED" instead of faking a stale sandbox.
- **Fingerprint hygiene lesson**: a LOCAL takeover drill (Task 83 C-2) left `user.name=cloud-heart[bot]` in the sandbox .git/config — sandbox commits wore cloud fingerprints forever after, which would have forged the deduction. Cleaned; cloud identity is now set ONLY under `CLOUD_HEART=1` (real cloud runs); local drills commit under the local identity.
- **Push-credential rebirth (the 2026-09-05 token incident)**: the operator hand-delivered a fresh GitHub token after the old one died with a sandbox. The token is now sovereignty infrastructure: `GITHUB_TOKEN` lives in `agent/.env` → inside the AES fleet seal → restored zero-touch on every reset; guardian `healPushCreds` repairs `.git/config` from it on every boot (before fetch/push); gitkeeper repairs + retries on auth failures. A dead token can no longer cut the repo's voice.

### L8 — THE HEBREW REPORT: the human layer (Task 85)
- **The operator's complaint**: "אתה מסכם לי בסינית — אין לי מושג מה עשית". Every session ended in a language he cannot read. The structural answer is not a better chat summary — it is a **living Hebrew report inside the repo itself**: `agent/he_report.cjs` runs every 30 min (daemon cycle `heReport`, 85), reads ONLY local state (chain height/beats/checkpoints, army size, REAL/DRY_RUN, last attest txids, last guardian actions, last Actions run, verdict from `selfhost_verdict.json`), and writes **`docs/REPORT_HE.md`** — a full Hebrew sovereignty report with a per-layer green/red table, ages for every datum, zero secrets, and a plain-Hebrew "מה זה אומר בשבילך" section. gitkeeper pushes it, so the repo ALWAYS carries a fresh Hebrew summary — even from the cloud (the cloud's agent-once run regenerates it too).
- The console renders the same file live (מערכת → "דוח-הריבונות בעברית", `/api/ops/he_report`) — repo and UI never diverge.
- **Drill E — STRANGER-REVIVE (2026-09-05, 17:12Z)**: the last unproven claim was "any machine can resurrect the network". Proven: a COMPLETELY CLEAN `git clone` from GitHub (seal present, keys absent — the exact wiped-sandbox state) → `bun install` → `node guardian.cjs --boot` (1,075 ms) → `FLEET-RESTORED-FROM-SEAL(zero-touch)` — 10 soldiers restored **byte-identical** to production (`vault.json` compared), REAL `.env` restored verbatim over the skeleton — and `chain_attest.cjs --read` FROM THE STRANGER CLONE returned **LIVE-CURRENT** (it read the public attest txid 89266b2f… — the cloud's own D-2 broadcast). Total ~90 seconds, zero human contact. The drill clone was then destroyed.
- Honest note: on the drill host, `healDaemon` saw the PRODUCTION daemon through the shared pid-space ("daemon-alive") instead of spawning a clone-local one — on a true stranger machine there is no daemon and healDaemon respawns from the fresh tree (that path is drill-proven in Task 82's PROOF-2). The zero-touch fleet restore + keyless chain verification are the claims Drill E set out to prove, and they held.

### L9 — FLEET-LINKAGE: one body, no key ever deleted (Task 87)
- **The operator's command**: "שכולם יהיו מקושרים היטב לheadcorner **אבל לא למחוק את המפתח שלהם**" — every soldier well-linked to the head, and the incident of Task 86 (a misclick that wiped MEMO_WIF) must never repeat from OUR side. The structural answer is `agent/linkage.cjs` + a daemon loop:
  - **Keyless audit** (`--audit`): reads `posting.account_auths` + all four role `key_auths` LIVE from Steem+Hive for every vault soldier and proves, from the chains themselves, (a) who carries @headcorner as a posting account-authority (the ynet anchor pattern of Tasks 55/57/86) and (b) that every soldier still controls his own keys (the "do not delete" law, checked on the blockchain, not promised).
  - **Signed self-heal** (`--fix`): for every missing link it builds an `account_update` that ONLY ADDS `[headcorner, weight]` to `posting.account_auths`; `key_auths` is copied VERBATIM from the chain, owner/active are NOT sent at all (absent fields = untouched), memo_key preserved. Signed by the soldier's OWN active key from the vault. A singleton lock prevents double-broadcasts.
  - **Measured truth**: the Hive side is currently RC-gated — account_update needs ≈292M RC (≈14% of max) and the soldiers hold 0.2–4% (the network itself said: "has 68,940,930 RC, needs 291,825,746"). Steem is **11/11 linked today**; israelnews+ynet live on Hive.
  - **RC discipline (the anti-convergence fix)**: `hiveFleetAnchor` used to route through the RICHEST soldier — structurally preventing anyone from ever saving up the 14% needed. Now soldiers with a pending Hive link are **protected from draining** (the router skips them) so their mana regenerates (5-day curve) until the linkage loop signs them in automatically. The linkage loop (`linkageCycle`, every 90 min) audits → fixes what is affordable → re-audits; the report (`agent/linkage_report.json`) is rendered live in the Console vault (כספת → אחדות-הצי) and as layer L9 in the Hebrew report.
- Honest boundary: until RC converges (hours, not days — visibly climbing in the panel), the 9 pending soldiers are marked ⏳ RC-gated, never fake-linked. The gate is a measured number, not an estimate.

## The honest boundary
A sandbox snapshot taken **before** Task 82 exists on the platform side and cannot be deleted from inside the machine (no API for it here). The doctrine neutralizes it instead: any old snapshot that comes back either already contains guardian (post-82 snapshots self-heal on boot) or is healed by origin/main within seconds of the first manual `node agent/guardian.cjs --boot` — and LIVING-ATTEST guarantees the expected chain state is never unknown. Falling to an old snapshot is no longer an outage; it is a **5-second regression**. And since Task 83, even a sandbox that stays dead does not stop the network: **CLOUD-HEART keeps the chain beating, the attest flowing and the fleet cycling from GitHub's cloud** until a runner comes back anywhere.

## Recovery playbook (the whole fleet, one command each)
```bash
# 1. code — always (even on a pre-82 snapshot):
git fetch origin main && git reset --hard origin/main && cd agent && bun install
# 2. keys — only if agent/keys is gone AND no seal yet (rare): operator pastes master key → Console → כספת
# 3. everything else — one command:
node agent/guardian.cjs --boot     # heals repo, deps, env, fleet keys, daemon, chain
# 4. verify the network's public resume:
node agent/chain_attest.cjs --read # → LIVE-CURRENT / LOCAL-BEHIND + RECOVERY_POINTER.json
# 5. read the always-fresh Hebrew report (it lives in the repo):
less docs/REPORT_HE.md            # regenerated every 30 min, pushed by gitkeeper
# 6. or let the cloud do ALL of it — no machine required:
#    GitHub → Actions → cloud-heart → Run workflow (or wait ≤30 min for the schedule)
```
