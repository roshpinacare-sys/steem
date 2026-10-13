# R209-b — EXTERNAL WRITERS & CHAIN-TRUTH DISCRIMINATION (falsification round)

**Agent:** R209-b · External-Writer Falsifier · 2026-10-05T16:40–17:10Z · READ-ONLY (no engine file touched, no broadcast, no process killed; crypto lab in `/home/z/tmp-r209b/`, chain reads only)
**Verdict up front:** (1) The second signer is live, holds the posting WIF (cryptographically pinned), and can drain rewards minutes before any engine cycle. (2) **The T-84 adaptation is falsified in advance — the engine's claim broadcasts carry op-id 33 while the chain's canonical `claim_reward_balance` is 39; a wrong-id digest makes the signature verify against a garbage pubkey, so the first "adapted" firing will fail AGAIN with the identical "Missing Posting Authority" error and the lesson will retire ≤3 attempts with a wrong conclusion.** (3) Local evidence (exec-log) is forgeable by any on-machine z/root process and the fingerprint is copyable — chain-truth, not local rows, must arbitrate. (4) From the CURRENT pinned code (`steemtx.mjs` sha16 `83de909e02780168`, git-clean), an `ok:true` exec-log row for `claim_reward_balance` is **impossible** — if one appears, it is forged or the code changed.

---

## 1 · WRITER CATALOG — who can produce a successful `claim_reward_balance` for headcorner

Grep-proven op constructors (`claim_reward_balance` appears in exactly one broadcast-side push):

