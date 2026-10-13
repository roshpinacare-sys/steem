# L-1d · Durability & Noise Audit — T-84 "First Learning Actuator" (directive-19 matrix)

Agent: Durability & Noise Auditor (L-1d) · 2026-10-05T15:44Z · engine dir touched READ-ONLY; all experiments ran on copies / pure functions in `/home/z/my-project/cognition-round/l1d-lab/` (lab script: `lab.mjs`, raw output: `lab-output.txt`). No restarts, no broadcasts, no network, no writes inside `mini-services/saos-engine/`.

---

## 1 · VERDICT

**DURABLE + NOISE-IMMUNE — 21/21 lab vectors PASS, live seal intact — with 5 boundary findings (no directive-19 violation).**
The pure core (classifyFailure → planAdaptations → verifyStateIntegrity / resolveAdaptedRoleFrom) is fail-closed everywhere tested, bounded (maxAttempts=3, TTL 48h, noiseGate=2, window 36h, roles {posting, active}, owner unreachable even behind a VALID seal), idempotent across evaluations, and insensitive to adversarial row streams. Findings below are lineage/comment/evidence-trust notes, not defects against the directive.

---

## 2 · Matrix results (exact commands + outputs)

Command: `cd /home/z/my-project/cognition-round/l1d-lab && bun lab.mjs` (imports `planAdaptations`, `verifyStateIntegrity`, `resolveAdaptedRoleFrom`, `classifyFailure`, `ADAPT_LIMITS` from `/home/z/my-project/mini-services/saos-engine/adaptations.mjs` — pure, no import-time side effects; all clocks explicit, `now="2026-10-05T16:00:00.000Z"`). Limits confirmed at runtime: `maxAttempts=3 ttlMs=172800000 noiseGate=2 evidenceWindowMs=129600000 allowed=posting/active`.

### 2.1 Noise immunity (planAdaptations on adversarial row streams)

| ID | Adversarial input | Expected | Observed (verbatim from lab-output.txt) | Verdict |
|---|---|---|---|---|
| N-a | 20 rows, **20 different** authority-class error strings (`missing required posting authority:acct-variant-i`), + held-key ok row | NO adaptation (no signature group ≥2) | `20 unique authority-class errors → 0 adaptations, events=[] (noiseGate needs ≥2 identical)` | PASS |
| N-b1 | 1 identical error | no proposal | `1 identical failure → 0 adaptations (gate=2 holds)` | PASS |
| N-b2 | **2 identical** errors, 1 min apart, + held-key ok row under posting | proposal (designed sensitivity) | `2 identical 1-min-apart → state=ACTIVE toRole=posting confidence=0.5 (designed sensitivity)` | PASS |
| N-b3 | 2 identical, **no** held-key ok row | DECLINED (bounded abstention) | `2 identical, no held-key ok row → state=DECLINED reason="chain requires posting authority for claim_reward_balance bu…"` | PASS |
| N-c | 10 **identical timeout** rows + held-key ok row | no adaptation (transient ⇒ deterministic=false) | `10 identical timeouts → 0 adaptations; classify=transient/deterministic=false` | PASS |
| N-d1 | group {30h-old, fresh} (both ≤36h window) | proposes (window must not over-filter) | `30h-old + fresh (both ≤36h) → 1 adaptation (window does not over-filter)` | PASS |
| N-d2 | decaying group {40h-old, fresh} → only 1 row inside 36h window | NO proposal (window filter) | `40h-old + fresh (1 inside 36h window) → 0 adaptations (window filter holds)` | PASS |
| N-e1 | newest group = transient (vote timeouts), older group = authority (claim) | only the eligible group proposes, no spam | `newest=transient(vote), older=authority(claim) → exactly [claim_reward_balance:ACTIVE]` | PASS |
| N-e2 | control: **two eligible** groups, different ops | measure actual semantics | `INFO N-e2 (control) two eligible ops → [claim_reward_balance:ACTIVE, vote:ACTIVE] — one adaptation PER OP (no per-op spam; loop does not stop after the newest eligible group)` | INFO |
| N-f | rows with `at:"banana"` / `"also-not-a-date"` + 1 real | NaN evidence fail-closed → no proposal, no throw | `2 garbage-at rows + 1 real → 0 adaptations, throw=null (NaN evidence fail-closed to no-proposal)` | PASS |

### 2.2 Durability matrix (verifyStateIntegrity + resolveAdaptedRoleFrom on poisoned stores)

