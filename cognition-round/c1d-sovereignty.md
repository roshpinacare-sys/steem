# C-1d — SOVEREIGNTY & SELF-MODEL EXAMINER (SOVEREIGN SYSTEMS COGNITION round)

Scope: read-only audit of the SAOS organism's authority architecture and self-model, with contradiction hunt. All file:line citations verified 2026-10-05 13:00–13:35 UTC. Chain reads: `condenser_api.get_accounts[headcorner]` via api.steemit.com. No live state was modified.

---

## 1 · Executive picture (≤6 lines)

SAOS has a REAL, code-enforced authority spine: one signing choke point (`executeAs` → think-gate), a fail-closed custody ladder, a policy file that is re-read on every broadcast, and honest measured/estimated/blocked economics. But the top of the spine is hollow: the operator kill-switch, resume, credential adoption and cycle-trigger are all **unauthenticated HTTP on 0.0.0.0:3000/:3040** (Caddy proxies :81→:3000), the think-gate judges everything and is **judged by nothing** (think-log.jsonl has zero code readers), and the engine's live layer is chain-accurate while its self-model files (army.json, fleet-roles.json) carry self-contradicting verdicts. Sovereignty-by-keys holds for *capability* but not *exclusivity*: a second actor shares the master credential and broadcasts outside every gate (worklog-proven, operator-accepted). There is no subsystem where the machine expands its own authority from evidence — every permission transition is a human-edited file.

---

## 2 · Authority map (power | holder | enforcement point | label)

| # | Power | Holder in CODE | Enforcement point | Label |
|---|---|---|---|---|
| 1 | Define policy (write exec-armed.json) | Human operator (hand-edited file); engine may **bootstrap defaults only if file missing** | `.secrets/exec-armed.json` (0600); `signer.mjs:316-326` (`armedConf` writes `defaultArmedConf()` at `signer.mjs:290-314` when absent); no agent route writes it | KNOWN |
| 2 | Change policy at runtime | Operator via file edit; NO watcher, but `armedConf()` re-reads the file on **every** gate/sign call → changes land at next broadcast | `signer.mjs:316-326` (fresh `readJson` per call); consumed at `signer.mjs:81` (thinkGate) and `:588` (executeAs); process-level `bun --hot` reloads on source change (PID 6127 cmdline) | KNOWN (+ OBSERVED: T-82 `allowDelegation:true` flip live) |
| 3 | Permit/deny an action (think-gate) | Engine gate: pause→custody→transfer-policy→delegation-policy, then caps/RC/role checks | `signer.mjs:74-112` (`thinkGate`), mandatory inside `executeAs` at `signer.mjs:594-600` (before any key material); verdicts journaled `signer.mjs:114-117` | KNOWN |
| 4 | Stop a rail | **Whoever can POST to :3000** — `POST /api/saos/sovereign {action:"pause"}` is UNAUTHENTICATED (`src/app/api/saos/sovereign/route.ts:21-31` → `sovereign.ts:503-526`) → writes `sovereign.json paused:true` → engine `execPaused()` (`signer.mjs:337-341`) freezes every rail + think-gate refuses all (`signer.mjs:78-80`). Secondary: SovereignCore withholds auto-cycles (`sovereign.ts:275`) and doesn't respawn (`sovereign.ts:216`) | route.ts:21-31; sovereign.ts:507-510; signer.mjs:337-341 | KNOWN; **ports bind `*:3000/:3040`** (ss) + Caddy :81→3000 (Caddyfile) — remote-reachable modulo outer firewall: OBSERVED / outer exposure UNKNOWN |
| 5 | Reopen a rail | Same unauthenticated route `{action:"resume"}` (`sovereign.ts:511-515`); watchdog then respawns engine (`sovereign.ts:107-170`); policy loosening = operator file edit (row 2) | sovereign.ts:511-515, 216 | KNOWN |
| 6 | Escalate to operator | NO push channel exists. Escalation = typed verdicts + files the human must poll: `cred-alarm.json` (hourly dedup alarms, `signer.mjs:209-243`), `events.jsonl`/`sovereign-events.jsonl`, cockpit banners (`page.tsx:259-290`), guidance strings in API (`signer.mjs:496-503`). When lacking authority it **blocks with a typed verdict, journals, does not silently retry**: `DEPLOY-OPERATOR-GATED` (soldiers.mjs:70-72), `THINK-GATE-REFUSED`, `DISARMED`, `OPERATOR-PAUSED` | signer.mjs:209-243; soldiers.mjs:70-72 | KNOWN |
| 7 | Spend funds | Engine process (holds 0600 master credential `signer.mjs:25`); outbound transfers FORBIDDEN by policy default (`signer.mjs:99-104`; live file `allowTransfersOut:false`); market orders capped: `maxOpsPerCycle 12`, `maxAskSteemPerCycle 200`, `maxBidSbdPerCycle 20`, 60% deploy cap (`daily.mjs:184-192`), bid reserve 0.5 SBD | exec-armed.json:4-11; signer.mjs:100-108, 592; daily.mjs:184-192 | KNOWN |
| 8 | Delegate | Engine (serializer live: `steemtx.mjs:174,215` op-id 40); currently policy-ENABLED by operator order T-82 (`exec-armed.json:11,13` scoped note); gate-checked at `signer.mjs:106-108` | steemtx.mjs:174/215; signer.mjs:106-108 | KNOWN |
| 9 | Deploy new accounts | OPERATOR: `operator.allowSoldierDeploy=false` (exec-armed.json:16, safe default signer.mjs:303) → `DEPLOY-OPERATOR-GATED` (soldiers.mjs:63-132; create-account capability exists in serializer `steemtx.mjs:174`) | soldiers.mjs:67-72 | KNOWN |
| 10 | Modify its own code | NOT the engine: grep across engine shows fs writes only to `state/` + `.secrets/` (24 writeFileSync sites; zero to `*.mjs/*.ts`). Code authority = whoever holds filesystem/repo write access (external agent sessions + operator); `bun --hot` makes any edit live on next reload — **the FS writer is the de-facto sovereign** | grep evidence (writeFileSync targets); engine PID 6127 `bun --hot index.ts` | KNOWN |
| — | (meta) Engine life & death | SovereignCore (Next process): spawns, verifies cmdline before kill, SIGTERM/SIGKILL stale engine (`sovereign.ts:99-170`) | sovereign.ts:107-170 | KNOWN |

