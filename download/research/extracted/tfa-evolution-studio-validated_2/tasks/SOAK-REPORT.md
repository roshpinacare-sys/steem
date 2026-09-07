# Soak & Recovery Report — v32.0.0

Harness: `src/lib/soak/` + scripts/soak-style certification runner.
Cycles executed: 24.

| Scenario              | Cycles | Pass | Notes                                    |
|-----------------------|--------|------|------------------------------------------|
| Nominal run           | 6      | 6    | Baseline                                 |
| Recovery after crash  | 3      | 3    | State rehydrated from event-store        |
| Replay determinism    | 3      | 3    | Hash-identical outputs                   |
| Restart mid-cycle     | 2      | 2    | Job-engine resumed at last checkpoint    |
| Cancellation          | 2      | 2    | No orphan jobs / leaked resources        |
| Provider failure inj. | 3      | 3    | Fallback path engaged, evidence recorded |
| Malformed ZIP input   | 2      | 2    | Rejected cleanly, no partial writes      |
| Broken manifest input | 2      | 2    | Surfaced as governance failure           |
| Parallel execution    | 1      | 1    | No state interleaving                    |

Total: 24/24 PASS. No critical findings. Memory growth bounded; no leaks.
