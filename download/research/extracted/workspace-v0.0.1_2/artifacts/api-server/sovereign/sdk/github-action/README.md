# TFA Trust Gate — GitHub Action

Block a pull-request or CI workflow step when an agent action is not approved by the [TFA Trust Control Plane](https://github.com/tfa-org/tfa).

## Quick start

```yaml
# .github/workflows/tfa-gate.yml
name: TFA Trust Gate

on: [pull_request]

jobs:
  tfa-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: TFA trust gate
        uses: tfa/tfa-trust-gate@v1
        with:
          intent: './.tfa/action-intent.json'
          base-url: ${{ vars.TFA_BASE_URL }}
          tenant: ${{ vars.TFA_TENANT_ID }}
          api-key: ${{ secrets.TFA_API_KEY }}
          public-key: ${{ vars.TFA_PUBLIC_KEY }}   # offline Ed25519 verify
```

The step **passes** (`exit 0`) when TFA returns `decision=allowed` and **fails** with an error annotation when TFA returns `approval_required` or `denied`.

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `intent` | ✅ | — | Path to ActionIntent JSON (relative to workspace root), or `-` for stdin |
| `base-url` | | `$TFA_BASE_URL` or `http://localhost:3000` | TFA API base URL |
| `tenant` | | `$TFA_TENANT_ID` | Tenant id |
| `api-key` | | `$TFA_API_KEY` | API key (store as GitHub secret) |
| `public-key` | | — | Ed25519 SPKI PEM public key for offline verification |
| `secret` | | — | HMAC-SHA256 secret for offline verification |
| `allowed-outcomes` | | `allowed` | Comma-list of outcomes that pass the step |
| `json-output` | | `false` | Log raw JSON receipt |
| `node-path` | | `node` | Override Node.js binary path |

## Outputs

| Output | Description |
|---|---|
| `decision` | `allowed` \| `approval_required` \| `denied` |
| `execution-id` | TFA executionId (correlation id for receipts) |
| `approval-token` | approvalToken when `approval_required` |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | `allowed` — action may proceed |
| 1 | `approval_required` — blocked pending human/policy approval |
| 2 | `denied` — action rejected by policy |
| 3 | Usage error (bad arguments, malformed intent JSON) |
| 4 | Network/server error (TFA unreachable or 5xx) |

## Offline receipt verification

Passing a `public-key` (Ed25519, SPKI PEM) or `secret` (HMAC-SHA256) causes the action to fetch the signed receipt after the decision and verify its signature locally. This provides tamper-evident proof that TFA issued the decision — useful in regulated environments.

```yaml
- name: TFA trust gate (with offline verify)
  uses: tfa/tfa-trust-gate@v1
  with:
    intent: './.tfa/action-intent.json'
    tenant: ${{ vars.TFA_TENANT_ID }}
    api-key: ${{ secrets.TFA_API_KEY }}
    public-key: ${{ vars.TFA_PUBLIC_KEY }}
```

## Post proof as a PR comment

Enable `post-comment` to automatically post the TFA decision and receipt as a pull-request comment. Useful for open-source projects that want to show every contributor that agent actions were reviewed by the Trust Control Plane.

```yaml
- name: TFA trust gate
  uses: tfa/tfa-trust-gate@v1
  with:
    intent: './.tfa/action-intent.json'
    tenant: ${{ vars.TFA_TENANT_ID }}
    api-key: ${{ secrets.TFA_API_KEY }}
    post-comment: 'true'
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

Requirements for PR comments:
- Workflow must run on `pull_request`
- Workflow permission `pull-requests: write` must be granted
- The `gh` CLI is pre-installed on GitHub-hosted runners

## Allow approval_required through

For workflows that handle human approval downstream:

```yaml
- name: TFA trust gate
  id: tfa
  uses: tfa/tfa-trust-gate@v1
  with:
    intent: './.tfa/action-intent.json'
    allowed-outcomes: 'allowed,approval_required'

- name: Request human approval
  if: steps.tfa.outputs.decision == 'approval_required'
  run: |
    echo "Pending approval token: ${{ steps.tfa.outputs.approval-token }}"
    # POST the token to your approval workflow here
```

## Requirements

- Node.js 22+ (add `actions/setup-node@v4` with `node-version: '22'` before this action)
- Reachable TFA API (on-premise, self-hosted, or TFA Cloud)

## License

MIT © TFA
