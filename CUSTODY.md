# CUSTODY — ONE CLEAN REGISTRY (owner law 2026-10-29: "find ALL the keys, one clean custody")

> Measured 2026-10-29 10:45Z. The chain is the only judge. Fingerprints only here —
> material lives in exactly three sealed places (see §3). No /tmp. No plaintext. Ever.

## 1. THE LIVING (chain-judged LIVE custody, fp-verified)

| Account | Chain | Roles live | Key fp | Where the material is |
|---|---|---|---|---|
| headcorner | steem | active | 8fc001a6 | custody-vault/headcorner-active.json + LIVE_FLEET_KEYS (4 repos) + census seals (vault-home) |
| woq | hive | active + posting | a5d044f1 / 941035e5 | crown-map.json (0600) + ROT2_FLEET_KEYS (Domain) + VERIFIED-CENSUS-20261029T104108Z.enc |
| lsa | hive | posting | 6c0be3fb | same as woq |
| siq | hive | posting | 521538ca | same as woq |

**Broadcast proof**: tx accepted by api.steemit.com signed with 8fc001a6 (transfer_to_vesting
0.001 STEEM, e2e-broadcast.mjs, 2026-10-29T10:31Z) + 26 live maker orders on the internal
market (dex-grid Domain run 40858957971, STEEM_ACTIVE_WIF lane).

## 2. THE DEAD (judged, do not re-litigate — re-key or retire)

| Material | Verdict | Evidence |
|---|---|---|
| ROT2_FLEET_KEYS steem legs (46 WIFs) | DEAD ×3 (10-29 ×2, 10-41 census) | census matrices (Domain/steem/saos-runtime) |
| Console SAOS_RELAY_WIF + SAOS_TREASURY_WIF | DEAD | Console census 10-41: 0 live |
| hcsoldier4/5/6/7 active+posting | LOST-WITH-SANDBOX (accounts alive, 300 SP each) | army-custody.json REVIVAL-FAIL 10:05Z; keys were local-only |
| saos-0001..0009 custody | LOST-WITH-SANDBOX | not in any repo/secrets/vault |
| hcsoldier1/2/3 | LOST-NO-CUSTODY forever (retired, owner-approved) | 3 scans × ~7,000 derivations, 0 matches |
| headcorner owner (STM5aUKy…, set 10-21) | NOT-HELD — derives from the master password | master password hunt: crown-vault-recovery workflow |

## 3. THE THREE SEALED PLACES (the whole custody topology — nothing else is canonical)

1. **Local**: `steem/.secrets/custody-vault/` (0700/0600) — material for the live engine.
   + `.secrets/custody-manifest.json` (0600, judge output, fingerprints only)
   + `.secrets/crown-map.json` (0600, merged verified map)
2. **Cloud secrets** (write-only, judgeable via census workflows): LIVE_FLEET_KEYS on
   Domain/saos-runtime/saos-dex/steem + STEEM_ACTIVE_WIF + ROT2_FLEET_KEYS (hive leg live).
   GH_PAT now present on all 20 instrumented repos (census can seal from anywhere).
3. **vault-home (private git)**: custody-intake/VERIFIED-CENSUS-*.enc + CROWN-RECOVERY-*.enc
   (aes-256-cbc pbkdf2-300000, transport pass) + intake/* (older seals) + fleet-rot2.keys.enc
   + keys.env.enc + ssh-keys.tar.enc (P-sealed; wraps = the P recovery chain).

## 4. THE ONE MECHANISM (how the sovereignty touches keys)

- **census**: `key-census-relay-v2.yml` now on 9 repos (steem, Domain, saos-dex, saos-runtime,
  FleetHQ, Zip, Console, Sandbox, Autonomy) — generic env WIF scan → chain judge → seal to
  vault-home. Dispatch with any ≥16-char seal_pass. The whole fleet's key truth in one wave.
- **crown recovery**: `crown-vault-recovery.yml` on steem — wraps open + GEN archaeology
  (every vault-era blob in git history) + full census + seal. The master-password hunter.
- **local judge**: `master-judge.mjs` (hourly patrol cron 483682) — custody-vault vs chain.
- **grid beat**: `beat-loop.sh` (15-min cron 483417) — judge + dispatch Domain dex-grid
  when its last success ages ≥2h (the takeover law).
- **e2e proof**: `e2e-broadcast.mjs` — the standing proof that signing→serialization→
  authority→acceptance all work (idempotent ops only).

## 5. THE OPEN WALLS (honest, with the measured path when they open)

| Wall | Why | The path |
|---|---|---|
| headcorner owner/posting keys | master password sealed behind vault wraps; no local credential opens them | crown-vault-recovery (running) opens GEN archives with STEEM_VAULT_PASSES/VAULT_PASSES_R33 + P-from-wraps in cloud |
| 10 keyless steem accounts (cashmachine, haran, israelnews, lsa, macrame, siq, tov, wic, wog, woq) | 10-21 rotation material unreachable | re-key via fee channel (3 STEEM/account ≈ 30 STEEM ≈ 1 week of power-down flow) OR account recovery if GEN archives hold their owner-era keys |
| hcsoldier7 + saos-0001..0009 | fresh random keys died with the sandbox (two-seal intake law was written FOR them but executed local-only) | re-key via fee channel (4 × 3 STEEM); the intake law now lands material in vault-home FIRST |
| headcorner posting (6 keys on chain) | derives from master password | same as owner |

## 6. THE LAWS (unchanged, re-proven today)

1. No key material in /tmp, ever. Two-seal intake: vault-home FIRST, local second.
2. No single-atomic-commit deletions of custody. Rotate first, delete later.
3. Every claim carries a proof handle (txid / block / run id). No handle = rumor.
4. The chain is the only judge — for keys, balances, orders, every "success".
5. Waiting-gates self-check their premise each run (B8) — if the resource exists, arm.
6. Cron survives sessions (cloud schedules + sandbox crons). The architecture runs alone.
7. This registry is the ONLY roster of the living. New keys land here + in custody-vault
   in the same breath.

## 7. THE LIVING (restored 2026-10-29 19:2xZ, wipe-#5 resurrection — chain-judged via master-judge)

| Account (chain) | Roles live | Source seal |
|---|---|---|
| headcorner (steem) | owner 9b10ce9d + active 8fc001a6 + memo 2509f6e4 | VERIFIED-CENSUS-20261029T190545Z |
| cashmachine/haran/israelnews/macrame/tov/wic/wog (steem) | owner+active+posting+memo | REKEY-W1 + CROWN-GEN-EXPANSION |
| lsa/siq (steem) | owner+active+posting+memo | REKEY-W1 (steem legs chain-matched 19:22Z) |
| woq (steem) | owner+active+posting+memo | REKEY-W1 (steem legs chain-matched 19:22Z) |
| woq (hive) | active a5d044f1 + posting 941035e5 | VERIFIED-CENSUS (census relay) |
| lsa/siq (hive) | posting | VERIFIED-CENSUS (census relay) |
| hcsoldier8..16 (steem) | owner+active+posting+memo ×9 | CROWN-NEW-* (P-opened) |
| hcsoldier4/5 (steem) | posting | CROWN-GEN-EXPANSION |

Material: /home/z/fleet/vault-home/.secrets/custody-vault/crown-map.json (0600, steem:*/hive:*
namespaced) + seals in roshpinacare-sys/vault-home custody-intake. hcsoldier1-3 retired;
hcsoldier6 dead-tier (no live wif); engine custody 13/14.
