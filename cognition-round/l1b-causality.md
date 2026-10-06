# L-1b · Causality & Theatre Audit — T-84 First Learning Actuator

Auditor: Causality & Theatre Auditor · Scope: READ-ONLY walk of the live SAOS artifacts
(`mini-services/saos-engine/`) · Method: timestamp-by-timestamp artifact walk + sha256
recomputation + pure-function reproduction (no writes, no network).

---

## 1 · VERDICT

**CAUSAL-CHAIN-ARMED-PENDING-FIRING**

Links 1–4 are CLOSED (verified against artifacts, hashes recomputed, consumption code
path cited and live-tested). Link 5 (behavioral firing) is structurally armed but has
**never executed**: 0 exec-log rows carry a `role` field, the adaptation's `attempts`
is 0, and the trigger precondition (pending rewards > 0 → intel `rewards/claim`
decision) has not held since 13:05:28Z — before the adaptation even existed. The loop
is real code on the hot path, waiting on a chain-side event. It is not theatre, but it
is also **not yet proven in behavior** — the honest label is "armed".

---

## 2 · LINK-BY-LINK TABLE

| # | Link | Status | Evidence (exact) |
|---|------|--------|------------------|
| 1 | EXPERIENCE — 19 identical claim failures | **CLOSED** | `exec-log.jsonl` rows 624–673: exactly 19 rows `ops:["claim_reward_balance"]`, all `ok:false`, error `missing required posting authority:Missing Posting Authority headcorner`, all `fingerprint:"c056922c"`, all role-less (= base `active`). First 2026-10-04T20:14:52.605Z (tx `eb6b7da5…`), last **2026-10-05T13:05:28.500Z** (tx `7875e0bd…`). `rg -c claim_reward_balance state/exec-log.jsonl` → 19. All 3 rows cited in the adaptation's `evidence[]` match real exec rows byte-for-byte (at+txid+error). |
| 2 | EVALUATION+INFERENCE — proposal event + summary | **CLOSED** | `events.jsonl:2056` `adaptation.proposed` at **2026-10-05T15:01:50.115Z**, id `adapt-claim_reward_balance-posting`, op=claim_reward_balance, fromRole=active, toRole=posting, **failures:19** (= rows inside the 36h evidence window of the last-60 eval slice). `learning.json` `runsTotal:169` (claim "~157+" holds; grown since), `adaptations:{active:["adapt-claim_reward_balance-posting"],verified:[],retired:[],declined:[]}` — first non-empty actuator output in **169** learn.done events (0 ever had non-empty `tunings`; 5 have non-empty `adaptations`, starting 15:01:50.115Z). Reproduction: `planAdaptations(null, execRows.slice(-60), "2026-10-05T15:01:50.115Z")` returns the **byte-identical adaptation** (id, confidence 0.8, attempts 0, evidence[0] txid `eb6b7da5…`, hypothesis "…21 ok broadcasts under posting…") — and the last-60 window measurably contains **21 ok rows under posting** (provenance: curator.mjs:304, army.mjs:143, promo.mjs:56 all pass `role:"posting"`; TAG_ROLE_PROVENANCE map is code-accurate). The inference is a deterministic function of measured rows, not hand-authored. |
| 3 | BEHAVIORAL STATE — sealed adaptations.json | **CLOSED** | `state/adaptations.json`: schema `saos.adaptations.v1`. Recomputed `sha256(JSON.stringify(payload))` = **e84abb0cb7fe843ec586c5fce6f0bde61545f05d02ce68dca93d504fcbb6a82e** = recorded `integrity` (verified at evalCount=5 and again at evalCount=6 after the 15:54 cycle rewrote it — seal tracks every rewrite). Adaptation ACTIVE, `attempts:0`, `maxAttempts:3`, `createdAt:2026-10-05T15:01:50.115Z`, `expiresAt:2026-10-07T15:01:50.115Z` (48h TTL), `authorityImpact:"none — same credential, same policy, same gates…"`. Contradictions: 3 OPEN rails (limit_order_create ×6, **claim_reward_balance ×19, last 2026-10-05T13:05:28.500Z — matches exec-log exactly**, vote ×5). `meta.evalCount:6`, `lastEvalAt:2026-10-05T15:54:48.905Z`-cycle stamp. Fail-closed reader (`adaptations.mjs:241-246,253-256`): tamper ⇒ base behavior. |
| 4 | CONSUMPTION — signer partition path | **CLOSED (code + live test)** | `signer.mjs executeAs` (line 603). Guard order on the **FULL op set, before any adaptation is consulted**: armed (:604) → operator-pause (:606) → ops cap (:608) → think-gate (:613) → verifyRoles (:618) → base-role key check (:621) → RC floor (:626-635) → DGPO (:639-644) → **:654 `partitionByAdaptedRole(ops, role, (opName) => resolveAdaptedRole(opName, role))`** → :665 `buildTx({ops: part.ops, …, wifs:[wif]})` per partition → :668-672 journaled per partition **with `role: part.role`**. `partitionByAdaptedRole` (:592-601) groups consecutive same-role ops, preserving order; key-material still gated by `id.wifs[part.role]` (:659) and `ROLE-KEY-ABSENT` retires the lesson via `noteAdaptationOutcome` (:661, adaptations.mjs:279-291). `resolveAdaptedRole` (adaptations.mjs:259-273) is the ONLY consumption point: fail-closed, TTL-checked, allowedTargetRoles-restricted (owner unreachable). **Live test on the real payload**: resolver returns `posting` for claim_reward_balance, `active` for vote, `active` after expiry; partition test → `[{role:"active",ops:[limit_order_create]},{role:"posting",ops:[claim_reward_balance]},{role:"active",ops:[vote]}]`. Selftest vectors exist (selftest.mjs:778-816: propose gates, resolve ACTIVE/expired/unknown-op, retire-on-3-attempts, legacy-role provenance). |
| 5 | PENDING FIRING | **OPEN — armed, never fired** | 0 exec-log rows carry `role` (post-T-84 writer at signer.mjs:669 has never run a partition > 1). No `adaptation.verified/retired/declined/superseded` events exist (census: exactly 1 `adaptation.proposed`, 3 `contradiction.opened`). attempts still 0 after 6 evaluations. Precondition: `intel.mjs:91-93` pushes the claim decision only when `unclaimedRewards().any` (steem>0‖sbd>0‖vests>0); current `intel.json` (15:54) has **no rewards decision** → daily.mjs:371-379 never pushes the op → `execute` verdict `NO-OPS` (daily-report.json 15:44 cycle). The rail is chain-dormant, not machine-broken. Spec in §4. |

