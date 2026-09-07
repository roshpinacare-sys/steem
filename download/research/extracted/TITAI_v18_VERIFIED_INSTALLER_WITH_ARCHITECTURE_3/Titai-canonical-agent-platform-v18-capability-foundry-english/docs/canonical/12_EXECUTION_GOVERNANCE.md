# Canonical Execution Governance

## State model

`proposed -> ready -> in_progress -> implemented -> verified -> done`

A task may also be `blocked` or `rejected`. A builder cannot move its own work to
`verified` or `done`.

## Selection

Choose the highest-priority ready task whose dependencies are done. Prefer the smallest
vertical slice. Do not auto-select work requiring credentials, purchases, production
access, personal data, legal conclusions, or unaccepted architectural decisions.

## Context discipline

Agents should not load the full research corpus. Generate a task-specific context pack
containing the task, relevant claims, ADRs, gates, and source metadata. Inspect code only
for the selected scope.

## Evidence discipline

Every acceptance criterion needs a command, artifact, test, measurement, or review.
Record environment and versions. Negative results, failed experiments, and unresolved
uncertainty remain visible.

## Change control

Discoveries outside scope become new claims or tasks. Architectural changes require an
ADR. Self-modifying prompts, skills, routing, policy, or models use the same version,
evaluation, approval, promotion, and rollback process as code.