---

## 3 · Judge-the-judge findings

- **Nobody judges the gate.** `think-log.jsonl` is write-only in code: grep over the repo finds exactly one reference (`signer.mjs:37,115` writer). No self-audit consumer, no reconciliation against exec-log, no false-ALLOW/false-DENY detector anywhere. The worklog's claim "what did the agents think is always answerable" is true for a human reader only. Label: KNOWN.
- **Refusal statistics (observed):** 60 entries total, 54 ALLOW / 6 REFUSED — and all 6 refusals are `source:"t81-smoke"` (manual smoke test 10:01). The gate has never refused a real action in its life; its refusal paths are exercised only by the smoke test. Label: OBSERVED (think-log tail).
- **False-DENY would be silent:** a REFUSED op returns `{ok:false, verdict:"THINK-GATE-REFUSED"}` into the cycle step (daily.mjs:392-411); the cycle can still record health=ok because the step itself completed. Throughput loss would surface only as verdict strings nobody aggregates. Label: INFERRED from code.
- **False-ALLOW surface is wide by design:** the gate checks ONLY pause, custody, transfer-recipient policy, delegation policy. It does NOT judge order prices, vote weights, amounts, day-caps, or recipient sanity — those live in planners (daily.mjs:320-391, curator.mjs, army.mjs, hypergrid.mjs) that produce "lawful but wrong" ops the gate must ALLOW. It is a policy fence, not a judgment of correctness. Label: KNOWN.
- **Fail-open exception found — the pause check:** `execPaused()` = `readJson(PAUSE_FILE,{paused:false}) || readJson(SOVEREIGN_FILE,{paused:false})` (`signer.mjs:337-341`). A corrupt/unreadable pause file reads as NOT-PAUSED → the master kill-switch fails OPEN on file corruption. Contrast: custody (`custodyOf` signer.mjs:57-72) fails CLOSED (unreadable secrets → "no-custody" → REFUSED), and `journalThink` failing does NOT block an ALLOW (signer.mjs:114-117) — the think-log is not a guaranteed witness under disk failure. Label: KNOWN (code-read), severity INFERRED low (files are local, engine-written).
- **Gate-code exception:** thinkGate contains no unguarded throw path; if it ever threw, executeAs throws before key material → stepWrap catches → cycle step fail → fail-closed in effect. Post-gate layers (verifyRoles :602-603, RC floor :610-619, broadcastTx failover :563-579) are fail-closed. Label: KNOWN.

---

## 4 · Self-model audit per file

