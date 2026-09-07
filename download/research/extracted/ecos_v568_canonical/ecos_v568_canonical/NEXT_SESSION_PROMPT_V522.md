# NEXT_SESSION_PROMPT — after V522 → build V523

You are the next engineering-partner in line. Below is the **honest** state
of the system after V522 shipped. Read it before you touch anything.

## Truth map (from `node scripts/audit-tests.js`)

```
total suites : 140
pass         : 105
cannotRun    : 24
realFail     : 11
```

V522 delta vs V521: **+2 pass, -1 realFail, 0 regressions, 0 SACRED drift,
0 new npm deps.** Verified from a fresh re-extract of the canonical zip.

## Safe (do not re-break)

- SACRED md5 — both files frozen and verified:
  - `lib/fiatLedger.js`  = `563e9b1f9e67091a5b6527c0a92568e5`
  - `lib/auditLog.js`    = `e5a5c2c27801d2d03991bc8e5a1df8cb`
- `lib/semanticDriftMonitor.js` is now calibrated. Do **not** widen the
  thresholds again — V522 ships a self-test that asserts the exact values
  (`-0.015` and `0.4`). If you need different thresholds, update the
  self-test and the V522 endpoint contract too.
- `tests/v522.test.js` must keep returning `exit 0`. Treat it as a guard.
- All V521 endpoints (incl. `/api/v1/admin/test-audit/v521`) are intact.
- Vendored vitest shim at `node_modules/vitest/` (V521) is untouched —
  if you extend it, do it additively.

## Fragile (could break easily — touch with care)

- `lib/semanticDriftMonitor.js` constants. Any change must be mirrored
  in `src/lib/semanticDriftMonitor.js` (V522 keeps them md5-identical
  and the v522 test asserts that mirror equality).
- The `semanticDriftFix522.js` connector parses the monitor source with
  a regex to surface live thresholds. If you change the file formatting
  around those two constants, update the regex.

## Still broken (the 11 realFail in priority order)

Pick **one** and finish it. Do not start a second until the first is shipped.

1. **`monitor/index.js` missing** (flips `monitor.test.js` + `cli.test.js`
   in one move — best bang/buck). Spec is documented inside
   `tests/monitor.test.js` (V89-P5 / V90-P3 / V95). Needs to export
   `statusServer` and `checkValidatorIdleState(lastResolvedAt,
   pendingCount)`. Node `http` only — no deps.

2. **Widen the vitest shim** (`node_modules/vitest/`) with
   `expect(fn).toHaveBeenCalledOnce()` and
   `expect(promise).resolves.not.toThrow()`. Flips
   `embeddingProvider.test.js` + `notification.test.js`. Stays inside
   V521's "zero deps, Node builtins only" contract.

3. `chainProof.test.js` + `missionDashboard.test.js` — both fail on
   `Failed to parse URL from undefined/api/...`. They expect a
   `TEST_BASE_URL` (or similar) env var. Either set it inside the test
   harness or wire a small helper that boots the server on a random port.

4. `lib/rails/manualRail` missing — either implement it (must route
   through `guardWithdraw402` + audit) or remove the test.

5. `graduationEngine.test.js` — `expected undefined to be 1`. This looks
   like a real product bug: new users are not being initialised at stage
   1 (USE). Find the init path and fix it.

6. `agent.test.js` (`require is not defined`) and
   `stripe.test.js` (live API key) — both need test-side rewrites, not
   product changes.

7. `v510.test.js` T08 will go green automatically when realFail = 0
   (excluding v510 itself). Do not touch it.

## Rules of engagement (the ones that mattered this round)

- **AUDIT first, always.** Do not start coding until you have a fresh
  `node scripts/audit-tests.js` baseline. Write it down. Compare at the end.
- **Connector > reimplementation.** V522 fixed two constants and added a
  thin connector. That's a full version. Resist the urge to add a fourth
  module for the same concept.
- **`lib/` and `src/lib/` must be md5-identical** for shared modules. The
  V522 test enforces it for `semanticDriftFix522.js`. Do the same for
  anything you add.
- **Truth in numbers.** Don't say "fixed it". Say "realFail X → Y, pass
  A → B, fresh re-extract verified". If you can't say that, you didn't fix it.
- **The CHANGELOG must have a "What was NOT verified" section.** It is
  not optional and it is not a weakness — it is what keeps the next
  partner from re-discovering the same trap.

## Concrete first command

```
cd <extracted v522> && node scripts/audit-tests.js | tail -25
# then pick #1 from the list above (monitor/index.js)
```

Good hunting. Keep it small, keep it real, keep it connected.
— Partner 8 (V522)
