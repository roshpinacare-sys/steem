# TITAI v11 Architecture Delta

## As-built delta

1. **Model control plane** - model capability profiles are persisted; routing uses hard eligibility constraints and a deterministic utility score; decisions are stored on runs and emitted as events.
2. **Memory control plane** - prompt assembly queries active user-owned memory, quarantines unsafe records, applies a retrieval budget, labels selected content as untrusted evidence, and stores content hashes instead of silently hiding context selection.
3. **Tool control plane** - each tool declares schema version, effect, idempotency strategy, network/filesystem needs, timeout, and output ceiling. The runner enforces allowlists and bounded runtime.
4. **Execution transition plane** - five runner modes exist. Durable execution is limited to simulation or dry-run and currently wraps the legacy run as one durable side effect.
5. **Operator plane** - run dossier and operations signal plane expose control provenance and operational debt.
6. **Approval primitive** - a serializable revision-checked state machine proves one-decision and expiry semantics, but it is not yet connected to active restart recovery.

## Trust boundaries

- Model text, fetched content, and memory content are untrusted inputs.
- Policy, authenticated identity, ownership, tool capabilities, and explicit approval are authority inputs.
- The application process remains a trusted boundary for tools; no OS-level sandbox exists.
- SQLite remains the local single-writer persistence baseline.

## Controlled cutover state

| Mode | Behavior | Side-effect policy | Release meaning |
|---|---|---|---|
| legacy | Current process-local runner | Existing guarded tools | Default rollback path |
| durable_shadow | Records durable comparison state | No duplicate tool effects | Observation only |
| durable_opt_in | Durable envelope for simulation/dry-run | Fail closed otherwise | Experimental |
| durable_default | Recognized but not release-approved | Must remain gated | Not production-ready |
| legacy_rollback | Explicit rollback | Legacy path | Emergency compatibility |

## Remaining architecture blockers

- Granular step checkpoints in the active runner.
- Lease heartbeat during long model/tool work.
- Worker fencing against late commit.
- Transactional binding across tool receipt, event, audit, checkpoint, and outbox.
- Persisted approval waits connected to resumption.
- Native SQLite concurrency and restart tests.
- Complete tenant/workspace identity rather than personal-workspace ownership only.
- Evaluated model profiles generated from repeatable benchmark runs.
