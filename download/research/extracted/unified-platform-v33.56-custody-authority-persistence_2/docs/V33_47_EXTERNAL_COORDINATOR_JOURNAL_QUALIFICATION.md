# V33.47 External Coordinator and Journal Qualification

V33.47 qualifies the V33.46 durable transaction coordinator for deployment across independently administered hosts. The repository proof remains a local multi-process rehearsal and does not claim external topology.

## Implemented controls

- four host identities separated by key, organization, hostname and administrator;
- host qualification attestations issued by two topology auditors;
- three independent signed clock attestations with bounded skew;
- three durable journal replicas before and after failover;
- actual file and directory `fsync`, reread and byte-digest verification in separate Node processes;
- two-observer partition quorum and fenced term-3 to term-4 failover;
- signed replication checkpoint over three post-failover receipts;
- site-loss restoration to a fourth host from two source replicas;
- fail-closed external status: local labels cannot be relabeled as external evidence.

## Truth boundary

The proof status is `LOCAL_COORDINATOR_JOURNAL_QUALIFICATION_REHEARSAL_ONLY`. Hostnames, organizations, administrators, clocks and partition observations are local fixtures. No externally administered host, external clock root, external append-only storage, human participant, production authority or external effect was observed.
