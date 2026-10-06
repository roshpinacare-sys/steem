# L-1a · SAFETY & AUTHORITY ADVERSARIAL REVIEW — T-84 "First Learning Actuator"

Date: 2026-10-05 · Reviewer: Safety & Authority Adversarial Reviewer (L-1a) · Mode: READ-ONLY on live organism; offline /tmp lab for adversarial inputs.

---

## (1) VERDICT LINE

**SAFE-WITH-FINDINGS** — no blocker, no authority-escalation path found. One major (conditional-liveness) landmine and several minors worth fixing before the adaptation's first live firing matures into permanent state.

---

## (2) CLAIM TABLE C1–C8

| # | Claim | Verdict | Evidence (file:line) |
|---|-------|---------|----------------------|
| C1 | No adaptation can change authority | **CONFIRMED** | Adaptations can only alter signing role via ONE consumption point: `signer.mjs:654` (`partitionByAdaptedRole(ops, role, (opName) => resolveAdaptedRole(opName, role))`) — the only import/use of the resolver (signer.mjs:22,654). Every partition is still gated by `id.wifs[part.role]` (signer.mjs:659-663). All guards run BEFORE partitioning on the FULL op set: armed (604), pause (606), op-cap (608), think-gate (613-616), verifyRoles (618-619), base-key check (621), RC-floor (626-635), DGPO (639-644). The actuator writes ONLY `state/adaptations.json` + `events.jsonl` (adaptations.mjs:41-42, 248-251, 57) — repo-wide grep shows no other writer and no import into anything touching `.secrets/exec-armed.json`, caps, floors, custody, pause, or think-gate. The single broadcast choke point is `broadcastTx` (module-private, signer.mjs:564) reachable only from `executeAs`; all rails (curator.mjs:304, army.mjs:143/146, promo.mjs:53-56, daily.mjs:392/447, hypergrid.mjs:332, soldiers.mjs:115/189) route through it. |
| C2 | Owner-key escalation is impossible | **CONFIRMED** (with defense-in-depth gap, see F2) | `ADAPT_LIMITS.allowedTargetRoles=["posting","active"]` (adaptations.mjs:44). Proposal guard: adaptations.mjs:178-189 → owner demand creates a `DECLINED` record (state≠ACTIVE/VERIFIED, ignored by resolver, adaptations.mjs:264). Supersede guard: adaptations.mjs:124 — owner fails the `allowedTargetRoles.includes(...)` conjunct and falls to the deterministic-retire branch at 132-136. Lab E6: owner-demand → `{"active":[],"declined":["adapt-claim_reward_balance-owner"]}`, resolve = baseRole. Lab E7: ACTIVE posting adaptation + "missing required owner authority" row → RETIRED, not superseded. **Caveat:** `verifyRoles` puts the OWNER wif into `id.wifs.owner` when it matches chain authorities (signer.mjs:507-512; live /exec-status shows owner matched:true), and `resolveAdaptedRoleFrom` performs NO role whitelisting — a *hand-sealed* state file with `toRole:"owner"` WOULD drive owner-key signing (lab E3 `toRole:owner => "owner"`). Not reachable through any current code path (planner is the only legit writer and is double-guarded), but the resolver trusts the seal blindly. |
| C3 | Fail-closed on corrupt state | **CONFIRMED** | `readAdaptFile` returns null on parse failure or integrity mismatch (adaptations.mjs:241-246); `adaptationState` yields empty payload (253-256); `resolveAdaptedRoleFrom` on empty payload → baseRole (263-266). Lab E1 (tampered without re-seal): integrity false → baseRole. Lab E2 (file deleted): intact=false → baseRole; `noteAdaptationOutcome` returns false, no throw. Lab E3 type-flood: `payload:array`/`payload:int` → baseRole; `expiresAt:"garbage"` → NaN compare → baseRole; `state:"lowercase"` → ignored → baseRole. Two inconsistent modes: `adaptations:"string"` and `[null]` (validly sealed) **throw** from the resolver — fail-closed-by-throw, contained by stepWrap (daily.mjs:49-57), hyper tick (hypergrid.mjs:372-377) and route `.catch` (index.ts:131) → no unsafe broadcast, availability-only cost. |
| C4 | Bounded adaptation | **CONFIRMED** (one immortal-state exception, see F1) | maxAttempts=3: every `ok:false` row under an ACTIVE adaptation increments attempts (adaptations.mjs:120) and any of: deterministic class → retire (132-136), attempts≥3 → retire (138-143). TTL 48h for ACTIVE regardless of rows (146-150). ROLE-KEY-ABSENT → immediate retire (270-281; called signer.mjs:661). Noise gate 2, evidence window 36h (44, 170-173). Lab E8: expired ACTIVE → baseRole. The exception: VERIFIED has no TTL and no retire path — bounded in *authority* (role-bounded, chain-enforced) but unbounded in *persistence* (F1). |
| C5 | Writer/reader matrix causal | **CONFIRMED** | Writers of adaptations.json: ONLY `writeAdaptFile` (adaptations.mjs:248-251) via `evaluateAdaptations` (295, called from learning.mjs:21,265) and `noteAdaptationOutcome` (278). Readers: `resolveAdaptedRole` → signer.mjs:654 (the executor), plus `evaluateAdaptations` itself; daily.mjs:645 reads only the learning summary for the marker. Loop is evidence-gated end-to-end: proposal requires ≥2 identical deterministic failures within 36h AND an ok row under the target role (172-174) AND no existing ACTIVE/VERIFIED for the op (168); cannot fire without measured failure rows. Live proof: events.jsonl:2056 `adaptation.proposed … failures:19`; the 19 rows are real exec-log entries (2026-10-04T20:14 → 10-05T13:05). |
| C6 | Legacy rows can't poison dangerously | **CONFIRMED** (worst case verified bounded) | `TAG_ROLE_PROVENANCE` (adaptations.mjs:54-55) is code-proven: curator.mjs:304, army.mjs:143/146, promo.mjs:53-56 all pass `role:"posting"`. A wrong adaptation (e.g., transfer→posting) can only make a partition sign with an *insufficient* key: the chain itself rejects the op (transfer requires active authority) → the failure row feeds attempts → retire ≤3. The think-gate additionally blocks non-allowlisted outbound transfers *before* any partitioning (signer.mjs:101-105). Lab E5 proves the wrong adaptation CAN be proposed from fabricated rows, but its ceiling is ≤3 failed broadcasts. The dangerous reverse direction (weaker key signing a stronger op) is structurally impossible on-chain; signing a lower-level op with a stronger key cannot give the op more power than its type allows (a vote is a vote regardless of signing key). No wrong-role broadcast both SUCCEEDS and does damage beyond the op's own type. |
| C7 | Partition can't reorder/drop ops; legacy path identical | **CONFIRMED** (additive deltas only) | `partitionByAdaptedRole` is a stable consecutive grouping — each op lands in exactly one partition, order preserved (signer.mjs:592-601; selftest t84 partition vectors). `buildTx` serializes `operations: ops` unsorted (steemtx.mjs:258-274). With no adaptation → one partition → same buildTx/broadcastTx/result shape; deltas are additive only: log rows gain `role` (signer.mjs:669) and result gains `partitions` only when >1 (685). Bookkeeping under BROADCAST-PARTIAL: daily.mjs:396 `if (res.ok ?? res.verdict === "BROADCAST")` — `false ?? x` → false, so orderids/opsToday bookkeeping is skipped; created orders self-expire (`expiration: tSec + 86400`, daily.mjs:349/357; hypergrid orderTtlSec=3600) and hypergrid re-plans from chain truth next tick (hypergrid.mjs:216-231 comment, 333-345) → the landmine is real but benign-bounded (F5). |
| C8 | Hot-reload didn't corrupt the organism | **CONFIRMED** | `curl :3040/` → route list; `/health` → `{"ok":true,...,"keyless":false}`; `/exec-status` → armed:true, paused:false, VERIFIED, all four roles matched. `state/cycle-run.json` fresh (finished 15:15:32Z, health ok, layers alive/safe/operational/effective/adaptive all true). `bun selftest.mjs` → **343/343 PASS** (also selftest-last-run.json: 343/0 @ 15:16:52Z). Note: live engine PID is 11694 (`bun --hot index.ts`, engine.pid agrees), not the ~6127 in the brief — the process was (re)started ~15:05; it is healthy now. Honest note, no action taken. |

