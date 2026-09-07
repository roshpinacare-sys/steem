# @ecos/client — ECOS Developer SDK [V103]

Official JavaScript/TypeScript client for the **ECOS** (Economic Cognitive Operating System) API.

Zero external dependencies. Works in Node.js ≥ 18 with native `fetch`.

---

## Installation

```bash
# From the monorepo root (local path):
npm install ./sdk

# Once published to npm:
npm install @ecos/client
```

---

## Quick Start

```js
const { EcosClient } = require('@ecos/client');

const ecos = new EcosClient({
  baseUrl:       'http://localhost:3000',
  depositApiKey: process.env.ECOS_DEPOSIT_API_KEY,  // for /deposit
  validatorJwt:  process.env.VALIDATOR_JWT,          // for validator endpoints
});

// Submit a task through the confidence gate
const result = await ecos.submitTask({
  clientAccountId: 'client::acme-corp',
  priceUsd:        '2.50',
  rawConfidence:   0.85,
  aiOutput:        { result: 'Reviewed contract — no issues found.' },
  taskType:        'legal-review',
});
console.log(result.verdict); // 'AUTO_FLOW' | 'HITL_QUEUE' | 'BLOCK' | 'HARD_REJECT'

// Mission Status Dashboard (V103)
const dashboard = await ecos.getMissionDashboard();
console.log(`Total: ${dashboard.totalMissions}, Pending: ${dashboard.pending}, Chain intact: ${dashboard.chainIntact}`);

// Check audit chain integrity
const proof = await ecos.getChainProof();
console.log(`Chain length: ${proof.chainLength}, Intact: ${proof.intact}`);
```

---

## API Reference

### Constructor

```ts
new EcosClient({
  baseUrl:       string,         // required — ECOS server base URL
  depositApiKey?: string,        // Bearer token for /deposit endpoint
  validatorJwt?:  string,        // JWT for validator-protected endpoints
  timeoutMs?:     number,        // per-request timeout (default: 30000)
})
```

### Core Protocol

| Method | Description |
|--------|-------------|
| `submitTask(task)` | Submit a task through the ECOS confidence gate |
| `chat(params)` | Natural language chat — runs inference internally |

### Approvals

| Method | Description |
|--------|-------------|
| `listApprovals({ status?, limit? })` | List approvals (requires validatorJwt) |
| `resolveApproval(id, { validatorAccountId, decision, note? })` | Resolve a single approval |
| `bulkResolve(items)` | Resolve up to 50 approvals in one request |

### Missions (V103)

| Method | Description |
|--------|-------------|
| `getMission(missionId)` | Full mission detail with audit trail |
| `getMissionDashboard()` | Aggregated view — counts, avgConfidence, chainIntact, topClients |
| `searchMissions({ q?, status?, clientId?, limit?, cursor? })` | Full-text mission search with pagination |

### Finance

| Method | Description |
|--------|-------------|
| `deposit({ clientAccountId, amountUsd, idempotencyKey })` | Fund a client account (requires depositApiKey) |
| `payout({ validatorAccountId, amountUsd })` | Withdraw validator earnings to Stripe |
| `getBalance(accountId)` | Get account balance |
| `getEarnings(validatorId)` | Get validator royalty earnings |

### Trust Infrastructure

| Method | Description |
|--------|-------------|
| `getChainProof()` | External audit chain verifier — intact, hashes, length |
| `getAgentIdentity()` | Persistent agent UUID + source |

### Utility

| Method | Description |
|--------|-------------|
| `getCalibratorStatus()` | Confidence calibrator status |
| `healthCheck()` | Server health — version, uptime, DB status |

---

## Error Handling

All methods throw on non-2xx responses. The error object includes:
- `err.status` — HTTP status code
- `err.body` — parsed response body (includes `error` field from server)

```js
try {
  await ecos.deposit({ clientAccountId: 'client::x', amountUsd: '10.00', idempotencyKey: 'key-1' });
} catch (err) {
  console.error(err.status, err.body?.error);
}
```

---

## TypeScript

Full type definitions are included in `types.d.ts`. No `@types/` package needed.

```ts
import { EcosClient, MissionDashboard, ChainProof } from '@ecos/client';
```

---

## Protocol Invariants

The SDK never modifies `lib/fiatLedger.js` or `lib/auditLog.js` — these are Sacred Files held since V38. The economic model (40/40/20 validator/platform/insurance split) is enforced by the server and reflected faithfully in SDK responses.

---

*@ecos/client · V103 · 2026-05-28*
