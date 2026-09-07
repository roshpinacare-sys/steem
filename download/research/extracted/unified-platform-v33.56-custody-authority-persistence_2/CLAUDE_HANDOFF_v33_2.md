# CLAUDE Handoff v33.2

Current status: G0 and G1 passed. V33.2 adds mission-conversation continuity and a local approval-inbox contract. G3 remains not passed.

Read `CLAUDE.md`, `MASTER_DIRECTIVE.md`, `PROGRAM_CHARTER.md`, historical `governance-state/`, then `v33/governance-state/PROOF_GATE_REGISTRY_V33.json`, `docs/V33_1_CHAT_MISSION_AND_PUSH_CONTRACT.md`, and `docs/V33_2_MISSION_CONTINUITY_AND_APPROVAL_INBOX.md`.

Authoritative V33.2 validation: `npm run validate:v33.2`.

Non-negotiable boundaries:

- v32.18 remains the sole canonical authority kernel.
- Conversation history cannot change its bound tenant, mission or authority digest.
- Approval delivery or decision retries must be idempotent.
- One approval card can have at most one terminal decision.
- Approval does not execute an external effect.
- G3 cannot pass without real human UX evidence and a real transport qualification.

Next slice: a device-bound local Push Gateway simulator, signed delivery receipts, persistent inbox storage, and a task-flow measurement harness. No external notification service is authorized yet.
