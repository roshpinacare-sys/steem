# ADR-0019: Evidence-First Run Interface

- Status: Accepted for implementation evidence; independent verification pending
- Date: 2026-07-10
- Owners: Creative Director, Interaction Architect, Design System Engineer
- Review role: Accessibility and Independent Verification

## Problem

The existing run detail exposed a canvas, timeline, audit log, and artifacts, but operators still had to infer whether a run was reconstructable, whether tool calls had results, whether approvals were resolved, and whether completion had sufficient structural evidence.

## Design directions considered

1. **Conventional KPI dashboard.** Familiar but generic and poor at showing causality.
2. **Graph-only execution view.** Strong spatial overview but weak at surfacing missing proof.
3. **Narrative transcript.** Detailed but expensive to scan under operational pressure.
4. **Evidence ledger with a vertical proof spine.** Directly maps execution claims to persisted signals and open gaps.
5. **Forensic diff view.** Powerful for expert review but too dense as the default operator surface.

## Decision

Add an Evidence Ledger as a first-class run tab. It derives all signals from the append-only event stream and presents event continuity, plan completion, tool accountability, human authority, artifact production, reconstructability, and explicit gaps. It must state that implementation evidence is not independent verification.

## Anti-generic constraints

- Use an asymmetric proof surface, not a grid of decorative metric cards.
- Use a continuous spine to communicate causal sequence.
- Show missing evidence as named gaps, not a vague health score.
- Keep semantic color subordinate to text and icon labels.
- Preserve keyboard navigation and reduced-motion behavior.

## Consequences

- Operators can identify unresolved tool calls and evidence discontinuities without reading the full transcript.
- The interface makes uncertainty visible.
- The current score measures structural evidence coverage only and must never be presented as correctness or independent verification.
