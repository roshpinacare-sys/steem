# CLAUDE Handoff — V33.36

V33.36 adds pinned HTTPS monitor qualification, signed clock quorum, durable receipt retention and monitor replacement during a sustained partition.

Verified locally:
- TLS 1.3 HTTPS server in a separate process.
- Three active monitor processes and one replacement process.
- Certificate SHA-256 pinning.
- Atomic durable receipt writes with file and directory fsync.
- Monitor-set transition 1 -> 2 after two active partition statements.
- Signed gossip and split-view detection.
- Fourteen independently reverified signatures.

Truth boundary:
- `externalTopologyObserved=false`.
- `externalHostEvidenceCount=0`.
- `externalHumanParticipants=0`.
- `productionAuthority=NONE`.
- production promotion remains blocked.

Next work must execute the same protocol on independently administered hosts and import signed topology evidence without lowering quorum or changing the truth boundary prematurely.