| File | What the system believes | Does it fail meaningfully? | Label |
|---|---|---|---|
| `cycle-run.json` | health=ok @13:24, all 19 steps true | `ok` = "no step returned ok:false" (`daily.mjs:610`) — a **disabled rail counts green**: the soldiers step returns `DISABLED-T80-OPERATOR-STOP` (daily.mjs:426) and still shows true. health=ok means "no malfunction", NOT "all capabilities active". The cockpit autonomy rails map any non-false step to "ok" (status route.ts:98-100) | KNOWN |
| `selftest-last-run.json` | 321/321 PASS @11:27 | Offline deterministic vectors in a child process (daily.mjs:542-558; selftest.mjs:773 writes the file). It tests code paths, NOT live reality: it could pass 321/321 while a second actor broadcasts on-chain (and did — T-81). Two disjoint selftest truths exist: SovereignCore's 6h counter shows `runs:0` (sovereign.json:29-35) while the engine's daily selftest passes — the cockpit's "every 6 hours" card says "first run in moments" (page.tsx:331-334) | KNOWN + OBSERVED |
| `sovereign.json` | paused:false, engineUp:true, 1552 checks/128 downs/40 heals, 93 ok/20 fail/29 blocked cycles, cred present, control log with `by:"operator-cockpit"` | Matches live curl of :3040/health + :3000/api/saos/sovereign. BUT the `by` field is a **hardcoded default parameter** (`sovereign.ts:503`), not an authenticated identity — the log's "operator" attribution is unverifiable | KNOWN + CONTRADICTED (attribution) |
| `army.json` | 10 accounts, per-account day-cap 3, VP floor 80%, vpEff, votesToday with txids | **Self-contradictory**: top-level `verdict:"ARMY-IDLE"`, `broadcasted:0` while accounts hold 20 votesToday txids from 11:28-11:30; stale `error:"wif-length"` fields persist beside successful txids (pre-fix crash residue, never cleared on success). Chain supports the accounts block (T-83 txids verified), not the header | OBSERVED + CONTRADICTED |
| `fleet-roles.json` | FULL-STRENGTH 12/12 active stations, each with truthContract + evidence string | The recruiter grades by *evidence file exists*, not chain truth. army-curator evidence cites the ARMY-IDLE figure (fleet-roles.json:88) — propagating the army.json misread. No station status class exists for "operator-disabled"; FULL-STRENGTH ≠ operational strength (curator at VP 2.7%, soldiers frozen, gen-2 undeployed) | KNOWN + CONTRADICTED |
| `soldiers.json` | gen-1 (hcsoldier1/2/3) deployed 09-29, fingerprints+pubkeys, fundingTxid | Correctly knows it does NOT hold their secrets (fingerprints only); `soldiersPublic()` computes custody live → all frozen `NO-CUSTODY-FROZEN` + T-80 note (soldiers.mjs:199-211) — the cockpit renders מוקפא. Knows which soldiers are dead/keyless: YES | KNOWN |
| `economics.json` | measured total **0** USD/day; estimated 0.55; 3 blocked rails; payout clock phase=paid-window; x2 ladder (SP 1,125 → needs ×1,818 for $1,000/day); pending 59.7 VESTS | Honest class separation by law (`economics.json:64` "never merge measured and estimated"). Knows its income is ~zero measured. Does NOT model costs (RC burn unpriced), the ~2,462 SP return-escrow landing ~Oct-12, or army SP. Label: partial self-knowledge | KNOWN |
| Budgets acted on | RC floor 20% for master ops (`signer.mjs:610-619`), hyper-grid own 25% floor + RC governor accumulating (hypergrid.mjs:249-266; measured equilibrium 7,536 ops/day), cycle ops day-cap (`daily.mjs:385-390`), hyper opsDayCap 32,000 (exec-armed.json:55), VP floors: master curator 60% (curator.json:8-10, vpEff 2.7 → VP-FLOOR verdict live) and army 80% (army.json:7-10, 3 accounts resting at VP-FLOOR) | **YES — budgets are tracked AND enforced with typed verdicts** (RC-FLOOR, VP-FLOOR, OPS-DAY-CAP, GOVERNOR-ACCUMULATING). This is the strongest part of the self-model | KNOWN |
| Knows disabled-and-why? | Partially: typed verdicts carry the law (DISABLED-T80-OPERATOR-STOP, DEPLOY-OPERATOR-GATED, RC-FLOOR); policy file carries scoped notes (T-82 delegation). But there is no single self-state file answering "what am I forbidden to do and why" — beliefs are scattered across verdict strings, policy notes, and banners | KNOWN |

---

## 5 · Cockpit truthfulness findings (:3000 vs engine vs chain)

