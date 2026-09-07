# TITAI v11 Evidence Index

| Task | Requirement | Key code | Tests | Raw evidence | Verification state |
|---|---|---|---|---|---|
| MOD-002 | Fail-closed measured model routing | `src/lib/models/router.ts`, `src/lib/models/db-routing.ts`, `src/app/api/models/route.ts` | `model-router`, `adversarial-state-space` | v11 test group C | Implemented; independent verifier pending |
| MEM-004 | Quarantine unsafe memory and label context as evidence | `src/lib/memory/prompt-context.ts`, `src/lib/engine/start.ts` | `memory-prompt-context` | v11 test group C | Implemented; independent verifier pending |
| TOL-003 | Enforce allowlists, runtime budgets, and artifact idempotency | `tool-capability.ts`, `tool-runtime.ts`, `runner.ts`, migration 0005 | `tool-capability`, `tool-runtime` | v11 test group C | Implemented; OS sandbox pending |
| UX-003 | Expose control provenance and operational debt | `run-dossier.tsx`, `control-room.tsx`, `globals.css` | TypeScript and source lint | Browser evidence unavailable | Implemented; browser/accessibility verification blocked |
| DUR-004 | Serializable one-decision approval contract | `approval-continuation.ts` | `approval-continuation` | v11 test group C | Primitive verified in pure tests; not integrated |
| DUR-002 | Controlled durable cutover | `runner-mode.ts`, `runner.ts`, `src/lib/durable` | durable tests and crash proof | durable vertical-slice JSON | Partial; active granular resume unverified |

## Release-bound evidence

The final release manifest binds each included file to SHA-256. The build remains blocked, native suites collect zero tests, and the release is classified DEVELOPMENT ONLY.
