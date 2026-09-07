# Claude Handoff — V33.30

V33.30 implements controlled human UX pilot instrumentation for the G3 priority selected by V33.29.

Read order: `CLAUDE.md`, `MASTER_DIRECTIVE.md`, `PROGRAM_CHARTER.md`, then this file, the V33.30 design note, proof, validation result, metric continuity receipt and pilot runbook.

Truth boundary: five local synthetic contract-test participants structurally achieve 73.3% median step reduction, one median approval and six-second comprehension, but they do not count as humans. External participant count is zero; G3 and production remain blocked.

Important historical correction: V33.12 no longer assumes `/proc/net/dev` disappears in a network namespace or requires a procfs mount forbidden by some hosts. It verifies namespace identities directly and uses a sealed empty read-only `/proc` reference while retaining fail-closed local isolation limits.

Next action: execute the external human pilot with at least five real participants under the signed protocol, import signed evidence, and do not change G3 to passed until the verifier confirms every threshold and role-separation rule.

Delivery note: the internal npm registry returned E503 during two clean-install attempts. The extracted archive built and validated with the preinstalled compatible local toolchain. Do not record `npm ci` as passed; repeat the exact lockfile installation when the registry is available.
