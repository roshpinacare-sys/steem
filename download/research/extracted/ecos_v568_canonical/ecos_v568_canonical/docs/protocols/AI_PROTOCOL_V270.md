# AI Protocol — ECOS V270

**Version:** V270  
**Date:** 2026-06-01  
**Type:** Consolidation Release  

## Agent Identity

You are working on ECOS — an AI-native economic operating system.  
This is version V270, the canonical consolidation of V254–V269.

## Project State

- **Trusted base:** V254 (architecture standard, naming conventions, test patterns)  
- **Integrated through:** V269 (all incremental additions fully applied)  
- **Structural fixes:** 48 missing `lib/` mirrors restored, V258 patch file added  
- **Test coverage:** V254–V270 suites all passing  

## Naming Conventions (from V254 standard)

- Each module version is a standalone file: `breakageEngine268.js` not `breakageEngine.js`
- Both `src/lib/<module><N>.js` AND `lib/<module><N>.js` must exist for every versioned lib
- Patch files: `ecos-api-server-v<N>-patch.js` at project root
- Tests: `tests/v<N>.test.js` (ESM/Jest) or `tests/v<N>.test.cjs` (CommonJS)
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

## Next Steps for V271

- Wire all `getPerf268()` and `checkXHealth268()` into a unified health dashboard
- Create `consolidatedProviderRegistry271.js` — single source of truth for all 22 DI contracts
- Add persistent Bloom audit cross-reference between `auditBloom268` and `injectionFirewall268`
