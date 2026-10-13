# C-1a — REALITY CARTOGRAPHER · Independent situation picture of the SAOS organism
Date: 2026-10-05T13:40Z · Auditor: C-1a · Method: read-only live inspection + read-only chain RPC + safe analysis on copies (/tmp only).
Epistemic labels: KNOWN / OBSERVED / INFERRED / PREDICTED / ASSUMED / UNKNOWN / CONTRADICTED.

---

## 1) Executive picture (≤6 lines)

- ONE live organism instance is real: `bun --hot index.ts` PID 6127 (:3040) + Next.js cockpit (:3000, PID 1072) with a sovereign loop inside it (watchdog 60s, cycle 10min, selftest 6h). Cycle freshness PROVEN by two mtime samples (13:24/25 → 13:34/35) and cycle-ok markers at 13:05/13:15/13:25/13:35.
- The machine genuinely: ticks a hyper-grid (11,087 ticks, real broadcasts), votes through a 10-account army (chain-verified today 11:28), posts its own daily transparency report (chain-verified 10:35), runs 321-vector selftests, journals a think-gate around every broadcast, and heals itself (40 heals / 37 verified).
- But it is NOT yet a self-correcting organism: its reward-claim op has FAILED 19/19 times with the same wrong-key bug since 2026-10-04 20:14 and it retries every 10 min while its own learning layer records "broadcast-fails" without repairing anything.
- A SECOND SIGNER shares the account from outside this machine (Zip sandbox): it claimed the rewards (13:07:21 tx 159e9313b0), revoked 3 soldier delegations (09:46–47), maintains 3×3.087 STEEM asks, posted 4 of today's 5 comments, and broadcasts `saos.weave.core.v1` checkpoints (~every 18min). Two sovereigns, one account.
- Measured economy today: $0.00/day measured (fuel $0, author $0), realized P&L −0.147 SBD, venue does 19 trades/24h, ladder verdict OFFER-EMPTY (capital locked in orders + 4.55M VESTS delegated out). The "$1000/day" mission is narrative, honestly labeled blocked/estimated in economics.json.
- The "16 repos" exist only on GitHub; locally there is ONE clone (roshpinacare-sys/steem.git, main == origin/main). The second signer's code is NOT on this machine.

---

## 2) Capability ladder table

