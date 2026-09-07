# ECOS Canonical v266 Changelog

This document outlines the key changes and improvements introduced in ECOS Canonical Version 266.

## Summary of Changes

Version 266 focuses on enhancing modularity and extensibility through **Dependency Injection (DI)** for core modules. This allows for greater flexibility in integrating external services and custom implementations without modifying core logic. The primary areas of enhancement include:

- **X402 Processor**: Introduction of `settlementProvider` for external payment settlement.
- **Embedded Wallet**: Integration of `custodyProvider` for abstracting wallet creation and management.
- **MCP Deep Integration**: Support for external `mcpServerRegistry` and `toolExecutor` for flexible MCP operations.
- **USSD/SMS State Machine**: Dependency injection for `smsGateway`, `ussdGateway`, and `sessionStore`.
- **Audit Bloom**: External `persistenceAdapter` for managing Bloom filter state persistence.
- **Split Module**: Integration of `antiDumpProvider` and `vestingProvider` for externalizing anti-dump and vesting logic.

## Detailed Changes

### `src/lib/x402266.js`
- **Dependency Injection**: Added `settlementProvider` to the constructor, allowing external services to handle X402 payment settlements.

### `src/lib/embeddedWallet266.js`
- **Dependency Injection**: Added `custodyProvider` to the constructor, enabling external wallet creation (`createWallet`) and linking (`linkExternal`) mechanisms.

### `src/lib/mcpDeepIntegration266.js`
- **Dependency Injection**: Added `mcpServerRegistry` and `toolExecutor` to the constructor, providing hooks for custom server registration and tool execution logic.

### `src/lib/ussdSmsStateMachine266.js`
- **Dependency Injection**: Added `smsGateway`, `ussdGateway`, and `sessionStore` to the constructor, allowing for flexible integration with various SMS/USSD providers and session management systems.

### `src/lib/auditBloom266.js`
- **Dependency Injection**: Added `persistenceAdapter` to the constructor, enabling external storage and retrieval of the Bloom filter's state.

### `src/lib/splitModule266.js`
- **Dependency Injection**: Added `antiDumpProvider` and `vestingProvider` to the constructor. This externalizes the logic for evaluating dump risk and managing vesting schedules, respectively.

### `ecos-api-server-v266-patch.js`
- **API Integration**: Updated `createV266State` function to correctly inject the new providers into their respective modules, ensuring the API server utilizes the enhanced modularity.

### `tests/v266.test.cjs`
- **Expanded Test Coverage**: Added new test cases and updated existing ones to validate the correct functioning of dependency injection for all new providers across the affected modules. All V266 tests passed, along with V264 and V265 regression tests.

## Test Results

- **V264 Tests**: 91/91 Passed
- **V265 Tests**: 11/11 Passed
- **V266 Tests**: 11/11 Passed

**Total Tests Passed: 113**

This ensures full backward compatibility and robust functionality for the new V266 features.
