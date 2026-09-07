# @tfa/cli

Zero-dependency command-line client for the **TFA Trust Control Plane**. Gate an
agent action through TFA from a shell, a CI job, or a pre-commit hook — no SDK
import, no build step. Drop `bin/tfa.mjs` into any Node 22+ environment.

## Why

Wedge #1 from the TFA go-to-market plan: a coding agent (Claude Code, Cursor,
OpenHands...) is about to run `rm -rf` or a `db migrate` in production. Pipe the
proposed action through `tfa check-action` first — it returns `allowed`,
`approval_required`, or `denied`, plus a signed receipt, and exits with a
CI-friendly status code so you can gate a step on the result.

## Install

Drop `bin/tfa.mjs` into your project and run it with `node bin/tfa.mjs ...`, or
install as a package and use the `tfa` binary directly (no dependencies — uses
the built-in `fetch`).

## Usage

```sh
# From a file
tfa check-action --intent ./my-action.json --base-url https://api.example.com --tenant acme

# From stdin (e.g. piped from another tool that builds the intent)
echo '{...}' | tfa check-action --intent - --tenant acme --json

# Environment variables instead of flags
export TFA_BASE_URL=https://api.example.com
export TFA_TENANT_ID=acme
export TFA_API_KEY=sk_live_...
tfa check-action --intent ./my-action.json
```

### Intent JSON shape

```json
{
  "actorId": "agent:ci-bot",
  "toolId": "file.delete",
  "resourceRef": "repo:prod/db.sql",
  "riskClass": "write_destructive",
  "valueMicrounits": "0",
  "privacyLevel": "internal",
  "approvalPolicyRef": "pol:default",
  "nonce": "unique-per-call-string",
  "expiry": "2099-01-01T00:00:00.000Z",
  "provenance": "ci",
  "evidencePolicy": "ev:default"
}
```

### Exit codes (CI-friendly)

| Code | Meaning                                          |
|------|---------------------------------------------------|
| 0    | `allowed` — action may proceed                    |
| 1    | `approval_required` — blocked pending approval     |
| 2    | `denied` — action rejected outright                |
| 3    | usage error (bad flags, malformed intent JSON)      |
| 4    | network / server error (could not reach TFA, 5xx)   |

Example in a CI step:

```sh
tfa check-action --intent ./action.json --tenant acme || {
  code=$?
  if [ "$code" -eq 1 ]; then echo "Needs human approval — opening a ticket"; fi
  if [ "$code" -eq 2 ]; then echo "Denied — failing the build"; exit 1; fi
}
```

## Roadmap

This is sub-step 1 of the SDK/CLI wedge. Planned next: `tfa start` (open a
durable execution workflow and poll status) and `tfa receipt` (fetch + verify
a signed receipt offline against a known public key / KID).

## License

MIT
