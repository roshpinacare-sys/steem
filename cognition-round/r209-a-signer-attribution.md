# R209-a · Signer-Attribution Falsification Report

**Task ID:** R209-a · **Role:** adversary (falsification, not advocacy) · **Anchor:** 2026-10-05T16:40Z re-anchor, audited 16:40–16:52Z
**Claim under attack:** *"the learned adaptation (adapt-claim_reward_balance-posting), not something else, chose the signing role of the future claim_reward_balance transaction."*
**Method:** read-only. No code/state modified, no transaction broadcast, engine untouched (PID 15086 confirmed live, `state/engine.pid`=15086, `hyper.boot` pid:15086 at 16:39:54.270Z in events.jsonl:2143).

---

## 0. Live baseline re-established (my own measurements, not inherited)

| Fact | Value | Source |
|---|---|---|
| Store seal intact | `verifyStateIntegrity=true`, integrity `070578ac…8a52`, updatedAt 16:45:25.369Z, evalCount 11 | re-computed live (sha256 over payload) |
| Resolver live | `resolveAdaptedRole("claim_reward_balance","active")` → **"posting"**; `("vote","active")` → "active"; `("claim_reward_balance","posting")` → "posting" | bun -e import, read-only |
| Exec rows since adaptation birth (15:01:50.115Z) | **0** — exec-log.jsonl frozen at 13:05:28.500Z | full-file census |
| Rows carrying any `role` field | **0** (673 rows total) | `grep -c '"role"'` = 0 |
| Claim rows | 19, all `ok:false`, no role field; last row bytes: `{"at":"2026-10-05T13:05:28.500Z","tag":"cycle-execute","account":"headcorner","ok":false,"txid":"7875e0bd…","ops":["claim_reward_balance"],"node":null,"error":"missing required posting authority:…","fingerprint":"c056922c"}` | exec-log.jsonl |
| `prediction.recorded` events | **0** | events.jsonl grep |
| Selftest | 346/346 at 16:39:15.470Z (post-restart) | state/selftest-last-run.json |

---

## 1. Alternative explanations constructed and tested

### A1 — Caller-supplied explicit role (no adaptation involved)
**(a) Mechanism.** `executeAs` takes `role` from the caller (signer.mjs:603, default `"active"`). The exec-log row writes `role: part.role` (signer.mjs:677) **regardless of who chose it** — caller or learned store. Any caller passing `role:"posting"` produces a row byte-identical (at exec-log level) to a learned one.
**(b) Eliminated today?** **YES, by exhaustive code census — but only by source-code inference, not by any runtime artifact.** Complete caller census:
- explicit `role:"posting"`: curator.mjs:304,309 (tag `curate`, vote ops), army.mjs:143,146 (tag `army-curate`, vote ops), promo.mjs:53–56 (tag `promo-daily`, comment op) — **none can emit claim_reward_balance**;
- default `active`: daily.mjs:392 (`cycle-execute` — the **only** claim source, daily.mjs:373), daily.mjs:447 (`soldier-topup`, transfer), hypergrid.mjs:332, soldiers.mjs:115,189, rc-probe.mjs:37,44, proof-live.mjs:72 (limit orders only);
- no external signer import: `grep src/ for saos-engine/signer → 0 hits`; engine index.ts routes only read (`/status`, `/exec-status`).
The only op source for claim_reward_balance in the entire codebase is daily.mjs:373 → :392 with **no role param**. Therefore a future claim row with `role:"posting"` can only originate from `resolveAdaptedRole` diverging from the default — *given today's code*.
**(c) Not eliminated at runtime.** The elimination rests on the census being complete and stable. Any future rail, manual patch, or operator one-off that broadcasts a claim with `role:"posting"` reproduces the row with zero adaptation involvement.
**(c-evidence)** Smallest eliminator at firing time: the **`prediction.recorded` event** (see A7 caveat) or, better, a per-row `roleSource` field (§4).

