# C-1b — LOOP TRACER: the real cognitive loop of the SAOS engine

Agent: C-1b Loop Tracer · SOVEREIGN SYSTEMS COGNITION round · 2026-10-05
Scope: LIVE engine path only (`mini-services/saos-engine`, PID 6127, `bun --hot index.ts`, port 3040; SovereignCore in `src/lib/sovereign.ts`). Agent-era scripts counted only where the live path invokes them.
Method: full read of live-path modules; log forensics on `state/*.jsonl` (read-only); one read-only chain RPC (`condenser_api.get_accounts[headcorner]`) to ground state-file truth. No live file touched.

---

## 1 · Executive picture

The engine is a **well-instrumented, fail-closed open-loop automaton**: a 10-minute deterministic pipeline (observe → rule-classify → plan → broadcast) wrapped in real safety controllers (pause, custody, caps, floors) and journaled with unusual honesty. The loop **closes only at micro-scale** (error-regex retry, already-voted dedup, sticky RPC node, RC governor carry, day-cap counters). At the loop scale that matters — *outcome → model update → different decision* — it is **severed**: 156 consecutive learning runs applied 0 tunings; a chain-rejected op has been re-broadcast identically 19 times over 17 hours; the think-gate is a one-way static filter whose own verdicts no code ever reads. Every structural upgrade in the organism's history (T-14…T-83) arrived from **external agent rounds editing code/config between cycles**, not from the loop itself.

---

## 2 · Loop table (LIVE path)

| Arrow | Where (file:line) | Evidence | Label | Verdict |
|---|---|---|---|---|
| **Observe** | `daily.mjs:107-135` (parity/feed/account/orders/fills/fuel → `observe.json`); `curator.mjs:192-197` (VP manabar); `hypergrid.mjs:195-260` (book+RC per 3s tick); `sovereign.ts:188` (engine pulse) | `observe.json` parity 0.10767, steem 0.531, rcPct 100 — matches live chain RPC I ran (balance `0.531 STEEM`, delegated `4,552,866.947848 VESTS` exact) | KNOWN | **REAL** |
| **Understand** | `intel.mjs:59-120` (typed decisions w/ templated reasons); `daily.mjs:140-151` (fed into same cycle); `measure.mjs` classification | intel decisions are fixed thresholds: spread→dragK (`lib.mjs dragK`), unclaimed→claim (`intel.mjs:91-94`), rc<20→conserve (`intel.mjs:97`) | OBSERVED | **PARTIAL** — classification, not comprehension; no causal model of market/account |
| **Model / Uncertainty** | Nowhere in live path. Closest: `parity.lowConfidence` flag (`offer.json marks`, `measure.mjs`), discovery classes measured/estimated/potential (`discovery.mjs:5-9,38-46`) | grep: no decision consumes a confidence/uncertainty value | OBSERVED | **MISSING as decision input** (labels/metadata only) |
| **Hypotheses** | Nowhere. `discovery.mjs scoreOpportunities` ranks static rail-ideas; "NEVER executes anything" (`discovery.mjs:10`) | 156 `discover.done` events; no code path turns an opportunity into an experiment | OBSERVED | **MISSING** — a menu, not hypothesis generation/testing |
| **Evaluate** | `lib.mjs planLadder/planConvert/parityVerdict`; `curator.mjs:78-118 filterCandidates`; `lib.mjs:499-519 rcGovernor` | deterministic filters + budget math, selftested | OBSERVED | **PARTIAL** — feasibility/budget check; no counterfactual or EV comparison |
| **Decide** | `daily.mjs:320-392` (ops array build: stale cancels 322-328, requote 326-328, ladder 331-369, claim 371-379, convert 381-384); `curator.mjs:294-303` | decision = current observation + caps + ours-registry + day counters | OBSERVED | **PARTIAL/REAL** but purely rule-mechanical |
| **Act** | `signer.mjs:587-639 executeAs` → `buildTx` (`steemtx.mjs`) → `broadcastTx` (`signer.mjs:563-579`, 3 nodes, 8s timeout) | exec-log txids; T-82 delegation txid `fcf347d5…` chain-landed; 18 army votes 11:28 (`events.jsonl army.votes`) | KNOWN | **REAL** (genuine chain writes, all-or-nothing tx) |
| **Observe outcome** | In-call: `signer.mjs:573-576` (node result), `curator.mjs:306-324` (error classify → retry/dedup). Cross-cycle: exec-log write `signer.mjs:633-637`; read ONLY by `learning.mjs:250` + `/status` (`index.ts:49`) | 19× identical claim failures recorded; cycle still journaled `cycle-ok(auto)` 13:05:32 (`sovereign-events.jsonl`) because `lib.mjs:319-325 cycleHealth` never sees `verdict:"BROADCAST-FAIL"` (step.ok stays true, `daily.mjs:49-57`) | KNOWN | **PARTIAL** — outcomes seen in-call, **ignored at loop scale** |
| **Learn** | `daily.mjs:472-482` → `learning.mjs:245-290 runLearning` | `learning.json`: runsTotal 156, verdict LEARNED ×156, `tuningsApplied: []` ×156; `lessonsTotal.broadcast-fails: 50` yet the failing op never changes | KNOWN | **PARTIAL→INERT** — writes lessons; 0 behavioral updates in live history |
| **Update model** | Only wiring: `learningTunings()` (`learning.mjs:238-242`) → curator merge `curator.mjs:165-166`, clamped `learning.mjs:198-202` | 156/156 `learn.done` events carry `"tunings":[]` (grep-verified). All real model/code changes came from agent rounds (T-14 idleTimeout, T-17 one-vote-per-tx, T-19 requote, T-80 gate, T-81 pause unify, T-82 serializer, T-83 army rail) and operator config (`exec-armed.json` allowDelegation) | OBSERVED | **EXTERNAL-AGENT** (mechanism exists but never fired live) |
| **Decide again** | SovereignCore interval `sovereign.ts:482-487` (10min cycle, 60s watchdog, 6h selftest); hypergrid 3s tick `hypergrid.mjs:410` | re-decision differs from first decision ONLY via small memories: `votesToday`/chain day-count (`curator.mjs:213-230`), `our-orders.json` ours/hyper sets (`daily.mjs:302-318`), sticky node `signer.mjs:561-562`+`lib.mjs:395`, governor carry `lib.mjs:513`, custody cache `signer.mjs:162` | OBSERVED | **PARTIAL** — counters close tiny loops; no belief/model state updates between cycles |