Ladder: declared → implemented → wired → executable → observed → verified → sustained.
Policy file reality: `/home/z/my-project/.secrets/exec-armed.json` (NOT `mini-services/saos-engine/.secrets/` as briefed — the briefing's path is WRONG; signer.mjs:24 computes `DIR/../../.secrets`). Content (OBSERVED): armed:true · allowTransfersOut:false · allowDelegation:true (T-82 operator order 2026-10-05) · curate enabled maxPerDay 10 · hyperGrid enabled · soldiers.enabled:false · promo 1/day.

| Rail | declared | implemented | wired | executable | observed | verified | sustained | evidence |
|---|---|---|---|---|---|---|---|---|
| 1. Hyper-grid DEX (limit orders) | YES — T-19b docs, config block | YES — hypergrid.mjs (21.7KB); signer+steemtx serialization | YES — `startHyperGrid()` at boot index.ts:262; own 3s tick loop | YES — conf.hyperGrid.enabled=true; think-gate ALLOW (think-log "hyper-grid:ALLOW"); RC floor honored | YES — tx 8065683d 12:56:46 (2 creates ok); all-time 569 create-ok / 492 cancel-ok | YES — orders 2100000379/380 visible via get_open_orders (/live, 5 orders) and in account history | PARTIAL — 11,087 ticks sustained, but firing starved: opsToday 2, governor "accumulating", budgets ≈0 (liquid 0.531 STEEM) |
| 2. Curator voting (master) | YES — T-13 policy curate.enabled | YES — curator.mjs (19.8KB) | YES — daily.mjs:93 stepWrap("curate") parallel branch | YES — posting role, rcPct/dgpo hoisted, day-cap 10 | YES — 39 votes total, txids journaled (09-29, 09-30, 10-02) | YES — those votes are in account history (last_vote_time 2026-10-04T02:57) | PAUSED-BY-LAW — VP-FLOOR (vpEff 2.7% < 60%), 0 votes today; law-honest, resumes ~Oct-8–10 |
| 2b. Army curation (10 delegated accts) | YES — T-83 | YES — army.mjs | YES — daily.mjs:101 parallel step | YES — vault direct-WIF custody verified 4/4; think-gate army-curate ALLOW ×31 | YES — cashmachine votes 11:28:48/51/54 (w4969/4954/4920) | YES — confirmed on-chain (get_account_history cashmachine) | YES — day-one 18 votes (T-83), 3 accounts voted today; per-account cap 3, VP floor 80% |
| 3. Reward claiming | YES — "claim pending rewards" daily.mjs:370 | YES — daily.mjs:371–379 builds claim op | YES — inside execute step | YES — think-gate ALLOW ×17 (cycle-execute) | FIRED 19× — ALL FAILED "missing required posting authority" (2026-10-04T20:14 → 13:05 today, exec-log) | NO for this engine — 0/19; the successful claim on chain (67.769681 VESTS, 13:07:21, tx 159e9313b0) was broadcast by the EXTERNAL second signer | NO — doomed 10-min retry loop; learning.json lesson "broadcast-fails" recorded, tunings=[] → no repair |
| 4. Delegation management | YES — T-82 (op-id 40 measured) | YES — steemtx.mjs:174,215 (op 40, `delegator` key contract byte-measured) | PARTIAL — no recurring rail in runCycle; invoked ad-hoc via think-gate (`t82-delegation-active-army:ALLOW` ×3) | YES — policy.allowDelegation=true (T-82 operator order) | YES — 1 success (woq +48,393.301791 VESTS, 10:44:18, tx fcf347d510), 1 fail (invalid account name) | YES — delegation is in account history; delegated_vesting_shares 4,552,866 VESTS out | NO — one-shot order execution; no standing adjust/revoke/health rail in the cycle |
| 5. Selftest / health | YES — T-22 standing selftest, T-15 watchdog | YES — selftest.mjs (321 vectors, offline child process); sovereign.ts watchdog/heal | YES — daily.mjs:542 selftest step (day-gated) + sovereign 6h timer + watchdog 60s | YES — ran today | YES — selftest-last-run.json: 321/321 PASS 11:27:14; sovereign.json: 1556 checks, 128 downs, 40 heals, 37 healVerified, 0 healFailed | YES — state + exit-code classification (SELFTEST-PASS / heal-verified events) | YES — daily selftest cadence + continuous watchdog since 09-04 boot |
| 6. Reporting / cockpit | YES — T-22 one-body law | YES — index.ts /status (19 sections, single-source); src/app/page.tsx + /api/saos/* thin proxies | YES — engine serves :3040; cockpit renders; sovereign loop POSTs /cycle every 10min | YES — observed serving | YES — cockpit HTTP 200 (0.04s); /api/saos/status live; engine /status all-19-steps; daily-report.json refreshed every cycle (13:35:18) | YES — cockpit numbers match engine state files and chain reads (/live: parity, 5 orders, rcPct 99.9) | YES — 142 auto cycles this boot: 93 ok / 29 blocked / 20 fail |
| 7. (bonus) Promo publish | YES — promo 1/day | YES — promo.mjs postDailyReport | YES — daily.mjs:407 inside execute step | YES — posting role | YES — "saos-transparency-20261005" posted 10:35:01 (comment:ok in exec-log) | YES — on chain (tx fb9bc9c1bf) | PARTIAL — one/day holds; BUT the post publishes stale soldier claims (see Gap 3) |

Chain truth snapshot (get_account headcorner, 13:31Z): balance 0.531 STEEM, sbd 0.015, vesting 6,366,836 VESTS, delegated OUT 4,552,866 VESTS, received 393,740 VESTS, reward_* ALL ZERO (just claimed externally), posting/active single keys.

---

## 3) State-file census (state/ — 33 files + journals)

Verdict legend: LIVE = written+read by live cycle path · STALE-READ = fossil still consulted · WISH = produced live but consumed by no execution path · DEAD-BUT-HANDLED = absent, code tolerates.

| file | written-by | read-by | live-path? | verdict |
|---|---|---|---|---|
| observe.json | daily.mjs (each cycle) | hypergrid, fleet, economics, discovery, content, recruiter, index | YES | LIVE (13:35:51) |
| offer.json | daily.mjs (peg) | daily(execute), hypergrid, fleet, index | YES | LIVE |
| state.json | daily.mjs (tick) | 17 modules + index | YES | LIVE |
| intel.json | intel.mjs | daily(peg spread), fleet | YES | LIVE (contains stale soldier decision → Gap 3) |
| curator.json | curator.mjs | intel, learning, weave, fleet, recruiter, selftest | YES | LIVE |
| army.json | army.mjs | content, fleet, recruiter, selftest, learning | YES | LIVE |
| cycle-run.json | daily.mjs marker | hypergrid, fleet, sovereign poll | YES | LIVE |
| daily-report.json | daily.mjs | index, economics, recruiter | YES | LIVE |
| events.jsonl | daily/curator/army/signer/hypergrid/discovery | index(tail), learning | YES | LIVE journal |
| exec-log.jsonl | signer.mjs | index(tail), learning | YES | LIVE journal |
| think-log.jsonl | signer think-gate | index render only | YES (advisory) | LIVE journal |
| sovereign.json | src/lib/sovereign.ts (Next side) | signer (pause), learning, fleet | YES | LIVE — shared pause truth (T-81) |
| sovereign-events.jsonl | sovereign.ts | learning | YES | LIVE journal |
| hyper-grid.json | hypergrid.mjs | recruiter, economics | YES | LIVE |
| hyper-ops.json | hypergrid.mjs (self) | — | YES | LIVE |
| our-orders.json | daily.mjs (execute) | daily, weave, hypergrid | YES | LIVE |
| order-ops.json | daily.mjs — ONLY on execute success | daily (ops day-cap) | write-gated | STALE-READ (day=2026-09-30; no successful cycle-execute since — claims fail) |
| market.json | daily.mjs (30-min marketPulse) | measure, lib, selftest, economics, recruiter | YES | LIVE |
| convert-plan.json / convert-state.json | daily.mjs | index, economics, recruiter / daily | YES | LIVE (CONVERT-HOLD honest) |
| learning.json | learning.mjs | fleet, discovery | YES | LIVE — but tuningsApplied=[] every run seen |
| discovery.json | discovery.mjs (30-min) | signer(spoilage), learning, economics, fleet | YES | LIVE |
| economics.json | economics.mjs | content, fleet, index | YES | LIVE (honest blocked/estimated labels) |
| webintel.json | webintel.mjs (6h via cockpit bridge) | content, daily, selftest | YES | LIVE (last 10:35:08) |
| content-ops.json | content.mjs (12h) | index render ONLY; promo.mjs does NOT read it | write-live / no-exec-consumer | WISH — 3 drafts queued, nothing ever broadcasts them |
| fleet-roles.json | recruiter.mjs | index render only | YES | LIVE but self-narrative ("FULL-STRENGTH 12/12 stations" = state files, not agents) |
| payouts.json | payouts.mjs (day-gated) | economics, lib, daily gate | YES | LIVE (read-only meter; the CLAIM op is broken — see Gap 1) |
| rc-tank.json | rctank.mjs (day-gated) | recruiter, fleet, index | YES | LIVE (measured 7,736 ops/day equilibrium today) |
| selftest-last-run.json | selftest.mjs | daily (cadence gate), recruiter | YES | LIVE |
| weave.json | weave.mjs (observes external checkpoints; never broadcasts) | daily gate, selftest, lib | YES | LIVE observer |
| soldiers.json | soldiers.mjs — only on deploy; deploy DISABLED since T-80 (mtime 2026-09-29 19:21) | signer, intel, discovery, promo, fleet, daily | actively read | STALE-READ — fossil feeding live decisions (deployed:true) |
| cred-alarm.json | signer alarm paths | signer, index | YES | STALE-RESIDUE (foreignSince 2026-10-01 "testuser" never cleared) |
| engine.pid | index.ts | sovereign.ts, fleet | YES | LIVE (6127 correct) |
| exec-pause.json | cockpit pause button path | signer execPaused() | not created | DEAD-BUT-HANDLED (pause actually flows via sovereign.json) |

Census conclusion: the briefing's suspicion that these are "state files written by past agent rounds" is REFUTED — every file has a live producer in the running cycle. The real defects are different: STALE-READ fossils (soldiers.json, order-ops.json, cred-alarm.json) and WISH outputs (content-ops.json).

---

## 4) Gap list (sharpest first)

1. **GAP-1 · The claim rail is broken-in-loop (fired-but-never-verified, and NOT self-correcting).** `claim_reward_balance` is pushed into the atomic execute tx signed with the DEFAULT role `active` (daily.mjs:392 executeOps → signer.mjs:587 `role = "active"`). This chain requires POSTING for claims (empirical: 19/19 failures "missing required posting authority"; curator/army votes signed `role:"posting"` succeed; external claim with posting succeeded). The engine retries every 10 minutes, learns "broadcast-fails" (learning.json metrics.exec.fails 25/25, lastError recorded) and changes nothing — the think-learn-act loop is open. Note the T-82 commit message even claims "payouts rail live" — declared ≠ real.
2. **GAP-2 · Two sovereigns, one account.** An external second signer (roshpinacare-sys/Zip sandbox, code absent here) shares headcorner: claimed rewards 13:07:21; revoked hcsoldier1/2/3 delegations 09:46–47; created 3×3.087 STEEM asks 12:56:42–48 (not in engine exec-log); posted 4/5 comments today; broadcasts weave checkpoints every ~18min. Engine defenses (our-orders partition, weave observation, D-021 lanes) prevent cancel-wars but capital, VP and comment-space are silently raced. Duplicate authority = the biggest structural risk.
3. **GAP-3 · Stale-assumption propagation into public output.** intel.json reads soldiers.json (fossil, deployed:true 09-29) → decision "soldiers: grids-live — 3 soldiers holding lanes" while the same cycle's soldiers step returns DISABLED-T80-OPERATOR-STOP; promo.mjs then publishes "Soldier fleet: live on the book" ON-CHAIN in the daily transparency post. A fossil file lies to the public through a live pipe.
4. **GAP-4 · WISH rail: content drafts never broadcast.** content.mjs queues grounded drafts (3 queued 10:35, exposure-law-checked) but promo.mjs posts its own hardcoded transparency report; nothing consumes content-ops.json queue. Implemented-produced, zero-execution.
5. **GAP-5 · Delegation is a one-shot dressed as capability.** op-40 was measured and fired once (T-82), policy now allows it, but no cycle step manages delegation health/renewal/revocation — while 4.55M VESTS (≈2822 SP) sit delegated and ~727 SP of escrow returns ~Oct-12 with no watcher.
6. **GAP-6 · Market-making idle-by-starvation.** OFFER-EMPTY every cycle (budgets ≈0: liquid 0.531 STEEM/0.015 SBD; 60%-deploy law satisfied by stale orders), venue = 19 trades/24h measured. The hyper-grid ticks thousands of times/day to place ~2 orders. Honest but the flagship rail is economically dormant; economics rollup measuredTotalUsdPerDay = 0.
7. **GAP-7 · Learning without acting.** lessons are derived every cycle (e.g., signing-cred-blocked, broadcast-fails) but tuningsApplied=[] in every run observed; no evidence any lesson ever changed behavior. The "continuous-learning layer" is currently a journal, not an actor.
8. **GAP-8 · Orderid self-collision burn.** 93 "could not insert object (uniqueness)" create-fails historically from `(tSec+ops.length)` ids within the same second; partial mitigation via partitions; still visible in all-time error stats.
9. **GAP-9 · Narrative inflation risk.** fleet-roles "FULL-STRENGTH 12/12", "standing teams", "16-repo org" — locally there is one repo and zero independent agents; stations are subsystem names graded by evidence-of-state-file. Cockpit honestly renders engine truth, but the vocabulary overstates the ontology.
10. **GAP-10 · Cockpit is a single point for external eyes.** webintel runs THROUGH http://127.0.0.1:3000/api/saos/ai/webintel (webintel.mjs:20,52) — if the Next dev server dies, the engine loses its web search organ (fail-isolated, but dependency is real and inverted: engine→cockpit).

Declared-but-not-wired / wired-but-never-fired / one-shot-dressed-up — explicit:
- declared-not-wired: soldier deployment (config exists, T-80 freeze — lawful), exec-pause.json kill-switch path, delegation recurring management.
- wired-never-fired(since evidence window): convert execution (CONVERT-HOLD; and when last fired 10-02 it failed 11/11 "missing active authority" with the then-credential — never re-verified with the current one), claim rewards (fired, never succeeded).
- one-shot-dressed-as-capability: delegate op-40; T-82 "payouts rail live" claim (contradicted by 19 consecutive failures).

---

## 5) System graph summary

- IDENTITY: `.secrets/headcorner.key` (0600, 64B, master password; NEVER opened by auditor) + `.secrets/army-vault-recovered.json` (10 army accounts, direct WIFs). verifyRoles chain-maps both pubkey encodings (signer.mjs:451–515). OUTSIDE the machine: the second signer holds identical authorities (evidence: its successful signatures). Policy: `.secrets/exec-armed.json` (safe-by-default, operator may loosen). KNOWN.
- AUTHORITY: operator standing orders → exec-armed.json → think-gate (signer.mjs:74–112: pause → custody → transfers-out → delegation; every verdict journaled incl. REFUSED) → RC floor → per-cycle op caps → ops day-cap. Two control planes coexist cleanly: sovereign.ts (Next process; watchdog/cycle/selftest timers, pause/kick) and engine policy files; they share sovereign.json as pause truth (T-81 unified).
- DATA: chain via 3-node ladder steemapi.boylikegirl.club → api.justyy.com → api.steemit.com (measure.mjs:13–15, signer.mjs:560); prices via binance→coingecko→coinpaprika ladder; web via cockpit bridge (z-ai sdk); market via market_history_api.
- DECISION: intel decisions (5/cycle) + curator selection (topic/age/saturation law) + planLadder (parity floor/ceiling, 60% deploy law, flow tranche, dragK) + convert hysteresis (D-023) + discovery tag board + learning (clamped).
- EXECUTION: ONE broadcast path — signer.executeAs/executeOps → steemtx serialize (op registry measured from chain) → 3-node broadcast, atomic all-or-nothing tx.
- RECEIPT: exec-log.jsonl (txids + key fingerprints, never keys), think-log.jsonl (verdicts+reasons), events.jsonl, sovereign-events.jsonl.
- OBSERVATION: measure.mjs fills/PnL (avg-cost, unbased≠profit law), payouts clock, weave (watches the OTHER signer's chain truth), rc-tank, market pulse; cockpit renders engine-computed truth only (T-22 one-body).
- ORPHANS/EXTERNAL: second signer (outside), 16-repo org (GitHub-only; /home/z/audit clones deleted), upload/ legacy encrypted key backups, historical 09-46 actor actions visible only on chain. STALE ASSUMPTIONS: soldiers.json fossil → intel → public post (Gap 3); cred-alarm "testuser" residue; order-ops stale day.

---

## 6) Experiments run (all read-only; no live file modified; no restarts; no broadcasts)

1. `ps aux` / `ss -tlnp` → engine bun PID 6127 on :3040 (only listener), next-server PID 1072 on :3000. No duplicate engine processes now (single-instance law works; engine.log shows 12 historical spawn/exit pairs from boot races).
2. Freshness proof: state mtimes sampled 13:24:35 (files 13:14–13:24) and again 13:35:33 (files 13:34:50–13:35:32) → 10-min cycle cadence LIVE; sovereign-events.jsonl cycle-ok(auto) at 13:05:32 / 13:15:16 / 13:25:16 (ms 40357/26430/27601).
3. `curl 127.0.0.1:3040/{health,cycle-status,status,live}` → health ok (account headcorner, doctrine capped-autonomy); last cycle 27.6s, health ok, all 19 steps ok; /live: parity 0.1041, 5 open orders, rcPct 99.9.
4. `curl localhost:3000/` → HTTP 200 (0.04s); `/api/saos/status` → live engine-backed JSON (thin renderer confirmed: "המנוע מודד, השכבה מציגה").
5. exec-log.jsonl full aggregation (673 entries): all-time by op — create 569 ok/330 fail, cancel 492/250, vote 53 ok/36 fail, claim 0/19, convert 0/11, delegate 1/2, comment 4/1, transfer 6 ok/30 fail (era before T-80), claim_account 0/18. Recent-fail scan → the claim posting-authority loop.
6. think-log.jsonl (60 entries): verdict census {cycle-execute:ALLOW 17, army-curate:ALLOW 31, t82-delegation:ALLOW 3, hyper-grid:ALLOW 1, promo:ALLOW 1, smoke-test:REFUSED 3, t81-smoke:REFUSED 3, smoke-test:ALLOW 1} — the gate bites and journals refusals.
7. Chain RPC (read-only curl, steemapi.boylikegirl.club):
   - `condenser_api.get_accounts ["headcorner"]` → balances/rewards/authorities/delegations (section 2 snapshot).
   - `condenser_api.get_account_history ["headcorner",-1,3000]` → last 61 ops 04:01→13:25 today; found the external claim 13:07:21 (159e9313b0), external revocations 09:46–47, engine delegation 10:44:18 (fcf347d510), 5 comments (1 engine, 4 external), 31 weave custom_json checkpoints.
   - `condenser_api.get_account_history ["cashmachine",-1,20]` → 3 army votes 11:28:48/51/54 w4969/4954/4920 — matches army.json byte-for-byte.
8. Policy file located and read: `/home/z/my-project/.secrets/exec-armed.json` (briefing's path was wrong — REFUTED, see §2). Key file NOT read (only permissions/size).
9. Git: `git -C /home/z/my-project` → single clone roshpinacare-sys/steem.git, main f027678 == origin/main; worktree modified = live state churn (tracked state/*.json). `/home/z/audit` (the 16-repo clones from Task-1) GONE.
10. Cross-checks: webintel bridge dependency (webintel.mjs:20,52 → :3000), promo.mjs does not reference content-ops (drafts unconsumed), `git -C engine` remote == same repo.

---

## 7) Honest unknowns

1. WHO/WHAT the second signer is (Zip sandbox on the operator's other machine per T-82 note?) — behavior OBSERVED on chain, code and operator UNKNOWN locally.
2. Whether claim_reward_balance requires posting-only on this chain by protocol or by fork config — rule derived empirically (19 fails vs posting-signed successes), chain source not read. PREDICTED: signing the claim tx with role:"posting" fixes it.
3. Engine's `spOwn` (observe.json 1124.57 SP) vs raw math on chain vesting fields (~880–1420 SP depending which of delegated/received are subtracted; T-83 unit law 1 SP = 1,613.04 VESTS) — reconciliation UNDETERMINED.
4. Selftest content not independently re-run (would write live state/selftest-last-run.json — forbidden); 321/321 taken from machine's own record (single-source).
5. Whether the 09:46–47 revocations were operator-directed or autonomous second-agent action — ASSUMED second agent (timing matches TODO note "other actor's 09:46 sweep").
6. upload/pat.env, *.enc backups, headcorner.key contents intentionally not inspected (rule 1).
7. Whether any of the 18 historical `claim_account/create_claimed_account` failures left on-chain residue (fee burns) — not audited.
8. sovereign selftest timer (6h) shows runs:0 since 09:04 boot — engine-cycle day-gated selftest covers it; whether the 6h timer would fire in a longer-lived process UNVERIFIED.
