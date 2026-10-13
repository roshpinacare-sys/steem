# R209 — SOVEREIGN CAUSAL PROOF · Orchestrator Synthesis

Round window opened: 2026-10-05T16:30Z · Code pinned at commit `ddf6f51` · Engine PID 18405 (bun --hot, :3040)

---

## I. RE-ANCHOR REALITY (first, no prior report trusted)

| # | Fact | Class | Evidence |
|---|------|-------|----------|
| 1 | Engine alive, `bun --hot index.ts` PID 18405 (live-verified after two controlled restarts during the round: 12394→…→18405) | OBSERVED | `pgrep`, `ss -ltnp` (port 3040), HTTP /status 200 |
| 2 | Watchdog supervisor healthy: 1736+ checks, 47 heals, healFailed 0, engineUp true | OBSERVED | state/sovereign.json |
| 3 | Cycle scheduler live: ~10-min cycles, all 19 steps green, learn step consumes adaptation (`adaptations:["active:adapt-claim_reward_balance-posting"]`) | OBSERVED | events.jsonl (learn.done rows), cycle-run.json |
| 4 | Adaptation `adapt-claim_reward_balance-posting` ACTIVE, attempts 0, confidence 0.8, created 15:01:50.115Z, TTL to 2026-10-07T15:01:50Z; integrity seal recomputed by orchestrator = MATCH | OBSERVED | state/adaptations.json + bun recompute |
| 5 | Resolver consumes learned state live: claim→**posting**, vote→active, transfer→active | OBSERVED | `resolveAdaptedRole` against live store |
| 6 | Chain pending rewards **ZERO** (0.000 STEEM / 0.000 SBD / 0.000000 VESTS) — natural trigger ABSENT; last drain by second signer 13:07:21Z | OBSERVED | condenser_api.get_accounts (re-polled every ~55s by /tmp/r209-monitor.sh) |
| 7 | 0 role-bearing exec rows exist (the firing has never happened) | OBSERVED | exec-log.jsonl (last row still 13:05:28Z) |
| 8 | Exec-log evidence row 3 (10:34:58Z failure) had pending>0 measured 19 s earlier (59.701894 VESTS at 10:34:48.867Z) | OBSERVED | state/payouts.json vs exec-log |
| 9 | Historical claim failures: 19× identical signature, single failure class, role-less (= signed active) | DERIVED | exec-log.jsonl (R209-e byte audit) |
| 10 | Git HEAD before round: c578f35 (T-84 close); worklog 970 lines with L-1a/b/c/d quartet | OBSERVED | git log, wc -l |
| 11 | UNKNOWN at round open: whether the engine's claim serialization is even capable of producing a verifiable signature | UNKNOWN → **RESOLVED BELOW** | — |

## II. THE FALSIFICATION BOMB (R209-b, independently reproduced by the orchestrator)

**Claim:** `steemtx.mjs` serialized `claim_reward_balance` with op-id **33**; the chain's canonical id is **39**. The node digests its own canonical re-serialization of the parsed JSON; the engine signed the digest of **its own** id-33 bytes ⇒ signature verifies against a garbage recovered pubkey ⇒ the chain answers `missing required posting authority` — **the role was never tested; the 19 failures were digest-caused.**

**Orchestrator's independent reproduction (not trusting the agent):**
1. Fetched the real second-signer claim tx from the chain (`condenser_api.get_transaction`, api.steemit.com): block 110175341, ref 9302/1569834387, expiration 13:17:18Z, single op `claim_reward_balance` 67.769681 VESTS.
2. Engine serializer rebuilt its OWN on-chain delegation txid `fcf347d5…` — MATCH ✓ (serializer machinery + txid formula + id-40 all proven correct).
3. Same serializer with claim → `ecfa2f8f…` ≠ `159e9313…` — MISMATCH as predicted.
4. Byte-patch sweep: **op-id 39 reproduces the on-chain txid EXACTLY** (sha256 preimage — collision impossible); 33/34/40 do not.

**Corroborating precedent inside the codebase:** `create_claimed_account` carries a measured comment "missing `00` = authority error" — serialization mismatches ALREADY known to masquerade as authority errors in this chain.

**Epistemological finding (deeper than the bug):** the chain's error text names the *requirement* ("requires posting authority" — TRUE, chain-sourced) but not the *cause* of not meeting it (digest mismatch). The organism's failure taxonomy has no serialization class, so `classifyFailure` mapped a compound authority+configuration failure to `authority-role` — the T-84 lesson's *content* was true, its *evidential basis* was confounded.

