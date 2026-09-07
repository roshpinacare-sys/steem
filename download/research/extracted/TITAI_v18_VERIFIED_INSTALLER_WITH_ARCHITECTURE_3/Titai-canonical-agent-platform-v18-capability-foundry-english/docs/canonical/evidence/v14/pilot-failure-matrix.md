# v14 Pilot Failure-Injection Matrix

v14 combines deterministic fault injection with real node:sqlite multi-process, approval, outbox, lock, backup, restore and network-failure proofs. Browser and destructive filesystem conditions remain explicitly blocked.

Result: **21/25 passed; 4 remain blocking.**

| ID | Boundary | Status | Evidence | Final state | Limitation |
|---|---|---|---|---|---|
| FI-01 | process termination after lease | PASS | v13 deterministic durability proof retained and re-run by regression suite | completed | - |
| FI-02 | termination before step | PASS | v13 deterministic durability proof retained and re-run by regression suite | completed | - |
| FI-03 | termination after receipt persisted | PASS | v13 deterministic durability proof retained and re-run by regression suite | needs_reconciliation | - |
| FI-04 | termination after side effect and completed receipt | PASS | v13 deterministic durability proof retained and re-run by regression suite | completed | - |
| FI-05 | termination after checkpoint | PASS | v13 deterministic durability proof retained and re-run by regression suite | completed | - |
| FI-06 | termination before final commit | PASS | v13 deterministic durability proof retained and re-run by regression suite | completed | - |
| FI-07 | unknown result after external effect | PASS | v13 deterministic durability proof retained and re-run by regression suite | needs_reconciliation | - |
| FI-08 | approval wait and application restart | PASS | v13 deterministic durability proof retained and re-run by regression suite | completed | - |
| FI-09 | stale browser approval | PASS | v13 deterministic durability proof retained and re-run by regression suite | rejected | - |
| FI-10 | approval expiry | PASS | v13 deterministic durability proof retained and re-run by regression suite | expired | - |
| FI-11 | database lock across independent SQLite processes | PASS | database-lock-proof.json | both committed after bounded wait | - |
| FI-12 | outbox delay and duplicate publisher delivery | PASS | multiprocess-outbox-proof.json | published once | - |
| FI-13 | model/tool timeout contract | PASS | bounded runtime timeout execution | tool_timeout:5 | - |
| FI-14 | malformed or cyclic model plan | PASS | execution-plan schema and cycle guard | rejected | - |
| FI-15 | network loss during provider call | PASS | gateway converts network failure into explicit result | failed_closed | - |
| FI-16 | filesystem write denial | PASS | OS denial observed without host policy changes | denied | - |
| FI-17 | disk-full artifact write | PASS | disk-full-proof.json | SQLITE_FULL with atomic rollback | - |
| FI-18 | backup tamper or credential failure | PASS | clean-restore-proof.json plus application-backup regression suite | bad backup rejected; valid snapshot restored | - |
| FI-19 | process interruption during restore commit | PASS | application-backup fault injection after target displacement | original target restored atomically | - |
| FI-20 | multi-process stale worker commit | PASS | multiprocess-lease-proof.json | stale token rejected; current token committed | - |
| FI-21 | tenant switch through user interface | BLOCK | backend tenant property tests pass; browser navigation is policy-blocked | browser_unproven | Managed Chromium URLBlocklist blocks localhost before navigation. |
| FI-22 | verifier evidence mismatch against final ZIP | BLOCK | must be executed only after final archive hash exists | pending_final_hash | Final verifier runs after archive freeze. |
| FI-23 | browser offline transition | BLOCK | browser executable is managed by URLBlocklist | environment_blocked | Requires disposable browser lane without managed URL block policy. |
| FI-24 | accessibility failure and responsive states | BLOCK | source accessibility contracts pass; browser semantics unexecuted | environment_blocked | Requires an unblocked browser engine. |
| FI-25 | production-style process restart with pending approval | PASS | approval-restart-process-proof.json | one resolver won and durable continuation remained resumable | - |
