# Witness topology

The minimum topology is five enrolled witnesses with a three-vote quorum. Witness keys, organizations and hosts must all be distinct. No witness may share a key, organization or host with the importer or witness coordinator.

Each vote binds policy digest, epoch, proposal digest, sequence, prior anchor and candidate checkpoint. A witness must refuse a stale anchor, skipped sequence, rewritten consumed set or proposal outside the active policy window. Conflicting votes for the same epoch, sequence and prior anchor are equivocation evidence and stop qualification.
