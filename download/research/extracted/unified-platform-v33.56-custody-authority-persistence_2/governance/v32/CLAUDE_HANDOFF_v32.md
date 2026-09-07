# Claude-Compatible Handoff — v32

## Canonical status

- Program: Sovereign Evidence-Carrying Execution Fabric
- Product: Governed Engineering and Change Assurance
- Version: 32.0
- Readiness: Integrated Pilot
- Production promotion: blocked
- External mutation: not authorized

## Read first

1. `CLAUDE.md`
2. `MASTER_DIRECTIVE.md`
3. `PROGRAM_CHARTER.md`
4. `governance-state/PROGRAM_STATE.json`
5. `governance-state/NEXT_ACTION.json`
6. `governance-state/OPEN_DECISIONS.json`
7. `governance/v32/V32_EXECUTIVE_VERDICT.md`
8. `governance/v32/INDEPENDENT_REVIEW_VERDICT_v32.md`
9. `governance/v32/V33_NEXT_GATE_DEFINITION.md`
10. `governance/v32/V33_EXTERNAL_QUALIFICATION_RUNBOOK.md`

## Canonical commands

```bash
npm ci --ignore-scripts
npm run validate:v32
```

## v32 implementation focus

- `src/security/credential-issuer-trust.ts`
- `src/security/reviewer-trust.ts`
- `src/security/provider-trust.ts`
- `src/platform/credential-trust-bundle.ts`
- `src/contracts/crypto.ts`
- `scripts/run-credential-sovereignty-mutation-v32.py`
- `scripts/credential-sovereignty-proof-v32.mjs`
- `scripts/validate-v32.py`

## Non-negotiable invariants

- Registered public keys do not acquire credential issuance authority.
- Issuer grants are signed, exact-digest-bound, tenant/scope/kind/time limited and revocable.
- Root threshold counts distinct pinned custodians, not key IDs alone.
- Credential acceptance time is sovereign and cannot be caller-overridden.
- Historical verification is evaluated at evidence time; live authorization is evaluated at acceptance/current time.
- A local anchor is not represented as protection from joint rollback of all storage.
- Signatures establish authorization and binding, not truth.
- Model output remains proposal-only and external mutations remain zero.

## Next work

Externally qualify roots, custodians, revocation propagation, monotonic witnessing, PostgreSQL, HSM/KMS, isolation, security and human value. Do not enlarge the kernel or claim Production.
