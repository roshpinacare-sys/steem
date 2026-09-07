# v13 Semantic Mutation Probes

Twelve curated semantic mutants covering pilot authorization, memory, routing, durable planning, approvals, verification, and fail-closed readiness.

Score: **12/12 (100.0%)**

| ID | Control | Killed |
|---|---|---|
| V13-MUT-01 | tenant predicate | yes |
| V13-MUT-02 | owner predicate | yes |
| V13-MUT-03 | memory poisoning filter | yes |
| V13-MUT-04 | unavailable model hard rejection | yes |
| V13-MUT-05 | dry-run side-effect boundary | yes |
| V13-MUT-06 | DAG cycle rejection | yes |
| V13-MUT-07 | approval revision compare-and-set | yes |
| V13-MUT-08 | verifier separation | yes |
| V13-MUT-09 | unknown evidence blocks pilot | yes |
| V13-MUT-10 | attestation tamper detection | yes |
| V13-MUT-11 | expired approval cannot resolve | yes |
| V13-MUT-12 | verification requires release hash | yes |

Limitation: Curated semantic mutation is stronger than source-pattern counting but is not exhaustive AST mutation across the repository.
