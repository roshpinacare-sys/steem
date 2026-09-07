# V33.8 — Chat to Reviewed Pull Request Proposal

## Scope

V33.8 begins G4 with one real local vertical slice:

`chat request → authority-bound mission → approval by policy → isolated repository clone → exact bounded change → tests → evidence → independent review → shadow Action Passport → signed Pull Request proposal → exact rollback`

## Controls

- The mission, authority grant and change plan must bind to the same tenant, subject and objective.
- `repository.write` must be explicitly requested and granted.
- The mission must prohibit `git.push`, `git.merge` and `production.deploy`.
- Approval is required only when policy requires it; a non-YES result cannot authorize preparation.
- Local preparation never removes the independent-review requirement.
- Builder and requester cannot act as reviewer.
- The Pull Request proposal is signed and digest-bound.
- The proposal states that no push, merge, deployment or other external effect occurred.
- Rollback must restore the exact base tree.

## Current limitations

- One explicit target-file replacement per mission.
- Trusted local repository and allowlisted `node --test` execution only.
- No external Git provider adapter.
- No actual branch push, Pull Request creation, merge or deployment.
- No three-repository / thirty-mission G4 campaign yet.
- No external security review or malicious-repository qualification.

## Gate truth

G4 is now `in-progress`, not passed. The local vertical slice is implemented and reproducible, but the G4 pass criteria remain unmet.
