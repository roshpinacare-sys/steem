# L-1c Chain-Truth Auditor — SLIM rerun (T-84 BEFORE state)

**Verdict: BEFORE-CONFIRMED.**
Chain + engine endpoints independently confirm the BEFORE state of the T-84 signing-role fix: the claim rail is still unsigned-by-posting (adaptation `adapt-claim_reward_balance-posting` = ACTIVE, attempts 0/3), reward balances are zero, and the credential's posting role is chain-verified HELD. No leak blocker.

## 1. Chain measurements — condenser_api.get_accounts ["headcorner"] @ steemapi.boylikegirl.club (16:21Z, 2026-10-05)

| Field | Value | Expected | OK? |
|---|---|---|---|
| reward_steem_balance | 0.000 STEEM | 0 | ✅ |
| reward_sbd_balance | 0.000 SBD | 0 | ✅ |
| reward_vesting_balance | 0.000000 VESTS | 0 | ✅ |
| reward_vesting_steem | 0.000 STEEM | 0 | ✅ |
| posting key_auths prefix (1 key) | `STM8m3rBLd8C…` | present | ✅ |
| active key_auths prefix (1 key) | `STM5HhJD5WUX…` | present, distinct | ✅ |
| delegated_vesting_shares | 4552866.947848 VESTS | ~4552866.947848 | ✅ exact |

Posting and active authorities are **distinct single-key authorities** → the two roles are genuinely separate; a posting-signed op cannot be satisfied by an active-key signature.

## 2. Engine status endpoints

- `http://localhost:3040/` → `{"ok":false,"error":"not-found"}` + route list (`/status`, `/exec-status`, …). Authoritative status lives at **`/exec-status`**.
- `http://localhost:3040/exec-status` → `ok:true`, `credentialPresent:true`, `armed:true`, `standingOrder:true`, `operatorPaused:false`, **`fingerprint:"c056922c"`**, **`verdict:"VERIFIED"`**; per-role `matched:true` for owner / active / **posting** / memo (`matchedOrder:"name+role+pw"`); `foreignCredential:false`. (`/status` :3040 mirrors the same fingerprint/verdict/roles.)
- `http://localhost:3000/api/saos/signer` → `{"ok":false,"total":0}` (mover-log unavailable) — non-authoritative; exec-status is the role source of truth.

## 3. Credential POSTING role = chain-verified HELD

Chain posting authority pubkey prefix `STM8m3rBLd8C…` **exactly equals** exec-status `roles.posting.pubkey` prefix with `matched:true` under `matchedOrder:"name+role+pw"`. The credential holds the very key the chain lists as `headcorner`'s posting authority — corroborated by 21 successful vote broadcasts today under posting (votes require posting auth), same fingerprint c056922c.

## 4. Leak scan — BLOCKER CHECK

Regex `5[HJK][1-9A-HJ-NP-Za-km-z]{49}` over all five captured responses (chain.json, engine.json, signer.json, exec.json, status.json): **0 matches. NO WIF-shaped material. NO BLOCKER.** Only public STM… pubkeys were emitted; prefixes-only policy held in this report.

## 5. Alternative-explanation discrimination

**Could "missing required posting authority" mean anything other than "sign with the posting key"? NO.**

- (a) The account demonstrably **has** a posting authority and our credential **is** it: chain `posting.key_auths` = `STM8m3rBLd8C…` = exec-status `roles.posting` matched:true, plus 21 successful posting-auth vote broadcasts today, same fingerprint c056922c. So the error cannot mean "account lacks posting authority" or "your credential's posting key is not the authority."
- (b) `foreignCredential:false` and `doctrineAccount==credentialAccount==headcorner` rule out a wrong-account credential; memo/owner keys are irrelevant to a posting-gated op.
- (c) Therefore the only surviving reading: the **signing key presented** for the claim transaction was the **active** key (`STM5HhJD5WUX…`), while the node requires a posting-authority signature for `claim_reward_balance` — exactly the learned lesson (`fromRole: active → toRole: posting`, adaptation ACTIVE in adaptations.json, evidence rows txid eb6b7da5…, 78d23e71…, 00cb67d6…).

## 6. AFTER-evidence spec (one line each)

- **Exec-log firing row:** `rg '"claim_reward_balance"' /home/z/my-project/mini-services/saos-engine/state/exec-log.jsonl | tail -3` — baseline today = 19 rows, all `ok:false`, error `missing required posting authority:Missing Posting Authority headcorner`, fingerprint c056922c, last 2026-10-05T13:05:28.500Z; AFTER = first new row with `ok:true`, same fingerprint, no posting-authority error.
- **adaptations.json VERIFIED check:** `python3 -c "import json;d=json.load(open('/home/z/my-project/mini-services/saos-engine/state/adaptations.json'));a=d['payload']['adaptations'][0];print(a['state'],a['attempts'])"` — expect `state:"VERIFIED"` (currently `ACTIVE`, attempts 0/3), attempts ≥1, integrity hash re-stamped.
- **Chain reward-zeroed check:** re-run `get_accounts` after the firing row — expect `reward_vesting_balance` back at `0.000000 VESTS` (accrual claimed, prior zero confirmed by second actor's 13:07Z drain) with **zero new** "missing required posting authority" rows; a successful zero-reward claim (`ok:true`) plus unchanged 4552866.947848 VESTS delegated is the passing signature.
