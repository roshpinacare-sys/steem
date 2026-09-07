# ECOS AI Protocol — V265 Canonical

## Purpose

This document defines the canonical V265 operating surface for ECOS. V265 is an additive upgrade over V264 and must preserve existing V264 contracts while exposing improved primitives for payments, agent tooling, mobile onboarding, degraded connectivity, and economic safety.

## Versioning Rule

All new public V265 functions, classes, constants, tests, and endpoints use the `265` suffix or `/api/v265/` namespace. V264 modules remain present for regression compatibility.

| Rule | Requirement |
|---|---|
| Backward compatibility | V264 tests must continue to pass unchanged. |
| Dependency policy | V265 modules add no new npm dependencies. |
| Public suffix | New public identifiers should end in `265`. |
| Realized value | 40/40/20 and sub-splits operate only on realized value backed by reserve assertions when available. |
| Crypto-free UX | Onboarding copy must avoid explicit crypto terminology unless the user is in an advanced/operator context. |

## Canonical V265 Modules

| Module | Class / Surface | Canonical Responsibility |
|---|---|---|
| x402 | `X402Processor265`, `parseX402Header265`, `buildPaymentRequired265`, `x402Middleware265` | Facilitator-aware x402 payment verification, replay protection, HMAC test-mode signing, and middleware propagation. |
| MCP | `MCPDeepIntegration265` | Registers MCP servers and tools, enforces risk controls, supports dry-run calls, and integrates with receipt chains. |
| Embedded wallet | `EmbeddedWallet265` | Creates and resolves email, Telegram, and external identity wallets with risk states and compact mobile payloads. |
| USSD/SMS | `UssdSmsStateMachine265` | Provides a degraded-path session state machine with retry, timeout, resume, and numeric menu handling. |
| Audit Bloom | `AuditBloom265` | Provides fast Bloom-style membership checks for audit-chain keys and exact membership snapshots. |
| Onboarding | `OnboardingFlow265` | Supports fast-path onboarding, state persistence hooks, embedded wallet creation, funnel analytics, and drop-off tracking. |
| Splits | `SplitModule265` | Enforces vesting minimums, supports cliff checks, tracks anti-dump flags, and preserves 40/40/20 realized-value semantics. |
| Programs | `ExecutionProgramRegistry265` | Maintains the 25-program roadmap and program lifecycle, including P15/P16/P18/P21/P24. |

## API Patch

`ecos-api-server-v265-patch.js` exports:

```js
const { registerEcosV265Routes, createV265State } = require('./ecos-api-server-v265-patch');
```

The route registration is additive and expects an Express-like app object. The patch exposes the following V265 route families.

| Route Family | Purpose |
|---|---|
| `/api/v265/health` | Module availability and version health. |
| `/api/v265/programs` | Program dashboard and program start operations. |
| `/api/v265/x402/*` | Payment-required descriptor and paid endpoint middleware sample. |
| `/api/v265/mcp/*` | MCP server/tool registration, listing, and safe tool calls. |
| `/api/v265/wallets/*` | Embedded wallet creation, resolution, and risk updates. |
| `/api/v265/ussd/*` | USSD/SMS session start, input, and state retrieval. |
| `/api/v265/onboarding/*` | Onboarding start, step completion, individual flow, and funnel analytics. |
| `/api/v265/audit-bloom/*` | Audit membership indexing, lookup, and stats. |
| `/api/v265/splits/*` | Split creation, distribution, vesting status, and anti-dump events. |

## Economic and Safety Invariants

V265 preserves ECOS economic safety by retaining realized-value checks in split distribution and by adding anti-dump review flags for withdrawal and transfer events. Cliff checks are surfaced both in vesting status and in distribution-time review decisions. Operators may set `blockOnDumpRisk` to convert anti-dump flags into hard blocks.

The MCP module treats unsafe or dangerous tool calls as human-in-the-loop actions by default. Dry-run mode allows safe previews without performing external side effects. Production adapters should pass explicit handlers and permission policies through constructor options.

## Testing Canon

The canonical validation command is:

```bash
npm test
```

The expected V265 canonical result is:

| Suite | Expected |
|---|---:|
| `npm run test:v264` | 91 passed, 0 failed |
| `npm run test:v265` | 11 passed, 0 failed |
