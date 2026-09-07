# ECOS AI Protocol — V281

**Version:** 281
**Date:** 2026-06-01
**Status:** Canonical

---

## 1. Overview

V281 extends the ECOS AI protocol with scheduled digest + notification cycles:

1. **Schedule registry** — `registerDigestSchedule281` / `deregisterDigestSchedule281`
   maintain a named map of recurring digest+notify jobs.
2. **Pause / Resume** — `pauseSchedule281` / `resumeSchedule281` toggle active intervals
   without losing schedule configuration.
3. **Run history** — each scheduled cycle records a run entry (ok/fail, digestId,
   delivery counts, durationMs) capped at 200 entries.
4. **SSE stream** — `addScheduleSseClient281` exposes live events for all schedule
   lifecycle transitions and run outcomes.

---

## 2. Provider DI Contract Protocol

### 2.1 V281 new contract

| Contract | Agent capability unlocked |
|---|---|
| `digestScheduler` | Recurring digest+notify scheduling with pause/resume and SSE stream |

### 2.2 Contract total

V281 defines **31 provider contracts** in `providerAdapters281.js`.

### 2.3 `digestScheduler` DI contract

```js
digestScheduler.registerDigestSchedule281(name, opts)
digestScheduler.deregisterDigestSchedule281(name)
digestScheduler.pauseSchedule281(name)
digestScheduler.resumeSchedule281(name)
digestScheduler.getSchedules281()
digestScheduler.getScheduleHistory281(opts)
digestScheduler.getStatus281()
// optional
digestScheduler.checkDigestSchedulerHealth281()
digestScheduler.getPerf281()
digestScheduler.addScheduleSseClient281(res)
digestScheduler.removeScheduleSseClient281(clientId)
digestScheduler.shutdown281()
```

---

## 3. Integration Flows

### 3.1 Scheduled Cycle Flow

```
Operator
  │─── POST /api/v281/alerts/schedules ──────────────────►DigestScheduler281
  │   { name, intervalMs, channels, period }               │
  │◄── 201 { ok, name, intervalMs, ... } ─────────────────│
  │                                                         │
  │ (every intervalMs ms)                                   │
  │                          AlertDigest279.generateAlertDigest279(period)
  │                                                         │
  │                          NotificationChannel280.notifyDigest280(digest)
  │                                                         │
  │                          → SCHEDULE_RUN_COMPLETE (SSE)  │
```

### 3.2 Pause / Resume Flow

```
Operator
  │─── POST /api/v281/alerts/schedules/:name/pause ───────►DigestScheduler281
  │◄── 200 { ok, paused: true }                            │ (timer cleared)
  │                                                         │
  │─── POST /api/v281/alerts/schedules/:name/resume ───────►DigestScheduler281
  │◄── 200 { ok, paused: false }                           │ (timer restarted)
```

---

## 4. Versioning Rules

- All new identifiers in V281 end with the suffix `281`.
- No V280 identifier is removed, renamed, or made breaking.
- V281 modules are drop-in replacements for V280 modules.
- Backward-compat aliases (`*280`, `*279`, ...) are preserved unchanged.
- Future versions (V282+) MUST follow the same additive-only, suffix-versioned pattern.

---

## 5. Security Constraints

| Constraint | Enforcement |
|---|---|
| Sacred file guard | `injectionFirewall268` blocks writes to `SACRED_FILES_268` |
| No self-attestation | `reputationLedger268.attest268` throws on `attesterId === subjectId` |
| No self-tipping | `tipModule268.tip268` throws on `fromUserId === toUserId` |
| Replay protection | `x402268` nonce registry consumes each nonce once |
| BigInt-only credits | All μ¢ values use `BigInt`; no float arithmetic on credits |
| Schedule safety | `registerDigestSchedule281` enforces minimum `intervalMs` of 5000 |