**Consequence if unfixed:** from pinned code, ANY `ok:true` claim row would be forged or foreign (success impossible); the natural firing would fail ×1 and instantly retire (deterministic class) a TRUE lesson with a wrong why; re-proposal would loop.

## III. THE FIX BUNDLE (commit ddf6f51 — body repair + proof-gap closures, mission §XIV smallest intervention)

| Change | File | Justification |
|--------|------|---------------|
| `claim_reward_balance: 33 → 39` + measured-contract comment | steemtx.mjs | Body defect made the tested variable unreachable; one byte, three independent proofs; pinned by selftest vector (txid★) |
| §X VERIFIED-is-revisable: post-verification failure retires the lesson, **reopens** the rail contradiction, confidence ↓ (−0.2, floor 0.1), resolver reverts to safe base role; RETIRED allows re-proposal (deliberation reopenable) | adaptations.mjs | R209-d: "one verified reflex that cannot be revised is conditioning with a saved file, not cognition" — mission §X forbids permanent learned authority |
| `roleSource` ("adapted"/"caller") + `adaptationId` journaled on EVERY exec row; evaluator scores only `roleSource:"adapted"` rows | signer.mjs, adaptations.mjs | R209-a A7 relabeling path: caller-chosen roles could previously confirm a lesson they never used |
| Pre-action `prediction.recorded` event (expected authority/operation/execution-path/outcome/failure-mode, hypothesis, confidence) appended to events.jsonl BEFORE `broadcastTx` for adapted partitions | signer.mjs → adaptations.recordPrediction | Mission §III: prediction_time < action_time provable from the journal alone |
| `predictionClass` CONFIRMED/CONTRADICTED/UNRESOLVED + `belief{before,evidence,after,why}` (honest `was`-state; no unverified journal-ordering assertion) + `contradiction.resolved`/`contradiction.reopened` events | adaptations.mjs | Mission §VI/§IX; R209-c honest-path bugs |
| 7 new selftest vectors (353/353 PASS): txid★ contract pin, VERIFIED-revisable, caller-rows-never-score | selftest.mjs | Serializer contract + §X behavior now regression-pinned |

**Authority boundary audit (mission §XI):** the fix and the learning core touch NO keys, policy flags, caps, floors, custody, pause, think-gate, or permission roots. `authority_before == authority_after` (same credential, same gates — think-gate/verifyRoles/RC-floor all precede the resolver); `behavior_after != behavior_before` (role selection now learned + serializer now correct). Owner remains unreachable at proposal, supersede, AND resolve (3 independent layers).

**Durability (mission §XII):** two controlled restarts during the round (watchdog-respawned); after the FINAL restart: memory intact, seal matches, resolver claim→posting. Cold-load verified. The engine requires no LLM session to reconstruct the lesson.

## IV. FIVE-AGENT COGNITIVE MODE (mission §XIV — same question, five lenses)