### A2 — TAG_ROLE_PROVENANCE forging evidence
**(a) Mechanism.** `rowRole = r?.role ?? TAG_ROLE_PROVENANCE[r?.tag] ?? "active"` (adaptations.mjs:54–55, applied at :100) assigns role `"posting"` to legacy rows by tag alone. If a legacy row with tag `curate`/`army-curate`/`promo-daily` contained a claim op, it would count as "posting evidence" both in `heldEvidence` (:179) and in the VERIFIED flip (:110).
**(b) Eliminated today? YES, live.** The flip requires `ops.includes(a.op)` (:109) and `at ≥ createdAt` (:107). All 19 claim rows predate createdAt, are `ok:false`, and carry tag `cycle-execute` (not in the provenance map → inferred "active", matching reality). The 21 "posting ok" rows are vote/comment ops — different op names, so they feed `heldEvidence` (:179) but can never flip the claim adaptation. Post-T-84 rows **always** carry a measured `role` (signer.mjs:677 writes it unconditionally), so `rowRole` inference can only touch pre-createdAt rows, which the flip window excludes. The other op-row writers into exec-log (signer.mjs:133,194 credential rows) have no `ops` array and are filtered at :100.
**(c) Residual:** the inference table is static code truth, not measured truth; it is self-correcting only through the ≤3-attempt retire loop, as documented. Latent, not live.

### A3 — Forged rows in the unsealed exec-log
**(a) Mechanism.** exec-log.jsonl is **unsealed** (only adaptations.json is integrity-sealed). Any local writer could append a fabricated `{role:"posting", ops:["claim_reward_balance"], ok:true, txid:<a real second-signer posting-signed claim txid>}` and the next `evaluateAdaptations` would flip the adaptation VERIFIED **without any code change and without the store ever steering anything**. The verifier (:110–124) never validates a txid against the chain and never checks that the row came from `executeAs`.
**(b) Eliminated today? NO.** Writer census (only signer.mjs:676 writes op rows) eliminates *accidental* forgery, not deliberate or third-party forgery. The second signer's off-machine claim (13:07Z) is a real posting-signed claim whose txid exists on chain — a perfect forgery anchor.
**(c-evidence)** Smallest eliminator at firing time: post-hoc chain join — account-history lookup proving the row's txid exists, contains exactly the claimed op, and the account's rewards went to zero in that block; plus the prediction event preceding. (A structural fix — sealing or hash-chaining exec-log — is a code change, out of my read-only scope.)

### A4 — Resolver firing from stale/corrupted state while the row "looks learned"
**(a) Mechanism.** If the store were stale (e.g., expired but still resolving) or corrupt-but-sealed, the row could say `posting` without a valid lesson.
**(b) Eliminated today? YES.** `resolveAdaptedRole` re-reads the file **per op** (no cache; adaptations.mjs:266–268); `verifyStateIntegrity` fail-closes to baseRole on any tamper (:251); TTL is checked inside the resolver (:272, `expiresAt` missing → `Date.parse(undefined??0)` → expired → baseRole); valid-seal-garbage and toRole:owner are neutralized at :277 (F2 hardening). A corrupt store cannot produce a learned-looking row — it produces the **legacy** row (`role:"active"`). I re-verified live: seal matches, resolve=posting. Race check: the entire decision block (partition :654 → prediction :671 → buildTx :673) is **synchronous** on a single-threaded loop; the store can only be rewritten during the awaited `broadcastTx` (:675), i.e., *after* the role decision is made and journaled. A learn-heartbeat rewrite mid-broadcast affects nothing already decided; it can at worst make the prediction event's `adaptationState` metadata differ from decision-time state (recordPrediction re-reads the file at :308–310 instead of receiving the resolved state) — cosmetic, not causal.

### A5 — Chain physics as an independent corroborator (closes the wrong half)
`buildTx` is invoked with exactly one key: `wifs: [wif]` (signer.mjs:673; steemtx.mjs:258–268 signs the digest with that wif only). The chain validated authority at broadcast for all 19 failures. Therefore **an `ok:true` claim row is chain-proven to be posting-signed regardless of what our journals say** — the signature cannot have been the active key. This closes *"the transaction was signed under posting"* independently of the exec row. **What it cannot close is the decision link** — *who chose* posting — which is precisely the attribution claim. Chain physics proves the fact, not the cause.

