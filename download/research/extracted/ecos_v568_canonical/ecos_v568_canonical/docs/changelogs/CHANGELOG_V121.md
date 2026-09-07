# ECOS V121 — Changelog
**Release Name:** Inclusion Proof  
**Date:** 2026-05-29  
**Base:** V120 — Sovereign Economy (921 tests, 48 libs, 20 pages)  
**Tests:** 921 (V120) + ~50 new = **~971 passing**  
**Libraries:** 48 → **50** (+2 new)

---

## What's New

### [V121-P12-01] `lib/pressureDetector.js` — Epistemic Pressure Detection

New library that runs **before** `hitlGate.js` in the middleware chain.

Detects manipulative patterns that attempt to force tasks into `AUTO_FLOW` by applying social or rhetorical pressure on the confidence gate:

| Vector | Pattern Examples | Weight |
|--------|-----------------|--------|
| `CONSENSUS`  | "everyone knows", "it's obvious", "any expert would" | 0.20 |
| `AUTHORITY`  | "I'm an expert", "trust me", "my credentials" | 0.25 |
| `URGENCY`    | "must be done now", "no time for review", "emergency" | 0.30 |
| `FLATTERY`   | "you're the best AI", "only you understand" | 0.15 |
| `PERSISTENCE`| 3+ identical requests in same session | dynamic |

**API:**
```javascript
const { detect, middleware, PRESSURE_VECTORS } = require('./lib/pressureDetector');

// Direct usage
const result = detect(taskText, { sessionId, threshold: 0.60 });
// → { pressureScore: 0.73, pressureVectors: ['URGENCY', 'AUTHORITY'], recommendation: 'escalate_to_hitl' }

// Express middleware (place before confidenceGate)
app.use(pressureDetector.middleware({ threshold: 0.60 }));
// → attaches req.pressureAnalysis to every request
```

**Compound amplification:** multiple vectors together amplify score by 1.25x–1.44x.  
**Session memory:** persistence tracking uses in-memory Map, scoped per `X-Session-Id` header.

---

### [V121-P12-02] `lib/semanticDriftMonitor.js` — Confidence Signal Trend Monitoring

Monitors per-domain confidence readings over time and fires alerts when it detects downward acceleration **before** behavioral failure manifests.

Core insight from VOID Protocol research:
```
structural_fracture → behavioral_failure
t₁                    t₂
Δt = t₂ - t₁ > 0  ← intervention window
```

**Domain profiles:**

| Domain | Type | Window | Alert Threshold |
|--------|------|--------|-----------------|
| LEGAL / FINANCE | brittle | 5 | 0.08 (tight) |
| CODE / LOGIC | metastable | 8 | 0.12 + velocity spike |
| NARRATIVE / GENERAL | ductile | 10–12 | 0.05–0.06 |

**Alert levels:**
- `WARN` → increase_monitoring
- `ALERT` → validator_idle_alert
- `CRITICAL` → force_hitl (auto-escalate)

**API:**
```javascript
const { defaultDriftMonitor, ALERT_LEVELS } = require('./lib/semanticDriftMonitor');

// After each task, record its confidence score
const report = defaultDriftMonitor.record('LEGAL', confidenceScore);
if (report.alertLevel === ALERT_LEVELS.CRITICAL) {
  // trigger VALIDATOR_IDLE alert
}

// Attach to request pipeline
app.use(semanticDriftMonitor.middleware());
```

---

### Tests Added

| File | Tests | Coverage |
|------|-------|---------|
| `tests/pressureDetector.test.js` | ~35 | All vectors, scoring, persistence, edge cases |
| `tests/semanticDriftMonitor.test.js` | ~25 | Recording, drift detection, all domain types, summary/reset |

---

## Sacred Files — Unchanged

```
lib/fiatLedger.js    MD5: 563e9b1f9e67091a5b6527c0a92568e5  ✅ (held since V38)
lib/auditLog.js      MD5: e5a5c2c27801d2d03991bc8e5a1df8cb  ✅
```

---

## What's Next (V122)

1. **Wire `pressureDetector` into `ecos-api-server.js`** — place before confidenceGate in `/task` and `/chat` routes
2. **Wire `semanticDriftMonitor`** — record confidence scores post-gate, expose via `GET /api/v1/monitor/drift`
3. **`lib/inclusionProof.js`** — MMR-based Merkle Mountain Range for audit chain verification (every validator can verify independently)
4. **`lib/validatorIdentity.js`** — key derivation for validator identity (ValidatorIdentity with HD keys)
5. **First real user** — the technical stack is ready
