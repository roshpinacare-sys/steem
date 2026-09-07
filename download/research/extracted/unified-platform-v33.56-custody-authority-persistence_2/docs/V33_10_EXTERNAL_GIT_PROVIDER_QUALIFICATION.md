# V33.10 — External Git Provider Qualification

## Purpose

Qualify provider-neutral Draft Pull Request / Draft Merge Request submission contracts without live credentials or external network mutation.

## Implemented boundary

- GitHub-shaped Git Data sequence: protected branch read, blobs, tree, commit, ref, Draft Pull Request.
- GitLab-shaped sequence: protected branch read, multi-action commit, Draft Merge Request.
- Ephemeral credential broker with tenant, repository, subject, scope, expiry and revocation binding.
- Secret-reference-only webhook verification.
- GitHub HMAC-SHA256 webhook verification.
- GitLab Standard Webhooks signature verification.
- Loopback-only HTTP provider qualification.
- Retry after lost response with provider-side idempotency.
- Redirect, timeout, size, malformed response and webhook-tampering failures close the workflow.

## Explicitly not proven

- No live GitHub or GitLab credential was used.
- No public provider endpoint was contacted.
- No real Pull Request or Merge Request was created.
- No merge, deployment or production effect is possible.
- No malicious repository or independent external security assessment was executed.

## Promotion posture

`LOCAL_EXTERNAL_GIT_PROVIDER_QUALIFICATION`, `shadow-only`, G4 remains `in-progress-not-passed`.