### A6 — Does `prediction.recorded` really prove prediction_time < action_time? (Q4)
**YES — within-process, airtight.** Write order in `executeAs`: `recordPrediction` (signer.mjs:671, synchronous `appendFileSync` — adaptations.mjs:57,326) → `buildTx` (signing, :673) → first `await` at `broadcastTx` (:675) → exec row appended after the response (:676–680). The whole block :654–:673 is synchronous; no async interleaving can place the prediction after signing. `prediction.at` is generated at call time (default param). The exec row's `at` is generated after the broadcast resolves. So the journal order **prediction → signature → broadcast → exec-row** holds; cross-file ordering rests on the same machine clock.
**Two real weaknesses:** (i) the prediction event **cannot contain the txid** (computed at :674, after the write), so prediction→row→chain correlation is by (ops, adaptedRole, adaptationId, temporal adjacency) — a join **no code performs**; (ii) `recordPrediction` is doubly swallowed (`try/catch` at signer.mjs:671 and adaptations.mjs:328) — a silent journaling failure yields an adapted row with **no** prediction marker, and absence-of-event then proves nothing.

### A7 — THE RELABELING HOLE (strongest remaining alternative explanation)
**(a) Mechanism.** The VERIFIED flip (planAdaptations:110–124) matches rows purely on `(op ∈ r.ops) ∧ (r.role === a.toRole) ∧ (r.ok === true) ∧ (at ≥ createdAt)`. It **never reads the prediction journal**. R209's `predictionClass:"CONFIRMED"` and the `belief.why` string — *"reality matched the prediction recorded before the action; both pinned in the append-only journal (prediction.recorded precedes the exec row)"* (adaptations.mjs:119) — are stamped **unconditionally** on every flip. Nothing verifies that a `prediction.recorded` event exists, precedes the row, or matches the txid.
This creates a concrete, code-demonstrable relabeling path in **both** directions:
1. **False evidentiary assertion:** if `recordPrediction` silently fails (A6-ii), or
2. **Zero-prediction verification (worse):** the emission condition is `part.role !== role` (signer.mjs:670) — it tests *"role diverged from the caller's base role"*, **not** *"the learned state chose the role"*. Implication asymmetry: `event ⟹ store diverged` (true), but `store diverged ⟹ event` is **FALSE** whenever the caller's explicit role equals the adapted role. Worked example: a future `vote→posting` adaptation while curator.mjs:304 keeps passing `role:"posting"` → `part.role === role` → **no prediction event is ever written**, yet every curator row says `role:"posting", ok:true` → the adaptation flips VERIFIED on the very next eval with a belief record asserting a prediction preceded the action. Full relabeling, zero journal trace, self-sustaining (VERIFIED has no TTL, resolveAdaptedRoleFrom:272).
For **today's claim firing specifically**, the caller base is the default `"active"` ≠ `"posting"`, so the event will fire — unless journaling silently fails. The hole is structural, not hypothetical-only: it is one caller-param away.
**(b) Eliminated today? NO.** Live evidence reduces it (store sealed, single claim source, caller census) but the verify path itself contains no check that would distinguish *caused* from *coincided*.
**(c-evidence)** Smallest eliminators: (1) verifier consumes the prediction — flip only if a `prediction.recorded` with matching `adaptationId`+ops exists at ≤ row.at (join events.jsonl in `evaluateAdaptations`); (2) exec row carries `roleSource:"adaptation"|"caller"|"default"` + `adaptationId` (both are one-line adds; the information exists in-memory at :654–:677 but is dropped on the floor). Without one of these, the belief.why assertion is **unverified evidence inside the evidence store** — an honesty defect in exactly the record future rounds will cite.

### A8 — The second signer (off-machine, shared credential)
**(a) Mechanism.** The second actor signs with the same credential outside the engine; its 13:07Z posting-signed claim drained rewards.
**(b) As attribution threat: eliminated.** It cannot write our exec-log (writer census + weave.mjs:57 design comment: "their votes/orders never appear in our exec-log"), so it cannot flip VERIFIED. **As firing threat: alive** — it can starve the natural firing indefinitely (pending rewards = 0 → rail NO-OPS), which means the causal experiment may never run, and every extra day increases the chance someone "helps" by patching the caller role (A1/A7 trigger).