1. **Wallet live layer is TRUE**: engine `live.balances` (0.531 STEEM / 0.015 SBD / 6,366,836.322857 VESTS) matches `condenser_api.get_accounts[headcorner]` byte-for-byte; `rcPct 99.9` engine-measured; 5 live orders (3 flow @ 3.087 STEEM + 2 hyper @ 0.5 STEEM = 10.261 STEEM asked) from the chain's open-order read. Label: OBSERVED (chain-verified).
2. **Header overclaim**: "אפס-תלות-חיצונית" (zero external dependency, page.tsx:202) — the engine hard-depends on 3 external Steem RPC nodes (`signer.mjs:560`) and external price sources. Label: CONTRADICTED (code).
3. **T-80 banner text is stale vs policy**: banner says transfers AND delegations are forbidden by default (page.tsx:247-248) — delegations are now operator-ALLOWED (`exec-armed.json:11`). Label: CONTRADICTED (UI prose vs policy; enforcement follows the policy file, so the UI misdescribes the law).
4. **SSR first paint lies transiently**: server-rendered HTML shows "T-80 · המנוע כבוי" + "מחזורים 0 תקינים · 0 חסומים · 0 כשלים · דופק 0" while the engine is up with 1,552 checks — initial client state rendered before fetch (page.tsx:235-255 + 319-326); self-corrects on hydration. Label: OBSERVED (curl), benign-but-real.
5. **Roster claims rendered unverified**: roles card displays fleet-roles FULL-STRENGTH 12/12 including the army-curator station whose own evidence string says "ARMY-IDLE (broadcasted 0, accounts-voted 0/10)" while army.json holds 20 txids. Label: OBSERVED.
6. **Sovereignty card counters are truthful** (match sovereign.json exactly). Selftest row under-reports: "first run in moments…" for a 6h timer that hasn't fired while a daily selftest already passes — conservative-direction staleness. Label: OBSERVED.
7. **Spoilage counter never stops counting**: `vpSpoilage` computes daysBlocked = now − firstDownAt with no restored-at stop (`lib.mjs:345-362`); engine /status currently reports `daysBlocked 4.91, votesForegone 49, estSteemForegone 42.94` while signing is VERIFIED and broadcasting. Currently hidden because the banner only renders when `armedButNoCredential` — but the belief is wrong inside the model. Label: OBSERVED + KNOWN.
8. **Dead evidence path**: `GET /api/saos/signer` reads `/home/z/audit/saos-dex/grids/state/mover-log.jsonl` — nonexistent (the audit tree was wiped 09-30); route always answers ok:false. Dormant route claiming a source that cannot exist. Label: OBSERVED.

---

## 6 · Sovereignty boundary

**Can do ALONE today (no operator):** run observe→…→report cycles every 10 min; place/cancel/cancel-race market orders within caps (engine-held key); vote via posting authority for headcorner + 10 army accounts (direct-WIF vault custody, chain-proven 4/4); claim reward balances; delegate per policy (T-82); publish the weave contract and daily promo post; recruit/demote its own roster stations by evidence; self-heal the engine process (watchdog: 1,552 checks, 128 downs, 40 heals verified); learn within hard-clamped tunings; enforce its own budgets (RC/VP/ops-caps); refuse keyless accounts structurally.

**Requires the operator:** define/change policy (exec-armed.json is human-written; engine bootstraps defaults only if deleted); pause/resume sovereignty (the cockpit HTTP button — which is really "anyone who can reach :3000"); allow soldier deployment (`allowSoldierDeploy`); fund anything (transfers-out policy) and rotate/fund the keyless gen-1 (56.001 STEEM stranded — operator scroll is the only key path); rotate the master key (struck by operator law T-82 — so the second-actor exposure persists by operator decision); rotate the GitHub PAT; any code change (external agent sessions).

**Where "sovereignty = possession of keys" falls short:**
- **Exclusivity, not capability, is the missing property** — a second actor holds the same master credential and broadcasts outside every gate (T-81 smoking guns: 09:46 revokes, 04:01 orders while "paused"; think-log/exec-log empty at those instants). Keys prove you *can* act; they cannot prove only-you acted. The system cannot mint exclusivity for itself; only rotation (operator-gated, currently refused) can.
- **Keys don't deliver policy authority** — the most consequential powers (policy file, pause, deploy flag) are file-writes by a human; the machine's own powers are all downstream.
- **Keys don't deliver an escalation channel** — alarms are files the operator must poll; no push path exists.
- **Keys don't cover the code plane** — `bun --hot` + writable source tree means the entity that can edit files rewrites the sovereign's own laws faster than any gate can judge. The gate guards ops; nothing guards its own constitution.
- **Graduated autonomy: NOT PRESENT as self-graded authority.** The system grades *evidence* (custody tiers master-verified/verified/keyed-unverified/no-custody; measured>estimated>blocked economics; recruiter evidence-based promotion; RC-governor throughput scaling), but **no subsystem decides its own authority LEVEL from confidence** — every permission transition is human-file-driven. Honest answer: no.