**MISSING arrows (nothing in the codebase does this):** explicit uncertainty modeling feeding decisions; hypothesis generation & testing; consequence/counterfactual evaluation; self-review of its own gate/journal; any update of a world-model (as opposed to counters and clamped knobs).

---

## 3 · Feedback case studies (real log evidence)

### Case A — the loop that never closes: `claim_reward_balance` (KNOWN)
The engine lacks multi-authority signing (`signer.mjs:629` signs with ONE role key: `wifs: [id.wifs[role]]`, default `role="active"`), but `claim_reward_balance` requires posting authority. `intel.mjs:91-94` re-decides "claim — free fuel" every cycle; `daily.mjs:371-379` rebuilds the op; `daily.mjs:392` broadcasts it with the active key. Result — **19 failures, 0 successes, identical error, identical fingerprint, every ~10 min from 2026-10-04T20:14 to 2026-10-05T13:05** (state/exec-log.jsonl):

```
{"at":"2026-10-04T20:14:52.605Z","tag":"cycle-execute","ok":false,"txid":"eb6b7da5…","ops":["claim_reward_balance"],"error":"missing required posting authority:Missing Posting Authority headcorner","fingerprint":"c056922c"}
{"at":"2026-10-05T12:55:23.573Z","tag":"cycle-execute","ok":false,"txid":"18898b50…","ops":["claim_reward_balance"],"error":"missing required posting authority:…","fingerprint":"c056922c"}
{"at":"2026-10-05T13:05:28.500Z","tag":"cycle-execute","ok":false,"txid":"7875e0bd…","ops":["claim_reward_balance"],"error":"missing required posting authority:…","fingerprint":"c056922c"}
```

The learner even counts it — `learning.json`: `"exec":{"window":25,"fails":25,"lastError":"missing required posting authority…"} `, `lessonsTotal.broadcast-fails: 50` — and its lesson `action` is **static narrative text** ("fail-closed stop already holds; vote-interval retry added T-14"), mapped to **no tuning** (`deriveTunings` `learning.mjs:205-235` only touches curator weight/age/tags). The cycle is simultaneously reported healthy: `sovereign-events.jsonl` 13:05:32 `{"kind":"cycle-ok(auto)","ms":40357,"steps":19}` — `cycleHealth` (`lib.mjs:319-325`) inspects only `step.ok`, and `stepWrap` (`daily.mjs:49-57`) never converts a `BROADCAST-FAIL` verdict into `ok:false`. **Verdict: Observe-outcome→Learn→Update→Decide-again is severed; behavior is bit-identical across 19 failures.**

