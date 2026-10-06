# C-1e — ADVERSARIAL SKEPTIC (SOVEREIGN SYSTEMS COGNITION round)

Investigator: C-1e · read-only on live system; all experiments on /tmp copies; chain reads via api.steemit.com.
Timestamp of investigation: 2026-10-05 ~13:00–14:00 UTC. Engine PID 6127 (`bun --hot index.ts`, :3040), cockpit :3000 up, sovereignty resumed 10:33 (sovereign.json `paused:false`).

---

## 1 · Executive picture (≤6 lines)

The organism is a **real, live, chain-writing system** — but its "green" is **exception-freedom, not success**: the last cycles show `health=ok` while its `claim_reward_balance` broadcast has failed **19 consecutive times over 6 days** (wrong signing role) and ~12 of 19 cycle steps are no-ops. A **second actor running a near-copy of the same organism** broadcasts on the same account outside this engine's gate — and today it did our machine's repairs (swept stale orders, claimed the rewards we couldn't). The think-gate is real but covers **this process only**, and its funds-policy inspects only 2 of ~15 value-moving Steem ops. Escrow truth (measured on-chain): **2,462 SP returns Oct 9–10, not "~Oct-12"**.

---

## 2 · Falsification table — 6 most consequential worklog claims

| # | Claim (source) | Test (independent evidence) | Result | Verdict |
|---|---|---|---|---|
| 1 | "Think-gate gates everything — no bypass" (T-80/81/82) | (a) grep of entire project: only saos-engine files reach `broadcastTx`/`executeAs`; `executeAs` (signer.mjs:587–639) calls `thinkGate` at :597 before key material. (b) BUT gate's funds policy (signer.mjs:100–108) inspects **only** `opName==="transfer"` and `"delegate_vesting_shares"` — `transfer_to_vesting{to:X}`, `transfer_to_savings{to:X}`, `withdraw_vesting`, `convert`, `collateralized_convert` pass the funds policy with merely custody+RC checks. (c) Chain shows a second writer broadcasting with the same master credential entirely outside this gate (see #6). (d) `:3040/adopt-credential` (index.ts:164–186, no auth, 5/h) can overwrite `.secrets/headcorner.key` (DoS the signing rail, not steal it — verifyRoles still gates usage). | Gate is real but narrower than claimed | **PARTIALLY CONFIRMED** (process-internal: yes; absolute "everything": no) |
| 2 | "First full-green cycle — health=ok ALL 17 steps true" (T-23) and "cycle health=ok" as ongoing health proof (T-82) | `stepWrap` (daily.mjs:49–57) marks a step `ok:true` unless it **throws**; `cycleHealth` (lib.mjs:319–326) counts only `ok===false`. Live: last marker (state/cycle-run.json) shows 19 steps green, but 12 are no-ops (`VP-FLOOR`, `ARMY-IDLE`, `NO-OPS`, `CADENCE-GATED` ×3, `DISABLED`…), and `exec-log.jsonl` shows `claim_reward_balance` **BROADCAST-FAIL ×19** (first 2026-09-29, 17× today, every ~10 min: 12:05→13:05) with "missing required posting authority" — `executeOps` defaults `role:"active"` (daily.mjs:409), claim needs posting. Each failed cycle still counted green (`BROADCAST-FAIL` ≠ step failure). | Health is exception-based; persistent on-chain failures invisible | **REFUTED** (as a "health" claim) |
| 3 | "SELFTEST 311→321/321 PASS" (T-82/T-83) | Re-ran `bun selftest.mjs` on a full copy in /tmp/c1e-selftest (engine node_modules symlinked): `SELFTEST 321/321 PASS`, EXIT=0 — matches state/selftest-last-run.json (11:27:14). Scope check: selftest.mjs imports lib/content/grid/fleet only — **zero vectors for signer.mjs** (think-gate, custody, pause-unification are untested); suite is pure-function/offline. Also SovereignCore's own 6-hourly selftest scheduler has **never fired**: sovereign.json `selftest.runs=0` despite cross-boot counter persistence. | Number reproduces; safety layer uncovered; in-system scheduler dead | **CONFIRMED** (with scope caveats) |
| 4 | "~727 SP return-escrow lands ~Oct-12" (T-82) → corrected by T-83 to "~2,462 SP landing ~Oct-12" | `condenser_api.get_expiring_vesting_delegations("headcorner")`: total **3,971,982.175 VESTS = 2,462.4 SP** @ 1,613.04 VESTS/SP. **Dates on-chain: expires 2026-10-09 05:21–20:34 (bulk incl. 400,448/408,732/401,281/405,658/401,370/404,883 VESTS old-army waves + powerspan/hive tranches) and 2026-10-10 09:46–47 (9928+9928+10033 = the hcsoldier1/2/3 wave)** — not Oct-12. T-82's 727 SP also refuted. | Size right (T-83), date wrong (both) | **SPLIT** — 2,462 SP CONFIRMED; "~Oct-12" REFUTED (actual Oct 9–10) |
| 5 | "Delegations restored/equalized — all 10 active-army accounts uniform @ 8.86 SP, chain-proven" (T-82) | Chain: cashmachine `received_vesting_shares` = **48,393.301791 VESTS**; woq = **53,932.940994 VESTS** (≠ uniform). At the TRUE ratio 1,613.04 VESTS/SP (T-83): 30 SP / 33.4 SP — "8.86 SP" came from the retired 5,460 unit law. Delegation tx on-chain 2026-10-05T10:44:18 (woq 48,393.301791) matching think-log source `t82-delegation-active-army` ×3 ALLOW. | Delegation real & gated; "uniform @ 8.86 SP" false | **REFUTED as written** (substance CONFIRMED) |
| 6 | "Stale 04:01 orders will be swept by the grid's OWN reconciliation law — not manually forced" (T-82) | Hyper layer cancels only ids in its partition [2.1e9, 4.294e9] or its own registry (hypergrid.mjs:67–71, 294, readLiveHyper:161–182); the stale asks 2026100501–503 (3.087 STEEM, created 04:01:39–45) are date-based ids outside both. Chain history (account_history_api): those orders were cancelled **12:56:33/36/39** and replaced by 2026100504–506 (12:56:42–48) — **none of these ops appear in our exec-log or think-log** (our only 12:56:46 tx = 2 hyper creates, txid 8065683d). The sweeper is the SECOND ACTOR's value-ladder rail (same id scheme as its Oct-4 waves 2026100401–403, ~30-min cadence). Also hypergrid.mjs header claims "chain-truth day accounting" but the governor enforces the **local** counter only (`opsToday: opsDay.opsToday`, hypergrid.mjs:257–262); `chainTail` is written by tailSample (:382–395) and never read back into the cap. | Swept by the other actor, not our law; day-cap enforcement local-only | **REFUTED** |

Bonus falsifications (small):
- "46 real fills" (status): CONFIRMED as fills, but the same payload shows `realizedSbd: −0.147` — real activity, **not profit**; economics.json itself marks market-making `confidence:"blocked"` while showing `fillsToday:46` — internally inconsistent card.
- "payout clock reached phase=paid-window" (T-82): CONFIRMED (state/payouts.json payoutDay 2026-10-05, phase paid-window; pending 59.70 VESTS).
- promo.mjs transparency posts describe a "Soldier fleet: live on the book / deploying" and "keyless-doctrine" — both stale lies post-T-80 (soldiers frozen; engine holds keys).

---

## 3 · AI-theatre inventory

| Component | Load-bearing / Decorative | Evidence |
|---|---|---|
| `GET :3040/health` (index.ts:47) returns `{ok:true,...,keyless:false}` **unconditionally** — hardcoded | Decorative as health; load-bearing as liveness. The SovereignCore watchdog (src/lib/sovereign.ts:90–96,185–249) and the single-instance pre-bind probe (index.ts:205–215) both key on it. Engine can be blind (RPC dead), signing-dead, or paused — /health still says ok:true | index.ts:47; sovereign.ts:92 |
| SovereignCore 6-hourly selftest timer (sovereign.ts:27,400–426) | **Decorative** — `selftest.runs=0` forever (state persists across boots); the header comment claims "quality suite every 6h" | sovereign.json `selftest:{runs:0,lastAt:null}` |
| Cycle "standing selftest" step (daily.mjs:542–562) | Half-real: day-gated on `selftest-last-run.json`; today's file was written by a **manual agent run** (11:27), so every cycle today reports CADENCE-GATED for free. Mechanism would fire on first cycle after midnight UTC | daily.mjs:544–547; selftest-last-run.json |
| Weave "handshake PUBLISHED" (weave.mjs:106–110, state/weave.json) | **Decorative on our side** — we publish a *local JSON file*; nothing is broadcast (weave.mjs is read-only). All on-chain `saos.weave.core.v1` / `saos.snapshot.v1` custom_json (every 5–20 min, see history) come from the second actor. The "shared day-cap" is nonetheless enforced for the master curator via chain-truth vote counting (curator.mjs:213–228) — that part is real | weave.mjs:21,106–114; curator.mjs:216–219 |
| Content team drafts "queued for the promo rail" (content.mjs:9–13) | **Decorative** — promo.mjs never reads content-ops.json (grep: zero references); 3 drafts queued, nothing consumes them | promo.mjs (full file); state/content-ops.json |
| Web-intel team (webintel.mjs) | Half-real: real bridge to Next AI SDK, 20 sourced findings (state/webintel.json), cadence 6h — but findings change no behavior (no consumer beyond cockpit display + discovery tags) | webintel.mjs:15–30 |
| state.json sim grids (`mm-grid, micro-arb, sweep, anchor-quote`, simFills 21, simFeesMu 10,500 µ) | **Decorative economics**: grid.mjs fills are labeled `real:false` (grid.mjs:27–44); "fee.spawn → R-FEE-SPAWN" meters money that exists nowhere. Displayed in /status `grids` next to real trading | grid.mjs:27–44,66–71; index.ts /status `state` |
| Cockpit `/api/saos/signer` route (src/app/api/saos/signer/route.ts:9) | **Dead rail** — reads `/home/z/audit/saos-dex/grids/state/mover-log.jsonl`; that path does not exist (saos-dex died with the sandbox). Route permanently answers `{"ok":false,...,"note":"mover-log.jsonl לא-זמין"}` (verified live) | route.ts:9; live curl |
| state/our-orders.json registry | Half-decorative: 44 entries, most from 09-30 long dead; pruned only on successful cancel broadcasts. Used by weave ours/theirs classification → drifts | our-orders.json contents |
| think-log.jsonl (the transparency promise "always answerable") | **Nobody consumes it** — zero reads in cockpit or engine (grep); answerable only by manually opening the file | rg "think-log" across src/ + engine → only signer.mjs writes |
| Learning layer (learning.mjs) | **Load-bearing** — tunings merge into curator policy last (curator.mjs:160–167), clamped; though today `tuningsApplied: []` (runsTotal 157, currently zero behavioral delta) | curator.mjs:160–167; learning.json |
| Watchdog heal loop | Load-bearing: 1,551 checks / 128 downs / 40 heals / 37 verified / 0 failed (sovereign.json) — measured | sovereign.json watchdog |
| Cycle-day chain-truth vote cap (curator) | Load-bearing: `budgetCounted = max(state, chainDayCount)` counts the second writer's votes too | curator.mjs:213–228 |
| Hyper-grid RC governor + RC-anomaly guard | Load-bearing: currently GOVERNOR-ACCUMULATING (verdict each tick), real burn protection | hyper-grid.json; hypergrid.mjs:243–267 |

---

## 4 · Signing-path map (static)

All paths that can sign/broadcast (grep of full project for `broadcastTx|executeAs|executeOps|broadcast_transaction`): every one lives in `mini-services/saos-engine/` and funnels through **one** choke point.

| Path | Through think-gate? | Evidence |
|---|---|---|
| cycle execute step (`daily.mjs:281+` → `executeOps`) | YES (`signer.mjs:597`, tag `cycle-execute`) | think-log entries `cycle-execute` |
| master curator votes (`curator.mjs` → `executeAs`, role posting) | YES | think-log `army-curate`/curate sources |
| army rail per-account votes (`army.mjs` → `executeAs`, posting only) | YES (custody per account; keyless = REFUSED) | think-log `army-curate` ×31 |
| hyper-grid orders (`hypergrid.mjs:332` → `executeOps`) | YES | think-log `hyper-grid` 12:56:42 |
| promo daily post (`promo.mjs` → `executeAs`, role posting) | YES | think-log `promo-daily` ×1 |
| soldiers rails (`soldiers.mjs`) | YES + config gate `soldiers.enabled=false` (dead code path today) | exec-armed.json |
| probes `rc-probe.mjs`, `proof-live.mjs` (manual CLI) | YES (executeOps) | rc-probe.mjs:37,44; proof-live.mjs:72 |
| `steemtx.buildTx` direct use outside signer | **NONE found** (grep: only signer imports it for signing) | grep results |
| Cockpit (`src/app/api/*`) | Never signs; proxies to :3040 (adopt-credential, status, sovereign control) | adopt-credential/route.ts:24–35 |
| SovereignCore (src/lib/sovereign.ts) | Cannot sign (spawns/controls only) — header law holds | sovereign.ts:11 |
| **Second actor (external process, same master credential)** | **NO GATE — outside this codebase** | chain ops 12:56:33–39 cancels, 13:07:21 claim, weave/snapshot custom_json, 09:46:51–09:47:09 delegate-to-zero revokes |

Signing material outside the engine process:
- `.secrets/headcorner.key` (master password, 0600) — engine-held by design.
- `.secrets/army-vault-recovered.json` (0600, **full WIFs for 14 accounts**) — any process running as user `z` can read and sign as the whole army without the engine.
- `upload/pat.env` (GitHub PAT, still present; T-79 flagged "revoke after ops" — still open).
- `upload/הד.txt`, KEYS tarballs — dead/encrypted material.
- Cockpit HTTP: `:3040/adopt-credential` (no auth) can replace the master key file; `:3040/cycle`, `:3000/api/saos/sovereign` (pause/resume/kick, no auth) can start/stop the machine. **Caddyfile** (`:81`) proxies :3000 by default and **any localhost port** via `?XTransformPort=3040` — whether the platform edge authenticates the preview URL is UNKNOWN, but the app layer adds zero auth.

---

## 5 · Failure-mode findings (code analysis; no execution)

1. **RPC node down 1h** — `rpcCall` fails over 3 nodes (measure.mjs:12–34), then `{ok:false}`. observe writes null-laden data and stays `ok:true` → **cycle stays green while blind**; peg → `NO-PARITY`, hyper → `NO-RC-EVIDENCE`/`NO-BOOK` (no burn, 3s retry loop); curator CRED-gate then candidate-fetch fails (typed verdict); executeAs refuses `NO-DGPO` (fail-closed at signing). Net: silent idle, no crash, no corruption, no recovery action — nobody but a verdict-reader would notice.
2. **Malformed chain response** — `rpcCall` returns `result` unverified; consumers use optional chaining and dual-shape parsers (`amt`, `opOf`, `opTypeName`); RC anomaly guard (hypergrid.mjs:243–246) catches implausible RC maxima. Residual risk: a lying-but-well-formed RPC (wrong account data) is mostly caught by pinned account names + custody verification; malformed open orders would feed the diff a bad plan (creates at wrong prices) until next tick's fresh read — bounded by caps (maxOpsPerTick, budgets).
3. **Policy file missing/corrupt** — `armedConf()` (signer.mjs:316–326) silently writes the **defaults** (armed:true, allowTransfersOut:false, allowDelegation:false) → **fail-closed for value ops**. Side effect: a corrupt file silently *deletes the operator's standing order* (T-82's `allowDelegation:true`) with no alarm; and `.secrets/` is wiped by cold-resets (measured twice, T-78/T-81), so operator policy resets at every environment fall.
4. **Two state sources disagree** — chain wins where it matters: hyper diff reads live `get_open_orders` (hypergrid.mjs:161–182); curator day-cap takes `max(state, chain-truth)` (curator.mjs:216–219). Exception: the hyper **opsDayCap** is enforced against the local counter only (see §2#6) — an under-count is possible after crashes; with a 32,000/day cap and ~14 real ops/day it is presently immaterial. Reconciliation (tailSample) observes but does not correct.
5. **Disk full / state write fails** — in-cycle writes throw → stepWrap marks the step failed (health finally reflects something); hyper tick catches → TICK-ERROR. Danger point: `executeAs` appends exec-log **after** the broadcast (signer.mjs:633) with no try/catch — a post-broadcast journal failure throws to callers who may retry; chain-side dedup (already-voted → DEDUP, same orderid → replace, chain-truth day-cap) makes actual double-execution unlikely but not impossible. Think journal is best-effort (gate still decides). Half-written files: only hyper-grid/our-orders/weave use tmp+rename atomic writes (hypergrid.mjs:59–64); daily.mjs/cycle-run/observe use plain truncate+write — the exact torn-read class hypergrid's comment describes still exists for the other files (marker readers treat torn JSON as null and cope).

---

## 6 · Autonomy novelty test (paper)

**No code path generates its own goals.** The engine is a fixed 19-step cycle (daily.mjs), a 3s fixed-rule requote loop (hypergrid.mjs), day-gated fixed-cadence teams (webintel 6h QUERY_PLAN of 4 hardcoded queries, content 12h, payouts/weave/rctank day-gated), and clamped tunings (learning can move baseWeightPct 30–60, ageMin 5–12, add ≤8 tags; never touch VF1/VP floors/caps). The only "choices" are: governor arithmetic, policy merges, and filterCandidates scoring. The LLM bridges (webintel/content) produce *display artifacts*, not intentions. After 30 days with no operator input: same loop — escrow lands (+2,462 SP → RC jump → governor allows more ops toward the 32k cap), claim rail keeps failing every 10 min (or the second actor keeps claiming), payout clock flips phases, learning counters grow with occasional clamped nudges, logs grow unbounded, selftest timer still never fires. **Richer data, same goals. Verdict: execute-only autonomy; goal synthesis absent.**

## 7 · Hardest-scenario walkthrough (code-cited)

Operator silent; price gaps −30% at 3am; Binance+CoinGecko+Coinpaprika all slow; one RPC node dies.
1. Parity ladder degrades → if all sources fail, `parity=0` → peg `NO-PARITY` (daily.mjs:173+), hyper `NO-PARITY` — the book decays by 1h TTLs (orderTtlSec 3600) and the machine goes **quietly flat**; cycle health stays ok.
2. RPC node down → failover; if the tail node also lies, RC-anomaly guard halts burns (hypergrid.mjs:243).
3. Band guard: current parity 0.1077 vs feed 0.1041 = 343 bps → `band-ok`; if broken, offer `blocker` → `OFFER-EMPTY` (observe live).
4. A service falls (engine process) → watchdog two-strike + heal (sovereign.ts:196–217, 128 downs/40 heals measured); while paused, heal is suppressed (sovereign.ts:216) and thinkGate REFUSES all (signer.mjs:78–80).
5. Resource scarcity: RC floor 25% stops orders first (hypergrid.mjs:249), votes protected by conf.minRcPct 20; disk-full → §5.5.
6. Multiple trade-offs: no deliberation — fixed op order in the execute step (stale cancels → ladder → claim → convert) with caps applied by slicing budgets (daily.mjs:296–397). "Past data proves wrong": if observe.json/parity marks were wrong, nothing cross-checks marks against fills; the machine would keep quoting at a false anchor until band guard or fills' PnL signals — **no data-quality loop exists**.
Verdict: it **endures** (heals, floors, fail-closed signing, honest journals) but it does not understand, choose, or learn from its own failures. **Most decisive missing capability: a closed failure→diagnosis→behavior-change loop** — the live proof is 19 identical `claim_reward_balance` failures over 6 days that never changed a line of behavior (role bug is a one-line fix: `role:"posting"`).

## 8 · One-up the optimism AND the pessimism

- Expect others to **over-credit**: "health=ok ALL GREEN" (= no exceptions; 12/19 steps no-ops, broadcast failures invisible); "selftest 321/321" (pure functions only; zero vectors on the think-gate/custody/pause safety core; in-system scheduler never fired); "army ACTIVE" (10 accounts voted the **same 3 posts** at identical weights — a clone-farm signal, 4/10 accounts still VP-floored); "handshake published" (local file; the other side never read it).
- Expect others to **over-damn**: "the second actor is a rogue threat" — chain evidence shows it sweeping our stale orders (12:56:33), claiming rewards our broken rail missed (13:07:21), running the weave protocol on-chain, and revoking bad delegations (09:46). Same-credential double-writing is ungovernable (106 `unknown key` + 93 uniqueness failures in exec-log are the measured cost) — yet today it functioned as an unconscious repair crew.
- Evidence-based middle: one account, two uncoordinated copies of the same organism = intermittent races (real, measured) + accidental redundancy (real, measured). The fix is not fear, it is either one writer or an on-chain lease.

## 9 · Honest unknowns

- Whether the platform edge authenticates the Caddy `:81` preview (external reachability of no-auth engine endpoints) — UNKNOWN from inside.
- Who exactly runs the second actor (worklog says the other platform sandbox; code forensics say a near-copy with a value ladder + claims + weave — consistent, unproven).
- Whether the engine-cycle daily selftest ever fired on a day boundary (mechanism exists; today's evidence is a manual run).
- Why SovereignCore's 6h selftest interval never fired once (0 runs while cycles ran 142 times) — hypothesis: frequent resets/HMR; unverified.
- Second actor's exact cadence/ownership of the value ladder pre-09-29 (history beyond the 100-op window not pulled).
