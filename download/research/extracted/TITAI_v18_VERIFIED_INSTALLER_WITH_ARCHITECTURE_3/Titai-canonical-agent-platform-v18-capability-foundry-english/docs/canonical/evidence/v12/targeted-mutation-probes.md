# v12 Targeted Semantic Mutation Probes

Generated: 2026-07-11T18:02:07.094Z

Curated semantic mutation probes. Each mutant removes one critical guard and is challenged by the same adversarial input as the real control.

Score: **6/6 mutants killed (100.0%)**

| ID | Control | Actual rejects attack | Mutant rejects attack | Killed |
|---|---|---|---|---|
| MUT-001 | owner authorization | yes | no | yes |
| MUT-002 | memory injection quarantine | yes | no | yes |
| MUT-003 | model health hard constraint | yes | no | yes |
| MUT-004 | dry-run side-effect denial | yes | no | yes |
| MUT-005 | dependency cycle rejection | yes | no | yes |
| MUT-006 | approval revision compare-and-set | yes | no | yes |

Limitation: This is not exhaustive AST mutation testing. It measures six high-value security and correctness guards and must not be presented as whole-repository mutation coverage.
