# ADR-003: `qodo:trigger:queue` is the canonical trigger queue

**Status:** accepted (2026-07)

## Context

Three different "mission queue" mechanisms coexisted and did not agree:

1. `worker/telemetry-proxy.js` `/dispatch` → GitHub `workflow_dispatch` (no queue at all).
2. `packages/agent/worker/webhook-receiver.js` → `LPUSH qodo:trigger:queue` (a real Redis LIST with a real writer).
3. `k8s/qodo-scaledjob.yaml` KEDA scaler → `qodo:mission:queue` — a key **nothing anywhere writes**, addressed through an Upstash **REST** URL that KEDA's TCP-protocol redis scaler cannot speak.

(`qodo:v24:mission-queue`, the prioritized mission store in
`mission-priority.ts`, is a JSON blob — not a list — and cannot drive a
list-length scaler.)

## Decision

- Queue-based consumers (KEDA) watch **`qodo:trigger:queue`**, the list the
  webhook receiver actually populates.
- KEDA must be given a **TCP** Redis endpoint (`REDIS_URL`,
  `redis://host:port` — Upstash provides one alongside its REST API); the
  REST URL/token pair is only for the agent's own `RedisState`.
- `workflow_dispatch` remains the manual/CI trigger path — documented as
  such, not as a parallel queue.

## Consequences

`qodo:mission:queue` is dead and must not reappear. Anything adding a new
trigger source should LPUSH `qodo:trigger:queue` and let both the k8s path
and future consumers share it.
