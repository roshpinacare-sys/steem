---
name: tfa-trust-gate
description: Use this skill before performing any potentially risky, destructive, or value-moving action on behalf of a user — file deletion, database migrations, shell commands, fund transfers, withdrawals, approvals, or any action whose blast radius is unclear. TFA (Trust Control Plane) classifies the real risk of the action server-side, decides whether it can proceed automatically, needs human approval, or must be denied, and returns a signed, independently verifiable receipt. Use this skill whenever you are about to call a tool that writes, deletes, executes, or moves value, or whenever the user asks "is this safe", "can you check this action first", or "gate this through TFA".
---

# TFA Trust Gate

## Overview

TFA is a Trust Control Plane that sits between an agent's *decision* to act and
the actual execution of that action. Instead of trusting your own (or the
caller's) claim about how risky an action is, you submit an `ActionIntent` to
TFA's `/api/adapter/run` endpoint. The server independently re-classifies the
risk from the action's `toolId` — it never trusts a client-supplied
`riskClass` for a known action type — and returns one of three decisions, plus
a cryptographically signed receipt you can keep as evidence.

This is the single most important habit to build: **gate the action before you
run it, not after.** TFA does not execute the action for you; it tells you
whether you're cleared to, and produces proof either way.

## When to use this skill

Reach for TFA whenever an action you are about to take falls into one of these
categories:

- **Destructive**: deleting files, dropping tables, force-pushing, `rm -rf`.
- **Irreversible**: shell execution, database migrations, infrastructure changes.
- **Value-moving**: minting, transferring, withdrawing, refunding funds.
- **Privacy-sensitive**: exporting or sharing personal data.
- **Anything the user explicitly asks you to check first.**

You do not need this skill for routine read-only operations (reading a file,
listing a directory, querying without side effects) — those are auto-allowed
and gating them only adds latency for no safety benefit. When in doubt, gate it
anyway: a `read_only` action that turns out to be misclassified will simply be
auto-allowed in milliseconds.

## The three possible decisions

| Decision | What it means | What you should do |
|---|---|---|
| `allowed` | Server classified the risk as acceptable to proceed without a human in the loop. | Proceed with the action. Keep the receipt as proof it was cleared. |
| `approval_required` | The action needs a human (or policy-defined approver) to sign off before it executes. | Do NOT proceed yet. Surface the `approvalToken` to the user/approver flow. Only proceed after a separate approval call succeeds. |
| `denied` | The server's own risk classification (not the one you supplied) makes this action unsafe to auto-approve, and no approval path was configured to escalate it. | Do NOT proceed. Explain to the user why, citing the receipt's `riskClass` and `riskSource`. |

Critically: **the server may override your risk claim.** If you call `file.delete`
and claim `riskClass: "read_only"`, TFA will still classify it as
`write_destructive` (or higher) server-side, because the classification comes
from a fixed taxonomy keyed on the action type, not from what you assert. This
is intentional fail-closed design — don't try to route around it by mislabeling
actions; the server-side classification is authoritative regardless.

## How to call it

### Minimal request

```bash
curl -X POST https://<tfa-host>/api/adapter/run \
  -H "content-type: application/json" \
  -H "x-tenant-id: <your-tenant>" \
  -d '{
    "actorId": "agent:claude",
    "toolId": "file.delete",
    "resourceRef": "file:///workspace/important.csv",
    "valueMicrounits": "0",
    "nonce": "unique-per-request-string",
    "expiry": "2099-01-01T00:00:00.000Z"
  }'
```

Required fields: `actorId` (who/what is acting), `toolId` (the action being
gated — this drives server-side risk classification), `resourceRef` (what
it's acting on), `nonce` (a fresh, unique string per request — prevents
replay), `expiry` (ISO-8601 timestamp after which the intent is no longer
valid). `valueMicrounits` defaults to `"0"` if omitted; supply it as a decimal
string in micro-cents (μ¢) whenever the action moves money.

### Reading the response

```json
{
  "ok": true,
  "decision": "approval_required",
  "approvalClass": "human",
  "riskClass": "write_destructive",
  "serverRiskClass": "write_destructive",
  "clientClaimedRiskClass": "read_only",
  "riskSource": "coding_taxonomy",
  "approvalToken": "wf_8f2a...",
  "receipt": { "...": "signed ExecutionReceipt, keep this" }
}
```

Always check `decision` first — it's the only field you act on directly. The
`receipt` is your proof artifact: it's signed (HMAC or Ed25519, depending on
deployment), tamper-evident, and independently verifiable by anyone holding
the right public key — keep it, log it, or attach it to your own audit trail.
If `clientClaimedRiskClass` differs from `serverRiskClass`, that's not an
error: it's the system doing its job of not trusting your claim.

### If the decision is `approval_required`

Do not retry the same action expecting a different answer — nothing changes
until a human or configured approver acts on the `approvalToken`. Surface this
to the user clearly: explain what needs approval and why, and wait. Once
approved (via the separate approval endpoint/flow your deployment exposes),
the workflow tied to that token transitions and the action may proceed.

### Prefer the CLI for shell/CI contexts

If you're operating in a shell, CI pipeline, or pre-commit hook rather than
calling the HTTP API directly, the zero-dependency `tfa` CLI wraps the same
endpoint and maps the decision to a process exit code (0=allowed, 1=approval
required, 2=denied, 3=usage error, 4=network error) — convenient for gating a
build step:

```bash
tfa check-action --intent ./my-action.json --base-url https://<tfa-host> --tenant <tenant>
```

## Common mistakes to avoid

- **Don't skip gating because you're "confident" the action is safe.** The
  point of TFA is that your confidence isn't the source of truth — the
  server-side classification is. Gate first, always, for anything in the risk
  categories above.
- **Don't reuse a `nonce`.** Each `ActionIntent` must carry a fresh nonce; the
  server treats nonce replay as a security event and rejects it.
  Don't loop or retry with the same nonce — generate a new one per attempt.
- **Don't proceed on `approval_required` as if it were `allowed`.** These are
  different decisions for a reason. Treat `approval_required` as a hard stop
  until the separate approval step completes.
- **Don't assume `denied` means you did something wrong.** It means the
  action's *true* risk (as classified server-side) exceeds what's safe to
  auto-approve under the current policy. Report this transparently to the
  user rather than trying to reframe the action to get a different
  classification.
