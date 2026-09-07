# External Coordinator and Journal Qualification Runbook

1. Assign four hosts with distinct organizations, administrators, DNS names and signing keys.
2. Obtain host evidence from at least two independent topology auditors.
3. Configure at least two independent signed clock sources and approve maximum skew.
4. Replicate the exact signed journal to three append-only stores and retain file/directory fsync receipts.
5. Isolate the active coordinator and collect two independent partition observations after the minimum delay.
6. Issue a fenced successor term and replicate the unchanged journal to three stores.
7. Publish a checkpoint over all post-failover receipts.
8. Remove one replica site and restore its exact bytes to a fourth host from two retained replicas.
9. Import all signed evidence. Do not enable production authority or G3 from this runbook.
