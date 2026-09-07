# V33.46 Durable Transaction Coordinator

V33.46 adds a signed monotonic transaction journal, coordinator leases and irreversible fencing, three-witness expired-lease takeover, idempotent replay receipts, timeout compensation, durable fsync receipts and crash recovery at the canary and promotion boundaries.

## Truth boundary

The proof uses three separate local Node processes and real local filesystem fsync. It does not prove externally administered hosts, production authority or external effects. G3 and production promotion remain blocked.
