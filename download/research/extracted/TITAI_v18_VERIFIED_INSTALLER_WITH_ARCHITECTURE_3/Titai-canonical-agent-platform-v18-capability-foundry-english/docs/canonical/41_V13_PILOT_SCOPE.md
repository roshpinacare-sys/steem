# TITAI v13 Golden Pilot Scope

## Supported Workflow

The pilot workflow is a local artifact-generation task executed under a durable run with a persisted human approval boundary.

```text
create task
-> resolve personal tenant and workspace
-> route to an eligible simulation or local model
-> retrieve governed non-restricted memory
-> calculate capability policy
-> persist approval for artifact.write
-> pause durable job
-> resume after approval and restart
-> write one idempotent artifact
-> expose evidence and blockers
-> request hash-bound independent verification
-> include state in encrypted backup
```

## Supported Boundary

- Human role: owner/operator in a personal workspace.
- Tenant model: one deterministic personal tenant and primary workspace per user.
- Task class: bounded local artifact generation.
- Providers: simulation; local provider only after it passes the isolated lane.
- Tools: bounded reads and `artifact.write`.
- Side effects: local application artifact only.
- Approval: required for writes; revisioned, expiring, restart-safe.
- Memory: governed evidence, semantic, preference, and decision records; restricted and poisoned records are excluded.
- Recovery: lease expiry, fencing, checkpoint resume, receipt replay prevention, explicit reconciliation.
- Backup: encrypted application database snapshot with integrity and required-table validation.
- Expected workload: one operator, at most three active pilot runs, bounded artifacts and context.

## Explicitly Unsupported

- Autonomous external network writes.
- Shell execution.
- Remote live-provider restart recovery.
- Shared enterprise workspaces.
- Production secrets.
- Unreviewed plugins.
- Automatic reconciliation of ambiguous external effects.

## Release Rule

Any unsupported path is denied or remains `DEVELOPMENT ONLY`. Unknown evidence is blocking evidence.
