# V33.7 — Controlled Human Pilot, Credentialled Provider Qualification, and Buyer Validation

## Status

`READY_FOR_CONTROLLED_EXECUTION` — no human pilot, credentialled APNs/FCM run, buyer interview, design-partner commitment, or paid pilot has been executed by this repository.

Production promotion remains blocked.

## Purpose

V33.7 converts the remaining G2 and G3 activities from informal checklists into signed, falsifiable evidence contracts.

### Controlled human pilot

A qualifying pilot requires:

- one immutable, authority-signed study protocol;
- at least three fixed scenarios;
- at least five distinct participants;
- a different enrolled device and signed consent for every participant;
- pseudonymous participant aliases and no direct personal identifiers;
- an independently signed observation bound to protocol, consent, telemetry, session and base observation;
- at least 70% step reduction;
- median approvals no greater than one;
- median comprehension below ten seconds;
- error rate no greater than five percent;
- accessibility passed;
- shadow-only execution and zero external effects.

A single device cannot create multiple participants. The study authority cannot act as the independent observer.

### Credentialled provider qualification

A qualifying APNs or FCM run requires:

- a credential reference backed by KMS, HSM or workload identity; raw credentials are forbidden;
- an isolated APNs sandbox or FCM project;
- a real device;
- real external network execution;
- TLS 1.2 or later and a recorded peer fingerprint;
- signed operator evidence;
- a separately signed independent witness from a different organization;
- invalid-token handling, token rotation, retry/deduplication and credential revocation tests;
- zero duplicate provider acceptances;
- a digest-bound transcript;
- shadow-only authority.

Current official provider posture used by the qualification contract:

- APNs provider connections use HTTP/2 with TLS 1.2 or later. Token authentication uses ES256 JWTs and provider tokens must be refreshed within Apple's validity requirements.
- FCM uses the HTTP v1 `projects.messages.send` endpoint and short-lived OAuth 2.0 access tokens or workload identity.

### Buyer and category validation

G2 requires signed external buyer evidence from unique organizations:

- 15 structured interviews;
- at least five urgent problems confirmed with budget ownership;
- at least three distinct design partners;
- at least two distinct paid pilots;
- at least USD 50,000 combined committed pilot ACV;
- no simulated, internal or duplicate organization evidence can count.

## Current gate truth

- G0: passed.
- G1: passed.
- G2: in progress, not passed; zero external buyer evidence imported.
- G3: in progress, not passed; zero controlled human participants and zero credentialled external provider runs imported.
- Production: blocked.
