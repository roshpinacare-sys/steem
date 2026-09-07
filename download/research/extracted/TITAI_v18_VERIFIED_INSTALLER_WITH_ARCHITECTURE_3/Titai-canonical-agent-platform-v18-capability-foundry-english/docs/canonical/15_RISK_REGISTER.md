# Risk Register

| ID | Risk | Severity | Primary controls |
|---|---|---:|---|
| R-01 | Process crash loses work or approval | Critical | checkpoints, leases, resume tests, idempotency |
| R-02 | Duplicate external side effect | Critical | idempotency record, broker, replay tests |
| R-03 | Prompt or retrieval injection controls tools | Critical | trust separation, capability broker, red team |
| R-04 | Cross-tenant or cross-run data leakage | Critical | identity, data scope, negative tests, cache isolation |
| R-05 | Durable false memory | High | provenance, confidence, correction, forgetting, evals |
| R-06 | Poisoned model, dataset, skill, or plugin | Critical | registry, AI-BOM, provenance, signing, quarantine |
| R-07 | Tool or protocol server expands permissions | Critical | pinned identity, descriptors, broker, deny by default |
| R-08 | Secret leakage through logs or telemetry | Critical | redaction, classification, leak scans, retention |
| R-09 | Unbounded agents or resource consumption | High | budgets, stopping, cancellation, overload controls |
| R-10 | Cloud or free-tier dependency disappears | High | optional adapters, local recovery, exit tests |
| R-11 | Backup exists but cannot restore | Critical | scheduled clean restore drills, checksums, key custody |
| R-12 | Model revision silently changes behavior | High | hashes, registry, qualification, promotion, rollback |
| R-13 | Benchmark gaming or judge bias | High | owned workloads, deterministic checks, human samples |
| R-14 | Approval fatigue becomes automatic consent | High | scoped approval, edit/deny, risk tier, UX measurement |
| R-15 | Distributed identity or queue complexity exceeds value | High | deployment profiles, measured scale trigger, rollback |
| R-16 | Licensing or data rights block distribution | High | asset registry, license checklist, unresolved-question gate |
| R-17 | Telemetry creates privacy and storage liability | High | minimization, sampling, access, deletion, export policy |
| R-18 | Cache returns stale or policy-incompatible output | High | scoped keys, invalidation, non-cacheable classes, tests |
| R-19 | Agent self-modification causes regression | High | version, eval, approval, promotion, rollback |
| R-20 | Product becomes broad but not valuable | High | beachhead workflows, outcome metrics, feature rejection |
