# C-1c — LEARNING & PREDICTION AUDIT (SAOS sovereign engine)

Round: SOVEREIGN SYSTEMS COGNITION · Agent: Learning & Prediction Auditor · Date: 2026-10-05 ~13:15–13:40 UTC
Scope: `/home/z/my-project/mini-services/saos-engine` (live, read-only) + cockpit `src/`. All experiments were read-only; no live file was modified.

---

## 1. Executive picture (≤6 lines)

The engine has a **real, live-wired learning loop that has never once changed a policy**: `learning.mjs` recomputes evidence-cited lessons from logs every ~10-min cycle (155→157 runs over 6 days), but the only actuator it owns (3 hard-clamped curator tunings) has fired **0 times in 156 recorded runs** (`tunings: []` in every `learn.done` event). Behavior *does* change over time — but as a **function of current state under fixed laws** (VP floor pauses voting at 2.7%, RC governor slowed 32,086→7,536 ops/day after the RC tank shrank 4×), not as a function of accumulated experience. The organism keeps **repeating a measured, identical failure 19× with zero adaptation** (`claim_reward_balance` → "Missing Posting Authority"). **No prediction anywhere in the system is recorded with confidence and later scored against reality.** Verdict class: **(c) reactive adjustment**, with one wired-but-dormant tuning channel and one true micro-adaptation (sticky broadcast node).

## 2. Learning-chain table

| Stage | Present? | Evidence | Label |
|---|---|---|---|
| **Experience** (raw outcomes recorded) | YES | `state/exec-log.jsonl` (673 lines, ok/error per broadcast), `state/events.jsonl` (`curate.done`, `hyper.requote` ×297, `learn.done` ×156), `state/sovereign-events.jsonl` (cycle ok/blocked/fail with ms), `state/think-log.jsonl` | KNOWN |
| **Representation** (metrics derived from history) | YES | `learning.mjs:52-108` `analyzeCycles/analyzeCurator/analyzeExec`; `learning.json` metrics block recomputed each cycle (okRate 78.8→79.4 as windows slid) | KNOWN |
| **Evaluation** (judgment on metrics) | PARTIAL | `learning.mjs:111-195` `deriveLessons` — deterministic threshold rules produce evidence-cited lessons (e.g. `cycle-latency-tail` fired at 13:04/13:14 when p90>3×p50, correctly **stopped** at 13:24 when 38136 < 3×12905 — the evaluator works) | KNOWN |
| **Lesson artifact** (persisted) | YES | `state/learning.json` lessons[] with `evidence` strings; `lessonsTotal` accumulates: cycle-conn-fails ×132, unclassified-fail-legacy ×90, signing-cred-blocked ×74, broadcast-fails ×49, cycle-latency-tail ×4 (13:14Z) | KNOWN |
| **Policy/model change by the machine** | WIRED, NEVER FIRED | `learning.mjs:205-235` `deriveTunings` (baseWeightPct clamp [30,60] +5; ageMinMinutes [5,12] −2; tags additive ≤8); read live at `curator.mjs:165-167` merge AFTER operator conf. All 156 `learn.done` events carry `"tunings":[]` — none of the 3 triggering lessons (daycap-repeat ≥3, vp-surplus-idle, candidate-stream-narrow ≥3) has ever occurred | OBSERVED |
| **Future behavior changed by experience** | ONE MICRO-CASE ONLY | `lib.mjs:393-399` `stickyNodeOrder` + `signer.mjs:561-574`: `lastGoodBroadcastNode` is updated on every successful broadcast and tried first thereafter (in-memory, resets on reboot). The measure/read path (`measure.mjs:12-35` rpcCall) uses a FIXED node order — no equivalent adaptation there | KNOWN (code) / OBSERVED (behavior) |
| Model re-fitting from outcomes (calibration, weight updates, error-driven parameter change) | **ABSENT** | grep across all `*.mjs`/`*.ts`: no calibration records, no fitted parameters, no prediction-error terms; every threshold is a compile-time constant (`curatorPolicy()`, `HYPER_DEFAULTS`, `LEARN_CLAMP`) | KNOWN |

**Where the visible behavioral improvements actually came from:** the engine's history is full of behavior changes (batch-vote → one-vote-per-tx; per-vote guard hoisting; cred gate first; chain-truth day budgets) — every one was **authored by agent rounds between sessions** and shipped as code (worklog T-13…T-19; e.g. `curator.mjs:252-268` documents the 2026-09-29 MIN_VOTE_INTERVAL law). The running process itself never made any of these changes.

