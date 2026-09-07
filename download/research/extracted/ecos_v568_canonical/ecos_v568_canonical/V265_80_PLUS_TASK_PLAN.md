# ECOS V265 — 80+ Task Plan Ordered by Criticality

## Critical Tier 0 — Protocol and Invariant Safety

| ID | Task | Area | Priority |
|---|---|---|---|
| V265-T001 | Preserve sacred-file rule and do not modify `lib/fiatLedger.js` or `lib/auditLog.js`. | Safety | Critical |
| V265-T002 | Update package version from `264.0.0` to `265.0.0`. | Release | Critical |
| V265-T003 | Keep all V264 endpoints and modules intact; add V265 additively. | API compatibility | Critical |
| V265-T004 | Ensure all new exported identifiers end with `265`. | Version discipline | Critical |
| V265-T005 | Keep zero new npm dependencies and rely only on Node built-ins. | Supply chain | Critical |
| V265-T006 | Keep all monetary amounts as `BigInt` micro-cents. | Accounting | Critical |
| V265-T007 | Keep `TRADABLE_TOKEN_ENABLED=false`. | Governance | Critical |
| V265-T008 | Enforce realized-value assertion before primary splits. | Economy | Critical |
| V265-T009 | Maintain 40/40/20 split semantics only on backed realized value. | Economy | Critical |
| V265-T010 | Mirror all new `src/lib/*265.js` files to `lib/*265.js`. | Packaging | Critical |

## Critical Tier 1 — Explicit V265 Checklist Items

| ID | Task | Area | Priority |
|---|---|---|---|
| V265-T011 | Add `facilitator` to x402 payment parsing, canonical signing, receipts, and descriptors. | x402 | Critical |
| V265-T012 | Preserve backward compatibility for V264-style x402 payloads without facilitator. | x402 | Critical |
| V265-T013 | Add audit-chain Bloom-style lookup index for fast event membership tests. | P07 Audit | Critical |
| V265-T014 | Implement deep MCP server registry and tool execution layer. | P15 MCP | Critical |
| V265-T015 | Link MCP tool calls to AP2 receipts and execution programs. | P15 MCP | Critical |
| V265-T016 | Add embedded wallet abstraction for email, Telegram, and external wallet identities. | P16 Wallet | Critical |
| V265-T017 | Add wallet risk states and no-crypto-word safe display payloads. | P16 Wallet | High |
| V265-T018 | Replace simple USSD prompt helper with a deterministic USSD/SMS state machine. | P18 USSD/SMS | Critical |
| V265-T019 | Add USSD/SMS session timeout, retry, cancel, and resume semantics. | P18 USSD/SMS | High |
| V265-T020 | Add onboarding snapshot export/import for restart-safe session persistence. | Onboarding | Critical |
| V265-T021 | Add onboarding funnel analytics for step conversion, channel conversion, and time-to-complete. | P24 Funnel | Critical |
| V265-T022 | Add cliff validation at split creation and at distribution time. | P21 Vesting | Critical |
| V265-T023 | Add anti-dump velocity-sensitive vesting acceleration detection. | P21 Vesting | Critical |
| V265-T024 | Add vesting unlock forecast and compact mobile vesting status. | P21 Vesting | High |

## High Tier 2 — API Surface and Integration

| ID | Task | Area | Priority |
|---|---|---|---|
| V265-T025 | Create `ecos-api-server-v265-patch.js` as an additive route patch. | API | High |
| V265-T026 | Add `/api/v1/x402/v265/*` endpoints. | API | High |
| V265-T027 | Add `/api/v1/audit/v265/bloom/*` endpoints. | API | High |
| V265-T028 | Add `/api/v1/mcp/v265/*` endpoints. | API | High |
| V265-T029 | Add `/api/v1/wallet/v265/*` endpoints. | API | High |
| V265-T030 | Add `/api/v1/onboarding/v265/*` funnel and snapshot endpoints. | API | High |
| V265-T031 | Add `/api/v1/ussd/v265/*` endpoints. | API | High |
| V265-T032 | Add `/api/v1/collab/v265/*` anti-dump and vesting endpoints. | API | High |
| V265-T033 | Add `/api/v1/version/v265` endpoint with module inventory. | API | High |
| V265-T034 | Keep server patch usable as `require('./ecos-api-server-v265-patch')`. | API | High |
| V265-T035 | Include V265 metrics in a V265 metrics endpoint. | Observability | High |
| V265-T036 | Return JSON-safe strings for all BigInt values. | API safety | High |

## High Tier 3 — Tests and Regression Protection

