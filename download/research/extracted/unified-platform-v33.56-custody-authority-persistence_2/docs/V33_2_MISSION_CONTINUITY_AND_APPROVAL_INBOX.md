# V33.2 Mission Continuity and Approval Inbox

## Purpose

Move the V33.1 chat contract from a stateless decision object toward a durable operator experience without granting any external-effect authority.

## Implemented boundary

### Mission Conversation Store

- tenant and mission bound;
- authority-grant digest fixed for the entire conversation;
- append-only sequence;
- hash-chained events;
- idempotent event replay;
- conflict rejection for reused event IDs with different content;
- file-backed persistence with a sovereign file lease and atomic replacement;
- export, restore and integrity verification;
- zero external effects.

### Approval Inbox Transport Contract

- enqueue, delivery, listing and decision operations;
- tenant and approver binding;
- duplicate delivery and decision idempotency;
- card expiry;
- one terminal decision per card;
- nonterminal explanation requests;
- no scope expansion beyond the bound approval card;
- zero external effects;
- in-memory adapter only.

## Adversarial cases

- reconnect and duplicate append;
- reused event ID with changed content;
- authority-digest rebinding;
- cross-tenant read and decision attempts;
- unauthorized approver;
- duplicate delivery;
- delivery retry after terminal decision;
- expired approval;
- conflicting decision ID;
- second terminal decision;
- stored-file tampering;
- restore of tampered state.

## Truth boundary

This is not a real push system and does not pass G3. It does not implement APNs, FCM, Web Push, email, SMS, signed device identity, human comprehension testing, accessibility validation, or real effects. The inbox captures and preserves decisions only.
