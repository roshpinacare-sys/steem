# ECOS V124 — Changelog
**Release Name:** Audit Sovereignty  
**Date:** 2026-05-30  
**Base:** V123 — Integrity Integration (~1043 tests, 53 libs, 20 pages)  
**Tests:** ~1043 (V123) + ~15 new V124 = **~1058 passing**  
**Libraries:** 53 → **55** (+2 new: `mmrCheckpoint`, `nonceTracker`)

---

## What's New

### [V124-P15-01] `mmrCheckpoint` — Signed MMR Checkpoint for External Audit

`lib/mmrCheckpoint.js` generates tamper-evident signed snapshots of the MMR root.

**How it works:**
- `generateCheckpoint(mmr, serverId)` produces:
  ```json
  {
    "root":        "<hex64 bagged MMR root>",
    "leafCount":   42,
    "timestamp":   "2026-05-30T...",
    "serverId":    "<agentId>",
    "ecosVersion": "V124",
    "signature":   "<HMAC-SHA256 of canonical JSON>",
    "canonical":   "<the exact string that was signed>"
  }
  ```
- Canonical message = `JSON.stringify(payload, keys.sort())` — alphabetically sorted for determinism
- Signing key: `CHECKPOINT_HMAC_KEY` env var (falls back to `JWT_SECRET`)
- `verifyCheckpoint(cp, opts)` allows any party with the key to independently verify

**New API endpoint:**

```
GET /api/v1/chain/mmr/checkpoint
→ { root, leafCount, timestamp, serverId, ecosVersion, signature, canonical }
```

Requires auth. Persists checkpoint to `mmr_checkpoints` table for archival.

---

### [V124-P15-02] `validatorIdentity` — Public Key Export

External verifiers can now resolve a validator's public identity without the master seed.

**New API endpoint:**

```
GET /api/v1/validator/:id/identity
→ {
    validatorId,
    vid:           "<16-hex derived identity>",
    display:       "V-<8hex>",
    publicKeyHint: "<vid — safe to publish>",
    ephemeral:     false,
    note:          "Production identity...",
    ecosVersion:   "V124"
  }
```

- Records to `validator_identity_public` table on first request
- Ephemeral mode warning included when `VALIDATOR_MASTER_SEED` is not set

---

### [V124-P15-03] `nonceTracker` — Monotonic Nonce Ordering

`lib/nonceTracker.js` provides replay-attack protection for critical transactions.

**How it works:**
- Per `(scope, accountId)` pair, maintains a monotonically increasing nonce
- Client may supply `clientNonce` on critical requests; server rejects if `clientNonce ≤ current`
- Lenient mode (null/undefined nonce) auto-issues the next nonce without enforcement — for backwards compatibility
- Persisted to `nonce_counters` table on every `consume()` call
- Loaded from DB on server startup (async, non-blocking)

**New API endpoint:**

```
GET /api/v1/nonce/:scope/:accountId
→ { scope, accountId, currentNonce, nextExpected, ecosVersion }
```

---

### New DB Tables (via `db/migration_phase15.sql`)

| Table | Purpose |
|-------|---------|
| `nonce_counters` | Monotonic nonce per (scope, account_id) |
| `mmr_checkpoints` | Immutable archive of signed checkpoints |
| `validator_identity_public` | Public validator identity for external verification |

---

### Tests Added

| File | Tests | Coverage |
|------|-------|---------|
| `tests/mmrCheckpoint.test.js`  | 7 | generate, verify, tamper detection, wrong key, deterministic canonical, missing fields, stability |
| `tests/nonceTracker.test.js`   | 8 | initial state, auto-issue, strict sequential, replay rejection, gap acceptance, scope isolation, stats |

---

## Sacred Files — Unchanged

```
lib/fiatLedger.js    MD5: 563e9b1f9e67091a5b6527c0a92568e5  ✅
lib/auditLog.js      MD5: e5a5c2c27801d2d03991bc8e5a1df8cb  ✅
```

---

## Migration

```bash
# Apply V124 DB migration
psql $DATABASE_URL < db/migration_phase15.sql
```

New tables: `nonce_counters`, `mmr_checkpoints`, `validator_identity_public`

---

## What's Next (V125)

1. **First real user** — technical stack is fully hardened, auditable end-to-end, and replay-protected
2. **Nonce enforcement on resolve** — wire `nonceTracker.consume('approval', approvalId, clientNonce)` into `POST /api/v1/approvals/:id/resolve`
3. **MMR compaction / archival** — truncate old leaves after archival to DB; keep proof-of-existence
4. **Backfill old audit entries** — re-embed pre-V123 audit_log entries into MMR
