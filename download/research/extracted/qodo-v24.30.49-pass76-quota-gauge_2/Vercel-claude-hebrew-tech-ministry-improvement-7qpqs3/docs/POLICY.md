# Per-Repo Policy (`.qodo/policy.yml`)

The agent has always been configured by ~70 operator-side environment
variables — global, and out of the repo owner's hands. A repo-level policy
gives **you**, the owner of a repository, a versioned, portable control surface
that travels with your code: a hard spend cap and an autonomy floor today, more
knobs over time. No vendor dashboard, no code changes — the policy is a file in
your repo, reviewed and merged like any other.

## Where it lives and how it's read

Put one of these on your **default branch** (in priority order):

```
.qodo/policy.yml
.qodo/policy.yaml
.qodo/policy.json
```

**Security / sovereignty:** the policy is read from the repository's *trunk*,
never from a pull request's head. A PR therefore cannot raise its own budget
cap or flip autonomy to `full` — the effective policy is always what the owner
committed to the default branch. Absent or malformed policy → safe defaults
that preserve current behavior (fail-open, but the mistake is logged loudly and
surfaced in telemetry, never silent).

## One-command readiness (`--doctor`)

Before a run, ask one question and get one answer:

```bash
node packages/agent/dist/cli.js --doctor
```

`--doctor` is local and offline (presence checks only — it never calls the
network or prints secret values). In one screen it tells you:

- **Configuration** — which required settings (a provider key, `GITHUB_TOKEN`,
  the Upstash pair) are present, and for anything missing, exactly what to set
  and where.
- **Control surface** — the effective `.qodo/policy.yml` (budget, autonomy,
  approval), or a tip to create one.
- **Next run will** — the plain-English pipeline path for your policy, whether
  it will pause for approval, and the budget ceiling.
- **Verdict** — `READY ✓` / `NOT READY ✗`, with a non-zero exit code so it also
  works as a pre-run gate in scripts and CI.

## Inspect it locally (`--policy`)

The control surface is **local-first and operationally clear**: from your
checkout, run

```bash
node packages/agent/dist/cli.js --policy
```

It reads the working tree's `.qodo/policy.*`, needs **zero credentials**, and
prints exactly what is in effect — budget, autonomy, approval, and what stays
mandatory. It exits non-zero if the file is present but invalid, so you can
lint it in CI. This is how you verify your controls as the repo owner before a
real run.

```
Qodo repository control surface (.qodo/policy)
──────────────────────────────────────────────
  source        : .qodo/policy.yml
  budget cap    : $2.00 per run (hard stop)
  autonomy      : full — normal operation
  approval      : auto — never require the interactive gate (owner pre-approves)

  Always enforced (not policy-toggleable): 5-gate validator,
  secret/path guards, sacred-file integrity, kill switch, audit log.
```

## Schema (`version: 1`)

```yaml
version: 1

budget:
  maxUsdCents: 200        # hard per-run LLM spend cap, in USD cents

autonomy: full            # full | mentor | dry-run
approval: trust           # manual | trust | auto  (refines autonomy: full)
```

### `budget.maxUsdCents`

A **hard cap** on estimated LLM spend for a single run. The pipeline checks
accumulated spend at each phase boundary and **halts cleanly** — before the
next costly or destructive step (Coder, Commit, Canary, Merge) — once the cap
is reached, then comments the reason on the PR. Distinct from
`QODO_COST_ALERT_USD_CENTS`, which only *warns*. Omit to disable.

This is runaway-spend protection owned by the repo, not the operator: the
single biggest fear of running an autonomous agent, made explicit and bounded.

### `autonomy`

The floor of autonomy the repo grants. Policy can only **add** restriction on
top of the operator's global env, never remove it:

| Value | Effect |
|---|---|
| `full` (default) | Normal operation. |
| `mentor` | Forces mentor mode: a human approves each change before the Ghost Commit (the mentor-approval loop). |
| `dry-run` | The agent plans, codes, and validates but **never** commits, deploys, or merges — a safe way to let it run on a sensitive repo. |

### `approval` (refines `autonomy: full`)

Controls the human-approval (mentor) gate. Ignored when `autonomy` is `mentor`
(always requires approval) or `dry-run` (never commits). Omit to inherit the
current env / supervisor / uncertainty behavior unchanged.

| Value | Effect |
|---|---|
| `manual` | Always require approval before the Ghost Commit. |
| `trust` | Consult the **trust ledger**: auto-proceed when this run's category bond is at/above the auto-merge threshold and not on probation; otherwise require approval. This is where the trust ledger finally drives behavior instead of just accumulating. |
| `auto` | Never require the interactive gate — the owner pre-approves from the trunk. Overrides the supervisor/uncertainty escalation (the override is audit-logged). Gates, kill switch, budget and audit still apply. |

### Admin owner at highest capability, minimal restriction

The configuration for running the agent at the highest practical capability —
the repo owner trusting it fully, with only the non-negotiable safety floor:

```yaml
version: 1
autonomy: full
approval: auto        # no interactive gate — owner pre-approves
# budget: omitted     # unbounded (or set a generous cap you're comfortable with)
```

Even here, the 5-gate validator, secret/path guards, sacred-file integrity, the
kill switch (`QODO_HALT`), and the hash-chained audit log remain in force — they
are invariants, not preferences. `--policy` shows you exactly this.

## Enforcement points

- Policy is loaded once at run start, before the supervisor and any LLM call,
  so autonomy overrides and the budget cap are in force from the first token.
- Both the loaded policy and every budget halt are recorded in the
  hash-chained audit log and emitted as telemetry (`policy`/`budget` phases),
  so they're visible in Mission Control and the audit trail.

## Not yet configurable (deliberately)

The five core validation gates and the safety guards (secret/path guards,
sacred-file integrity, kill switch) are **not** policy-toggleable — they are
invariants, not preferences. Gate strictness, model-tier routing, and
trust-ledger auto-merge thresholds are natural future additions to this schema;
they were left out of the first version to keep the surface small and safe.

See `.qodo/policy.example.yml` for a copy-paste starting point.
