# ECOS Canonical Changelog — V265

## Executive Summary

ECOS V265 is an additive canonical upgrade over V264. It preserves V264 behavior and test compatibility while adding a dedicated V265 layer for **x402 facilitator payment flows**, **MCP deep integration**, **embedded wallets**, **USSD/SMS degraded access**, **audit-chain Bloom-style lookup**, **onboarding funnel analytics**, and **vesting/anti-dump controls**.

The implementation follows the project’s established convention that versioned public identifiers end with the active version suffix. Therefore, new public classes, constants, functions, endpoints, and test names use the `265` suffix where appropriate, while V264 files remain available for backward compatibility.

## Major Additions

| Area | V265 Addition | Files |
|---|---|---|
| Payment rails | Facilitator-aware x402 parsing, descriptor generation, HMAC canonical signing, receipt metadata, and middleware propagation | `src/lib/x402265.js`, `lib/x402265.js` |
| MCP | Server/tool registry, risk-aware tool calls, dry-run execution, permission checks, and AP2 receipt linking hooks | `src/lib/mcpDeepIntegration265.js`, `lib/mcpDeepIntegration265.js` |
| Wallets | Embedded-wallet abstraction for email, Telegram, and external identity paths with risk states and mobile compact payloads | `src/lib/embeddedWallet265.js`, `lib/embeddedWallet265.js` |
| USSD/SMS | Stateful degraded-path machine with retries, timeout, resume support, compact state, and numeric task handling | `src/lib/ussdSmsStateMachine265.js`, `lib/ussdSmsStateMachine265.js` |
| Audit | Bloom-style event membership index with exact-key support and exportable snapshot | `src/lib/auditBloom265.js`, `lib/auditBloom265.js` |
| Onboarding | Funnel analytics, drop-off tracking, state export/import, embedded-wallet bridge, and persistence adapter hooks | `src/lib/onboardingFlow265.js`, `lib/onboardingFlow265.js` |
| Splits | Cliff-aware vesting status, anti-dump event log, withdrawal/transfer review flags, and optional blocking mode | `src/lib/splitModule265.js`, `lib/splitModule265.js` |
| Programs | V265 registry retains 25 canonical programs including P15, P16, P18, P21, and P24 | `src/lib/executionPrograms265.js`, `lib/executionPrograms265.js` |
| API | Additive V265 API patch exposing the new module surfaces without removing V264 endpoints | `ecos-api-server-v265-patch.js` |
| Tests | Dedicated V265 regression suite plus package script integration | `tests/v265.test.cjs`, `package.json` |

## Compatibility Results

The combined test run was executed with `npm test` in the canonical project directory.

| Suite | Result |
|---|---:|
| V264 regression suite | 91 passed, 0 failed |
| V265 regression suite | 11 passed, 0 failed |
| Combined total | 102 passed, 0 failed |

## V265 Notes

The new V265 layer is intentionally **zero-new-dependency** and uses only Node.js built-in modules. This keeps the canonical zip portable and consistent with the style of V264.

The V265 API patch can be imported independently using:

```js
const { registerEcosV265Routes, createV265State } = require('./ecos-api-server-v265-patch');
```

The patch expects an Express-like application object with `get` and `post` methods. It returns a shared V265 module state so deployments can inspect or inject dependencies.

## Known Operational Boundaries

V265 includes abstractions for embedded wallets, MCP tool calls, and facilitator-based x402 flows, but it does not hard-code any third-party provider credentials. Production integrations should provide adapters through constructor options or API patch dependencies.