### Case B — adaptation by external agent, not by the loop (KNOWN/OBSERVED)
T-82 delegation to `woq` (48,393.301791 VESTS). Think-gate ALLOWed the identical op three times (`think-log.jsonl` 10:36:32, 10:40:19, 10:44:14 — no memory of the prior failure); broadcast failed once and then succeeded **only because the T-82 agent edited `steemtx.mjs` in between** (measured the chain's JSON-key contract: "delegator", not "account"):

```
exec-log: {"at":"2026-10-05T10:40:26.225Z","tag":"t82-delegation-active-army","ok":false,"txid":"f0ae2014…","error":"Assert Exception:is_valid_account_name( name ): Accou…"}
exec-log: {"at":"2026-10-05T10:44:19.495Z","tag":"t82-delegation-active-army","ok":true,"txid":"fcf347d5103002febdd4a33581cd0a06c703e911","node":"https://steemapi.boylikegirl.club"}
```

**Verdict: the system improved between two broadcasts, but the improver was an external agent round, not the organism.**

### Case C — vote-interval assert → structural fix, again by agent round (KNOWN)
Three `curate` BROADCAST-FAILs on 2026-09-29 19:42–19:44 (10 votes per tx → `STEEM_MIN_VOTE_INTERVAL_SEC` assert), one more 2026-10-02T00:01. Runtime now micro-adapts (one vote per tx, 3.2 s spacing, single clean retry `curator.mjs:294-310`; "already voted" → DEDUP, count budget, continue `curator.mjs:285-286,318-324`). The structural redesign (T-14/T-17) was code edited by agent rounds — the failure rows themselves contain no actuator other than the in-call retry.

### Case D — world-change answered by static threshold (OBSERVED)
VP hit the floor: `curator.json` verdict `VP-FLOOR`, vpEff 2.7 < 60 (`curator.mjs:198-202`) — the machine lawfully rests until regen (worklog: votes resume ~Oct-8). Army rail repeats per account at 80% (`army.mjs:60,125`). Correct, conservative — and purely a hardcoded threshold: no re-planning, no alternative use of the idle resource beyond a lesson text (`learning.mjs:165-173 vp-surplus-idle` → monitor).

### Case E — pause hole: journaled evidence existed, nobody read it (KNOWN via worklog T-80/T-81, code-verified)
During "pause" the executors checked only `exec-pause.json`; the hyper-grid ticked 7,643× and broadcast real orders at 04:01 while paused. Those broadcasts WERE journaled in exec-log — but nothing reads exec-log for policy violation, so the organism never noticed; the T-81 agent round found it, then unified the pause (`signer.mjs:337-341 execPaused` reads both files). Adaptation: EXTERNAL-AGENT.

---

## 4 · Think-gate anatomy (`signer.mjs:74-112`)

**What it actually consumes** (grep-complete):
- `execPaused()` — two JSON flags (`signer.mjs:337-341`);
- `armedConf().policy` — three booleans + allowlist from `.secrets/exec-armed.json` (`allowTransfersOut:false, allowDelegation:true` since T-82);
- `custodyOf(account)` (`signer.mjs:57-72`) — in-memory verified identities + secrets-file membership;
- op **names** — only `transfer` (with `to`, `amount`) and `delegate_vesting_shares` (`delegatee`, `vesting_shares`) are inspected (`signer.mjs:100-109`).

**What it never consumes:** amounts vs caps on non-transfer ops, order prices, market state, VP/RC, account history, learning lessons, uncertainty, consequence estimates, its own prior verdicts.

**Verdict logic is one line:** `signer.mjs:110` — `const verdict = reasons.length ? "REFUSED" : "ALLOW";` → static rule-checker, 4 rules + pause. It cannot weigh context: it ALLOWed the malformed delegation twice (Case B) and re-ALLOWs the doomed claim op every cycle (Case A).

**Hole worth naming:** `custodyOf` returns `master-unverified` for the master when not yet chain-proven (`signer.mjs:58`), and the gate refuses only `no-custody` / `keyed-unverified` (`signer.mjs:91-98`) — so think-log is full of `"verdict":"ALLOW", "custody":"master-unverified"`. Real custody enforcement happens later in `executeAs` via `verifyRoles` (`signer.mjs:602-603`), i.e. the gate's "custody first" is decorative for the master account; the guarantee holds, but it lives two lines below the gate.

**One-way filter — nobody reviews the gate:** `journalThink` (`signer.mjs:114-117`) appends to `think-log.jsonl`; grep across the entire repo shows the file has **exactly one writer and zero readers** (`signer.mjs:37,55,115` only; nothing in `src/`, nothing in `learning.mjs`, nothing in `selftest.mjs` — the 321-test suite contains no think-gate vectors). 54 ALLOW / 6 REFUSED verdicts sit unreviewed. The verdict's only feedback is the typed return value to the immediate caller (`signer.mjs:597-600`). **Verdict: a policy firewall, not a deliberation.**

---

## 5 · Scheduler-vs-cognition test (paper experiment)

Replace the entire engine with cron + if/else scripts reproducing today's behavior. What is lost?

**Honest answer: nothing decision-relevant.** Every live "decision" is a deterministic threshold/filter over the current observation plus small counters, all reproducible in shell/JS glue:
- sticky broadcast node = 1 memory variable (`signer.mjs:561-562`, `lib.mjs:395`);
- vote retry / already-voted dedup = error-string regex + counters (`curator.mjs:275-324`);
- RC governor = closed-form arithmetic with a bounded carry (`lib.mjs:499-519`), incl. the honest no-evidence→no-burn branches (`lib.mjs:501,646-651`);
- day caps = `max(state, chain)` counters (`curator.mjs:213-230`, `hypergrid.mjs:187-205`);
- single-instance/mutex/watchdog-heal = locks + health probes (`index.ts:196-251`, `sovereign.ts:127-249`);
- learning = a no-op on behavior in 156/156 live runs (tunings always `[]`);
- intel/discovery/recruiter = threshold rules, ranking, and re-labeling of state files — none of which alter the next broadcast beyond what a cron table could hardcode.

What cron would equally lack — and what therefore distinguishes "missing" from "replaceable": outcome→model-update (Case A proves it absent), uncertainty-graded action, hypothesis testing, self-review of the gate. The organism's genuinely non-trivial engineering (custody verification, byte-exact tx serializer, fail-closed doctrine, honest truth-taxonomy) is **safety and instrumentation**, not cognition. A cron implementation would need the same safety code, but it would not need to *think*, because nothing in the current loop thinks. **Verdict: today SAOS is a scheduler with guards and an excellent flight recorder.** The one capability a dumb cron truly couldn't reproduce without extra work — in-memory identity/custody caching across calls (`signer.mjs:162`) and the single-flight cycle marker — is concurrency plumbing, not cognition.

---

## 6 · Uncertainty verdict

- **Present, small, fail-closed (OBSERVED):** no-parity → peg publishes NO-PARITY and executor places nothing (`daily.mjs:174-178`); book-read fail → flow tranche silently inert (`daily.mjs:197-204`); no-RC-evidence or RC anomaly → zero ops (`lib.mjs:501,646-651`); custody unproven → REFUSED (`signer.mjs:91-98`); conn-fail → one retry, timeout → no retry (`sovereign.ts:254-258`).
- **Metadata-only (OBSERVED):** `lowConfidence` parity flags and measured/estimated/potential classes are displayed and journaled, but no decision reads them.
- **Absent (KNOWN):** no graded blast-radius choice, no reversible-vs-irreversible ranking, no suspension-with-escalation. The pause is binary operator control (`sovereign.ts:505-515`); escalation exists only as journal text ("OPERATOR REVIVAL…"). The largest uncertainty events on record (second actor broadcasting with the same credential; posting-authority mismatch) were resolved by external agents or not at all.

---

## 7 · Honest unknowns

1. **Watchdog downs (128) vs healthy engine (UNKNOWN):** `engine.log` shows 12 consecutive `duplicate-exit` spawns while the port was healthy (`heal-spawn` ×14 in sovereign-events). Why SovereignCore's 3.5 s `/health` probe intermittently fails (dev-server CPU contention vs Bun idleTimeout effects) is unresolved — the heal loop is firing against a live engine.
2. **Whether learning tunings can ever fire (UNKNOWN):** the wiring exists (`curator.mjs:165-166`) and is selftested as pure functions, but the trigger lessons (`curation-daycap-repeat`, `vp-surplus-idle`, `candidate-stream-narrow`) have never co-occurred with the current failure classes in 156 runs. Untested live.
3. **Second-actor interaction surface (UNKNOWN):** the weave handshake (`weave.mjs`, read-only, day-gated) counts their votes/orders, but nothing models or predicts the co-signer; collision handling is reactive regexes.
4. **Whether `exec-armed.json` policy (`allowDelegation:true`) is correctly scoped (ASSUMED from worklog T-82):** the gate sees a boolean only — "delegation to ACTIVE army accounts" is prose in a `delegationNote` field no code reads; nothing enforces the note's scope (delegatee set is unrestricted).
5. **Long-run P&L effect of the broken claim op (PREDICTED, small):** claims are currently pending rewards → VESTS accrue unclaimed; self-heals only if rewards hit 0 (op stops being generated) or an agent fixes the role.

---

## 8 · One-sentence verdict for the operator

**SAOS observes honestly, acts lawfully, records everything — and learns nothing: every arrow that should turn outcomes into changed decisions is either inert (156/156 empty tunings), blind (BROADCAST-FAIL invisible to cycle health), or delegated to external agent rounds; close Case A (claim-op role), give the think-gate memory and a reviewer, and wire one real outcome→policy path before calling this a cognitive loop.**
