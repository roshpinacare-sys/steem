# ADR-004 — Domain Packs, Digital Thread, and Failure Knowledge

- Status: Accepted for bounded proof
- Version: 0.2.0
- Date: 2026-07-16

## Decision

The universal kernel remains domain-neutral. Domain packs declare workflows, capabilities, evidence classes, scopes, surfaces, and risks, but may not own authority or request kernel-reserved scopes.

A content-addressed digital thread links authority, commitments, requirements, missions, evidence, certification, passports, incidents, and recertification through explicit typed edges. It is a traceability proof, not a truth oracle.

Known failure categories may be compiled into proposed invariants, regression tests, adversarial tests, monitors, and recertification triggers. Unknown failures require human interpretation and cannot be marked automatically resolved.

## Consequences

- Jewelry, payments, research, irrigation, trading, and other domain semantics stay outside the kernel.
- Hidden state transfer between packs is forbidden.
- A pack cannot grant authority to itself.
- Simulation and inferred evidence cannot satisfy measured-evidence requirements.
- Standards adapters are mappings, not compliance certifications.