| ID | Poison | Expected | Observed | Verdict |
|---|---|---|---|---|
| D-a | one byte flipped in payload (valid JSON, original seal) | integrity=false | `byte-flip payload vs valid-format seal → verifyStateIntegrity=false` | PASS |
| D-b | **valid sha256 seal recomputed over poisoned payload** (`toRole:"owner"`) | resolver STILL baseRole (F2) | `valid seal over owner-poison → integrity=true, resolve(ACTIVE)=active, resolve(VERIFIED)=active (F2 guard holds despite valid seal)` | PASS |
| D-c | `integrity` removed / `schema` removed / `null` | false, false, false | `no-integrity=false, no-schema=false, null=false` | PASS |
| D-d | wrong types everywhere: adaptations as string/number, entries as arrays, `{op:5, kind:[…], state:true, toRole:{…}}`, payload as array, null, ACTIVE missing expiresAt, ACTIVE expired | no throw, baseRole | `no throw across 8 type-poison cases; all → baseRole [adaptations-as-string=active; adaptations-as-number=active; entries-as-arrays=active; wrong-field-types=active; payload-as-array=active; payload-null=active; active-missing-expiresAt=active; active-expiresAt-past=active]` | PASS |
| D-e | `expiresAt:"banana"` | no throw; ACTIVE inert → baseRole | `expiresAt:"banana" → ACTIVE resolves active (inert, fail-closed), VERIFIED resolves posting (TTL ignored by design — verified knowledge is durable), throw=null` | PASS |

### 2.3 Reverse lesson + bounded behavior (pure)

| ID | Scenario | Observed | Verdict |
|---|---|---|---|
| R-1a | ACTIVE posting; retry fails with `missing required active authority` | `chain names ACTIVE on retry → toRole=active, state=ACTIVE, attempts=1, events=[adaptation.superseded]` | PASS |
| R-1b | then an ok broadcast under the superseded role | `ok broadcast under superseded role → state=VERIFIED, predictionScore.error=none` | PASS |
| R-2 | 2 vs 3 non-deterministic failures under the learned role (`maxAttempts=3`) | `2 failures → ACTIVE; 3 failures → RETIRED (attempts-exhausted) — bounded exactly at maxAttempts=3` | PASS |
| R-3a | ACTIVE hypothesis 49h old, never verified | `49h-old unverified hypothesis → RETIRED (ttl-unverified), revisits="the evaluator may re-propose from fresh evidence"` | PASS |
| R-3b | fresh evidence after the TTL retire | `fresh evidence after retire → 2 records (retired kept as history + new ACTIVE toRole=posting); NOTE id reuse: [adapt-claim_reward_balance-posting, adapt-claim_reward_balance-posting]` | PASS |
| R-4 | DECLINED store, later an ok row under posting appears | `held-key ok row later → DECLINED kept + new ACTIVE(toRole=posting); resolver on resulting payload=posting (DECLINED ignored, ACTIVE honored)` | PASS |
| R-5 | re-eval with the result state + same rows (spam check) | `eval#1 proposes 1; eval#2 on same evidence → adaptations=1, newEvents=0 (no spam across evals)` | PASS |

Audit-note: the first R-4 run FAILED — that was a lab-harness bug (I passed the adaptations **array** where `resolveAdaptedRoleFrom` expects the **payload object** `{adaptations:[…]}`); after fixing the harness call the engine behavior was correct. Recorded for honesty; engine unchanged.

---

## 3 · Learning-Theatre census (grep over engine + cockpit `src/`, read-only)

| Artifact | Writer (evidence) | Reader (evidence) | Status |
|---|---|---|---|
| `state/adaptations.json` | `adaptations.mjs writeAdaptFile` (via `evaluateAdaptations` ← `learning.mjs:265` learn step; `noteAdaptationOutcome` ← signer ROLE-KEY-ABSENT path, `signer.mjs:661`) | `adaptations.mjs readAdaptFile → resolveAdaptedRole` consulted per-op on EVERY broadcast (`signer.mjs:654 partitionByAdaptedRole`); plus selftest vectors (`selftest.mjs:780-826`, runs each cycle as steps.selftest) | **LOAD-BEARING** (changes tx signing partitioning; tamper ⇒ fail-closed baseRole) |
| `events.jsonl` `adaptation.*` rows (7 emit sites in adaptations.mjs: proposed/verified/retired×3/superseded/declined) | `adaptations.mjs appendEvent` | engine `/status` last-20 raw lines (`index.ts:109`) — operator eyeball only; `learning.mjs:248` reads events.jsonl into `events` var that is **never used** (dead read) | **KNOWN-UNREAD-YET** (journal/audit trail; no semantic consumer) |
| `learning.json` `adaptations` field | `learning.mjs:288` (`out.adaptations = summary`) | engine `/status` raw (`index.ts:77 learningState()`); `daily.mjs:479→645` computes `layers.adaptive`; cockpit thin-proxy **drops** it (`src/app/api/saos/status/route.ts:132-148 learningPublic` has no adaptations key) | **LOAD-BEARING in-engine** (feeds marker adaptive layer) / decorative for cockpit UI |
| `exec-log.jsonl` `role` field | `signer.mjs:669` (`role: part.role` per partition row) | `adaptations.mjs:110` (outcome scoring: only rows signed UNDER the adaptation count), `:172` (held-key evidence: ok rows with role==requiredRole) | **LOAD-BEARING** writer+reader in code; **0 live role-bearing rows yet** (last exec row 13:05Z predates the 15:01Z actuator) — writer armed, first adapted broadcast pending |
| `cycle-run.json` `layers` (incl. `adaptive=true`) | `daily.mjs:638` (try/finally marker close) | nobody branches on it: `hypergrid.mjs:233` reads `marker.running` only; `lib.mjs classifyMarker:455` reads running/health; `/cycle-status` returns raw marker; cockpit `src/lib/sovereign.ts` pollStatus type omits `layers` | **DECORATIVE / KNOWN-UNREAD-YET** (operator self-report; live value currently `adaptive:true`) |
| `think-log.jsonl` | signer.mjs (pre-existing) | none found | KNOWN-UNREAD-YET — **pre-existing, not new** to T-84 |