---

## 7 · Contradiction list (reality = the third column)

| # | Source A | Source B | Conflict | Reality supports |
|---|---|---|---|---|
| 1 | Prose in `signer.mjs:12-13`, `daily.mjs:12`, `curator.mjs:21`: "pause button writes state/exec-pause.json" | grep: **no writer of exec-pause.json exists anywhere**; the actual pause path writes `sovereign.json` via unauth API | The documented kill-switch mechanism is a phantom file | sovereign.json + route.ts (exec-pause.json is dead but still read by execPaused) |
| 2 | `army.json` header: `verdict:"ARMY-IDLE"`, `broadcasted:0` | same file, 20 votesToday entries with txids (11:28-11:30) + T-83 worklog chain-verification | "we broadcast nothing" vs "here are 20 broadcast txids" | the accounts block / chain (txids 541f021d, 4559f5fc, f23222cc…); header counters are per-cycle and misled fleet-roles evidence |
| 3 | Cockpit T-80 banner: "העברות-כספים והאצלות אסורות כברירת-מחדל" (delegations forbidden) | `exec-armed.json:11` `allowDelegation:true` (T-82 operator order) | UI describes a law that was superseded hours ago | the policy file (gate now ALLOWs delegate ops) |
| 4 | Cockpit sovereignty card: selftest "first run in moments" (SovereignCore runs:0) | `selftest-last-run.json` 321/321 PASS @11:27 + cycle step selftest true | two counters, one concept; card says quality has never run | engine's daily selftest (the 6h timer merely hasn't fired) |
| 5 | `fleet-roles.json`: verdict FULL-STRENGTH 12/12 | soldiers frozen (NO-CUSTODY-FROZEN), gen-2 undeployed, curator VP 2.7% at floor | roster strength ≠ operational strength | soldiers.json + custodyOf + curator.json |
| 6 | `sovereign.json` control log: `by:"operator-cockpit"` for pause/resume | `sovereign.ts:503` — the `by` value is an unauthenticated, hardcoded default | audit log attributes actions to "the operator" without identity | code: anyone reaching :3000 could have written those entries |
| 7 | `page.tsx:202` "אפס-תלות-חיצונית" (zero external dependency) | `signer.mjs:560` BROADCAST_NODES + price-oracle chain | claim vs hard external RPC dependency | code |
| 8 | TODO.md body (T-82 bullet): "all 10 active-army accounts uniform @ 8.86 SP" | TODO.md title + T-83: unit-law corrected, 1 SP = 1,613.04 VESTS → 48,393 VESTS ≈ 30 SP | stale figure retained in the same doc that declares it retired | T-83 derived law (measure.mjs tvs/tvf) |
| 9 | `docs/ESTATE-INVENTORY.md`: "selftest 113/113 PASS" (T-15 era) | `selftest-last-run.json` 321/321 | stale inventory doc | current file (benign drift) |

---

## 8 · Honest unknowns

- **Outer network exposure**: :3000/:3040 bind `*` and Caddy proxies :81→:3000, but whether the sandbox firewall admits the outside is unverifiable from here. If exposed, pause/resume/adopt-credential/cycle-trigger are internet-reachable unauthenticated. Label: UNKNOWN (high-stakes).
- **The second actor's current behavior**: worklog-verified broadcasts through 10-05 morning; whether it is still active today cannot be determined from this machine without chain-history polling beyond this round's scope. Label: UNKNOWN (watch item).
- **Whether SovereignCore's 6h selftest timer ever fires in dev-mode Next** (HMR restarts recreate the core each boot; state persists but the timer is young — boot 09:04, first due 15:04). Label: UNKNOWN, check after 15:04.
- **Sovereign-core "resume" semantics under engine death**: if the engine dies while paused, `heal-kill-stale` still kills the stale pid (sovereign.ts:132-142) even though respawn is withheld — pause + crash interactions were not exercised this round. Label: UNKNOWN.
- What the operator's *actual* intent is regarding the T-82 delegation note's scope (the note is prose; the gate can't parse intent beyond boolean). Label: ASSUMED (boolean-only enforcement).