## 3. learning.json forensics

- **Writer (exactly one):** `learning.mjs:283` `writeJson(LEARN_FILE, out)` inside `runLearning()`, invoked from the daily cycle's `learn` step (`daily.mjs:472-482`) **every cycle** (~every 10 min; sovereign `autoRuns` 142, cadence observed 13:04:48 / 13:14:48 / 13:24:48 / 13:34:48). Also appends `learn.done` to `events.jsonl`.
- **Readers (four, two in the live decision path):**
  - `curator.mjs:165` `learningTunings()` → merged into the live vote policy (`p = {...curatorPolicy(), ...conf.curate, ...learned}`) — **this is a genuine live actuator wire**, currently carrying `{}` every run.
  - `discovery.mjs:180` (display field `learningConsumer`), `fleet.mjs:64,142` (fleet-registry status line), `index.ts:77` → `/status` → cockpit `page.tsx:784-816` (badge "למד · התעדכן", lessons list, tuningsApplied).
- **Schema:** `at, enabled, runsTotal, verdict, metrics{cycles,curator,exec,watchdog}, lessons[{id,severity,evidence,lesson,action}], tunings{}, tuningsApplied[], lessonsTotal{counts}, honesty`.
- **Diffs over time (three live samples):**
  - **13:14:48.876Z** (runsTotal 155): okRate 78.8 (26/33), p50 12242 / p90 38136, lessons = `[signing-cred-blocked, cycle-latency-tail, broadcast-fails]`, tunings `{}`.
  - **13:24:48.874Z** (runsTotal 156): okRate 79.4 (27/34), p50 12905 / p90 38136, lessons = `[signing-cred-blocked, broadcast-fails]` — **`cycle-latency-tail` correctly disappeared** because 38136 < 3×12905 = 38715. tunings `{}`.
  - **13:34:48** (runsTotal 157, confirmed via `learn.done` event): same shape, tunings `[]` again.
- **Verdict:** **(ii)+(i) hybrid — a live diary whose only behavior-changing payload has been empty for its entire 6-day life.** It is not a fossil (written and consumed by the live engine every cycle), and the metrics genuinely recompute; but as of today **nothing in the live path behaves differently because learning.json exists**. The `runsTotal`/`lessonsTotal` counters are the only monotonic "memory" — and they change no decision.
- Side-finding (journal honesty): `hypergrid.mjs:214-222 + 119-128` — `finish()` writes the new `lastVerdict` to `hyper-grid.json` **before** `journalVerdict()` re-reads the file, so the change-detector always compares the verdict against itself: **0 `hyper.verdict` events in events.jsonl over 11,010 ticks** while verdicts demonstrably oscillated (NO-PLAN now, BROADCAST at 12:56). The verdict journal is dead code — the bus *under*-records the volume layer's decision history.

## 4. Behavioral-diff case studies (decision points over time)

**Case 1 — Curator VP-floor (fixed threshold, state-driven, not experience-driven).**
`curator.mjs:48` `minVpEffPct: 60` since day one. `events.jsonl curate.done`: vpEff **85.5%** → VOTED ×10 (2026-09-29 19:45, tx 8fd4f634…) → **83.1%** → VOTED ×9 (09-30 17:30) → **70.3%** → VOTED ×10 (10-02 00:01) → **2.7%** → verdict `VP-FLOOR`, votesToday 0 (10-05 13:24, `curator.json`). The pause/resume is the same law evaluating current state; it would have behaved identically on day one. (Note: `maxPerDay` was 18 in the 09-30 `curate.day-cap` events vs 10 today — an **operator config change**, not learning.)

**Case 2 — RC governor: the machine slowed 4× when its capital shrank.**
`rc-tank.json` history: maxRc **6.139e12** (10-01/10-02, equilibrium **32,086** ops/day) → **1.509e12** (10-04, **7,886**) → **1.480e12** (10-05, **7,736**, growthPct −1.89%). `events.jsonl hyper.requote`: opsToday climbed 2→8 within 12 s on 09-30 19:18 and reached **324** on 10-02 00:16 with `equilibriumOpsPerDay: 32086`; on 10-05 12:56 the same law broadcast 2 ops with `equilibriumOpsPerDay: 7536`. Live governor state (`hyper-grid.json`): headroom 2.996, `reason: "accumulating"`, carry 0.111 — the "governor budget law" claim from the worklog **verifies** (`lib.mjs:499-519`: burn/day ≤ regen/day × headroom, pairs = floor(raw+carry), 0 at RC≤25%). This is **reactive model-based control**: the model (`regen = maxRc × 20%/day`) never changed; only the measured input did.

