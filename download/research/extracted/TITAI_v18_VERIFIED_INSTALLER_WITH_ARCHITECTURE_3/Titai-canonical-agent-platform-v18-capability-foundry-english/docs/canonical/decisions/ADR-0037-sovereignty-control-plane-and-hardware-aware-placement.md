# ADR-0037: Sovereignty control plane and hardware-aware placement

## Status
Accepted for sovereign development mode.

## Problem
Local operation is not understandable if operators cannot see model locality, external dependencies, network attempts, key custody, recovery evidence, and hardware feasibility.

## Alternatives
1. A single sovereignty score. Compact but conceals fatal weaknesses.
2. Raw dependency and metrics tables. Accurate but cognitively expensive.
3. A vector assessment with fatal gates, evidence status, and a control plane connected to placement and dependency records.

## Decision
Represent sovereignty as separate compute, model, data, memory, identity, tool, network, update, supply-chain, recovery, operations, energy, and governance dimensions. Fatal dependencies and unknown evidence are evaluated before classification. Work placement applies tenant, trust, locality, hardware, load, and energy constraints before utility scoring.

## Risks
Energy values are estimates until measured on target hardware. The full application outbound network audit remains incomplete.

## Acceptance evidence
- `src/lib/sovereignty/assessment.ts`
- `src/lib/sovereignty/node-placement.ts`
- `src/lib/sovereignty/control-plane.ts`
- `src/components/sovereignty/sovereignty-control-plane.tsx`
