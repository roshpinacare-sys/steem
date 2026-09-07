# @tfa/escrow-client

Standalone, zero-dependency client for **TFA Sovereign Escrow** — completion-contingent
payments for the coordination economy. Funding moves payer→escrow; completion moves
escrow→worker; cancellation refunds escrow→payer. Either party can freeze a funded
escrow (dispute) without moving money.

## Why
When two parties (a requester and an AI agent / worker) agree on paid work, neither wants
to pay upfront or work for free. Escrow holds the funds in a dedicated ledger account until
the work is confirmed — verifiable by both sides via the TFA API.

## Install
Drop `index.mjs` + `index.d.ts` into your project (Node 22+). No dependencies — uses the
built-in `fetch`.

## Usage
```js
import {
  createEscrow, fetchEscrow, fundEscrow, releaseEscrow, refundEscrow,
  disputeEscrow, undisputeEscrow, EscrowClientError,
} from "@tfa/escrow-client";

const base = "https://api.example.com";
const tenant = "acme";
const opts = { apiKey: process.env.TFA_API_KEY };

// 1. Create the agreement (no money moves yet)
const { agreement } = await createEscrow(base, tenant, {
  opportunityId: "opp-123",
  payerAccountId: "acct-payer",
  workerAccountId: "acct-worker",
  amount: 500_00n, // μ¢ — $5.00
}, opts);

// 2. Fund it: payer → escrow
await fundEscrow(base, agreement.id, tenant, { ...opts, initiatedBy: "acct-payer" });

// 3. On completion, release: escrow → worker
const { agreement: released } = await releaseEscrow(base, agreement.id, tenant, opts);
console.log(released.state); // "released"
```

### Dispute path
```js
// Either party can freeze a funded escrow — no money moves.
await disputeEscrow(base, agreement.id, tenant, { ...opts, reason: "work not delivered" });

// Only the funder can unfreeze back to "funded".
await undisputeEscrow(base, agreement.id, tenant, { ...opts, initiatedBy: "acct-payer" });

// Then either release or refund as normal.
await refundEscrow(base, agreement.id, tenant, opts);
```

## Error handling
All calls throw `EscrowClientError` (never resolve with a partial/invalid result) on
network failure, timeout, or a non-success HTTP status. Check `err.code`:

| code | meaning |
| --- | --- |
| `missing_base_url` / `missing_tenant_id` / `missing_escrow_id` / `missing_body_field` | invalid call — fix your code |
| `not_found` | unknown escrow id, or cross-tenant (isolation preserved — never leaks data) |
| `conflict` | wrong state (e.g. release before fund) |
| `unauthorized` | missing/invalid API key, or action not permitted (e.g. undispute by non-funder) |
| `network_error` / `timeout` | transport failure — safe to retry |
| `server_error` / `invalid_response` | unexpected server response |

```js
try {
  await fundEscrow(base, "unknown-id", tenant, opts);
} catch (e) {
  if (e instanceof EscrowClientError && e.code === "not_found") {
    // handle missing escrow
  }
}
```

## Amounts
All money values are **μ¢ (micro-cents)** as `bigint`. The server serializes amounts as
decimal strings; this client revives `agreement.amount` (and other money fields) back to
`bigint` automatically. Pass `amount` to `createEscrow` as `bigint`, `string`, or `number`.

## States
`created → funded → released` (happy path) or `created → funded → refunded` (cancellation).
`funded → disputed → funded` (dispute/undispute) is a side-branch that never moves money.

## Webhook verification
TFA can send webhook callbacks when settlement state changes (e.g. `settlement.released`).
Each callback is HMAC-SHA256-signed with the secret you provided at registration time.

```js
import { verifyWebhookSignature } from "@tfa/escrow-client";

// In your HTTP handler:
const secret = process.env.TFA_WEBHOOK_SECRET; // the secret from registration
const payload = await request.text();            // raw body, before JSON.parse
const signature = request.headers.get("x-tfa-signature");

const result = verifyWebhookSignature(secret, payload, signature);
if (!result.ok) {
  console.error("Invalid webhook signature:", result.reason);
  return new Response("unauthorized", { status: 401 });
}

// Safe to process the event
const event = JSON.parse(payload);
console.log("Received:", event.event, event.data.agreementId);
```

### Verification rules
- The signature header format is `sha256=<base64>`.
- The payload must be the **raw request body** (UTF-8 string), not a re-serialised object.
- `verifyWebhookSignature` is timing-safe and zero-dependency (uses only `node:crypto`).
- It returns `{ ok: true }` on success or `{ ok: false, reason: "..." }` on failure.
- Never silently ignore a failed verification — reject the request with 401.
