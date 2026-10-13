# R209-e — COUNTERFACTUAL & ATTRIBUTION STATISTICS (FALSIFICATION ROUND)

Task ID: R209-e · Agent: Counterfactual-Statistics Falsifier · Written 2026-10-05T16:57Z (live engine PID 15086, started 16:39:53; watch PID 17424 → /tmp/r209-monitor.log)
Method: read-only. No engine state, code, or chain state modified. Chain reads via steemapi.boylikegirl.club (condenser_api.get_account_history). Note: /tmp/r209-monitor.sh existed but was NOT running; I started it detached at 16:44 (writes only to /tmp).

Target claim under attack: **"Had the learned adaptation NOT been applied, the next claim would have failed the same way"** (support: 19 identical failures, fingerprint c056922c) and its downstream inference **"therefore posting will succeed"**.

---

## 1 · ATTACK THE BASELINE — are the 19 really "same relevant conditions"?

**VERDICT: YES — homogeneous on every causally-relevant field.** All 19 rows (state/exec-log.jsonl, 2026-10-04T20:14:52.605Z → 2026-10-05T13:05:28.500Z, txids eb6b7da5…, 78d23e71…, 00cb67d6…, …, 7875e0bd…):

| field | value across 19 | heterogeneity |
|---|---|---|
| tag | `cycle-execute` | none |
| account | `headcorner` | none |
| ok | `false` | none |
| ops | `["claim_reward_balance"]` — **single-op tx in all 19** | none |
| error | `missing required posting authority:Missing Posting Authority headcorner` — **byte-identical ×19** | none |
| fingerprint | `c056922c` (same credential identity) | none |
| node | `null` ×19 | **journaling artifact, not a missing condition** (see below) |
| role | absent ×19 | confirmed: daily.mjs execute calls `executeOps(ops,{tag:"cycle-execute"})` → `executeAs(..., {role="active"})` default (signer.mjs:601). All 19 were signed under the ACTIVE key. `TAG_ROLE_PROVENANCE` (adaptations.mjs:54) does not map `cycle-execute`, so the evaluator correctly reads them as active-signed. |

**Heterogeneity found — all non-causal (and therefore exculpatory):**
- **Wall time**: 17h span; gaps 10.0±0.1 min (cycle cadence) except a **850-min overnight gap** (explained: chain had ZERO settles 2026-10-04 18:43 → 10-05 09:14, pending=0, gate `intel.unclaimedRewards().any` lawfully never staged the op — NOT engine death) and two **off-cadence rows** 11:31:25 / 11:35:13 (6.4/3.8 min gaps).
- **Engine process**: the 19 rows span **≥4 distinct engine PIDs**, inside a day with ≥9 engine boots — including a 7-boot restart storm 11:21:54→11:28:54 (pids 5739/5825/5863/5883/5931/5985/6127; claim rows at 11:25:04 vs 11:31:25/11:35:13 sit on opposite sides of it). Restart state does not change the failure.
- **Pending pool size**: three distinct pools (see §2): 12.909063 VESTS (10-04 evening), then 59.701894→67.769681 VESTS (10-05 morning). Amount/composition (always vests-only, 0 STEEM/0 SBD) varies; outcome never does.
- **Think-gate custody display**: think-log journaled 18 claim verdicts (60-row cap rotated the two 10-04 rows): ALL `ALLOW`, reasons `[]`; custody `master-verified` ×16, `master-unverified` ×2 (10:44:57, 11:24:59) — a stale-cache display artifact; verifyRoles passed inside executeAs in both cases (exec row exists ⇒ fingerprint present).
- **node:null explained**: `broadcastTx` (signer.mjs:564-580) returns `{ok:true, node}` only on success; the error path returns `{ok:false, error}` with no node. **ALL 249 fail rows in exec-log lack node; all 404 ok rows have it.** Stronger: on a chain rejection the loop `continue`s to the NEXT node — every one of the 19 "failures" was submitted to all three nodes (boylikegirl → justyy → steemit, sticky order never updates on failure), and the recorded text is the LAST node's (api.steemit.com) rejection. Three independent operators rejecting identically kills the "node-specific quirk" alternative.

**Alternative-cause screen (all excluded):**
- *RC floor*: RC-FLOOR is a pre-broadcast verdict — produces NO exec row; the 19 rows reached the wire. RC now 100% (observe.json 16:44).
- *Node outage*: produces timeout/`no-result`/network error text, not a byte-stable authority assert ×19 × 3 nodes × 17h.
- *Think-gate/custody refusal*: REFUSED/KEY-UNVERIFIED produce no exec row; 18/18 journaled verdicts ALLOW.
- *Wrong credential/foreign key*: fingerprint c056922c constant; posting role chain-verified HELD (L-1c: credential posting pubkey == account posting key_auths; 21 posting-role ok broadcasts today).
- *"Nothing to claim" disguised as authority error*: impossible — steemd validates transaction authority before applying ops; and §2 proves the pools were intact at every attempt.

