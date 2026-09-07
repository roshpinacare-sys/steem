# V33.34 — Federated Recovery Drill

V33.34 adds a fail-closed local rehearsal for continuity after witness loss and coordinator replacement.

## Implemented controls

- Three-of-five recovery with no more than two unavailable or replaced witnesses.
- Two predecessor-linked epoch transitions with an unchanged sequence floor.
- Proof of possession by every witness in each next epoch.
- Active-lease coordinator handoff only with a signed outgoing relinquishment, signed incoming acceptance and witness quorum.
- Cutover semantics that truncate the outgoing range at sequence N and start the replacement at N+1.
- Conflict detection for multiple handoffs derived from one predecessor lease.
- Portable transparency-publication request and publisher receipt bound to the prior pin, both recovery certificates and the handoff certificate.
- Independent verification from exported public keys only.
- Regression receipts bound to compiled output and repository runtime-input identity.

## Verified results

- 35/35 V33.34 attack and recovery tests.
- 192/192 focused V33.30–V33.34 tests.
- 2,017/2,017 authoritative tests across 219 isolated test files.
- 850/850 direct V33 tests across 34 files.
- 32 independently reverified signatures.
- 159/159 closed capability paths, zero source cycles and zero untested source modules.
- 44/44 final validation checks.

## Truth boundary

The included evidence is a synthetic local recovery rehearsal. The HTTPS endpoint is a portable target descriptor, not an observed network publication. No independent external host, participant or production action is claimed. `networkFetchObserved` remains false, production authority remains `NONE`, G3 remains blocked and production promotion remains blocked.