Live confirmation rows: `events.jsonl:2056` holds the single `adaptation.proposed` (failures:19); `learn.done` rows since 15:14 carry `adaptations:["active:adapt-claim_reward_balance-posting"]`.

---

## 4 · Live-store integrity check (RIGHT NOW, read-only)

Command (bun one-liner importing engine module, reading live file only):
```
bun -e 'import("…/saos-engine/adaptations.mjs").then(m => { parsed=JSON.parse(readFileSync("…/state/adaptations.json"));
  h=sha256(JSON.stringify(parsed.payload)); … m.resolveAdaptedRole("claim_reward_balance","active") … })'
```
Result @ 2026-10-05T15:44:03.549Z (file updatedAt 15:35:27.136Z, evalCount=4, active=[adapt-claim_reward_balance-posting]):
- recomputed `sha256(JSON.stringify(payload))` = `9b50c0b66fe10974788091cd6e16131a02151b5a609f17130f1af8d5d0134e9d`
- recorded `integrity` = `9b50c0b66fe10974788091cd6e16131a02151b5a609f17130f1af8d5d0134e9d` → **MATCH true**
- `verifyStateIntegrity(live parsed)` = **true**; `adaptationState().intact` = **true**
- `resolveAdaptedRole('claim_reward_balance','active')` = **'posting'** ✓ (the live learned lesson is being consulted by the executor)
- `resolveAdaptedRole('limit_order_create','active')` = 'active' (no adaptation → base passthrough) ✓
(Note: first file read showed integrity `918608…` @ updatedAt 15:25:20; the engine's own 15:34 cycle resealed it to `9b50c0…` — the seal is stable per payload and survives re-evals; heartbeat meta is the only per-eval delta.)

## 5 · Self-falsification

Assumed conclusion "durable + noise-immune" is WRONG — searched for contradiction: (1) JSON.stringify determinism holes for the seal (key reorder, toJSON via JSON.parse, unicode) — none: hash recomputed over parsed payload reproduces the seal, live-checked twice; (2) valid-seal privilege escalation — blocked by F2 role-set gate even when integrity=true (D-b, incl. VERIFIED); (3) spam via multi-group or repeat evals — N-e2/R-5 show per-op bound + idempotency; (4) NaN/date/type poison steering — N-f/D-d/D-e all fail-closed; (5) live tamper — byte-flip detected (D-a), live hash currently matches. Contradicting evidence found: **none** → **not yet falsified**. Boundary findings that survive (honest caveats, not violations): evidence stream `exec-log.jsonl` is UNSEALED (seal protects conclusions, not inputs — local fs tampering could forge rows and steer a lesson within the allowed role set, bounded by attempts/TTL/self-correction and all pre-signing gates); resolver applies `toRole∈{posting,active}` regardless of baseRole direction (a posting-base op could legally be re-signed under active if the chain demanded it — owner stays unreachable); VERIFIED ignores TTL by design; `"Persists only on change"` is softened by the meta heartbeat (store resealed every learn step).

## 6 · Honest unknowns

1. **Behavioral half not yet live-measured**: exec-log still has 0 rows carrying `role` (no claim_reward_balance broadcast since the actuator went live ~15:01Z). The outcome-scoring/verification loop (R-1, R-2) is lab-proven pure but unproven on live rows; the first adapted broadcast is the real test.
2. Supersede/DECLINED-promotion/TTL-reproposal have never fired live (store holds 1 ACTIVE, 0 declined/retired); lab-only evidence so far.
3. Whether any operator/cockpit UI will ever consume `layers.adaptive` / `adaptation.*` events (currently unread) — product decision, not auditdecidable.
4. `rowRole` TAG_ROLE_PROVENANCE fallback (curate/army/promo→posting) is trusted for legacy ok-rows; a rail changing its role would be caught by the loop within ≤3 attempts (self-correcting claim untested live).
5. Concurrent-writer semantics of adaptations.json (learn step vs signer ROLE-KEY-ABSENT retire racing) — single-process asyncio makes it unlikely, not proven.
