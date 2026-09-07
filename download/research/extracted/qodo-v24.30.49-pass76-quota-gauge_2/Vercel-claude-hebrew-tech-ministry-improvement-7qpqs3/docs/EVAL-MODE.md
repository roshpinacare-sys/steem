# Sovereign Premium Evaluation (`--eval`)

A single command runs the **entire** delivery pipeline — Architect → Coder →
5-gate validator → Ghost Commit → Canary → Merge → Review — fully in-process,
with **no network, no vendor API, and no credentials**, then prints a
one-screen report proving the system worked. It is meant for the repo owner's
private evaluation: a way to see the agent operate at maximum capability,
end-to-end, in seconds, on any machine.

```bash
node packages/agent/dist/cli.js --eval
node packages/agent/dist/cli.js --eval --objective="Add a rate limiter to the API"
```

## What "sovereign" means here

Every external dependency the pipeline normally uses is replaced by an
in-process, in-memory implementation of the **real** class — so the pipeline
runs its genuine code (checkpoints, telemetry, the trust ledger, the audit
chain, all five gates), just against a local backing store:

| Real dependency | Sovereign stand-in | Where |
|---|---|---|
| Upstash Redis (state) | `LocalRedisState` (Map-backed) | `services/local/in-memory-adapters.ts` |
| R2 (blob storage) | `LocalR2Storage` | same |
| GitHub API (repo) | `LocalGitHubClient` (serves your `.qodo/policy.*` + a canonical lockfile, records every commit/comment/merge) | same |
| LLM providers | deterministic simulator (`QODO_LLM_SIM`) | `services/local/sovereign-llm.ts` |

The intelligence layer has two sovereign options, neither of which touches a
metered API:

1. **Simulator (default).** A deterministic, schema-perfect responder. It
   returns valid Architect / Coder / Reviewer JSON derived from your
   objective, so the pipeline's own validators accept it. Guaranteed offline,
   reproducible, and free.
2. **Local Ollama (opt-in).** Set `OLLAMA_BASE_URL=http://localhost:11434` to
   route every LLM call to a local Ollama server (OpenAI-compatible). Real
   intelligence, still on your own machine — no data leaves the host.

Because inference is local, **LLM spend is $0** and runs are unlimited.

## The report

```
╔════════════════════════════════════════════════════════════╗
║  QODO — SOVEREIGN PREMIUM EVALUATION                        ║
╚════════════════════════════════════════════════════════════╝
  Outcome   : SUCCESS ✓
SOVEREIGN POSTURE     external services: none · spend: $0.0000
PIPELINE              ✓ Architect ✓ Coder ✓ Gate ✓ Commit ✓ Merge ✓ Review
VALIDATION GATES      ✓ lockCheck ✓ blast ✓ dom ✓ shadow ✓ chaos ✓ test ✓ contractGuard
CONTROL LAYER         your .qodo/policy.yml, applied
TRUST LEDGER          the bond this run earned
AUDIT CHAIN           hash-linked, VALID ✓
```

The audit chain is **cryptographically verified** at the end (`verifyAuditChain`)
— every entry's SHA-256 chains to the previous — so the report is evidence, not
narration.

## It is governed by your policy

`--eval` reads your `.qodo/policy.yml` through the same code path production
uses (it is served to the pipeline as if from trunk), so budget caps, autonomy
floors, and the approval mode all take effect. The report's **Control Layer**
section shows exactly what governed the run. See [`POLICY.md`](POLICY.md).

Because the run is non-interactive, a `mentor` / `manual` policy is
auto-approved at the Ghost-Commit gate (recorded in the audit chain as an owner
pre-approval) rather than blocking on a prompt.

## Guarantees & boundaries

- **No network on the core path.** The simulator path makes zero outbound
  requests. Optional context enrichers (GitHub code/issue search) and the
  embedder-backed accelerators (semantic cache, hive, skill vector store) are
  skipped in sovereign mode — they are optional boosts, never part of the core
  validation path. The five gates still run for real: `blast-radius` uses a
  deterministic local embedding instead of downloading a model.
- **Nothing is committed anywhere.** The audit log is written to an isolated
  temp workspace, not the repo. Every "commit" and "merge" is recorded in the
  in-memory GitHub client only.
- **Off by default.** `QODO_LLM_SIM` / `OLLAMA_BASE_URL` are opt-in. With
  neither set, the agent behaves exactly as before. A normal `--dry-run`
  against real services is unchanged.
- **Owner-only.** This is an evaluation and demonstration surface, not an
  end-user feature.

## Verify it yourself

```bash
npm run build --workspace @qodo/agent
node packages/agent/dist/cli.js --eval          # expect: Outcome SUCCESS, exit 0
```

The whole flow is covered by `tests/eval-mode.test.ts` (end-to-end offline run,
audit-chain verification, policy governance) and `tests/sovereign-llm.test.ts`
(every simulated response validated against the real agent schemas).