---

## 3 · THEATRE CENSUS (directive 16 — writer / reader / decision-consumer)

| Signal | Writer | Readers | Does a DECISION consume it? |
|--------|--------|---------|------------------------------|
| `adaptation.proposed` event | `planAdaptations`→`evaluateAdaptations`→events.jsonl (adaptations.mjs:215,306) | historians, cockpit event feeds | Indirectly — the durable artifact it mirrors (adaptations.json) IS consumed (below). Event itself: record only. Honest. |
| `adaptation.verified/retired/declined/superseded` | same (:114,135,141,149,187,200,289) | none yet (none exist) | The RETIRE/DECLINE outcomes feed back behaviorally (resolver ignores non-ACTIVE/VERIFIED states; ROLE-KEY-ABSENT retires instantly). Not theatre by design; unproven until first firing. |
| `learning.json.adaptations` | learning.mjs:288 (from `evaluateAdaptations().summary`) | daily.mjs:479 (marker), daily.mjs:645 (`layers.adaptive` flag) | The flag itself is **reporting, not behavior** (see next row) — but the underlying store IS behavioral (signer). Mirror, not engine. |
| `cycle-run.json.layers.adaptive` (pre-audited DECORATIVE — rechecked) | daily.mjs:637-646, stamped per cycle | `index.ts:129,137` (sovereign poll of `running`/marker only), `hypergrid.mjs:233` (single-flight skip) — **nobody reads `layers` for decisions** | **Confirmed decorative**: pure status mirror. Honesty check: `adaptive:true` at 15:44 is *truthful* (a real sealed ACTIVE adaptation exists) but costless. Adjacent wrinkle: `effective:true` in the same cycle rests on "no failed broadcast **this cycle**" while the execute step was `NO-OPS` and the standing rail is 25/25-fail in the eval window — vacuously green. Counterbalanced by the contradiction rails + `broadcast-fails` lesson that surface the same fact loudly. Verdict: decorative-but-counterbalanced, not deceptive. |
| `exec-log` `role` field | signer.mjs:669 (every broadcast, post-T-84) | `planAdaptations` rowsNorm (:100) — only rows with `role===toRole` score as attempts/outcomes (:110-143) | **Yes — this is the outcome-feedback channel**: it decides VERIFIED vs attempts++ vs superseded vs RETIRED. Currently 0 rows carry it → the loop's outcome leg is unexercised. |
| `resolveAdaptedRole` (the one that matters) | reads adaptations.json (adaptations.mjs:253-261) | **signer.mjs:654, called per-op on EVERY executeAs, before buildTx** | **YES — real consumption point, live-tested above.** The claim op WILL be signed under posting the next time the op is staged. |

