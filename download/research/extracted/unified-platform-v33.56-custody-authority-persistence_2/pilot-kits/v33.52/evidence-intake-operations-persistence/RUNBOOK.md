# V33.52 Persistence Runbook

1. Verify the v33.51 readiness certificate and operations policy signatures.
2. Create a fenced worker lease for allowed queue operations.
3. Commit every operation to the signed sequence-linked journal using an idempotency key.
4. Require three expiry witnesses before worker takeover.
5. Apply high/low watermark hysteresis and oldest-item pressure thresholds.
6. Replicate exact journal bytes to three separated stores and verify readback.
7. Recover from the signed journal prefix and recompute the audit verdict.
8. Keep external readiness, G3 and production authority blocked.