---

## (3) ATTACK VECTORS TRIED (lab: `/tmp/l1a-lab/` — copy of adaptations.mjs with its own isolated `state/`; script: `/home/z/my-project/cognition-round/l1a-lab.mjs`)

Setup: `mkdir -p /tmp/l1a-lab/state && cp .../adaptations.mjs /tmp/l1a-lab/ && cp state/adaptations.json /tmp/l1a-lab/state/` then `bun /home/z/my-project/cognition-round/l1a-lab.mjs` (module copy derives its own ADAPT_FILE → live file untouched).

| Exp | Attack | Result |
|-----|--------|--------|
| E1 | Hostile edit of a copied adaptations.json without re-sealing (toRole→owner) | `verifyStateIntegrity=false`, `adaptationState().intact=false`, resolve → baseRole. Fail-closed. |
| E2 | File deleted mid-flight (simulated) | intact=false → baseRole; `noteAdaptationOutcome` → false, no throw. |
| E3 | Valid-seal garbage payloads (writer gone mad): `adaptations:"string"`, `[null]`, `toRole:42`, `toRole:"owner"`, `expiresAt:"garbage"`, `state:"active"`, `payload:array`, `payload:int` | string→**THROWS** (contained upstream); [null]→**THROWS** (contained); 42→ resolves 42 → signer `id.wifs[42]` undefined → ROLE-KEY-ABSENT → retire (bounded); **owner→ resolves "owner"** (see F2); garbage expiresAt→baseRole; lowercase state→baseRole; array/int payload→baseRole. |
| E4 | Sealed poison `ACTIVE/owner` entry + ROLE-KEY-ABSENT | noteAdaptationOutcome RETIRES it (true) — the outcome path can neutralize sealed poison. |
| E6 | Owner escalation through the planner: 2 fabricated "missing required owner authority" rows + legacy curate ok row | `declined:["adapt-claim_reward_balance-owner"]`, active:[]; resolve → baseRole. **Guard holds.** |
| E7 | Supersede-to-owner: ACTIVE posting adaptation + failing row "missing required owner authority" (role:posting) | RETIRED (`state:RETIRED, toRole:posting`) — **guard holds.** E7b: legal reverse lesson posting→active supersedes correctly. |
| E5 | Poisoned exec-log (unsealed!) → fabricate transfer failures "missing required posting authority" + legacy curate ok row | Planner PROPOSES `adapt-transfer-posting` — evidence gates pass on fabricated rows. Damage ceiling: think-gate (policy/allowlist) + chain (transfer needs active) → ≤3 failed broadcasts → retire. See F4. |
| E8 | TTL / immortality | expired ACTIVE → baseRole; VERIFIED +1y → still toRole (by design). |
| E9 | **VERIFIED adaptation + key no longer held** | `noteAdaptationOutcome` → **false** (retires ACTIVE only, adaptations.mjs:274); state stays VERIFIED; resolve keeps returning the learned role → permanent ROLE-KEY-ABSENT partition every future cycle with NO exec-log row (signer.mjs:658-663 `continue` precedes appendLine) → silent op starvation, no TTL, no learning feedback. **CONFIRMED landmine (F1).** |