| ID | Task | Area | Priority |
|---|---|---|---|
| V265-T037 | Create `tests/v265.test.cjs`. | Tests | High |
| V265-T038 | Port V264 test coverage to V265 identifiers where useful. | Tests | High |
| V265-T039 | Test x402 facilitator parsing and HMAC canonicalization. | Tests | High |
| V265-T040 | Test x402 replay protection remains intact. | Tests | High |
| V265-T041 | Test Bloom index add/query/false-negative behavior. | Tests | High |
| V265-T042 | Test MCP server registration, tool registration, and tool invocation. | Tests | High |
| V265-T043 | Test MCP receipt emission and audit summary. | Tests | High |
| V265-T044 | Test embedded wallet create/link/resolve flows. | Tests | High |
| V265-T045 | Test USSD state transitions and invalid input handling. | Tests | High |
| V265-T046 | Test onboarding snapshot export/import. | Tests | High |
| V265-T047 | Test funnel analytics conversion counters. | Tests | High |
| V265-T048 | Test cliff enforcement and anti-dump detection. | Tests | High |
| V265-T049 | Test V265 module mirrors are byte-identical. | Tests | High |
| V265-T050 | Run baseline V264 tests after V265 work to ensure no regression. | Tests | High |

## Medium Tier 4 — Documentation and Canonical Packaging

| ID | Task | Area | Priority |
|---|---|---|---|
| V265-T051 | Create `AI_PROTOCOL_V265.md`. | Docs | Medium |
| V265-T052 | Create `CHANGELOG_V265.md`. | Docs | Medium |
| V265-T053 | Create `IMPLEMENTATION_REPORT_V265.md`. | Docs | Medium |
| V265-T054 | Create `NEXT_SESSION_PROMPT_V265.md`. | Docs | Medium |
| V265-T055 | Update `README.md` with V265 canonical status. | Docs | Medium |
| V265-T056 | Document V265 API groups and endpoints. | Docs | Medium |
| V265-T057 | Document migration notes from V264 to V265. | Docs | Medium |
| V265-T058 | Document no-new-dependency compliance. | Docs | Medium |
| V265-T059 | Document test results and known limitations. | Docs | Medium |
| V265-T060 | Package as `ecos_v265_canonical.zip`. | Release | Medium |

## Medium Tier 5 — Quality Improvements Beyond the Checklist

| ID | Task | Area | Priority |
|---|---|---|---|
| V265-T061 | Add helper validation functions for safe integer/BigInt parsing. | Robustness | Medium |
| V265-T062 | Add safer compact mobile projections for V265 wallet/onboarding states. | UX | Medium |
| V265-T063 | Add deterministic IDs with versioned prefixes. | Traceability | Medium |
| V265-T064 | Add audit summaries to newly created modules. | Auditability | Medium |
| V265-T065 | Add snapshot import validation and version checking. | Persistence | Medium |
| V265-T066 | Add funnel drop-off report ordered by worst step. | Analytics | Medium |
| V265-T067 | Add per-channel funnel analytics. | Analytics | Medium |
| V265-T068 | Add USSD transcript event history. | UX | Medium |
| V265-T069 | Add MCP tool permission risk levels. | Security | Medium |
| V265-T070 | Add MCP dry-run mode. | Safety | Medium |
| V265-T071 | Add wallet provider health/status summary. | Wallet | Medium |
| V265-T072 | Add anti-dump event history. | Economy | Medium |
| V265-T073 | Add vesting risk score tiers. | Economy | Medium |
| V265-T074 | Add versioned stats methods for all new modules. | Observability | Medium |
| V265-T075 | Add endpoint-level graceful errors rather than uncaught exceptions. | API | Medium |

## Lower Tier 6 — Deferred but Noted for Future Versions

| ID | Task | Area | Priority |
|---|---|---|---|
| V265-T076 | Wire a real external MCP transport when dependencies/governance allow it. | P15 MCP | Deferred |
| V265-T077 | Wire real Privy/Zora providers when dependency policy allows SDKs. | P16 Wallet | Deferred |
| V265-T078 | Add Ed25519/CDP production verification when dependency policy changes. | x402 | Deferred |
| V265-T079 | Calibrate metacognition decay against production data. | P05 | Deferred |
| V265-T080 | Add verified contribution proofs to full CLR matching. | P20 | Deferred |
| V265-T081 | Add DB-backed onboarding storage when deployment DB is selected. | Persistence | Deferred |
| V265-T082 | Add real sandbox execution provider to reflection loop. | P05 | Deferred |
| V265-T083 | Add production-grade Bloom sizing based on observed audit volume. | P07 Audit | Deferred |
| V265-T084 | Add openAPI V265 schema expansion. | Docs/API | Deferred |
| V265-T085 | Add frontend dashboards for V265 MCP/wallet/funnel modules. | UX | Deferred |