**Case 3 — The non-learned loop: 19 identical failures, zero adaptation.**
`exec-log.jsonl`: `claim_reward_balance` failed with the **same error** "missing required posting authority:Missing Posting Authority headcorner" **19 times** (first 2026-10-04 20:14:52, last 10-05 13:05:28, all tag `cycle-execute`) — once per cycle, ~every 10 minutes, while `limit_order_create` broadcasts succeeded seconds earlier (active key OK, posting authority absent). The learning layer even sees it (`broadcast-fails` lesson, ×49 total, severity high) — but its `action` is a **static prose string** ("fail-closed stop already holds; vote-interval retry added T-14") and **no mechanism connects the lesson to the op**: no backoff, no removal, no role change. A learner that re-runs a measured-doomed op 19× is not learning from it.
*PREDICTED:* when VP regenerates above 60% (~Oct-8-10 at the measured regen curve), the curator will hit the same posting-authority wall on vote ops (role `posting`) and will produce one BROADCAST-FAIL per run, fail-closed, indefinitely — unless an agent/operator intervenes.

**Case 4 — Grid prices: input-tracking, strategy-constant.**
`our-orders.json`: value-tranche asks at unit **0.108808–0.108917** (09-30 18:43) → flow asks **0.106 / 0.108** and live book front **0.1026** (10-05 12:56). Prices follow the parity feed + book front by construction (`planLadder`, `spacingBps: 15` fixed); 46 fills, realizedSbd **−0.14697** (`observe.json` pnl) — and **no parameter of the ladder changed because of PnL**. The grid has no notion of "my placements lost money; place differently".

**Case 5 — Agent-authored behavior change (the actual learning channel of this organism).**
2026-09-29 19:42: three `BROADCAST-FAIL` curator runs (batched 10-vote tx killed by `STEEM_MIN_VOTE_INTERVAL_SEC=3`); 19:45 same day: `VOTED ×10` after an **agent** (worklog T-13) changed the code to one-vote-per-tx spaced 3.2 s (`curator.mjs:252-268`). The behavior change is real and permanent — but it lives **outside** the running process: in agent cognition + git, not in any state the engine reads to adapt.

## 5. Prediction inventory + scoring status

| Prediction | Where recorded | Confidence recorded? | Scored later? |
|---|---|---|---|
| VP regeneration (`hrsToFull` 116.7 h, regenPerSec 14.7M/s) | `payouts.json` `vp` block; `lib.mjs:920-929` | No | **NO** — recomputed fresh daily; history stores only pendingVests/phase |
| RC equilibrium ops/day (7,736 today) | `rc-tank.json` incl. 4-day history + growthPct | Labeled `MEASURED` (it is a re-measurement, not a forecast) | **NO** — actual ops burned are never compared to equilibrium |
| Curation yield estimate **8.74 STEEM/day ≈ $0.55/day** | `discovery.json` `curationEst` (ESTIMATED class, honesty note), `economics.json` rail | Yes — explicitly labeled "ESTIMATED… never claimed as measured" | **NO** — `observe.json` fuel says curationVestsPerDay **0** and `payouts.json` rollup curationVests **0** sit right next to it; **no code path ever reconciles estimate vs measured** (`measuredUsdPerDay` stays null) |
| Payout clock (daysRemaining, phase) | `payouts.json`; history 10-02 `pre-payout` → 10-04 `paid-window` | No (deterministic) | It "came true" — but it is a chain-state readout, not a scored forecast |
| Governor fraction-carry credit | `hyper-grid.json` `governor.carry` | n/a | n/a — accumulator, not scored |
| Convert edge 7107 bps → armed-in-doctrine HOLD | `convert-plan.json` | n/a (measured input to a fixed gate) | n/a |

**Bottom line:** predictions exist as *labeled estimates* (the honesty taxonomy measured/estimated/potential is real and consistently applied), but there is **no prediction-error anywhere** — no expected-vs-actual comparison, no calibration record, no Brier/log-score, nothing. The one pair that begs to be reconciled (curation estimate 0.55 $/day vs measured 0.00 $/day over a 24-day window) has never been confronted in code. **This is the single cheapest upgrade to a real learning loop**: `|est − measured|` per rail, journaled, and used to re-clamp the estimators.

## 6. The 7-days-without-agents thought experiment

