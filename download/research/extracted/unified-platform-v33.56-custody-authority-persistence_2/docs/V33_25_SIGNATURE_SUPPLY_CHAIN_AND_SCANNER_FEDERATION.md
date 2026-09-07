# V33.25 — Signature Supply Chain and Scanner Federation Qualification

## Purpose
V33.25 adds a signed, monotonic signature-feed chain and a fail-closed scanner federation. It does not create production authority and it does not claim that local reference engines are ClamAV or YARA.

## Local proof
- Ed25519-signed feed genesis and updates.
- Sequence and previous-digest continuity.
- Pinned critical rules to reject feed poisoning.
- Separate signed witness to reject ledger rollback.
- Signed feed revocation.
- Two different scanner implementations in separate Node processes.
- Exact package-byte binding and signed per-engine receipts.
- Fail-closed quarantine whenever engines disagree.

## External qualification remains required
External qualification requires live ClamAV and YARA, distinct implementations and organizations, a signed fresh feed chain of depth three or greater, authenticated update transport, rollback protection, multiple scanner hosts, two independent operators, and a separate verifier.

## Truth boundary
The local evidence class is `LOCAL_SIGNED_FEED_CHAIN_AND_TWO_REFERENCE_SCANNER_FEDERATION`. Local reference engines are not external scanners, local process separation is not host independence, and a qualified subgate never grants production promotion.
