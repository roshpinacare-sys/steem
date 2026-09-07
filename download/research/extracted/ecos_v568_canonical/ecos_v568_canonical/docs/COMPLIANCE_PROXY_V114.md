# ECOS V114 Compliance Proxy

The **ECOS V114 Compliance Proxy** routes external AI completion requests through the same control surface used by the core ECOS protocol. It wraps provider execution with confidence gating, HITL escalation, and append-only `PROXY_CALL` audit evidence.

| Capability | Implementation |
|---|---|
| Completion endpoint | `POST /api/v1/proxy/complete` |
| Audit event | `PROXY_CALL` appended through `lib/auditLog.js` |
| Human review | Non-auto results create a HITL approval and return `approvalId` |
| Authentication | `ECOS_PROXY_API_KEY` via `X-API-Key` or `Authorization: Bearer` |
| Rate limit | 60 proxy completions per IP per minute |
| UI | `/proxy` in the Next.js web application |

## Environment

Set `ECOS_PROXY_API_KEY` in production. If it is unset, the proxy runs in development-open mode, which is useful for local testing but should not be used for public deployments.

```bash
export ECOS_PROXY_API_KEY="replace-with-a-secret"
```

## Example request

```bash
curl -s http://localhost:3000/api/v1/proxy/complete \
  -H 'Content-Type: application/json' \
  -H "X-API-Key: $ECOS_PROXY_API_KEY" \
  -d '{
    "userPrompt": "Summarize this policy and identify compliance risks.",
    "clientAccountId": "client::proxy_customer",
    "priceUsd": "0.01",
    "taskType": "compliance-review"
  }'
```

The response always includes the proxy status, confidence, gate verdict, and audit metadata. When the confidence gate does not allow auto-flow, `aiOutput` is withheld and `approvalId` identifies the pending HITL record.

```json
{
  "ok": true,
  "status": "HITL_QUEUE",
  "gateVerdict": "HITL_QUEUE",
  "confidence": 0.55,
  "approvalId": "apv_...",
  "aiOutput": null,
  "audit": { "type": "PROXY_CALL", "index": 42, "hash": "..." }
}
```

## Supporting endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/proxy/config` | Returns V114 proxy policy, thresholds, and whether API-key auth is required. |
| `GET /api/v1/proxy/stats` | Returns in-memory usage counters for the current server process. |

## Operational guidance

The proxy is intentionally **non-blocking** for human review. A low-confidence or policy-sensitive call returns promptly with `HITL_QUEUE`, while existing validator workflows resolve the approval later. This preserves API responsiveness while making every call auditable and reviewable.
