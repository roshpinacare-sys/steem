# V33.36 — External HTTPS Monitor Qualification

V33.36 strengthens the V33.35 monitor-retrieval path with pinned TLS 1.3, signed time quorum, durable fsync-backed receipts, partition-safe monitor replacement, signed gossip and split-view rejection.

The included proof is a local multi-process HTTPS rehearsal. It performs real TLS network fetches and durable writes, but all processes run on one machine. Therefore it does not prove independently administered external hosts.

External qualification requires one publisher, three active monitors, at least two topology auditors and at least two clock sources under independently evidenced administrators, organizations and hosts. Every external claim must be bound to signed host-evidence attestations; labels alone are insufficient.

Production authority remains `NONE`. External mutation and production promotion remain blocked.
