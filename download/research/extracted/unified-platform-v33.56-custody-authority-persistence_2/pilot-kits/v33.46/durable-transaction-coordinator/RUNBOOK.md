# Durable Transaction Coordinator Runbook

1. Issue a bounded coordinator lease.
2. Append and fsync every journal entry before acknowledging it.
3. On expiry, collect three independent witness votes after the safety delay.
4. Fence the old term and resume at the exact next sequence.
5. Return replay receipts for duplicate idempotency keys.
6. Apply timeout compensation only to the signed base manifest.
7. Keep production authority at NONE until external qualification.
