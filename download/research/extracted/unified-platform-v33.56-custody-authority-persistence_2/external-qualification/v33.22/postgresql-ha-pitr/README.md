# V33.22 PostgreSQL HA/PITR External Evidence Kit

This kit collects and packages evidence for a controlled external PostgreSQL high-availability and point-in-time-recovery qualification. It contains no credentials and does not execute failover, restore, promotion, backup, firewall, or production changes automatically.

Two independent roles are required:

- `HA_OPERATOR`: observes a single-winner failover, timeline advancement, monotonic fencing, old-primary write rejection, outbox continuity, TLS verify-full, RTO and RPO.
- `PITR_OPERATOR`: restores an isolated target, reaches the declared recovery target, proves a new recovery timeline, preserves the witness fence, verifies backup integrity and outbox continuity, and measures RTO/RPO.

The two bundles must come from different signer keys, organizations and operator hosts, while referring to the same source cluster and database system identifier. A separate importer verifies artifact bytes and a separate verifier issues the verdict.

Synthetic or same-host evidence cannot qualify. A passing verdict permits only an external pilot and grants no production authority.