Assume no agent session, no operator touch, from 2026-10-05 onward. The engine keeps cycling (~144 cycles/day), the watchdog keeps healing (1,537 checks, 40 heals so far), the hyper-grid keeps ticking.

**WOULD change (state-driven, fixed laws):**
- Grid order prices/front levels track the live book and parity feed; TTL (60 s) requotes continue.
- Governor burn rate scales with the RC tank (equilibrium already moved 32k→7.5k ops/day by itself).
- Curator resumes voting when VP crosses 60% (army accounts at their own 80% floor — `army.mjs:60`).
- Sticky broadcast node flips if the current node dies (the one genuine experience-dependent variable, lost on restart).
- Day-cap / chain-truth gates, stale-order reconciliation (cap 12), RC-anomaly guard all continue.
- Diaries keep growing: rc-tank daily curve, payouts history, learning.json lessonsTotal, discovery tag board (30-min cadence).

**MIGHT change (the dormant actuator):** if VP recovers AND the curator then hits `DAY-CAP ×3 in a row` or `VP>90% idle with votes>0`, `deriveTunings` would produce its first-ever tuning (baseWeight 50→55→60, clamped at 60) and the curator would genuinely vote heavier. This is the **only** self-modification the machine can perform, bounded to ±5% weight / ±2 min age / +1 tag (`LEARN_CLAMP`). In 156 runs it has never happened.

**WOULD NOT change:**
- The doomed `claim_reward_balance` call — ~144 identical failures/day forever (posting authority cannot self-heal; only operator/agent can fix custody).
- The curation estimate would keep saying $0.55/day next to a measured $0.00 — unreconciled, unshameable.
- Every threshold: VP floor 60/80%, RC floor 25%, setpoint 50%, burst 3, spacingBps 15, ttlSec 60, day caps 10 votes / 32k ops, minBodyChars 600, age window 10–1200 min — all constants.
- No strategy change from the negative realized PnL; no fill-probability or spread-dynamics learning; no re-prioritization of rails from their measured yields.
- If the credential spoils or the posting-authority gap persists, the machine **screams honestly** (cred-alarm, blocked cycles) but cannot restructure itself.

**Net:** 7 days alone produce a system whose behavior is a pure function of (current environment × fixed laws) + one sticky-node memory. Everything that "learned" in this project's history learned in agent rounds and was welded in as code.

## 7. Final verdict + honest unknowns

**Verdict: (c) reactive adjustment — not (b) pure passive memory, and decisively not (d) model-updating learning.**
- **Grid / hyper-grid:** (c) — measured-input governor, constant model; verdict-journal bug makes its decision history incomplete (0 `hyper.verdict` events / 11,010 ticks).
- **Curator:** (c) — fixed-threshold gating (60% VP, day caps, chain-truth budget), plus a **live but never-fired** learned-tuning actuator (the closest thing to (i) live learning in the codebase).
- **Army:** (c) — same planner, 80% VP floor, fixed weights.
- **Payouts / RC-tank / economics:** (b) — high-quality passive memory (daily measured diaries with honesty labels), zero feedback into policy.
- **Learning layer itself:** honest by construction (evidence-cited, hard-clamped, doctrine untouchable) — currently a **diary with a disconnected actuator**.
- **True learning in the organism** lives in the **agent layer** (worklog T-13→T-19: every law was a measured failure converted into code by an agent). The engine is the *evidence buffer and executor* of that cognition, not the cognizer.

**Unknowns / caveats:**
- Whether `deriveTunings` would fire under a day-cap streak is verified by code + selftest vectors, never by a live occurrence (label: INFERRED from code).
- Why the account lost posting authority between 10-02 (votes landed) and 10-04 (claim fails) is UNKNOWN from local state — custody/keys were out of my audit scope (no secrets touched).
- The read-path (`measure.mjs`) node ordering is fixed while only the broadcast path is sticky — whether that asymmetry is deliberate is UNKNOWN (it looks like an oversight).
- The second signer's behavior (same credential, external) is observed only through chain history; its "learning" is invisible to this audit.

**Highest-value next moves (for whoever implements):** (1) score the curation estimate against measured curation daily and journal the error; (2) make lesson actions *addressable* (at minimum: suppress the claim op after N identical failures — a 5-line, clamped, journaled adaptation); (3) fix the `journalVerdict` write-then-read order so the grid's verdict history actually lands in events.jsonl; (4) make `learningTunings()` feed back `okRate/p90` sanity so lessons can gate the governor's `burst` — the only parameter with real headroom left.
