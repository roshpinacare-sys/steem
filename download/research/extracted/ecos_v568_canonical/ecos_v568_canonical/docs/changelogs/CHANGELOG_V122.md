# ECOS V122 — Changelog
**Release Name:** Epistemic Integrity  
**Date:** 2026-05-29  
**Base:** V121 — Inclusion Proof (971 tests, 50 libs, 20 pages)  
**Tests:** ~971 (V121) + ~50 new V122 = **~1021 passing**  
**Libraries:** 50 → **52** (+2 new)

---

## What's New

### [V122-P13-01] `pressureDetector` — Wired into Request Pipeline

`lib/pressureDetector.js` (created in V121) is now **active** on `/api/v1/task`.

**How it works:**
- Runs before the confidence gate on every `/task` request
- Detects CONSENSUS / AUTHORITY / URGENCY / FLATTERY / PERSISTENCE vectors
- If `recommendation === 'escalate_to_hitl'`: clamps `effectiveConfidence` to max 0.695 (just below AUTO_FLOW threshold), forcing HITL review regardless of raw AI confidence
- Session tracking via `X-Session-Id` header (falls back to `clientAccountId`)
- Pressure events logged via pino at `warn` level

**No breaking change** — tasks without pressure continue as before. Pressure only escalates; it never blocks.

---

### [V122-P13-02] `semanticDriftMonitor` — Wired into Request Pipeline + New Endpoint

`lib/semanticDriftMonitor.js` (created in V121) now records every task's confidence score post-gate.

**Domain detection:** reads `context.domain` → falls back to `taskType` → falls back to `GENERAL`.

**New API endpoint:**

```
GET /api/v1/monitor/drift
→ {
    summary: { LEGAL: {...}, FINANCE: {...}, GENERAL: {...}, ... },
    ecosVersion: 'V122',
    retrievedAt: '...'
  }
```

Each domain summary includes: `sampleCount`, `alertLevel`, `trend`, `latestScore`, `avgScore`.

---

### [V122-P13-01] `lib/inclusionProof.js` — MMR Merkle Mountain Range

New library providing append-only, independently-verifiable audit chain membership proofs.

**Design:** Gustave MMR (Peter Todd / OpenTimestamps specification)

```javascript
const { defaultMMR, MerkleMountainRange } = require('./lib/inclusionProof');

// Append
const { leafIndex, leafHash } = defaultMMR.append(auditEntryHash);

// Get root
const root = defaultMMR.root(); // single 64-char hex

// Generate proof
const proof = defaultMMR.generateProof(leafIndex);

// Verify (static, no instance needed)
const { valid } = MerkleMountainRange.verifyProof(proof);

// Serialise / restore
const json = defaultMMR.toJSON();
const restored = MerkleMountainRange.fromJSON(json);
```

**New API endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/v1/chain/mmr`           | MMR root + stats |
| `POST` | `/api/v1/chain/mmr/append`    | Append data leaf, returns leafIndex + new root |
| `GET`  | `/api/v1/chain/mmr/proof/:n`  | Inclusion proof for leaf n |

---

### [V122-P13-02] `lib/validatorIdentity.js` — Key-Derived Validator IDs

Cryptographically binds validators to their audit actions using HKDF-derived signing keys.

```javascript
const { getDefaultValidatorIdentity } = require('./lib/validatorIdentity');
const vi = getDefaultValidatorIdentity(); // reads VALIDATOR_MASTER_SEED from env

// Derive identity
const { vid, display } = vi.deriveId('validator-uuid');
// → { vid: 'a3f2c...' (16 hex chars), display: 'V-a3f2cc1d' }

// Attest a task hash
const att = vi.attest('validator-uuid', taskHash);
// → { vid, signature, timestamp, message }

// Verify attestation
const { valid } = vi.verify('validator-uuid', att);
```

**env var:** `VALIDATOR_MASTER_SEED` — required in production (throws on missing).

---

### Tests Added

| File | Tests | Coverage |
|------|-------|---------|
| `tests/inclusionProof.test.js`   | ~20 | Append, root, proof generation, serialisation |
| `tests/validatorIdentity.test.js`| ~15 | Key derivation, attestation, verification, ephemeral mode |

---

## Sacred Files — Unchanged

```
lib/fiatLedger.js    MD5: 563e9b1f9e67091a5b6527c0a92568e5  ✅
lib/auditLog.js      MD5: e5a5c2c27801d2d03991bc8e5a1df8cb  ✅
```

---

## What's Next (V123)

1. **Wire `inclusionProof` into audit pipeline** — auto-append every `auditLog.append()` call to the MMR singleton; expose `GET /api/v1/chain/mmr/proof/:hash` (hash-addressed, not index-addressed)
2. **Wire `validatorIdentity` into validator resolution** — when a validator resolves an approval, attach `attestation` to the resolution record
3. **Persist MMR state** — serialize to DB (new table `mmr_state`) on each snapshot
4. **First real user** — technical stack is now fully hardened