## 2 · STRESS-TEST THE ANCHOR — the 10:34:58 failure had pending>0, chain-arithmetic-exact, and nobody claimed in the window

payouts.json at **10:34:48.867Z**: `pending.vests=59.701894`, verdict MEASURED-PENDING (node boylikegirl). 9.6 s later the claim failed (00cb67d6…).

Chain history (get_account_history, indices 65856–66034) reconstructs the pool **exactly**:
```
10-05 09:14:15 curation_reward +27.430617   ┐
      09:31:54                 +25.817030   │
      09:45:15                 + 1.613563   ├ Σ = 59.701894 VESTS = payouts.json @10:34:48 EXACT
      10:02:15                 + 1.613562   │
      10:03:18                 + 1.613562   │
      10:18:12                 + 1.613560   ┘
      10:39:21                 + 3.227118   ┐
      11:10:42                 + 1.613556   ├ Σ = 67.769681 VESTS
      11:15:18                 + 3.227113   ┘
      13:07:21 claim_reward_balance 67.769681  (idx 66014 — the second signer's sweep)
```
**Between 10:18:12 and 13:07:21 there is NO claim_reward_balance op on chain.** The "could someone have claimed in the 19 seconds?" question is moot — nobody claimed for 2h53m; the anchor is bulletproof. Even a hypothetical drain wouldn't change the error class: authority validation precedes reward-balance validation.