### A9 — Cross-process journal interference
Writers to events.jsonl are all in-engine (daily, curator, army, hypergrid, signer, learning, adaptations, index.ts:132); the Next.js side writes only `sovereign-events.jsonl` (src/lib/sovereign.ts:23 — a different file). All appends are `appendFileSync` (O_APPEND, small lines) — no torn/interleaved writes observed; `engine.pid` matches the single live bun process. Eliminated.

---

## 2. Direct answers to the five assigned questions

**Q1 — Could role:"posting" appear in an exec row without the adaptation store?**
Today: only via the five explicit-`role:"posting"` call sites, none of which can carry a claim op (A1 census) — so *for this op* no. In general **yes**: the row's `role` field records the *used* role, not the *chooser*; TAG_ROLE_PROVENANCE adds a tag-based inference layer for legacy rows that cannot touch the flip window today (A2) but is inference, not measurement. The store is currently the only thing that can put `role:"posting"` on a claim row — provable **only by reading the source, not by any runtime artifact**.

**Q2 — Stale/corrupted state producing learned-looking rows?** No (A4). Corrupt → baseRole, fail-closed, per-op fresh read, TTL enforced in the resolver, owner unreachable twice over. The one genuine race is benign (post-decision store rewrite); its only symptom is possibly-wrong `adaptationState` metadata inside the prediction event.

**Q3 — Is the evidence chain CLOSED at runtime?** Link status:
1. lesson-ID → resolver: **CLOSED** (sealed store read per-op; adaptationId enters the prediction event).
2. resolver-decision → signing role used: **OPEN AT ROW LEVEL** — the exec row (signer.mjs:676–680) carries `role` but **not** `adaptationId`/`roleSource`; the prediction event carries `adaptationId` but **not** `txid`. The two journals are joinable only by (ops, adaptedRole, timestamps) and **no code performs the join**. *This is exactly the one link that requires inference from source code.* All other links (guards before partition, single-wif signing, row txid = sha256(serialized) = chain txid convention) are closed by code + artifacts.
3. signer → transaction: **CLOSED** (txid computed from the exact serialized bytes; single-wif signature).
4. transaction → chain: **CLOSED ONLY EXTERNALLY** — requires a post-hoc chain read (account history / get_accounts) that the engine itself never performs; the "verified on-chain" resolution text (adaptations.mjs:122) is written without any chain read.

**Q4 — prediction.recorded ordering / races?** Airtight within the process (A6): sync `appendFileSync` at :671 precedes sync signing at :673 and the first await at :675; single-threaded loop; no reordering possible. Caveats: no txid in the prediction (written before tx construction), silent-failure swallowing, and a benign post-decision store-rewrite race affecting only event metadata.

**Q5 — What stops VERIFIED from being a relabeling?** Nothing *in the verifier*. The only protections are (i) chain physics proving the ok row was posting-signed (fact, not cause), (ii) today's caller census, (iii) the best-effort prediction event that **nothing consumes**. The learning currently cannot distinguish "the adaptation acted" from "the role was already the caller's choice" — A7's worked example (a vote→posting adaptation verifying instantly off curator's ordinary rows) demonstrates the relabel end-to-end in current code with zero patches to the learning machinery.

---

## 3. Anomaly ledger (code/state findings)

1. **MAJOR (evidence integrity):** `belief.why` at adaptations.mjs:119 asserts "prediction.recorded precedes the exec row" unconditionally on every VERIFIED flip — an evidentiary claim the code never checks and which can be false (A7). False statements inside the sealed belief store are worse than missing statements.
2. **MAJOR (attribution):** exec row lacks `adaptationId`/`roleSource` (signer.mjs:676–680); prediction event lacks `txid` — the causal join is left to human audit (Q3 link 2).
3. **MINOR (condition conflation):** `part.role !== role` (signer.mjs:670) ≠ "learned state chose the role"; also diverges from the stated R209 intent ("any partition whose role was chosen by the learned state").
4. **MINOR (test gap):** `recordPrediction`, the `part.role !== role` emission, and `predictionClass`/`belief` stamping have **zero selftest vectors** (grep: only the scoring-side lines selftest.mjs:801,806 mention prediction). 346/346 does not cover any R209 code.
5. **MINOR (temporal conflation):** `adaptation.verified` event `at` = the *row's* time (:114), not eval time — events.jsonl ordering no longer equals event-time ordering; an auditor diffing timestamps against journal positions will see inversions.
6. **MINOR (TOCTOU, cosmetic):** `recordPrediction` re-reads adaptations.json (:308–310) instead of receiving the decision-time state — mid-broadcast learn rewrites can stamp stale `adaptationState` metadata.
7. **INHERITED (L-1d, still open):** events.jsonl and exec-log.jsonl are unsealed/append-only-by-convention; all causal evidence outside adaptations.json is rewrite-able without trace (A3).
8. **Cosmetic:** `recordPrediction` records no `tag`/`account`; if parallel adapted rails ever exist, prediction→row correlation by ops alone becomes ambiguous.
9. **Live-state observations (not defects):** 0 exec rows since 13:05:28Z; 0 role-bearing rows; 0 prediction events; store sealed ×2 re-checks; restart trail hyper.boot pids 11627→11694→12394→15086 all present in events.jsonl.