Also verified live: the ACTIVE adaptation has NOT yet fired — last cycle (15:14:48) staged no claim op (daily.mjs:371-372 requires intel decision `rewards/claim`); exec-log's last claim failure remains 13:05:28Z. First live firing is still pending.

---

## (4) FINDINGS

- **F1 · MAJOR (conditional liveness/self-DoS, not authority)** — VERIFIED adaptations are immortal and un-retirable: `noteAdaptationOutcome` matches `state === "ACTIVE"` only (adaptations.mjs:274), outcome scoring skips non-ACTIVE (104), TTL applies to ACTIVE only (146), and ROLE-KEY-ABSENT partitions produce no exec-log row (signer.mjs:658-663 `continue` before appendLine). If the learned key is ever lost/rotated after VERIFIED, the op is silently skipped FOREVER (no journal, no learning signal, no self-heal) until manual file deletion or key restoration. Fix: retire VERIFIED too on ROLE-KEY-ABSENT (with a distinct `reason:"verified-role-key-no-longer-held"`), and/or append ROLE-KEY-ABSENT partition rows to exec-log so the loop can see them.
- **F2 · MINOR (defense-in-depth)** — `resolveAdaptedRoleFrom` (adaptations.mjs:263-266) trusts the seal blindly: no `allowedTargetRoles` check, no `kind==="signing-role"` check, no type validation. A validly-sealed `toRole:"owner"` drives owner-key signing (E3), because `verifyRoles` stores the owner wif (signer.mjs:512; live owner matched=true). Not reachable via any current writer, but this is THE choke point of the operator's core law — make it self-defending: reject any entry whose toRole ∉ allowedTargetRoles or kind ≠ signing-role, and wrap the resolver body in try/catch → baseRole (kills the E3 throw modes too).
- **F3 · MINOR** — `noteAdaptationOutcome`'s `writeAdaptFile` (adaptations.mjs:278) is unguarded and is called raw inside `executeAs` (signer.mjs:661): a write failure (ENOSPC/EACCES) throws mid-partition-loop → remaining partitions skipped after some already broadcast. Contained by stepWrap/tick (fail-closed) but violates the tidy-typed-verdict discipline. Fix: try/catch around the call site (or around writeAdaptFile inside noteAdaptationOutcome).
- **F4 · NOTE** — the actuator's evidence source `state/exec-log.jsonl` is unsealed and attacker-writable in the same threat model that the integrity seal defends against: fabricated rows can spawn wrong adaptations (E5 proved `adapt-transfer-posting` proposal). Bounded by think-gate + chain + ≤3 attempts. Consider role-plausibility cross-checks or sealing the evidence journal.
- **F5 · NOTE** — BROADCAST-PARTIAL skips bookkeeping (daily.mjs:396-403): created orders untracked (self-expire ≤86400s — benign as documented), opsToday undercount, RC sample missed. Hypergrid self-heals from chain truth (hypergrid.mjs:216-231,333-345).
- **F6 · NOTE** — adaptations are account-global (no account field): any account's ROLE-KEY-ABSENT retires the global adaptation (fail-safe direction — retire = legacy behavior), and a master-learned lesson applies to any account signing the same op (chain enforces per-account authority, so no escalation).
- **F7 · NOTE** — `KIND_WHITELIST` (adaptations.mjs:45) is declared but never enforced; "rejected at write time" holds only by construction (both writers create kind:"signing-role" exclusively). See F2 fix.
- **F8 · NOTE** — `resolveAdaptedRole` does a full file read + sha256 **per op** (signer.mjs:654 resolver): 24 reads per hyper tick; and N partitions = N transactions = N× broadcast/RC overhead (bounded by op caps). Cheap fix: read once per executeAs call.
- **F9 · NOTE** — `evidence` arrays store the FIRST 3 group rows, which may predate the 36h evidence window (gate correctly uses `within`, display honesty only); `heldEvidence` ok-rows have no age bound either (fine for key-holding, but the hypothesis text "N ok broadcasts" can overcount stale rows).
- **F10 · NOTE** — wrong-op attribution on mixed failing txs: group key is `ops[0]` (adaptations.mjs:157); a mixed [cancel,claim] failure credits the adaptation to `limit_order_cancel`. Chain-bounded (≤3 failed broadcasts). Post-T-84 claim rows are single-op, so exposure is low.
- **F11 · INFO** — 60-row exec-log window (adaptations.mjs:288) can be flooded by hyper-grid rows (up to ~24 ops/3s), starving future proposals; learning starvation, not safety.
- **INFO** — live PID (11694) differs from the brief's ~6127; engine healthy. `armedConf` writes the default armed file (armed:true) when missing (signer.mjs:319-322) — pre-T-84 behavior, out of scope, flagged for completeness.

