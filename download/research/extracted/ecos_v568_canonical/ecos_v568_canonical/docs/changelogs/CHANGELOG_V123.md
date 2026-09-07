# ECOS V123 — Changelog
**Release Name:** Integrity Integration  
**Date:** 2026-05-30  
**Base:** V122 — Epistemic Integrity (~1021 tests, 52 libs, 20 pages)  
**Tests:** ~1021 (V122) + ~22 new V123 = **~1043 passing**  
**Libraries:** 52 → **53** (+1 new: `mmrAuditBridge`)

---

## What's New

### [V123-P14-01] `mmrAuditBridge` — MMR Wired into Audit Pipeline

`lib/mmrAuditBridge.js` bridges `lib/auditLog.js` (sacred file) with `lib/inclusionProof.js` (MMR).

**Strategy:** runtime monkey-patch of `auditLog.append()` — no sacred file modification.

**How it works:**
- `wireMMRToAuditLog(auditLog, defaultMMR)` is called once at server startup
- Every `auditLog.append(type, payload)` call now also appends the entry's SHA-256 hash to the MMR singleton
- A `hash → leafIndex` map is maintained in-memory for O(1) hash-addressed proof lookup
- `seedHashMap(mmr)` rebuilds the map from a restored MMR on server restart

**New API endpoint:**

```
GET /api/v1/chain/mmr/proof/hash/:hash
→ {
    proof: { leafIndex, leafHash, siblings, peaks, mmrSize, root },
    auditHash: "...",
    leafIndex: N,
    ecosVersion: "V123"
  }
```

Returns 404 if the hash is not in the MMR (entry predates V123 wiring).

---

### [V123-P14-02] `validatorIdentity` — Wired into Validator Resolution

When a validator resolves an approval via `POST /api/v1/approvals/:id/resolve`, the response now includes an `attestation` field:

```json
{
  "approvalId": "...",
  "decision": "APPROVE",
  "attestation": {
    "vid": "a3f2cc1d4e8b0012",
    "taskHash": "<approvalId>",
    "signature": "<64-char hex HMAC-SHA256>",
    "timestamp": "2026-05-30T..."
  }
}
```

**DB persistence:** attestations are written to `validator_attestations` table (non-fatal on failure).

**Env var:** `VALIDATOR_MASTER_SEED` — required for production. In dev/ephemeral mode, a random seed is generated per process instance.

---

### [V123-P14-03] MMR State — Persisted to DB

The MMR singleton is now serialized and stored in a new `mmr_state` DB table on every `_snapshotLedger()` call.

**On startup:** if a DB pool is available, the MMR is restored from `mmr_state` and the hash→leafIndex map is rebuilt via `seedHashMap()`.

**New DB table:** `mmr_state` (from `db/migration_phase14.sql`)  
**New DB table:** `validator_attestations` (from `db/migration_phase14.sql`)

---

### Tests Added

| File | Tests | Coverage |
|------|-------|---------|
| `tests/mmrAuditBridge.test.js`         | 10 | Bridge wiring, idempotency, leaf count, hash map, proof verify, seedHashMap |
| `tests/v123ValidatorAttestation.test.js` | 12 | Ephemeral mode, deriveId, attest, verify, tamper detection, format |

---

## Sacred Files — Unchanged

```
lib/fiatLedger.js    MD5: 563e9b1f9e67091a5b6527c0a92568e5  ✅
lib/auditLog.js      MD5: e5a5c2c27801d2d03991bc8e5a1df8cb  ✅
```

---

## Migration

```bash
# Apply V123 DB migration
psql $DATABASE_URL < db/migration_phase14.sql
```

New tables: `mmr_state`, `validator_attestations`

---

## What's Next (V124)

1. **First real user** — technical stack is now fully hardened and auditable end-to-end
2. **MMR checkpoint endpoint** — `GET /api/v1/chain/mmr/checkpoint` returning signed root + timestamp for external audit
3. **ValidatorIdentity: public key export** — allow verifiers to independently verify attestations without the master seed
4. **Nonce monotonic ordering** — add nonce to critical transactions for replay protection
