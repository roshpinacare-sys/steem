# Roast Traceability Matrix

| Finding | Severity | Status | Category | Canonical tasks | Primary evidence |
|---|---|---|---|---|---|
| F-001 | critical | open | durability | DUR-001, DUR-002, DUR-003, INF-002 | `src/lib/engine/start.ts` |
| F-002 | critical | open | durability | DUR-001, DUR-002, CAP-002 | `src/lib/engine/runner.ts` |
| F-003 | critical | partially_mitigated | identity-tenancy | IAM-001, DAT-001 | `src/lib/db/schema.ts` |
| F-004 | critical | fixed_in_v8 | security-egress | THR-001, CAP-001 | `src/lib/security/egress.ts` |
| F-005 | critical | fixed_in_v8 | runtime-correctness | LIF-001, EVAL-001 | `src/lib/engine/plan.ts` |
| F-006 | critical | open | recovery | OPS-001 | `docs/canonical/20_DATA_LIFECYCLE_CONTRACT.md` |
| F-007 | high | open | supply-chain | SUP-001 | `package.json` |
| F-008 | high | fixed_in_v8 | authorization | IAM-001, POL-001 | `src/app/api/policies/route.ts` |
| F-009 | high | fixed_in_v8 | authorization | IAM-001, SKL-001 | `src/app/api/skills/[skillId]/route.ts` |
| F-010 | high | fixed_in_v8 | capability-security | CAP-001, CAP-002 | `src/lib/engine/tools/index.ts` |
| F-011 | high | fixed_in_v8 | human-oversight | POL-001, UX-001 | `src/lib/engine/policy.ts` |
| F-012 | high | open | reliability | DUR-001, REL-001, PERF-001 | `src/lib/engine/runner.ts` |
| F-013 | high | open | integrity | DUR-002, OBS-001 | `src/lib/engine/events.ts` |
| F-014 | high | open | audit-integrity | OBS-001, SEC-002 | `src/lib/engine/audit.ts` |
| F-015 | high | fixed_in_v8 | provider-routing | PROV-001, PROV-002 | `src/lib/engine/gateway.ts` |
| F-016 | high | fixed_in_v8 | startup-integrity | OPS-001, INF-001 | `src/lib/db/index.ts` |
| F-017 | high | partially_mitigated | agent-security | CAP-001, CAP-002, THR-001 | `src/lib/engine/tools/httpFetch.ts` |
| F-018 | high | environment_blocked | verification | EVAL-002 | `docs/roast/evidence/v8-full-tests.txt` |
| F-019 | high | environment_blocked | release-verification | EVAL-002, INF-001 | `docs/roast/evidence/build.txt` |
| F-020 | high | open | data-governance | DAT-001, OPS-001, MEM-001 | `docs/canonical/20_DATA_LIFECYCLE_CONTRACT.md` |
| F-021 | high | open | identity-tenancy | IAM-001 | `src/lib/db/schema.ts` |
| F-022 | high | partially_mitigated | identity-tenancy | IAM-001, OBS-001 | `src/app/api/audit/verify/route.ts` |
| F-023 | high | open | authentication | IAM-001, SEC-002 | `src/app/api/register/route.ts` |
| F-024 | high | open | cryptography | SEC-002 | `src/lib/crypto.ts` |
| F-025 | high | open | api-reliability | DUR-002 | `src/app/api/runs/route.ts` |
| F-026 | high | open | human-oversight | DUR-003, UX-001 | `src/lib/engine/runner.ts` |
| F-027 | high | open | recovery | DUR-003 | `src/lib/engine/runner.ts` |
| F-028 | high | fixed_in_v8 | resource-governance | LIF-001, PERF-001 | `src/lib/engine/plan.ts` |
| F-029 | high | fixed_in_v8 | runtime-correctness | LIF-001, EVAL-002 | `src/lib/engine/runner.ts` |
| F-030 | medium | fixed_in_v8 | economics | OBS-001, PERF-001 | `src/lib/engine/runner.ts` |
| F-031 | medium | fixed_in_v8 | evidence-integrity | UX-002, OBS-001 | `src/lib/engine/runner.ts` |
| F-032 | medium | open | privacy | DAT-001, OBS-001 | `src/lib/engine/runner.ts` |
| F-033 | medium | fixed_in_v8 | resource-governance | CAP-002, PERF-001 | `src/lib/engine/tools/writeArtifact.ts` |
| F-034 | medium | open | policy-engine | POL-001, SEC-002 | `src/lib/engine/policy.ts` |
| F-035 | medium | open | abuse-control | IAM-001, INF-002 | `src/lib/rate-limit.ts` |
| F-036 | medium | partially_mitigated | browser-security | THR-001 | `next.config.ts` |
| F-037 | medium | open | code-quality | EVAL-002, SUP-001 | `scripts/lint-source.mjs` |
| F-038 | high | open | supply-chain | SUP-001, MOD-001 | `package.json` |
| F-039 | high | open | observability | OBS-001, OBS-002, PERF-001 | `src/lib/engine/event-types.ts` |
| F-040 | high | open | memory | MEM-001, MEM-002, MEM-003 | `docs/canonical/06_DATA_MEMORY_KNOWLEDGE.md` |
| F-041 | high | open | model-routing | MOD-001, PROV-001, PROV-002 | `src/lib/engine/gateway.ts` |
| F-042 | high | open | evaluation | EVAL-002, REL-001 | `tests` |
| F-043 | medium | open | evaluation | EVAL-002, UX-001 | `e2e` |
| F-044 | medium | open | operations | OPS-001, SEC-002 | `scripts/seed.ts` |
| F-045 | medium | partially_mitigated | evidence-quality | UX-002, EVAL-002 | `src/components/runs/evidence-ledger.tsx` |
| F-046 | high | open | program-execution | CAN-001 | `docs/canonical/tasks/TASKS.json` |
| F-047 | high | open | infrastructure | INF-001, INF-002, DUR-001 | `src/lib/db/index.ts` |
| F-048 | high | open | browser-security | THR-001 | `next.config.ts` |
| F-049 | high | open | capability-security | CAP-001, CAP-002, DEV-001 | `src/lib/engine/tools/index.ts` |
| F-050 | high | open | context-engineering | CTX-001, RSN-001, RSN-002 | `src/lib/engine/runner.ts` |
