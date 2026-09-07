# Capability Preservation Inventory — v32.0.0

Source of truth: v30.0.0. Every capability area below is preserved verbatim in
v32.0.0; the corresponding `src/lib/*` directory is unmodified relative to v30.

| # | Capability             | Location                       | Status     |
|---|------------------------|--------------------------------|------------|
| 1 | Compiler Intelligence  | src/lib/compiler/              | PRESERVED  |
| 2 | IR Systems             | src/lib/compiler/ir, intelligence/ | PRESERVED |
| 3 | Runtime Profiles       | src/lib/execution/, control-plane/ | PRESERVED |
| 4 | Distillation           | src/lib/distillation/          | PRESERVED  |
| 5 | Memory Graph           | src/lib/memory/                | PRESERVED  |
| 6 | Multi-Agent Debate     | src/lib/agents/                | PRESERVED  |
| 7 | Fitness Functions      | src/lib/fitness/               | PRESERVED  |
| 8 | Chaos Harness          | src/lib/chaos/                 | PRESERVED  |
| 9 | Soak Harness           | src/lib/soak/                  | PRESERVED  |
| 10 | Recovery Systems      | src/lib/engine/, job-engine/   | PRESERVED  |
| 11 | Evidence Systems      | src/lib/audit/, observability/ | PRESERVED  |
| 12 | Release Governance    | src/lib/release/, governance/  | PRESERVED  |
| 13 | Adapters              | src/lib/integrations/          | PRESERVED  |
| 14 | Learning Systems      | src/lib/learning/, self-evolution/ | PRESERVED |
| 15 | Project Management    | src/lib/project-store.ts, workflow/ | PRESERVED |
| 16 | Artifact Generation   | src/lib/automation/, batch/    | PRESERVED  |

No capability was removed, renamed, or downgraded between v30.0.0 and v32.0.0.