**Op construction (daily.mjs:371-379):** the claim op carries the measured amounts of the cycle (`rewDec.action.steem/sbd/vests` from intel's same-cycle `get_accounts` read; gate `any=true` requires ≥1 non-zero — a zero-amount claim is never staged, and would still fail at the authority stage if it were). The 13:05:28 cycle measured the intact 67.769681 pool, so the last engine op asked for **exactly the amount that succeeded 113 seconds later under a different key** (below).

**BONUS — two natural paired experiments the baseline already contains** (stronger than the anchor itself):
1. **10-04 20:14→20:33**: settles 18:04+18:06+18:43 = **12.909063 VESTS** pending. Engine fails at 20:14:52 and 20:24:51 (active key). Second signer claims **exactly 12.909063** at 20:33:12. Same op, same pool, same chain state, 9–19 min apart; only the signing key differs.
2. **10-05 13:05:28→13:07:21**: engine's op asks for the full **67.769681** pool and fails; **113 seconds later** the second signer asks for **exactly 67.769681** and succeeds. A near-perfect A/B: the manipulated variable is only the key.
Quantified damage of the defect: **67.769681 VESTS (~0.042 SP) of engine-earned curation leaked to the second signer** because the engine could not claim.

## 3 · ATTACK THE INFERENCE — "posting will work" (attempts=0 for claim under posting)

Extrapolation base measured: **67 posting-role exec rows lifetime (57 ok), 21 ok today = 20 votes + 1 comment — ZERO claims.** The posting WIF is proven to sign validly on this exact executeAs→buildTx→broadcastTx path (21× today); the claim op serialization is proven well-formed (all 19 baseline txs deserialized far enough to reach authority validation — a malformed op errors differently); the only unproven combination is (posting signature × claim op). Residual failure modes enumerated and rated:

| # | mode | mechanism | would it show as a DISTINCT error class? |
|---|---|---|---|
| a | Reward drained by second signer between intel measurement and broadcast | op asks > available; chain assert "…reward balance…" | **Yes but DANGEROUS**: classifyFailure maps `/assert/` → `{type:"config", deterministic:true}` → adaptation **RETIRED instantly** (`new-failure-class:config`, predictionClass CONTRADICTED) — a **false falsification** of a correct authority hypothesis. The one mode that actively corrupts the causal ledger. Window is narrow (drain must land inside the engine's seconds-wide observe→execute gap, or pool already drained → gate blocks → no attempt), but the second signer has swept every drip so far (lags 4 min / ~110 min / ~112 min). |
| b | RC dropped below 20% floor | pre-broadcast verdict | Yes — RC-FLOOR, **no exec row at all** (delays firing, never mis-attributes). |
| c | TaPoS/DGPO staleness across partitions | same dgpoRes reused for both partitions; ref-block ≤60s old, window ≈65536 blocks (~54h); each partition's tx gets fresh `expiration=now+45s` (buildTx called per partition) | Yes — "expired transaction" (transient class, attempts+1, no retire). Practically unreachable. |
| d | Posting signature invalid | same signDigest (RFC6979 low-s) proven ×21 today | Yes — checksum/signature error class. |
| e | Claim serialization nuance | buildTx is generic; claim = op-id 33, positional `account‖3 assets`, extensions varint(0); JSON remap adds only undefined keys | n/a — already proven good by the baseline reaching authority check. |
| f | **OPS-DAY-CAP / maxOpsPerCycle truncation** | daily.mjs day-cap return BEFORE executeOps; executeAs slices ops to 12 — claim is pushed AFTER cancels/orders, so a heavy grid cycle can silently cut it | **NO — silent non-firing.** No exec row, no error; indistinguishable from NO-OPS in exec-log (cycle-run verdict only). Delays the firing; cannot fake it. |
| g | **BROADCAST-PARTIAL headline masking** | executeAs returns the BASE partition's txid/error as the headline (`shape = primary ?? adaptedPrimary`); per-partition rows are journaled separately | **NO — cycle-level verdict can mask or be masked by the claim row** (e.g., orders fail + claim ok ⇒ headline BROADCAST-PARTIAL/error; orders ok + claim fail ⇒ headline ok, error=null). The role-tagged exec-log rows remain the only truth source — the AFTER-spec must key on them, not on cycle-run. |
| h | `d?.result !== undefined` success semantics | a 200 with `result:null` would journal ok:true without inclusion | **NO — theoretically silent FALSE VERIFIED.** Remote (condenser returns result on success, error object on failure); detectable only by the chain-side AFTER check (reward_vesting_balance → 0). |
| i | posting authority rotated by second signer | verifyRoles fails | Yes — KEY-UNVERIFIED, no exec row. |

**Answer to deliverable (3):** the modes that would NOT produce a distinct error class are (f) day-cap/truncation silent non-firing, (g) partition-headline masking at cycle level, (h) result:null false-success, and above all (a) the drain-race assert that would be **misclassified as config and instantly retire a correct hypothesis**. Of these only (a) corrupts the attribution record; (f)/(g)/(h) merely hide or delay it. Recommend (for a later round, not now — read-only): exempt chain-state races from the deterministic-config class, or require the failure signature to repeat under a freshly measured non-zero pool before retiring.

## 4 · CAUSAL GAP QUANTIFICATION — cofactor table & class assignment

**Controlled by design/code (identical in baseline and firing):** credential + fingerprint (c056922c, verifyRoles re-run per call) · op construction (daily.mjs:371-379) · think-gate (runs on FULL op set pre-partition) · RC floor (pre-partition; 100% now) · DGPO acquisition (fresh ≤60s, same object for all partitions) · serializer & signing crypto (RFC6979 low-s; posting WIF proven ×21 today) · 3-node sticky failover logic · same execute-step position in the same 19-step cycle · same think/learn bookkeeping.

**Varied WITHIN the baseline and never changed the outcome (shown immaterial):** engine PID/restarts (≥4 processes across the 19 rows; 7-boot storm) · wall time (17h) · pending pool (12.9 / 59.7 / 67.8 vests) · think-custody display (2/18 unverified) · off-cadence gaps · chain height/DGPO.

**Necessarily different at the firing moment:** (1) **the signing role itself — the manipulation** (single-op tx in 19/19 baselines means, in the likely claim-only firing shape, the tx differs from baseline ONLY in the signature key: a single-manipulated-variable experiment); (2) tx structure IF other ops share the cycle (mitigated: partitioning isolates the claim in its own posting-signed tx, per-partition rows keep attribution exact); (3) second-signer behavior (mode (a)/(i) above); (4) node currently first-tried (consensus-level authority check — node-independent; failover covers all three anyway); (5) pending composition at firing (vests-only pattern so far).

**Strongest defensible attribution statement AFTER a clean firing** (exec row `{role:"posting", ok:true, txid, error:null, fingerprint:"c056922c", ops:["claim_reward_balance"]}` preceded by a `prediction.recorded` journal row):

> "The identical op, account, credential, serializer, gates and node set that failed 19/19 under the active key succeeded under the posting key. Within the baseline, every measured nuisance variable — 17h of wall time, three distinct reward pools, ≥4 engine processes including a 7-boot restart storm, think-custody display drift — varied with zero effect on the outcome; and the chain itself ran the counterfactual twice (20:14→20:33 and 13:05:28→13:07:21), where the same op for the same pool succeeded only when signed by a posting-satisfying key. The role change is therefore the discriminating cause of the firing (class A at the RAIL level), not a correlated artifact."

**Class assignment:** pre-firing today = **C** (adaptation armed, outcome unobserved — attempts 0/3, ACTIVE, expires 2026-10-07T15:01:50Z). Post-firing with the clean row above: **A for the specific proposition** (claim_reward_balance succeeds iff signed under posting for this credential), because the design reduces the firing to one manipulated variable against a homogeneous 19-row baseline PLUS two natural paired experiments. The **system-level ceiling stays B**: n=1 firing, inference rules are human-authored code inside a fixed rule-space, and generalization beyond the claim rail is extrapolation until a second op class (e.g. the open rail:limit_order_create / rail:vote contradictions) fires through the same actuator. If the drain-race (a) fires first and retires the adaptation: the ledger would record CONTRADICTED — that outcome would be a **measurement artifact, not a falsification** of the authority theory (the paired experiments would still stand). If nothing fires before TTL: C→unobserved-retire (ttl-unverified), NOT class D — the theory was never tested.

## 5 · PREDICTED FIRING WINDOW (PREDICTED, not observed)

Mechanism: pending rises only in **curation-settle bursts** (virtual `curation_reward` ops, ~7d after votes). Observed bursts: 10-04 17:24–18:43 (5 settles, 20.4 vests) ↔ 09-28 evening votes; 10-05 09:14–11:15 (9 settles, 67.8 vests) ↔ 09-28 morning votes. **No settle since 11:15:18; pending 0.000/0.000/0.000000 at every monitor poll (16:44, 16:57).** The 09-28 vote cohort pays 7d later ⇒ next settle cohort due **this evening UTC**.
- **PREDICTED window: 2026-10-05T17:00Z–23:59Z** (residual probability spreads into 10-06 morning if the 09-28 evening cohort was small; unpaidTranches=417 guarantees future bursts, timing is cohort-driven, not drip-rate-driven).
- Once a burst starts, the engine catches pending>0 on its next 10-min cycle (observe→execute gap is seconds; burst settles land minutes apart). The race is the second signer's sweep lag: observed 4 min / ~110 min / ~112 min. **P(engine wins at least one cycle per burst) ≈ high (est. 60–80%) unless the second signer's reaction collapses back to the 4-min regime**; weave checkpoints (~18 min cadence) prove it is alive but its claim lag has been slow in 2 of 3 sweeps. Failure to win a burst repeats harmlessly until one lands in a slow-sweep interval.
- Hard deadline: adaptation TTL **2026-10-07T15:01:50:115Z** — no firing by then ⇒ ttl-unverified retire ⇒ outcome remains unobserved.
- Watch: /tmp/r209-monitor.log (polls every 55s; flags `*** PENDING-NONZERO ***`; also appends last exec row — the firing will appear as `ok=True role=posting`).

## Verdicts (requested return items)

1. **Baseline homogeneity: YES** — all 19 are the same failure class (byte-identical chain authority assert, same op, same credential, single-op txs). Heterogeneity exists only in non-causal fields: time (17h, incl. an 850-min settle-free gap), pending pool (12.9/59.7/67.8 vests), engine PID (≥4, restart-storm), think-custody display (2/18), node-echo (null = journaling artifact; failures were submitted to all 3 nodes). No row admits an alternative cause (RC floor and gate refusals produce no exec row by construction).
2. **Strongest defensible post-firing attribution statement**: as quoted in §4 — role change is the discriminating cause at rail level (class A there), system-level class B (n=1, human-authored rule-space).
3. **Posting-role failure modes WITHOUT a distinct error class**: day-cap/maxOpsPerCycle silent truncation (no row); BROADCAST-PARTIAL headline masking (cycle verdict ≠ claim row); result:null false-success (remote); and the drain-race assert misclassified as deterministic config → instant false retirement of a correct hypothesis.
4. **PREDICTED firing window**: 2026-10-05T17:00Z–23:59Z (curation-settle cohort of 09-28 evening votes; bursts, not drips; monitor armed; TTL deadline 10-07T15:01:50Z).

*Evidence files: state/exec-log.jsonl (673 rows; 19 claim fails), state/think-log.jsonl (18 claim verdicts), state/payouts.json, state/adaptations.json (ACTIVE 0/3, sealed), state/observe.json+intel.json (16:44, RC 100%, no rewards decision), signer.mjs:564-700, daily.mjs:371-409, steemtx.mjs:197-290, adaptations.mjs:65-84,100-160, intel.mjs:43-97, chain history /tmp/r209e-ah1.json (idx 65856-66034), monitor /tmp/r209-monitor.log.*
