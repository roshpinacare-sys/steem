# ADR-002: Hybrid durable-work pattern

**Status:** Accepted for local proof; production runtime deferred

The proof combines:

1. transactional authoritative state;
2. transactional outbox;
3. leases and monotonically increasing fencing tokens;
4. idempotent effect receipts;
5. append-only event and evidence history;
6. revision compare-and-set for human approvals and cancellation.

SQLite proves local semantics and process-crash behavior. It does not prove PostgreSQL, multi-host or network-partition behavior.
