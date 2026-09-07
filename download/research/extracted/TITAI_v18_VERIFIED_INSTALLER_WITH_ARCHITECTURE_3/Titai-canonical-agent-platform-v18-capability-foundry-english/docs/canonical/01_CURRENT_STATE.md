# Current-State Baseline

This baseline describes the supplied repository before roadmap implementation.

## Existing strengths

- Next.js application with an English UI, authentication, agents, versioned skills,
  provider settings, run history, approvals, artifacts, and a living execution canvas.
- Provider gateway for multiple commercial APIs, OpenAI-compatible endpoints, Ollama,
  and deterministic simulation.
- DAG-like planned steps, streamed events, policy decisions, human approval, and a
  hash-linked audit log.
- SQLite persistence, migrations, unit and integration tests, E2E smoke tests,
  typechecking, and CI.
- A no-commercial-key demonstration path through simulation and a local provider path.

## Verified limits

- Execution and approval waits are process-bound and not restart-resumable.
- SQLite and run management assume a single long-lived writer.
- Planning is short and execution is sequential; multi-agent personas are not a
  durable multi-agent runtime.
- No governed long-term memory or versioned knowledge ingestion lifecycle exists.
- Skills in repository files are not automatically imported into application versions.
- Tools lack a general capability broker and strong isolation boundary.
- Identity and ownership are not complete tenancy and delegated-agent contracts.
- No model and dataset registry, AI-BOM, or promotion lifecycle exists.
- Telemetry is insufficient for end-to-end quality, SLO, cost, capacity, and energy claims.
- MCP and A2A adapters are absent.
- Portable export, encrypted backup, restore drills, and offline synchronization are
  not productized.

## English-only revision

The revised distribution removes the prior secondary-language catalog and related
tests and adds an automated language gate. The application retains a simple English
locale path without shipping non-English content.
