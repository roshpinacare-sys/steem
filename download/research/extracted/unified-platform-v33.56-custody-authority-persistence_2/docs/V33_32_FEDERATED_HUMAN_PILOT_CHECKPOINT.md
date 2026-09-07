# V33.32 — Federated Human-Pilot Checkpoint and Execution Kit

## Purpose

V33.31 proved a signed append-only checkpoint on one trust domain. V33.32 removes the single-signer checkpoint from the authoritative human-pilot path by requiring a signed 3-of-5 witness certificate across distinct keys, organizations and hosts.

## Security properties

- The importer signs a proposal bound to the prior anchor, prior checkpoint, candidate checkpoint, study, protocol, package and one-time challenge.
- Every witness signs the same proposal, prior anchor and candidate checkpoint.
- A quorum certificate requires at least three distinct enrolled witness keys, organizations and hosts.
- The coordinator is distinct from the importer and every witness.
- The candidate checkpoint must increment sequence by exactly one and append exactly one challenge and package digest without rewriting history.
- A federated anchor binds the certificate, checkpoint and prior anchor.
- Conflicting votes from the same witness for the same epoch, sequence and prior anchor are explicit equivocation evidence.
- The V33.32 human-pilot verdict cannot pass from a V33.31 verdict unless the receipt, package, challenge and checkpoint certificate all bind.
- Synthetic evidence remains blocked even when the witness protocol is structurally valid.

## Human-pilot execution kit

The kit fixes the external execution controls before recruitment:

- at least five external participants;
- three comparative scenarios;
- consent before instrumentation;
- withdrawal and deletion handling;
- no raw PII, audio or video;
- retention at most 30 days;
- clock-skew bound at most 300 seconds;
- nine non-overlapping operational roles;
- quorum availability during import;
- mandatory abort conditions and preflight checks.

The included kit is a structural template only. It does not claim external organizations, protected hosts, consented participants or real execution.

## Explicit boundary

V33.32 proves protocol behavior locally. It does not prove that five independent witness hosts exist, that keys are held in HSM/KMS, that real humans participated, or that an external privacy authority approved retention. G3 and production remain blocked.