**If the firing never happens, is the loop theatre? — both sides argued in §5.**

---

## 4 · FIRING EVIDENCE SPEC (field-by-field, grep-able)

**Precondition (chain-side):** an account's pending rewards become > 0 → next cycle's
intel step records `{"kind":"rewards","decision":"claim","action":{"any":true,…}}` in
`state/intel.json` → daily.mjs:372 pushes `["claim_reward_balance",{account,reward_steem,reward_sbd,reward_vests}]` → `executeOps(..., {tag:"cycle-execute"})`.

**The row that proves behavior (exec-log.jsonl, appended by signer.mjs:668-672):**
```json
{"at":"<ISO broadcast time>","tag":"cycle-execute","account":"headcorner","ok":true,
 "txid":"<40-hex sha256 of serialized tx>","role":"posting",
 "ops":["claim_reward_balance"],"node":"<winning node url>","error":null,
 "fingerprint":"c056922c"}
```
Exact greps:
```bash
rg '"role":"posting".*"ops":\["claim_reward_balance"\]' state/exec-log.jsonl   # THE firing row
rg '"type":"adaptation.verified"' state/events.jsonl                            # loop-close event
rg 'rail:claim_reward_balance' -A4 state/adaptations.json                       # status must read RESOLVED
rg '"verified":\["adapt-claim_reward_balance-posting"\]' state/learning.json
bun -e 'const j=JSON.parse(require("fs").readFileSync("state/adaptations.json","utf8"));console.log(require("crypto").createHash("sha256").update(JSON.stringify(j.payload)).digest("hex")===j.integrity)'
```

**The state flips on the NEXT learn step after that row (planAdaptations §1, adaptations.mjs:103-117):**
- `adaptations.json` → `state:"VERIFIED"`, new field `verified:{at:<row.at>, txid:<row.txid>, predictionScore:{expected:"broadcast ok for claim_reward_balance within 3 attempts", actual:"ok", error:"none"}}`; `attempts` stays 0; file resealed (new `updatedAt`+`integrity`).
- `events.jsonl` → `{"type":"adaptation.verified","at":<row.at>,"id":"adapt-claim_reward_balance-posting","op":"claim_reward_balance","txid":<row.txid>}`.
- `contradictions[]` `rail:claim_reward_balance` → `status:"RESOLVED"`, `resolvedAt:<row.at>`, `resolution:"learned signing-role adaptation verified on-chain (tx <16hex>…)"`.
- `learning.json` → `adaptations.active:[]`, `adaptations.verified:["adapt-claim_reward_balance-posting"]`; next `learn.done` event carries `"adaptations":["verified:adapt-claim_reward_balance-posting"]`.

**Failure-path spec (equally grep-able, bounded):** row `role:"posting", ok:false` →
`attempts` +1 (evidence appended, capped 5); error names a *different* allowed role →
`adaptation.superseded` (toRole updates); deterministic non-authority error →
`adaptation.retired reason:new-failure-class:*`; attempts≥3 →
`adaptation.retired reason:attempts-exhausted`; no posting WIF at partition time →
immediate `adaptation.retired reason:required-role-key-not-held` (signer.mjs:661);
48h no verification → `reason:ttl-unverified`. Every path journals an event.

**One-cycle-lag (verified from code, not a bug):** within `runCycle` the learn step
(daily.mjs:472) runs strictly AFTER the execute step (daily.mjs:281). The adaptation
stamped 15:01:50.115Z was created in cycle-N's learn; the earliest possible
consumption was cycle-N+1's execute (15:04:52.942Z). Every execute since has been
`NO-OPS` (no rewards decision, grid `OFFER-EMPTY`, convert `CONVERT-HOLD`) → zero
consumption opportunities. This is inherent learning latency, by construction.

