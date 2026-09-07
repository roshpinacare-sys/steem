# NEXT SESSION PROMPT — ECOS V265 Canonical

You are continuing from ECOS V265 canonical. Start by reading `AI_PROTOCOL_V265.md`, `CHANGELOG_V265.md`, and `tests/v265.test.cjs`.

## Current State

V265 has been implemented as an additive upgrade over V264. V264 remains intact and the combined test command passes.

```bash
npm test
```

Expected result:

| Suite | Result |
|---|---:|
| V264 | 91 passed, 0 failed |
| V265 | 11 passed, 0 failed |

## Important Files

| File | Purpose |
|---|---|
| `src/lib/x402265.js` | Facilitator-aware x402 payment rail. |
| `src/lib/mcpDeepIntegration265.js` | MCP deep integration registry and risk-gated tool calling. |
| `src/lib/embeddedWallet265.js` | Embedded wallet abstraction. |
| `src/lib/ussdSmsStateMachine265.js` | Degraded-path USSD/SMS state machine. |
| `src/lib/auditBloom265.js` | Bloom-style audit membership index. |
| `src/lib/onboardingFlow265.js` | Onboarding funnel, persistence hooks, embedded-wallet bridge. |
| `src/lib/splitModule265.js` | Vesting cliff and anti-dump controls. |
| `src/lib/executionPrograms265.js` | 25-program registry including P15/P16/P18/P21/P24. |
| `ecos-api-server-v265-patch.js` | Additive V265 API route patch. |
| `tests/v265.test.cjs` | V265 canonical regression suite. |

Matching copies exist under `lib/` for distribution compatibility.

## Next Recommended Work

The next meaningful implementation steps should focus on production adapters rather than more local mocks. In particular, connect real provider adapters for x402 settlement, wallet custody, MCP servers, SMS/USSD gateways, and persistent storage. Each adapter should be injected through constructor options rather than hard-coded into the canonical modules.

## Do Not Break

Do not remove V264 modules or change V264 test expectations. Any V266 work should follow the same additive versioning convention and should start by preserving the current `npm test` result.
