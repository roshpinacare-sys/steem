# v32.7 Proof Diversity, Integration Stress and Release Decision Closure

## Purpose

v32.7 strengthens the repository-local proof model. Test count alone is not treated as confidence. Critical claims require distinct proof techniques, independent oracles, more than one execution environment, observed evidence, and coverage of named defect classes.

## New controls

1. **Proof diversity and independence** — critical claims require at least six techniques, two independent oracles and two environments. Stale, inauthentic, incomplete or merely computed evidence is not counted.
2. **Integration contract assurance** — every critical edge binds success, rejection, timeout, replay, concurrency, tamper, rollback, tenant isolation, observability and evidence references.
3. **Integration fault campaigns** — critical edges are evaluated against timeout, duplicate, reorder, tamper, partial-write, dependency-unavailable and tenant-confusion scenarios.
4. **Governed release assurance** — semantic impact, governance, selected tests, proof diversity, integration closure, fault results, claim closure, evidence identity and rollback are aggregated. The result may become ready for external qualification, but production promotion always remains blocked.

## Rollback

The v32.7 additions are additive pure evaluators. Rollback removes the four v32.7 source modules, their dedicated test file, scripts, architecture-path declarations and governance records. No persistent production format or external state is changed by this cycle.

## Truth boundary

The cycle deepens local proof and integration coverage. It does not execute HSM/KMS custody, external witness, PostgreSQL HA/PITR, independent review, human pilot or multi-host SLO qualification.
