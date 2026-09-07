# ECOS AI Protocol v266

This document specifies the AI Protocol for ECOS Canonical Version 266, detailing the module contracts, API endpoints, and invariants. Version 266 introduces significant enhancements through Dependency Injection (DI), allowing for greater modularity and integration with external services.

## Core Principles of V266

1.  **Modularity via Dependency Injection**: Core functionalities are now designed to accept external providers for specific operations (e.g., settlement, custody, persistence). This promotes a plug-and-play architecture, enabling easier customization and integration.
2.  **Backward Compatibility**: All V266 modules and APIs are designed to be backward compatible with V265 and V264, ensuring a smooth upgrade path.
3.  **Enhanced Testability**: The DI approach facilitates easier mocking and testing of individual components, leading to more robust and reliable code.
4.  **Clear Contracts**: Each module explicitly defines its expected dependencies and the interfaces they must adhere to.

## Module Contracts and Dependencies

| Module | Class / Surface | Canonical Responsibility | Adapter Injection Points |
|---|---|---|---|
| x402 | `X402Processor266`, `x402Middleware266` | Facilitator-aware x402 payment verification, replay protection, HMAC test-mode signing, and middleware propagation. | `settlementProvider` (for actual payment settlement) |
| MCP | `MCPDeepIntegration266` | Registers MCP servers and tools, enforces risk controls, supports dry-run calls, and integrates with receipt chains. | `mcpServerRegistry`, `toolExecutor` |
| Embedded wallet | `EmbeddedWallet266` | Creates and resolves email, Telegram, and external identity wallets with risk states and compact mobile payloads. | `custodyProvider` (for secure key management/storage) |
| USSD/SMS | `UssdSmsStateMachine266` | Provides a degraded-path session state machine with retry, timeout, resume, and numeric menu handling. | `smsGateway`, `ussdGateway`, `sessionStore` |
| Audit Bloom | `AuditBloom266` | Provides fast Bloom-style membership checks for audit-chain keys and exact membership snapshots. | `persistenceAdapter` (for Bloom filter state) |
| Onboarding | `OnboardingFlow266` | Supports fast-path onboarding, state persistence hooks, embedded wallet creation, funnel analytics, and drop-off tracking. | `cryptoWordsFilter` (for content moderation) |
| Splits | `SplitModule266` | Enforces vesting minimums, supports cliff checks, tracks anti-dump flags, and preserves 40/40/20 realized-value semantics. | `antiDumpProvider`, `vestingProvider` |
| Programs | `ExecutionProgramRegistry266` | Maintains the 25-program roadmap and program lifecycle, including P15/P16/P18/P21/P24. | (No new adapter injection points in V266) |

## API Endpoints (via `ecos-api-server-v266-patch.js`)

The `ecos-api-server-v266-patch.js` file registers the following API endpoints, leveraging the dependency-injected modules:

-   `/api/v266/health`: Health check for V266 modules.
-   `/api/v266/programs`: Program dashboard and program management.
-   `/api/v266/x402/required`: Generates X402 payment descriptors.
-   `/api/v266/x402/paid`: Processes X402 payments.
-   `/api/v266/mcp/servers`: Registers MCP servers.
-   `/api/v266/mcp/tools`: Registers MCP tools.
-   `/api/v266/mcp/call/:toolId`: Calls an MCP tool.
-   `/api/v266/wallets`: Creates embedded wallets.
-   `/api/v266/wallets/:userId`: Resolves wallet for a user.
-   `/api/v266/wallets/:userId/risk`: Marks wallet with a risk flag.
-   `/api/v266/ussd/start`: Starts a USSD session.
-   `/api/v266/ussd/input`: Handles USSD input.
-   `/api/v266/ussd/:userId`: Retrieves USSD session state.
-   `/api/v266/onboarding/start`: Starts an onboarding flow.
-   `/api/v266/onboarding/:userId/step/:stepId`: Completes an onboarding step.
-   `/api/v266/onboarding/:userId`: Retrieves onboarding flow state.
-   `/api/v266/onboarding-funnel`: Retrieves onboarding funnel analytics.
-   `/api/v266/audit-bloom/add`: Adds an event to the audit Bloom filter.
-   `/api/v266/audit-bloom/has`: Checks for event membership in the audit Bloom filter.
-   `/api/v266/audit-bloom/stats`: Retrieves statistics for the audit Bloom filter.
-   `/api/v266/splits`: Creates a split.
-   `/api/v266/splits/:splitId/distribute`: Distributes funds through a split.
-   `/api/v266/splits/:splitId/vesting`: Retrieves vesting status and anti-dump events for a split.

## Invariants

-   **Immutable Core Logic**: The core business logic within each module remains stable, with external integrations handled via injected dependencies.
-   **Secure Defaults**: If no external provider is injected, modules fall back to secure, in-memory, or stub implementations.
-   **Consistent API Contracts**: Public API endpoints and module interfaces maintain consistency across versions, ensuring predictable behavior.
-   **Test Coverage**: Comprehensive test suites (V264, V265, V266) ensure that all changes are validated and backward compatibility is preserved.

This protocol serves as a guide for developers integrating with or extending the ECOS V266 canonical system, emphasizing the new modularity and extensibility features.
