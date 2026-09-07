# v13 Pilot Failure-Injection Matrix

Deterministic source-level failure matrix. It proves portable durability properties and explicitly blocks native, browser, remote-provider, and OS fault claims that were not executed.

Result: **10/25 source-level scenarios passed; 15 remain blocking or out of scope.**

| ID | Boundary | Status | Side effects | Final state | Limitation |
|---|---|---|---:|---|---|
| FI-01 | process termination after lease | PASS | 1 | completed | - |
| FI-02 | termination before step | PASS | 1 | completed | - |
| FI-03 | termination after receipt persisted | PASS | 0 | needs_reconciliation | - |
| FI-04 | termination after side effect and completed receipt | PASS | 1 | completed | - |
| FI-05 | termination after checkpoint | PASS | 1 | completed | - |
| FI-06 | termination before final commit | PASS | 1 | completed | - |
| FI-07 | unknown result after external effect | PASS | 1 | needs_reconciliation | - |
| FI-08 | approval wait and application restart | PASS | 1 | completed | - |
| FI-09 | stale browser approval | PASS | 0 | rejected | - |
| FI-10 | approval expiry | PASS | 0 | expired | - |
| FI-11 | database lock across native SQLite processes | BLOCK | unknown | unproven | Requires isolated native CI lane. |
| FI-12 | outbox delay and duplicate publisher delivery | BLOCK | unknown | unproven | Transactional outbox exists; multi-process delivery proof requires native CI. |
| FI-13 | model timeout during live provider call | BLOCK | unknown | unproven | Pilot excludes remote live providers until restart-safe model intents exist. |
| FI-14 | malformed live model output | BLOCK | unknown | unproven | Simulation schema tests exist; live provider E2E is unsupported by pilot. |
| FI-15 | network loss during provider call | BLOCK | unknown | unproven | Remote provider operation is outside frozen pilot scope. |
| FI-16 | filesystem write denial | BLOCK | unknown | unproven | Needs disposable OS-level fault lane. |
| FI-17 | disk full during artifact write | BLOCK | unknown | unproven | Needs disposable filesystem quota lane. |
| FI-18 | backup interruption | BLOCK | unknown | unproven | Needs child-process termination around real application database backup. |
| FI-19 | restore interruption | BLOCK | unknown | unproven | Needs clean disposable target and process termination. |
| FI-20 | multi-process stale worker commit | BLOCK | unknown | unproven | Fencing is unit-tested; real SQLite process race remains CI-only. |
| FI-21 | tenant switch through browser | BLOCK | unknown | unproven | Backend property tests pass; browser E2E remains CI-only. |
| FI-22 | verifier evidence mismatch against final ZIP | BLOCK | unknown | unproven | Executed only after final archive hash exists. |
| FI-23 | browser offline transition | BLOCK | unknown | unproven | Requires Playwright validation lane. |
| FI-24 | accessibility failure state | BLOCK | unknown | unproven | Requires browser accessibility lane. |
| FI-25 | production restart with pending approval | BLOCK | unknown | unproven | Pure and route-level continuation is implemented; native process proof remains CI-only. |
