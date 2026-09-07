# Qodo V24 Mentor Terminal — Runbook

## Running the Agent

```bash
npm run build
node packages/agent/dist/cli.js
```

Required environment variables are listed in `.env.example`.

## Mentor Mode

Mentor Mode gates the pipeline immediately before the Commit phase.

1. Set `QODO_MENTOR_MODE=true` when starting the agent.
2. When the pipeline reaches the pre-commit pause, the agent polls this Redis key:
   ```
   qodo:v24:mentor:{owner}:{repo}:{prNumber}
   ```
3. Set the key to one of the following JSON values to proceed:
   - `{"status": "approved"}` — allows the Ghost Commit.
   - `{"status": "rejected", "reason": "..."}` — aborts the run with the supplied reason.

If no decision is received within 30 minutes, the run times out.

## Full Auto

Default behavior is unchanged. Do not set `QODO_MENTOR_MODE`, or set it to any value other than `true`. The pipeline proceeds from Gate to Commit without pausing.

## Auto-Fix Feedback

`FailureRecoveryPanel` sends the failure reason back to the pipeline as `feedback`. The UI posts it to the existing `/dispatch` endpoint. Ensure the backend dispatch handler forwards `feedback` to the agent if you want unattended retry.

## Telemetry

The mission-control dashboard reads from the telemetry proxy configured via `VITE_TELEMETRY_PROXY_URL`. It expects the same event schema emitted by `packages/agent/src/services/telemetry.ts`.
