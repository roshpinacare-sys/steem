# v27 Architecture and Design-to-Evidence Closure

## Objective
Prevent a design claim from being treated as implemented merely because code or a positive test exists.

## Closure contract
Every critical capability must identify:
1. design references;
2. implementation components;
3. an integrated product path;
4. positive and adversarial tests;
5. authentic mutation kills;
6. persistence or recovery behavior;
7. an operational control;
8. evidence artifacts;
9. independent reviewer roles;
10. explicit limitations.

## Dependency architecture
Local source, test and entrypoint nodes are extracted into a directed graph. Release is blocked on unresolved local imports, forbidden layer dependencies, source cycles, untested source nodes, or an open declared capability path. Type contracts are separated from runtime implementations to avoid reciprocal imports.

## Persistent capability paths
The closure gate covers durable recertification, request-bound agent execution, review-preserving Domain Pack admission, governed model orchestration, proposal-only engineering assistance, and architecture integrity. External PostgreSQL, KMS/HSM, independent isolation, legal review and human validation remain separate qualification gates.