---

## (5) SELF-FALSIFICATION ATTEMPT (directive 18)

Actively hunted evidence against my own SAFE-WITH-FINDINGS verdict:

1. *Think-gate bypass via partitioning?* Re-checked call order — gate at signer.mjs:613 runs on the full op set before partitioning at 654; a REFUSED set never reaches any broadcast. Doubt refuted.
2. *Partial broadcasts as new power?* Partitioning never re-evaluates policy; any op that could now succeed alone was already policy-allowed in the set. A partitioned ALLOW-set can only succeed MORE often, not do MORE. Doubt refuted.
3. *Unbounded retry?* Attempts increment on every failing row under an adaptation (adaptations.mjs:120) and TTL retires ACTIVE even with zero rows (146-150). Only VERIFIED escapes — captured as F1, not a verdict-flipper (authority still bounded).
4. *Sealed-poison owner entry?* Shown to resolve "owner" (E3) — but requires arbitrary file write, which in this hot-reload organism is equivalent to editing signer.mjs directly (strictly stronger attack, same precondition). Cannot flip C2 within the learning-layer threat model. Recorded as F2.
5. *Could a wrong-role broadcast succeed and damage?* The op's authority ceiling is set by its TYPE on-chain; a stronger signing key cannot enlarge it; a weaker key is always rejected. No damaging success path found. Not yet falsified.
6. *Bookkeeping loss → double-spend/double-order?* Orders self-expire; grid diff re-reads chain truth. No compounding path found. Not yet falsified.

Result: no contradicting evidence found — verdict **not yet falsified**.

---

## (6) HONEST UNKNOWNS

- Steem chain semantics for cross-level signatures (does an owner-key signature satisfy an active-level op check?) were NOT tested on-chain (read-only mandate). Irrelevant to the verdict — the op's type bounds its power either way — but F2's fix removes the question entirely.
- Whether the current ACTIVE adaptation's first live firing will VERIFY: pending (no claim op staged since its proposal). The 21 "ok under posting" evidence rows are legacy-inferred via TAG_ROLE_PROVENANCE (curate rows); the code provenance is verified (curator.mjs:304 etc.) but the inference itself has not yet been confirmed by an actual posting-signed claim broadcast.
- Long-horizon behavior of `adaptations.json` growth (contradictions array is append-only; DECLINED/RETIRED records accumulate) — unbounded file growth over months, cosmetic.
- The PID discrepancy (~6127 → 11694): I cannot determine from read-only evidence whether this was an operator restart or a crash-respawn. Engine and marker are healthy at review time.

---

*Reviewer note: nothing was modified on the live organism; no restarts; no broadcasts; lab ran offline in /tmp with a module copy owning its own state dir.*
