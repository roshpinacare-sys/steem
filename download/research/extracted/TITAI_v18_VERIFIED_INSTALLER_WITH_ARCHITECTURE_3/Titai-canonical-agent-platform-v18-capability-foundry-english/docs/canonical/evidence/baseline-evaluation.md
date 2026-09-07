# Titai Baseline Evaluation

Deterministic simulation baseline. This report does not claim database integration coverage.

- Cases: 8
- Passed: 8
- Failed: 0
- Pass rate: 100%

| ID | Result | Title | Criterion |
| --- | --- | --- | --- |
| LIF-001 | PASS | Legal run lifecycle | queued -> running -> awaiting_approval -> running -> completed is accepted |
| LIF-002 | PASS | Illegal run lifecycle | queued -> completed is rejected |
| LIF-003 | PASS | Illegal step reopening | completed -> running is rejected |
| EVD-001 | PASS | Complete evidence reconstruction | A complete deterministic run has no gaps and is reconstructable |
| EVD-002 | PASS | Missing tool-result detection | A completed run with an unresolved tool call is rejected as complete evidence |
| GRAPH-001 | PASS | Event-to-graph projection | The run graph contains the agent, one step, one tool, and one artifact |
| POL-001 | PASS | Fail-closed high-risk policy | A high-risk deployment tool requires human approval |
| POL-002 | PASS | Low-risk default policy | A low-risk tool remains locally executable without a provider key |
