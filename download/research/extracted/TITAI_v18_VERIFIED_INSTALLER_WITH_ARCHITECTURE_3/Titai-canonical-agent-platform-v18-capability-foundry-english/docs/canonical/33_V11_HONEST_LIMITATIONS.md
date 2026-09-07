# TITAI v11 Honest Limitations

## Verified in this environment

- English-only repository scan.
- Source lint and client/server boundary scan.
- TypeScript compilation.
- Six migration files and twelve required tables through the pure migration validator.
- Focused v11 adversarial tests.
- Static Roast checks except the known Drizzle dependency baseline.

## Implemented but not independently verified

- Model profile registry and explainable routing.
- Governed memory prompt integration.
- Tool capability broker, timeout, output ceiling, and artifact idempotency.
- Run dossier and operations signal plane.
- Durable feature modes and single-step envelope.
- Serializable approval continuation primitive.

## Partially implemented

- Durable cutover. The active runner is wrapped as one durable side effect; it cannot resume individual plan steps.
- Approval continuation. The state contract is tested but not persisted and attached to active runner resume.
- Model evaluation. Profiles can store measurements, but no full benchmark campaign populated them.
- Tenant isolation. User ownership is enforced in many paths, but there is no complete tenant/workspace/service-identity model.

## Environment blocked

- `better-sqlite3` native tests because the binary binding was intentionally not built or downloaded.
- Full Next.js page-data build phase for the same native binding.
- Playwright browser tests and screenshot regression.
- External accessibility automation and real load tests.

## Production blockers

- Granular durable resume and restart-safe approval continuation.
- Native migration, concurrency, and race tests.
- Browser E2E and accessibility gates.
- Security dependency upgrade verification for Drizzle.
- Independent verifier execution bound to the final archive hash.

Release classification: **DEVELOPMENT ONLY**.
