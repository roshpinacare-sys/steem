# Research Coverage Audit

The previous pack was strongest on durability, memory, provider routing, MCP, RAG,
observability, backup, and competitors. It under-specified the systems that make those
features safe and operational.

## Gaps closed in this revision

- Product beachhead, user outcomes, adoption barriers, and differentiation.
- Reasoning budgets, stopping rules, context selection, compression, contamination,
  and cache safety.
- Model registry, licensing, hashes, quantization, hardware qualification, promotion,
  rollback, and deprecation.
- Identity, tenancy, delegation, workload identity, and confused-deputy prevention.
- Data classification, consent, ownership, retention, residency, deletion, export,
  and provenance.
- Tool capability descriptors, risk-tiered isolation, structured errors, and resource budgets.
- Agent delegation, deadlock, recursion, shared-state, cancellation, and external protocol mapping.
- Software and AI supply-chain provenance, SBOM, AI-BOM, signing, and verification.
- Telemetry privacy, exact versus approximate usage accounting, SLOs, capacity, and incidents.
- Deployment profiles, workers, synchronization, cloud-burst exit, restore drills, and chaos tests.
- Quality-constrained cost and full-system energy methodology.
- Approval quality, reversibility, accessibility, and operator decision support.
- Plugin SDK, conformance, technology watch, legal questions, and experiment portfolio.

## Completeness rule

Completeness does not mean every topic must be implemented. It means every material
system concern is visible, has an owner and decision path, and cannot be silently
ignored by an agent. `COVERAGE_DOMAINS.json` and canonical validation enforce this.
