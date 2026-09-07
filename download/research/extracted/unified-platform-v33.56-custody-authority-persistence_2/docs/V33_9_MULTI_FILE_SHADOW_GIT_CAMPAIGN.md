# V33.9 — Multi-File Engineering and Shadow Git Campaign

## Scope

V33.9 extends G4 from one explicit file to an atomic two-to-eight-file plan and a signed local Shadow Git Provider.

`chat mission → bounded multi-file plan → atomic isolated modification → tests → independent review → shadow Action Passport → signed PR proposal → provider acceptance receipt → exact rollback`

## Controls

- All target files and exact replacements are validated before any write.
- Duplicate targets, path traversal, symlink targets and non-allowlisted commands are rejected.
- Test-created changes outside the plan fail closed.
- Failed preparation resets the isolated workspace to the base commit.
- Session state and provider state are digest-bound; provider persistence is signed.
- Provider admission verifies the proposal signer, tenant and adapter.
- Idempotency conflicts and competing branch ownership are rejected.
- Cancellation is requester-bound and retries remain idempotent.
- No network, external branch push, real Pull Request, merge, deployment or production effect is permitted.

## Campaign

The local qualification campaign executes 30 missions across three distinct disposable repositories. Every mission changes two files, runs tests, receives independent review, produces a signed proposal and signed provider receipt, verifies an idempotent retry, and rolls back exactly.

## Gate truth

The campaign is `SIMULATED_LOCAL_CAMPAIGN`. G4 remains in progress because the repositories are disposable fixtures and the provider is local shadow infrastructure. Real repositories, external Git provider qualification, malicious-repository testing and independent external review remain required.