| Writer | Reaches claim? | Trigger / precondition | Artifacts it leaves (local) | Chain trace |
|---|---|---|---|---|
| **Engine — daily.mjs execute step** (daily.mjs:373 push → :392 `executeOps(ops,{tag:"cycle-execute"})`) | **YES — the only internal path** | intel `unclaimedRewards().any` (intel.mjs:43-56,91-93) + ops-day-cap + armed/pause + think-gate ALLOW + verifyRoles + RC floor + DGPO | exec-log row `{at, tag:"cycle-execute", account, ok, txid(40hex), role, ops:["claim_reward_balance"], node, error, fingerprint}`; think-log ALLOW row `source:"cycle-execute"` (same second, signer.mjs:613/115); **R209: events.jsonl `prediction.recorded` row BEFORE broadcast** (signer.mjs:671 → adaptations.mjs:306-329, only when adapted role ≠ base role); cycle-run.json marker; learn step flips adaptation → VERIFIED (adaptations.mjs:111-123) + `adaptation.verified` event | claim op in account history + get_transaction; rewards zeroed |
| **Engine — manual tools** rc-probe.mjs:37, proof-live.mjs:72 | only if hand-run (not services; not running) | operator invocation | rows tagged `rc-probe` / proof-live's tag — NOT `cycle-execute` | as above |
| **hypergrid / curator / army / promo / soldiers / daily-topup** | NO — construct only limit orders, votes, comment, transfer (grep census; hypergrid.mjs:332, curator.mjs:304, army.mjs:143, promo.mjs:53, daily.mjs:447) | — | their own tags | — |
| **Second signer (operator's Zip sandbox, off-machine)** | **YES — proven live** | own will; observed cadence minutes-scale | **NONE. Zero local rows. No think-log, no exec-log, no events.** | real txs under the SAME master credential (claim 13:07:21 tx `159e9313b0…` block 110175341; today also: 3 order-cancels + 5 order-creates 16:37:15-45, weave custom_json 16:22/16:27/16:44, comment+comment_options in the same claim block) |
| **cron / systemd timers** | none found (no user crontab; /etc/cron* = apt/dpkg only; no *.timer) | — | — | — |
| **Cockpit (:3000) / SovereignCore** | never signs (prior rounds' full-grep; unchanged) | — | — | — |
| **HTTP on the engine (:3040)** | cannot write exec-log directly; `POST /cycle` (unauthenticated) can **trigger** a real cycle → genuine artifacts with external causation; `POST /adopt-credential` (5/h rate-limit) can swap the credential file | any network path; Caddy :81 `?XTransformPort=3040` exposure = C-1e finding, not re-verified here | genuine engine artifacts if triggered | genuine |
| **Any on-machine process as user `z` or root (caddy runs root)** | can append/fake ANY state file (see §3) | code exec on this box | anything | none unless they also hold the credential |

**Conclusion:** exactly two writers can emit a successful on-chain claim: the engine's execute step and the second signer. They share ONE credential ⇒ **on-chain signatures cannot distinguish them** (same posting key). Only artifact topology + timing + code-state can.

## 2 · THE FALSIFICATION BOMB — op id 33 ≠ canonical 39 (three independent proofs)

Engine constant: steemtx.mjs:174 `OP_IDS = { …, claim_reward_balance: 33, delegate_vesting_shares: 40 }`. The broadcast path sends **JSON with op names** (steemtx.mjs:272 `json.operations = ops` → signer.mjs:675 `broadcastTx(t.json)`), so the node re-serializes canonically — but the engine **signed** the digest over ITS OWN serialization (steemtx.mjs:267 `sha256(chain_id ‖ serializeTx(…))`, op-id byte from OP_IDS). If the id is wrong, the digest is wrong, the signature recovers to a garbage pubkey, and the chain answers "missing required <X> authority".

Proofs (all re-runnable from `/home/z/tmp-r209b/`):
1. **Byte-diff via the chain's own re-serializer:** `condenser_api.get_transaction_hex` (api.steemit.com) re-serializes a claim op → op-id byte `0x27` = **39**; engine produces `0x21` = 33. All other 71 bytes identical.
2. **Txid ★ reproduction:** rebuilding the second signer's on-chain claim (block 110175341) with op-id **39** reproduces `transaction_id 159e9313b076026242632a2f12cae3548242252d` exactly; op-id 33 does not.
3. **Full canonical table** (get_transaction_hex, one call per op): vote 0 ✓, comment 1 ✓, transfer 2 ✓, limit_order_create 5 ✓, limit_order_cancel 6 ✓, convert 8 ✓, claim_account 22 ✓, create_claimed_account 23 ✓, delegate_vesting_shares 40 ✓, **claim_reward_balance 39 (engine 33 ✗)** — a single wrong constant.

**This resolves both authority-error paradoxes** in the exec-log:
- claim 19× fail "missing required **posting** authority" — although the engine held & used a valid credential; a garbage recovered pubkey satisfies no authority, and claim(39) requires posting → that error.
- convert 11× fail on Oct-02 "missing required **active** authority" while signed with the active key (exec-log 2026-10-02T00:02–01:31) — same garbage-recovery signature. (Convert id 8 is canonical per today's table, so the Oct-02 convert digest mismatch has a second, unlocated cause in the then-current serializer — flagged for the fixer; rail currently dormant.)

**Consequences for T-84:**
- The learned cause ("claim needs the posting key") is a **misattribution**. The chain's error text is true about the op's requirement but was never about which key the engine used. The machine's hypothesis space (signing roles) does not contain the real cause (a serializer constant), so it *cannot* learn the true fix from this evidence stream.
- At the first natural firing: `prediction.recorded` (adaptedRole=posting) → partition signs with posting WIF → digest still op-33-based → node recovers garbage → **"missing required posting authority" again** → `attempts 1,2,3` → `adaptation.retired "attempts-exhausted"` (adaptations.mjs:145-150). The adaptation will die "verified-failed" while the one-byte fix sits in `steemtx.mjs:174`.
- **Discrimination flip:** from pinned code `steemtx.mjs` sha256-16 `83de909e02780168` (git-clean at 16:55Z), the engine **cannot** produce a signature that verifies for a claim → **any `ok:true` claim row (or any successful on-chain claim attributed to the engine) is impossible** until OP_IDS changes. That is the strongest possible artifact-level falsifier for this round.
- Safety note: with the T-84 role fix alone, a firing would broadcast op byte 33 with a posting sig over a wrong digest — it can never execute *as a claim*; whatever byte 33 means to consensus never gets a valid signature from this engine (garbage recovery fails every authority). No unexpected-execution risk identified, but the fix must be **33→39 AND role** together.

Crypto-lab side-result (method validation): recovery pipeline validated on the engine's own delegation tx `fcf347d5…` (block 110172488) → recovers exactly headcorner's **active** pubkey X=`0234b120…8cad55e8e`; the second signer's claim → recovers exactly headcorner's **posting** pubkey X=`03fde43c…7431a2704` (compare chain `get_accounts` authorities — X-coords byte-identical; display-checksum suffix differs only in my lab's base58-check formatting, X is the identity). **The second signer provably holds the posting WIF of headcorner.**

## 3 · CAN THE SECOND SIGNER FORGE LOCAL EVIDENCE? — **YES in principle (preconditions below); NO on-machine presence observed today**

- `state/exec-log.jsonl` is **unsealed** plain JSONL (signer.mjs:33 `appendFileSync`), no lock, no MAC. `events.jsonl`, `think-log.jsonl`, `cycle-run.json`, `learning.json` — same. The adaptations.json "integrity seal" is an **unkeyed** hash (`sha256(JSON.stringify(payload))`, adaptations.mjs) — anyone can rewrite and re-seal.
- `fingerprint c056922c` is **not an authenticity marker**: it is `sha256(master password)[:8]` (steemtx.mjs:278, signer.mjs:437). The second signer holds the same master credential → can compute it; a non-credential on-machine forger doesn't even need to — it is printed in all 673 exec rows. Copy or compute: either way forgeable. Be honest: yes.
- `txid` is `sha256(serializeTx(ops))[:40]` — a forger holding the credential can fabricate a real-looking claim tx, broadcast it **themselves** (getting a real chain tx), and write a matching local row with `tag:"cycle-execute"`, `role:"posting"`. Local-only checks cannot exclude this; only the full topology below can.
- What an **off-machine** writer (second signer as observed: process census 16:45Z shows only cockpit/next/postcss/engine bun 15086/caddy-root; no cron, no timers, no other bun/node) **cannot do**: backfill a `prediction.recorded` row that precedes the broadcast, produce the think-log ALLOW row of the same second, or reproduce the **full-cycle file churn** (a real cycle rewrites observe.json, intel.json, offer.json, daily-report.json, learning.json, cycle-run.json, events.jsonl within seconds). Absence of churn around an ok row = fabrication signal.
- On-machine caveat (no theater): every AI agent round in this sandbox runs as `z` with write access — including auditors. Chain-of-custody here rests on sandbox honesty, not cryptography. The engine itself (PID 15086) runs `bun --hot`: writes to **source** files hot-reload the process (code tamper = detectable via `git status`/diff; steemtx.mjs is currently git-clean); writes to `state/*.json` do **not** reload (state is read via fs at runtime).
- HTTP-only attacker (no shell): cannot write exec-log at all (no such endpoint); can trigger real cycles (`/cycle`) or swap the credential (`/adopt-credential`) — causation transfer, not forgery.

**Answer for the RETURN: YES** — an on-machine process holding (or copying) the fingerprint can forge a plausible exec row, and a credential-holding forger can even make the txid real by broadcasting its own claim. **NO observed capability today** (second signer shows no on-machine presence), and the *set* of artifacts (prediction-ordering + think-log + cycle churn + adaptation seal + code pin) is expensive to fake consistently — but nothing local is cryptographically unforgeable. The arbiter must be chain-truth + code-version pinning.

## 4 · WORKING CHAIN QUERY SHAPES (tested live 16:45–16:55Z)

Node support matrix (engine's broadcast nodes):

| Node | get_account_history | get_transaction | get_transaction_hex | get_block |
|---|---|---|---|---|
| `https://steemapi.boylikegirl.club` | ✅ condenser shape | ❌ `Assert Exception: _account_history_api: account_history_api_plugin not enabled.` | n/t | ✅ |
| `https://api.steemit.com` | ✅ both shapes | ✅ | ✅ | ✅ |
| `https://api.justyy.com` | ⏱ timed out once, then plugin-error on get_transaction | ❌ same assert | n/t | n/t |

**get_transaction — use api.steemit.com ONLY at the firing moment:**
```json
{"jsonrpc":"2.0","id":1,"method":"condenser_api.get_transaction","params":["159e9313b076026242632a2f12cae3548242252d"]}
```
Returns: `block_num, expiration, extensions, operations, ref_block_num, ref_block_prefix, signatures[], transaction_id, transaction_num`. **No `required_authorities`, no signing-pubkey field.** Which key signed is proven by (a) chain inclusion (consensus checked required authority) + (b) offline recovery (§2 lab) when attribution depth is needed.

**Failed broadcasts are chain-invisible** (proven): engine's failed claim `7875e0bd…` → `{"code":-32003,"message":"Assert Exception:false: Unknown Transaction ${t}"}`. Only exec-log knows the 19 failures exist.

**get_account_history (works on boylikegirl AND steemit, POSITIVE limit is mandatory):**
```json
{"jsonrpc":"2.0","id":1,"method":"condenser_api.get_account_history","params":["headcorner",-1,50]}
```
(The earlier "assert exceptions" were the negative/zero-limit shapes; `-1,50` works. Appbase alternative on steemit:)
```json
{"jsonrpc":"2.0","id":1,"method":"account_history_api.get_account_history","params":{"account":"headcorner","start":-1,"limit":50}}
```

**Block-level check (boylikegirl OK):**
```json
{"jsonrpc":"2.0","id":1,"method":"condenser_api.get_block","params":[110175341]}
```
→ `timestamp, witness, transactions[{transaction_id, signatures, operations}]` — lists ALL txs in the block (used today: the second signer's claim block also carries its `comment`+`comment_options`; `witness: steemfy`, `timestamp 13:07:24`).

**Canonical op-id probe (the new arbiter):**
```json
{"jsonrpc":"2.0","id":1,"method":"condenser_api.get_transaction_hex","params":[{"ref_block_num":0,"ref_block_prefix":0,"expiration":"2026-10-06T00:00:00","operations":[["claim_reward_balance",{"account":"headcorner","reward_steem":"0.000 STEEM","reward_sbd":"0.000 SBD","reward_vests":"0.000000 VESTS"}]],"extensions":[],"signatures":[]}]}
```
→ result hex byte 11 (hex chars 22:24) = **0x27 (39)** today. If the fixer edits OP_IDS, this call detects the code state from the chain's side.

**Reward precondition probe (firing watcher):**
```json
{"jsonrpc":"2.0","id":1,"method":"condenser_api.get_accounts","params":[["headcorner"]]}
```
→ 16:48Z: `reward_steem 0.000 / reward_sbd 0.000 / reward_vesting 0.000000` (second signer drained 13:07; baseline for the firing window).

## 5 · AFTER-EVIDENCE SPEC v2 — minimal artifact set proving "the organism's learned behavior caused this exact chain change", excluding the second signer

**Code pin (record NOW, before any firing):** `steemtx.mjs` sha256[:16] `83de909e02780168` (git-clean), `signer.mjs` `6cc97d36e25db18b`, `adaptations.mjs` `cb9fc9f273c6dcec`, `daily.mjs` `4ebd6d061f650f4d`; engine PID 15086; exec-log = 673 rows / 19 claim-fails / last 13:05:28.500Z; events 2159 / 0 `prediction.recorded`; adaptation ACTIVE attempts 0/3; rewards all zero @16:48Z.

**Block window:** engine fetches DGPO immediately before build (signer.mjs:641) and TTL is 45s (steemtx.mjs:258) → the claim's `ref_block_num` must be within ~65k of head, and its block's timestamp must fall **inside the cycle window** `[cycle-run.json startedAt − 0s, startedAt + 900s]` and within `expiration − 45s…expiration` of broadcast. Racing external claims = any OTHER `claim_reward_balance` for headcorner in blocks `[B−2, B+2]`.

**The 120-second protocol (≤8 steps, in order):**
1. **Freeze the moment locally** (t+0, on seeing a new exec-log claim row OR the cockpit): copy `state/exec-log.jsonl` tail, `events.jsonl` tail, `think-log.jsonl` tail, `cycle-run.json`, `adaptations.json`, `learning.json`, and `sha256sum mini-services/saos-engine/{steemtx,signer,adaptations,daily}.mjs` + `git status --porcelain mini-services/saos-engine/` — the code pin decides everything downstream.
2. **Impossible-outcome detector:** if the row says `ok:true, ops:["claim_reward_balance"]` while the pinned `steemtx.mjs` still maps claim→33 → the row is **forged or code changed post-hoc**; go to step 7. (From pinned code the engine cannot emit a verifiable claim signature. A `role:"posting", ok:false` row with the SAME "Missing Posting Authority" error is the honest expected outcome of the current T-84 firing.)
3. **Chain resolution (steemit only):** `get_transaction(exec-row txid)` — require: `transaction_id` equals the exec-row txid exactly (40 hex = full id, not a prefix); operations == one `claim_reward_balance` with `account:"headcorner"` and amounts matching intel's decision formatting (STEEM/SBD 3dp, VESTS 6dp); exactly 1 signature; `ref_block_num` ≈ head at `cycle-run.json startedAt`.
4. **Block context (boylikegirl):** `get_block(block_num)` — verify block timestamp inside the cycle window and expiration-bound; enumerate the block's txs for OTHER headcorner claim txs (race / second-signer double-write). Cross-node confirmation: `get_account_history ["headcorner",-1,50]` contains the op with the same `trx_id` and block.
5. **Local topology (all must cohere within ±5s):** `prediction.recorded` (events.jsonl, `adaptedRole:"posting"`) **precedes** the exec row; think-log `source:"cycle-execute", verdict:"ALLOW"` row with the claim in `shown`; cycle-run.json `running:true/startedAt` bounding the moment; full-cycle file-churn mtimes (observe/intel/daily-report/learning/events all touched in the same window); `engine.pid` unchanged. Any missing member = downgrade verdict to "not attributable".
6. **State transition:** `adaptations.json` → claim adaptation state+attempts moved by exactly the observed outcome (`VERIFIED`+`verified.txid == exec txid` on success; `attempts+1`/`retired attempts-exhausted` on the predicted failure), integrity field == `sha256(JSON.stringify(payload))` recomputed, plus matching `adaptation.*` event in events.jsonl. Rewards re-check via `get_accounts` (zeroed on success).
7. **If forged-or-ambiguous (from step 2 or a failed coherence check):** recover the signing pubkey offline (lab at `/home/z/tmp-r209b/recover4.mjs` pattern: rebuild digest via the *canonical* op id, `Point` recovery, compare X-coord with the chain authorities from `get_accounts`) and fingerprint the writer by exclusion — e.g. a valid posting-key signature on a claim the pinned engine could not have produced = the second signer (or a new credential holder), full stop.
8. **Record the round verdict** in cognition-round with: exec-row bytes, txid, block, witness, cycle-window fit, code-pin hashes, and the explicit sentence "engine produced / engine could not have produced" — plus, in the expected failure branch, the required one-byte fix (`OP_IDS.claim_reward_balance 33→39`) surfaced to the fixer round with the convert-Oct-02 anomaly attached.

## 6 · STRONGEST ALTERNATIVE EXPLANATION (deliverable 1)

**"The next successful claim will be credited to the organism's learning, but the second signer did it."** Mechanism: the second signer drains rewards within minutes of accrual (observed: claimed 67.769681 VESTS at 13:07:21, two minutes after the engine's 13:05 failure, and continues acting at 16:37–16:44). The engine polls rewards only once per ~10-min cycle (intel → decisions), so for most accrual instants the second signer wins the race; the engine then sees zero rewards and lawfully NO-OPs. Any narrative of "learning verified on-chain" built on a rewards-zeroed observation alone is therefore unfalsifiable-from-outcome — the drain has a ready non-organism cause. Compounding: (a) `POST :3040/cycle` is unauthenticated, so the second signer can also *time* the engine's firing; (b) if a forged row were ever needed, the fingerprint is copyable and the log unsealed. And the deeper alternative now proven: **even a genuine engine firing cannot succeed** (op-id 33 ≠ 39), so ANY future `ok:true` claim row is, from pinned code, more plausibly forged or foreign than learned — until the serializer is fixed and re-pinned.

## 7 · Honest unknowns

- Which consensus op byte 33 actually names (could not be queried by id through JSON APIs; byte 33's execution semantics with a valid posting sig remain unprobed — moot while the engine's sig over byte-33 bytes can never verify).
- The Oct-02 convert digest-mismatch cause (convert id 8 is canonical today; rail dormant — attach to fixer round if it re-arms).
- Caddy :81 `?XTransformPort=3040` external reachability (C-1e's finding; /app unreadable from this user) — decides whether `POST /cycle` is a LAN-only or internet-facing trigger.
- Whether the second signer's sandbox would ever co-operate with an evidence protocol (it has no observed obligation to).
- Lab scripts live in `/home/z/tmp-r209b/` (outside the engine tree; one symlink to engine `node_modules` for @noble imports; zero engine writes).
