# CLAUDE HANDOFF — V33.17

V33.17 adds a continuous adaptive control service above V33.16.

Read first:
1. `CLAUDE.md`
2. `MASTER_DIRECTIVE.md`
3. `PROGRAM_CHARTER.md`
4. `docs/V33_17_CONTINUOUS_ADAPTIVE_CONTROL_SERVICE.md`
5. `release-evidence/v33.17/V33_17_CONTINUOUS_ADAPTIVE_CONTROL_SERVICE_PROOF.json`
6. `release-evidence/v33.17/V33_17_VALIDATION.json`

Truth boundary:
- local signed scheduler;
- single-host signed file store;
- monotonic local fencing;
- crash recovery before effect application;
- 90-cycle accelerated local soak;
- shadow-only, zero external effects;
- no distributed consensus, external witness or production promotion.
