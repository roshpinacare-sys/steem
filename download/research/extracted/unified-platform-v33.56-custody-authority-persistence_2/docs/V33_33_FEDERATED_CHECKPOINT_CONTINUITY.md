# V33.33 Federated Checkpoint Continuity

## Purpose

V33.33 closes long-lived operational gaps left after the V33.32 3-of-5 checkpoint protocol. It adds safe witness-policy rotation, quorum-certified coordinator leases and an externally pinnable transparency chain without claiming that any independent infrastructure was deployed.

## Implemented controls

### Witness epoch rotation

- The next epoch must equal the current epoch plus one.
- The sequence floor and predecessor checkpoint/anchor are inherited exactly.
- At least the old quorum of witnesses is retained; a 5-member, quorum-3 policy can replace at most two witnesses in one rotation.
- A quorum of current witnesses signs the rotation plan.
- Every next-epoch witness signs a proof-of-possession activation challenge.
- Importer, coordinator, rotation authority and witnesses require distinct keys, organizations and hosts.

### Coordinator lease continuity

- A coordinator receives an explicit epoch, term and bounded sequence range.
- A quorum of next-epoch witnesses signs the lease.
- Successor leases embed the prior certificate, increment the term and begin exactly after the prior range.
- Overlapping ranges or conflicting coordinators are reported as split brain.

### Transparency continuity

- Rotation plans, certificates, leases and checkpoint anchors are recorded as signed hash-chain entries.
- Independent monitor votes bind the exact log size and head digest.
- A pin authority issues a quorum-backed certificate linked to the previous pin.
- A successor pin is accepted only when the prior pinned head is a real prefix of the supplied log.
- Conflicting pins for a common log position are reported as split views.

## Truth boundary

The proof fixtures are local and synthetic. They demonstrate protocol behavior, signature verification and attack rejection only. They do not prove separate machines, independent organizations, durable public publication, HSM/KMS custody or an executed human study. External human participant count is zero, production authority is `NONE`, external effects are zero and G3 remains in progress.

## Reproduction

```bash
npm run build
npm run test:v33.33
npm run proof:v33.33
npm run verify:proof:v33.33
npm run test:full:v33.33
npm run test:direct:v33.33
npm run truth:v33.33
npm run architecture:v33.33
npm run validate:v33.33
```

## Local validation result

The final source tree builds under Node 22.16 and TypeScript 5.8.3. The focused chain passed 157/157 tests, the full one-process-per-file regression passed 1,982/1,982 tests across 218 files, and the direct V33 set passed 815/815 across 33 files. The independent verifier checked 25 signatures. Repository and architecture checks report 222 source modules, 218 test files and 158/158 closed capability paths.
