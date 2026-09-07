# V33.10 Execution Ledger

## Implemented

- Added a provider-neutral external Git qualification contract for GitHub and GitLab.
- Added ephemeral credentials bound to provider, tenant, repository, subject, scopes, expiry and revocation.
- Added secret-reference-only webhook verification.
- Reproduced GitHub-shaped protected-branch, blob, tree, commit, ref and Draft Pull Request flow on a local reference server.
- Reproduced GitLab-shaped protected-branch, multi-action commit and Draft Merge Request flow on a local reference server.
- Added signed receipt verification and request trace evidence.
- Added retry after provider acceptance with lost response and provider-side duplicate suppression.

## Adversarial closure

- Rejected non-loopback endpoints, redirects, malformed and oversized responses, timeouts and HTTP failures.
- Rejected proposal, bundle, file digest, path, head prefix, tenant and credential-scope substitution.
- Rejected tampered GitHub and GitLab webhook signatures.
- Verified credentials are never serialized into manifests, receipts or provider metrics.
- Verified no merge or deployment endpoint is called.

## Evidence

- 17/17 V33.10 targeted tests passed.
- 180/180 V33.1–V33.10 direct tests passed.
- GitHub and GitLab local provider qualification both passed with signed webhook evidence.
- Response-loss retry produced one draft object and one webhook record.
- 1,347/1,347 repository tests passed across 195 files with exit code 0.
- Repository truth map: 196 source modules, 195 test files and zero findings.
- Architecture: 115/115 capability paths, zero source cycles and zero untested sources.

## Boundary

This is `LOCAL_EXTERNAL_GIT_PROVIDER_QUALIFICATION`. No live provider credential, public GitHub or GitLab endpoint, real branch, real Draft Pull Request or Merge Request, merge, deployment or production effect was executed. G4 remains in progress.