| Agent | Lens | Strongest alternative found | Eliminated? |
|-------|------|----------------------------|-------------|
| R209-a | Signer attribution | A7 relabeling: caller-role rows could flip VERIFIED without the adaptation | YES — roleSource guard (this round) |
| R209-b | External writers | **THE BOMB: op-id 33≠39 — success impossible from pinned code; second signer wins drain races** | Root cause YES (fixed+proven); race remains external by design |
| R209-c | Prediction integrity | Pre-fire prediction rewrite + self-reseal (machine owns both prediction and outcome) | PARTIAL — journal pins fire-time prediction text; original proposal text pinned only in git/sealed store (documented residual) |
| R209-d | Learning theatre | VERIFIED one-way ratchet; RESOLVED contradictions never reopen; confidence never decreases | YES — §X bundle (this round) |
| R209-e | Counterfactual | Baseline homogeneous (19/19 one class); chain ran the counterfactual twice itself (20:14→20:33 and 13:05→13:07: same pool claimed by second signer 113s after engine's identical-op failure) | Analysis stands; firing pending |

## V. THE FIRING (natural trigger)

**Status at window close (2026-10-05T17:52Z): WAITING_FOR_EXTERNAL_OUTCOME.** Chain pending rewards = 0.000000 VESTS at every poll from 16:34Z to 17:50Z (~80 min, 80+ polls, /tmp/r209-monitor.log); last settle matured before the 13:07Z drain; the rail lawfully NO-OPs (intel gate `unclaimedRewards().any` = false). No forcing, no injection, no synthetic claim (mission §II). The monitor continues to ~19:40Z; the engine self-records the firing whenever the chain settles.

AFTER-evidence protocol (armed, executes within 120s of a firing):
1. Pin code hashes (post-fix steemtx.mjs = ddf6f51).
2. Snapshot exec row (must carry `role:"posting"`, `roleSource:"adapted"`, `adaptationId`), prediction.recorded event ordering, think-log ALLOW.
3. `get_transaction(txid)` on api.steemit.com: id match, single claim op, amounts match intel decision. The exec-row txid is sha256 of OUR serialization (pre-broadcast) — if the chain's tx with that exact id exists, OUR constructed tx is provably the one on chain (second-signer exclusion).
4. `get_block(B)` on boylikegirl: timestamp inside cycle window; scan [B−2,B+2] for rival claims.
5. Rewards zeroed via get_accounts; adaptations state transition + seal recompute; `adaptation.verified` event with predictionScore.class CONFIRMED.
6. Verdict per §XVII.

## VI. VERDICT

**C — ADAPTATION ARMED, OUTCOME UNOBSERVED.**

The learned behavior is real (derived from measured failures), persistent (integrity-sealed, restart-surviving — 2 controlled restarts this round), and live (resolver consumes it at the broadcast choke point). The natural external trigger did not occur during the proof window. This is the honest waiting state the mission prescribes.

**The decisive incidental proof:** at round open, the armed state was PROVEN-INCAPABLE of success (op-id 33 ⇒ signature can never verify ⇒ the firing was predetermined to fail and retire a TRUE lesson with a false why — a false lesson in waiting). The five-agent adversarial mode found it; the orchestrator reproduced it mathematically (txid★, sha256 preimage); the body was repaired and pinned. **The armed state is now PROVEN-CAPABLE** (serializer byte-canonical, selftest-pinned; authority boundary intact; §X downward revision live). Without this round, verdict C would have silently decayed into D at the first firing.

**Why not A/B:** no external outcome observed — attribution of success remains untestable until the chain settles. Why not D: the adaptation was genuinely derived by the organism's own experience→evaluation→inference→adaptation machinery; its content survives independent verification (chain requirement statement + canonical semantics + the second signer's on-chain posting-signed claim); what the round falsified was the EVIDENTIAL BASIS (the 19 failures were digest-caused), not the learning mechanism.

## VII. FIVE FINAL ANSWERS

**1. WHAT DID REALITY TEACH THE ORGANISM?**
The chain's error text names the requirement, not the cause — all 19 "missing required posting authority" failures were digest-garbage from a one-byte serialization defect (op-id 33 vs canonical 39), meaning the organism's true lesson was untestable until its body was repaired.

**2. WHAT DID THE ORGANISM CHANGE BECAUSE OF IT?**
Its future decision structure is machine-verifiably different: the next claim fires under the learned posting role with a byte-canonical transaction (op-id 39, pinned by the txid★ selftest vector), every exec row now carries roleSource/adaptationId attribution, a pre-action prediction is journaled before every adapted broadcast, and if reality contradicts the lesson — even after VERIFIED — the adaptation retires itself, the rail contradiction reopens, confidence drops, and the resolver reverts to the safe base role (commit ddf6f51, selftest 353/353).

**3. WHAT CAUSAL CLAIM CAN IT JUSTIFY?**
(a) The op-id defect was THE cause of the 19 failures — mathematical (sha256 txid★ reproduction). (b) The learned role change is NECESSARY for claim success (the chain's own requirement statement + canonical semantics) but was never SUFFICIENT alone. (c) Posting-sufficiency is evidenced by the second signer's on-chain posting-signed claim (crypto-pinned pubkey recovery). Role-causality of a future success remains ATTRIBUTION-PARTIAL (joint cause with the body repair; the counterfactual "id-39 + active" was never run and will not be manufactured).

**4. WHAT DOES IT STILL NOT KNOW?**
Whether the natural firing occurs before TTL expiry (2026-10-07T15:01:50Z); whether the second signer drains future settles before the engine's 10-min cycle catches one (~60–80% engine per R209-e); what canonical op byte 33 actually names (unprobed, moot); whether other serializer field mismatches exist (the Oct-02 convert/limit_order anomaly remains OPEN); whether settle cadence resumes as observed.

**5. WHAT IS THE NEXT INFORMATION-GAIN FRONTIER?**
One missing flow: the engine samples pending rewards once per ~10-min cycle while the second signer acts within minutes — a near-real-time pending-reward watcher feeding the existing intel gate (inside the engine, no new daemon) closes the race gap and gives the firing its first clean observation.