**Re-evaluation idempotency (verified):** 6 evaluations so far (15:01, 15:14, 15:24
[the "~15:25Z" one], 15:34, 15:44, 15:54 — all cycle-stamped), yet exactly **1**
`adaptation.proposed` event; the PROPOSE gate skips when an ACTIVE/VERIFIED
adaptation for the op exists (adaptations.mjs:168-169); `attempts` still 0,
`createdAt` still 15:01:50.115Z, `evidence` unchanged (3 rows); only `meta.evalCount`
(4→6) and the seal rolled. The "re-eval duplicated/reset" hypothesis is falsified.

---

## 5 · FALSIFICATION PASS (directive 18)

**Attempt 1 — assume "the loop is real" is WRONG. Evidence found:**
- Zero behavioral delta on-chain: no exec row with `role`, no broadcast under posting
  for claim ever attempted post-proposal; the failing rail has not even been retried.
- The 21 "ok broadcasts under posting" are votes/posts (provenance-inferred), **never a
  successful claim_reward_balance under any role** — the hypothesis extrapolates from
  the chain's error TEXT ("missing required posting authority"), not from a demonstrated
  claim-under-posting. If this chain variant demands active for claims despite the error
  text's phrasing, first firing fails 3× and retires (bounded, but the "fix" was never
  demonstrated).
- `layers.adaptive:true` was minted while `opsToday:0` — a health badge derived from a
  state file, not from behavior; a cynical observer could call the *badge* theatre even
  if the mechanism isn't.
- Escape hatch into paperwork: if pending rewards stay 0 until
  `expiresAt 2026-10-07T15:01:50.115Z`, the adaptation retires `ttl-unverified` and the
  system returns to baseline having produced 48h of sealed JSON and zero behavior change.
  *Counterweight:* every one of those writes would be honest (TTL retirement is a
  designed, journaled outcome), and pending>0 recurred for ~17h straight before 13:05.

**Attempt 2 — assume "the loop is theatre" is WRONG. Evidence found:**
- The consumption point is real, single, and hot: `signer.mjs:654` runs every
  `executeAs` call before any `buildTx`; live resolver+partition tests on the sealed
  payload produce the exact predicted posting-signed partition. When the op next
  appears in `ops[]`, the signing key WILL differ — a measurable behavioral difference.
- The proposal is reproducible: `planAdaptations(null, execRows.slice(-60),
  "2026-10-05T15:01:50.115Z")` regenerates the persisted adaptation byte-identically
  from measured rows (window contains exactly 19 claim-fails and 21 posting-oks —
  the numbers in the hypothesis are measured, not asserted).
- Bounded epistemology with real exit ramps and self-tests: superseded/retired/declined
  paths, ROLE-KEY-ABSENT instant retire, fail-closed on tamper, owner-role unreachable,
  selftest.mjs:778-816 vectors; contradiction rails surface the "health=ok while a rail
  fails" conflict instead of hiding it.
- The trigger is chain-controlled, not self-controlled: the same rail fired 19 times
  when pending>0, proving the execute path stages this op whenever fuel exists; curator
  is actively voting (23 VOTED in window) so curation rewards accrue toward a future
  pending>0.

**Judgment:** the mechanism is real (code path, seal, determinism, bounded outcomes all
check out); its *efficacy* is unproven until the first posting-signed row. Neither
"fully real" nor "theatre" — the honest verdict is the armed one.

---

## 6 · HONEST UNKNOWNS

1. **Chain pending rewards cannot be verified locally** (no network allowed). The claim
   rail's silence is consistent with pending=0, but a persistent `unclaimedRewards` RPC
   failure would look identical in local state — the firing precondition's absence is
   inferred, not measured.
2. **The posting-key claim has never been demonstrated on-chain for this op.** The
   first firing is also the first test of the hypothesis itself.
3. Whether `verifyRoles`' seed-order self-verification keeps matching under the posting
   partition is guarded at runtime (fingerprint `c056922c` must remain constant across
   partitions) but not observable until a partitioned broadcast actually happens.
4. `exec` metric "window 25 / fails 25" counts only exec-tagged rows
   (`analyzeExec` regex `/broadcast|exec/i` on tag) — accurate but easy to misread as
   "all broadcasts fail"; hyper-grid (199F/297O) is excluded. Cosmetic, noted for
   future auditors.
5. `updatedAt` (write wall-clock, e.g. 15:45:14.499Z) intentionally trails
   `meta.lastEvalAt` (cycle-start stamp, 15:44:48.904Z) because learn is a late step in
   a ~26s cycle — explained by daily.mjs step order; not a second writer.
