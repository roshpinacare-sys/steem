# TITAI v18 Evidence Index

Primary v18 evidence is stored under `docs/canonical/evidence/v18/`.

## Capability subsystem

- `V18_CAPABILITY_FOUNDRY_EVIDENCE.json`
- `V18_CAPABILITY_REGISTRY_EXPORT.json`
- `V18_MISSION_COMPILER_EVIDENCE.json`
- `V18_POLICY_EVIDENCE.json`
- `V18_SANDBOX_EVIDENCE.json`
- `V18_SELF_IMPROVEMENT_EVIDENCE.json`
- `V18_MULTI_AGENT_EVIDENCE.json`
- `V18_EVALUATION_EVIDENCE.json`
- `V18_ADVERSARIAL_EVIDENCE.json`
- `V18_LOCAL_TOOL_EXECUTION_EVIDENCE.json`
- `V18_FOUNDRY_CANDIDATE_EVIDENCE.json`
- `persistence-proof.json`
- `packages/titai-local-document-toolpack-1.0.0/`

## Release gates

- `full-tests/summary.json` - 81 isolated files and 262 tests, with zero failures and zero timeouts.
- `gates/` - command output, exit code, duration and output hashes for source, evaluation, mutation, Roast, build and release gates.
- `validation.json` - consolidated software and subsystem decision evidence.
- `docs/roast/ROAST_FINDINGS.json` - 100 historical and current findings.
- `docs/roast/RELEASE_MANIFEST.json` - generated only after source freeze.

The external release verifier and archive extraction evidence are generated after the final source ZIP is assembled. Physical v17 gates remain separate and blocked without returned external-hardware evidence.