---

## 4. Firing-time evidence spec (what current code will and will not prove)

**Will be provable from journals alone (if no silent failure):**
`prediction.recorded {op, ops, baseRole:"active", adaptedRole:"posting", adaptationId:"adapt-claim_reward_balance-posting", prediction{expectedOutcome…}}` at position P in events.jsonl, with `exec-log` row `{role:"posting", tag:"cycle-execute", ok, txid, fingerprint:"c056922c"}` whose `at` > prediction `at` — plus chain: txid resolves in account history with the claim op, and get_accounts rewards zeroed. The four-way join (prediction → row → txid → chain state) is **unbreakable when all four pieces exist** — but the join itself is performed by no code and three of the four files are unsealed.

**Will NOT be provable with current code:**
- that the role choice originated in the store *if the prediction event is silently missing* (attribution then collapses to source-code inference);
- that no caller-supplied role was involved (row and prediction both blind to caller intent — A1/A7);
- that the row was not fabricated (unsealed exec-log, txid never chain-checked by the engine — A3).

**Two smallest code adds that would make attribution unbreakable at firing time** (recommendations only — I changed nothing):
1. **Exec-row provenance field** (signer.mjs ~:677): `roleSource: (part.role !== role) ? "adaptation" : (callerPassedRole ? "caller" : "default")` + `adaptationId` (resolvable by having `resolveAdaptedRole` return `{role, id}` or re-deriving from the store already read in `recordPrediction`). One field closes Q3-link-2 permanently and makes A1 undetectable-by-inference → detectable-by-row.
2. **Verifier consumes the prediction** (adaptations.mjs planAdaptations/evaluateAdaptations): flip to VERIFIED only when a `prediction.recorded` with matching `adaptationId`+ops exists at ≤ row.at; otherwise stamp `predictionClass:"UNCORROBORATED"` instead of "CONFIRMED". This turns belief.why from an assertion into a checked fact and kills the relabeling path (A7).

**No-code fallback for the operator at firing time:** within one minute of the claim broadcast, snapshot (a) the prediction.recorded line, (b) the exec row, (c) `get_account_history` entry for the txid, (d) `get_accounts` rewards=0 — the human-performed join is then as strong as the code-performed one would be.

---

## 5. Verdict

**ATTRIBUTION: PLAUSIBLE-BUT-NOT-RUNTIME-PROVABLE (1 weak link).**
The claim *"the learned adaptation chose the role"* is true for the next natural firing **given today's source** (single claim source, no role param, sealed store resolving posting, live-verified by me), but the proof of it at runtime hangs on one unclosed link: the exec row records the role **used**, never the role's **provenance**, and the R209 prediction event — the only journal marker of learned choice — is (i) conditionally conflated (`part.role !== role` ≠ learned choice), (ii) silently droppable, (iii) never consumed by the verifier that stamps "CONFIRMED" and asserts its own existence in `belief.why`. Chain physics closes the *fact* of posting-signing; nothing runtime closes the *decision*. Strongest surviving alternative: **A7 relabeling** (adaptation verified from rows whose role the caller chose / that lack any prediction marker), concretely demonstrated by the vote→posting curator example. One exec-row field (`roleSource`+`adaptationId`) or one verifier-side prediction join converts this verdict to unbreakable at firing time.
