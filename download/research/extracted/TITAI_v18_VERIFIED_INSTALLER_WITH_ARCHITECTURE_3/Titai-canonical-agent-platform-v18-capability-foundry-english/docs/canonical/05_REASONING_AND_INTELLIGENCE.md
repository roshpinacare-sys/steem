# Reasoning and Intelligence Architecture

## Controller inputs

- Task risk, ambiguity, novelty, reversibility, and failure cost.
- Available models and measured capability profiles.
- Context sources, permissions, provenance, and token budget.
- Tool capabilities, expected side effects, cost, and latency.
- Time, model-call, tool-call, token, and operator budgets.

## Controller actions

Direct answer, clarify, decompose, retrieve, search, simulate, call a tool, request
approval, critique, cross-check, escalate to another model or role, or stop.

## Required controls

- Easy tasks take a direct bounded path.
- Complex tasks can use explicit subproblems and independent checks.
- Every loop has iteration, time, and cost ceilings.
- The system records uncertainty and evidence, not private hidden reasoning.
- A verifier checks observable artifacts and acceptance criteria.
- Failure to find evidence lowers confidence rather than producing confident prose.

## Evaluation

Compare direct, fixed-iteration, adaptive, and role-separated modes under the same
workload and budgets. Report quality, omissions, regressions, latency, calls, tool use,
operator corrections, and failure classes.
