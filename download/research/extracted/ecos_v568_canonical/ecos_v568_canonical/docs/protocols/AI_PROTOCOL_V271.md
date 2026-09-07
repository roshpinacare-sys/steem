# AI Protocol — ECOS V271

**Version:** V271  
**Date:** 2026-06-01  
**Type:** Canonical Server Wiring + Consolidated Registry + Health  

## Agent Identity

You are working on ECOS — an AI-native economic operating system.  
This is version V271, the first additive release on top of the V270 consolidation.

## Project State

- **Trusted base:** V254 (architecture standard, naming conventions, test patterns)  
- **Integrated through:** V270 (all patches fully applied)  
- **V271 additions:** canonical patch chain wiring, consolidated provider registry (22 contracts), unified health dashboard, Bloom-Firewall cross-reference bridge, PostgreSQL persistence foundation (12 tables)

## Naming Conventions (from V254 standard)

- Each module version is a standalone file: `consolidatedProviderRegistry271.js` not `providerRegistry.js`
- Both `src/lib/<module><N>.js` AND `lib/<module><N>.js` must exist for every versioned lib
- Patch files: `ecos-api-server-v<N>-patch.js` at project root
- Tests: `tests/v<N>.test.cjs` (CommonJS)
- Changelogs: `CHANGELOG_V<N>.md` at project root + mirrored in `docs/changelogs/`
- Session prompts: `NEXT_SESSION_PROMPT_V<N>.md` at root + mirrored in `docs/sessions/`
- AI protocols: `AI_PROTOCOL_V<N>.md` at root + mirrored in `docs/protocols/`

## Sacred Files (never modify)

- `src/lib/fiatLedger.js` — hash `563e9b1f…`
- `src/lib/auditLog.js` — hash `e5a5c2c2…`

## Rules

- R1: Sacred files untouched  
- R2: All tests from prior versions must continue to pass  
- R3: New versioned modules go in BOTH `src/lib/` and `lib/`  
- R4: Every patch file must be self-contained (graceful fallbacks if deps unavailable)  
- R5: Version bumps propagate to `package.json`, `.agent-identity.json`, `MANIFEST.json`  
- R6: Zero new npm dependencies per release  
- R7: `node --check` must pass on all new JS files before release  

## Active Module Families (highest version)

| Family | Latest | Introduced |
|---|---|---|
| automationCatalog | 254 | V254 |
| automationRunner | 255 | V255 |
| automationScheduler | 257 | V256 |
| cronParser | 257 | V257 |
| creditReserve | 268 | V263 |
| breakageEngine | 268 | V263 |
| conversionGateway | 268 | V263 |
| reputationLedger | 268 | V263 |
| memoryIntegrity | 268 | V263 |
| metacognition | 268 | V263 |
| offlineQueue | 268 | V263 |
| onboardingFlow | 268 | V263 |
| quadraticFunding | 268 | V263 |
| reflectionLoop | 268 | V263 |
| splitModule | 268 | V263 |
| sybilGuard | 268 | V263 |
| telemetry | 268 | V263 |
| tipModule | 268 | V263 |
| injectionFirewall | 268 | V263 |
| costAwareRouter | 268 | V263 |
| agentReceipts | 268 | V263 |
| x402 | 268 | V264 |
| executionPrograms | 268 | V264 |
| embeddedWallet | 268 | V265 |
| mcpDeepIntegration | 268 | V265 |
| ussdSmsStateMachine | 268 | V265 |
| auditBloom | 268 | V265 |
| providerAdapters | 269 | V267 |
| postgresAuditBloomAdapter | 271 | V271 |
| consolidatedProviderRegistry | 271 | V271 |

## V271 New Endpoints

- `GET /api/v271/providers/registry` — 22 DI contracts + live validation
- `GET /api/v271/providers/contracts` — contract definitions
- `POST /api/v271/providers/validate` — ad-hoc validation
- `GET /api/v271/health/unified` — all modules getPerf268() aggregated
- `GET /api/v271/health/summary` — lightweight status check
- `GET /api/v271/admin/summary` — V271 feature summary
- `POST /api/v271/audit/bloom-firewall-check` — cross-reference check
- `GET /api/v271/audit/bloom-firewall-stats` — cross-reference stats

## Next Steps for V272

- Inject `CreditReserveRepo` (V271) into `CreditReserve268` factory for DB-backed persistence
- Inject `ReputationRepo` (V271) into `ReputationLedger268` factory for DB-backed persistence
- Wire `consolidatedProviderRegistry271` into V270 summary route
- Add partition-by-date to `reputation_events` for high-volume deployments
