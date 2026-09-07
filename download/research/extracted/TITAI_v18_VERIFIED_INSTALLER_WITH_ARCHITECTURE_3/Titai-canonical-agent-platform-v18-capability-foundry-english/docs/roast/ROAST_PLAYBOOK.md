# Repeatable Roast Playbook

## Purpose

Run this audit on every meaningful release. The goal is to disprove unsafe assumptions before users or operators discover them.

## Safe workstation mode

- Never disable antivirus, EDR, firewall, or operating-system protections.
- Do not use PowerShell or execute opaque downloaded binaries.
- Prefer repository-owned Node/TypeScript checks.
- Install dependencies with lifecycle scripts disabled on sensitive machines.
- Execute native database and browser suites only in an approved clean CI image.

## Roles

1. Repository cartographer establishes verified reality.
2. Architecture prosecutor attacks invariants and failure domains.
3. Security red team attacks authority, egress, data, secrets, and supply chain.
4. Reliability prosecutor injects crash, timeout, duplicate, cancellation, and restart faults.
5. UX prosecutor looks for misleading confidence, missing recovery, inaccessible approvals, and generic control surfaces.
6. Evidence prosecutor rejects any claim without reproducible proof.
7. Independent verifier reruns evidence and attempts counterexamples.

## Execution

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run roast:static
npm run roast:validate
npm run test:safe
npm run typecheck
npm run eval:baseline
```

Run native/full gates in clean CI:

```bash
npm ci
npm test
npm run build
npm run e2e
npm audit --audit-level=high
```

## Finding contract

Every finding requires severity, status, confidence, category, description, impact, evidence, canonical task mapping, recommendation, and a falsifiable acceptance test.

## No-false-green rule

A static pass proves only its named property. Documentation, code presence, compilation, unit tests, integration tests, recovery drills, security tests, and independent verification are separate evidence classes.
