# UI Design Doctrine

## Product thesis

Titai is not a chatbot dashboard. It is an operating surface for delegated work where authority, evidence, uncertainty, recovery, and cost must remain legible while agents act.

The interface should feel like a **forensic command instrument**: calm under normal operation, exact under failure, and explicit about what is known, inferred, approved, reversible, or still unverified.

## Five structural directions evaluated

| Direction | Core structure | Strength | Fatal risk |
|---|---|---|---|
| Mission dashboard | KPI grid and queues | Fast familiarity | Generic and weak causality |
| Living execution graph | Spatial agent and tool graph | Strong topology | Missing evidence can remain invisible |
| Evidence ledger | Vertical proof spine and gaps | Fast trust assessment | Requires disciplined event semantics |
| Temporal operating room | Time lanes for agents and tools | Excellent concurrency visibility | High density on small screens |
| Case file workspace | Evidence bundles, decisions, and artifacts | Strong audit review | Slower for live operations |

## Selected synthesis

Use the living execution graph for topology and the evidence ledger for trust. The timeline remains the chronological source view. No single visualization is allowed to imply more certainty than the underlying events support.

## Interaction principles

1. **Authority is visible before action.** Risky actions show the policy, requested capability, arguments, reversibility, and decision owner.
2. **Evidence precedes confidence.** A completed badge is never a substitute for linked proof.
3. **Failure has a recovery path.** Interrupted and partial states explain what is durable and what must be repeated.
4. **Uncertainty is named.** Missing events, unresolved approvals, and unverified outputs are explicit interface objects.
5. **Density is progressive.** Operators see the decisive signal first and can reveal raw events, artifacts, hashes, and prompts.
6. **Motion communicates change only.** Decorative motion is prohibited; reduced-motion preserves all meaning.

## Token and component rules

- Semantic tokens remain the only source of color.
- Status must always combine color with text or iconography.
- Monospace is reserved for identifiers, evidence codes, event sequence, and machine values.
- Rounded geometry is asymmetric where it communicates state or direction; generic card grids are discouraged.
- Every action component must define hover, focus, disabled, loading, denied, partial-success, offline, and error states.

## Implemented vertical slice

The run detail now includes an Evidence Ledger that derives structural proof directly from the event stream. It detects sequence discontinuity, missing plan evidence, unresolved tool calls, unresolved approvals, conflicting terminal events, and completed runs with incomplete step evidence.
