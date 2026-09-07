# V101 Experimental Libraries (NOT WIRED IN)

These three modules were produced in the divergent `V101_final` branch.
They are preserved here for reference but are **deliberately not wired**
into the canonical engine, because that branch also:

- Rewrote the sacred `lib/fiatLedger.js` (MD5 changed from the protocol
  invariant `563e9b1f...` to `88dc24e9...`) — a violation of the
  never-modify rule enforced since V38.
- Dropped the entire frontend (`apps/web`).
- Regressed the test suite (232 vs the canonical 275).

If any of these are adopted in a future version, port them onto the
canonical V100 ledger API **without** importing the V101 ledger rewrite,
add tests, and keep the sacred-file hashes intact.

- `analyticsEngine.js` — aggregate analytics over missions/approvals
- `slaTracker.js` — service-level tracking for validator response times
- `taskEscalation.js` — escalation rules when tasks exceed SLA
