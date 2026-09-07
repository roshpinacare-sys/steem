# TITAI v17 Honest Limitations

## Independently verified
- Source ZIP manifest integrity after extraction, once final packaging is complete.
- Hash-bound verifier rejection semantics and Ed25519 decision signature.

## Implemented and tested
- Gate-specific physical evidence semantics.
- Rejection of simulated local-model evidence.
- Rejection of same-machine verifier evidence.
- Rejection of one-machine multi-node evidence.
- Signed offline-installer manifest validation.
- Hash-pinned, purpose-limited external custody helper boundary.
- Signed privacy-preserving node profile collector.
- Isolated per-file test authority.
- Drizzle package upgrade with registry integrity and behavioral validation.

## Partially implemented
- Platform-specific offline installer. A complete 1.1 GB staging tree was created, but bounded archive construction did not complete. The incomplete archive was deleted.
- External physical collectors. They are executable, privacy-preserving, and signed, but only one environment returned evidence during this cycle.
- Retrieval qualification. Governed BM25 is tested; real embedding, reranking, task-quality, and energy comparison remain unavailable.

## Environment blocked
- Real local generative model: no signed model artifact or active loopback endpoint.
- Browser and accessibility: managed browser policy denies every URL including loopback.
- OS or hardware custody: no TPM device, DPAPI environment, Linux Secret Service, hardware token, or smart card is exposed.

## Hardware blocked
- Two genuinely separated machines.
- Target Mini-PC power, thermal, GPU, VRAM, and wall-energy measurements.
- External-machine verifier reproduction.

## Unsafe for sovereign pilot
- Treating deterministic runtime output as local-model quality evidence.
- Treating static screenshots as browser evidence.
- Treating same-host process separation as two-node proof.
- Treating CPU/RAM estimates as target energy evidence.
- Treating an ephemeral installer signature as trusted distribution authority.
