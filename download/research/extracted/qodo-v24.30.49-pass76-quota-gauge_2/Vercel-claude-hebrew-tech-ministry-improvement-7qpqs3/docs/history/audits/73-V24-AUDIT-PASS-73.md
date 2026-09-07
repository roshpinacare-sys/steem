# QODO V24 — Audit Pass 73
**Version:** 24.30.45
**Date:** 2026-07-07
**Protocol:** CIEP-X v10.0
**Task:** task-34 — Centralized secrets/config management decision (Doppler vs. Infisical vs. status quo)
**Type:** Owner-decision pass (documentation only — no new source or config files)
**Baseline:** 24.30.44 (Pass 72 — Turborepo/Nx Cloud CI caching decision)

---

## PASS 1 — Impact Analysis

| Dimension | Assessment |
|---|---|
| Engineering value | High as a decision: locks in a clear recommendation with documented reversal conditions, preventing recurring re-evaluation on a topic with real security implications. |
| Implementation risk | Zero — documentation-only pass. |
| Compatibility impact | Zero — no source, workflow, config, or env files modified. |
| Rollback complexity | N/A. |

---

## PASS 2 — Context

### Current secrets management baseline

The project manages secrets across two environments:

1. **Local development** — `bootstrap.mjs` interactive wizard collects credentials, writes `.env`, and optionally pushes each key to GitHub Actions via `gh secret set` (GitHub CLI). The `.env.example` template documents all ~40 env vars across ten categories (required, optional LLM, R2, Vercel, Upstash, kill-switch, behavior flags, integrations, CI, edge+runtime, support, observability, cost alerting).

2. **CI / Production (GitHub Actions)** — `agent-pipeline.yml` reads secrets directly from GitHub Actions repository secrets, injected as environment variables. No `.env` file is read at CI time.

The two mechanisms are complementary and already working:
- `bootstrap.mjs` solves the initial-setup friction the task-34 survey identified.
- GitHub Secrets is the authoritative CI store and the transit path for production secrets.
- `.env.example` is comprehensive and kept up-to-date by the infra-oracle agent.

### Candidates evaluated

| Candidate | Model | Cost | Key characteristics |
|---|---|---|---|
| **Doppler** | SaaS | Free Developer plan (1 user, 1 project); paid plans for teams | Centralized UI for env vars across dev/staging/prod; native GitHub Actions integration (secrets sync); secrets stored on Doppler servers |
| **Infisical** | Open-source SaaS or self-hosted | Free cloud tier (3 users); self-hosted is free but requires own infra | Same pattern as Doppler; self-hosting eliminates SaaS trust concern but adds infrastructure overhead |
| **Status quo** | `bootstrap.mjs` + GitHub Secrets + `.env` | Free (already in use) | Interactive setup wizard; all secrets in GitHub's own secrets store for CI; local `.env` for dev |

### Key constraints active in this codebase

1. **`QODO_PRIVACY_MODE=strict` is a load-bearing invariant** (Do Not Touch List item 4, `04-SYSTEM-INVARIANTS.md`). All 40+ secrets — including LLM API keys and `GITHUB_TOKEN` — flow through paths guarded by this invariant. Adding any new intermediary in the secrets transit chain is a security-relevant architectural change, not a convenience upgrade.

2. **`env-schema.ts` validates required vars at startup.** `GITHUB_TOKEN`, `GROQ_API_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `REPO`, and `OBJECTIVE` are validated before the pipeline phase state machine starts. The validation path is independent of whatever delivery mechanism populates them.

3. **`bootstrap.mjs` already solves the friction.** The task-34 survey framing ("reduces the exact friction bootstrap.mjs exists to solve") is accurate — but bootstrap.mjs already resolves it for both local dev (`.env` write) and CI (GitHub Secrets push). The marginal friction reduction from adding Doppler or Infisical is small relative to the trust-surface cost.

4. **GitHub Secrets is already the production trust anchor.** The pipeline in `agent-pipeline.yml` uses GitHub Secrets natively. Routing those secrets through a third-party manager before they reach GitHub Secrets would either (a) duplicate the trust surface or (b) replace GitHub Secrets with the third-party store — the latter is a vendor dependency for a security-critical path.

---

## PASS 3 — Decision

### Doppler — NO-GO

Three independent blockers, each individually sufficient:

**B1 — Adds a new trust boundary over all pipeline secrets.**
Every secret the pipeline uses — including `GITHUB_TOKEN`, all LLM API keys, Redis tokens, and the `QODO_DISPATCH_SECRET` Worker auth — would transit Doppler's servers before reaching the agent or CI runner. This expands the attack surface of the pipeline's most sensitive path (the one protected by `QODO_PRIVACY_MODE=strict`) with a non-removable third-party SaaS dependency.

**B2 — Free tier is a single-user plan, incompatible with team use.**
Doppler's free Developer plan covers 1 user and 1 project. Any team usage requires a paid plan. The project's free-tier posture (established across Passes 42, 65, 67, 68, 70, 72) requires that adopted integrations have a meaningful free operating envelope.

**B3 — `bootstrap.mjs` already provides the primary stated benefit.**
Doppler's main value proposition is reducing the friction of managing env vars across environments. `bootstrap.mjs` already covers this for this project's two environments (local `.env` + GitHub Actions secrets). Replacing a working, zero-cost, vendor-free mechanism with a SaaS dependency solves a problem that is already solved.

**Reversal conditions** (all three required simultaneously):
1. A team-size deployment is planned where multiple contributors each need independent secrets management (invalidates B2).
2. A formal risk assessment concludes Doppler's SaaS trust boundary is acceptable for the `PRIVACY_MODE=strict` path (invalidates B1).
3. `bootstrap.mjs` is identified as a persistent friction point not addressable by local improvement (invalidates B3).

---

### Infisical — NO-GO

Two independent blockers:

**B1 — Cloud Infisical shares B1 with Doppler (SaaS secrets transit).**
Infisical's cloud instance stores secrets on Infisical's servers. The trust-surface argument is identical to Doppler B1 above.

**B2 — Self-hosted Infisical contradicts the minimal-infra posture.**
Self-hosting Infisical eliminates the SaaS trust concern but requires provisioning and operating a dedicated secrets-management service (Docker or Kubernetes deployment, PostgreSQL, Redis, and TLS termination). The project's established pattern — Tier 1 is Upstash Redis + GitHub Secrets, Tiers 2–3 are opt-in with clean no-ops — does not include an always-on secrets-management service in any tier. Adding one would raise the operational floor for a component that provides no runtime benefit to the agent pipeline itself.

**Reversal condition (self-hosted path):** An explicit Infisical self-host task is added to the task queue, approved, and provisioned as a prerequisite, with a documented decision on where it sits in the infrastructure tier table.

**Reversal condition (cloud path):** Same as Doppler reversal conditions B1 and B3.

---

### Status quo (bootstrap.mjs + GitHub Secrets + .env) — KEEP with two targeted improvements

**Decision: STATUS QUO KEPT.**

The existing approach covers both environments correctly, is vendor-free, operates at zero additional cost, and preserves the privacy and security posture established in prior passes. No centralized secrets manager is adopted at this time.

**Two improvements identified for a future code pass** (not implemented in this documentation-only pass):

| Improvement | Location | Value |
|---|---|---|
| `--verify` flag for `bootstrap.mjs` | `bootstrap.mjs` | Runs a non-destructive audit of an existing `.env` / GitHub Secrets configuration, reporting which required and optional keys are present vs. absent. Eliminates the need to re-run the full interactive wizard to check setup completeness. |
| Grouped validation output in `bootstrap.mjs` | `bootstrap.mjs` | After the wizard collects all credentials, print a structured summary table (Required ✓/✗, LLM providers ✓/✗ count, Optional infra ✓/✗ count) before writing `.env`. Surfaces misconfiguration at setup time rather than at first pipeline run. |

These improvements are locally tractable (no network required, no new dependencies) and should be queued as a code task (task-47 or equivalent) when the owner-decision queue is clear.

---

## PASS 4 — Alternatives Considered

| Alternative | Disposition |
|---|---|
| HashiCorp Vault (open-source) | Not evaluated — requires significantly more infrastructure than Infisical self-hosted; rejected for the same reasons as B2 (Infisical) but more emphatically. |
| AWS Secrets Manager / GCP Secret Manager | Not evaluated — both are paid services with no meaningful free tier; incompatible with the free-tier infrastructure posture established in Pass 42. |
| 1Password Secrets Automation | Not evaluated — SaaS trust-surface concern is identical to Doppler B1; no free tier. |
| Sealed Secrets (Kubernetes) | Not applicable — no Kubernetes runtime is required for the core agent pipeline (Tier 0/1). |
| Adopt Doppler for dev-only (not CI) | Rejected. Doppler's value is cross-environment consistency; limiting it to dev only removes its primary benefit while retaining the SaaS trust-surface cost. |

---

## PASS 5 — Files Modified

| File | Change |
|---|---|
| `packages/agent/docs/73-V24-AUDIT-PASS-73.md` | This document — new |
| `03-ARCHITECTURE.md` | Secrets Management Decision section added |
| `tasks/agent-task-queue.json` | task-34 → done (completedInPass: 73) |
| `tasks/agent-task-queue.md` | Status snapshot updated |
| `06-CHANGELOG.md` | Pass 73 entry prepended |
| `CHANGELOG.md` | Version 24.30.45 entry added |
| `ENGINEERING_NOTES.md` | Pass 73 section appended |
| `package.json` (×4) | Version bumped 24.30.44 → 24.30.45 |

---

## PASS 6 — Static Validation

```
python3 -m json.tool tasks/agent-task-queue.json    → Exit 0
./validate.sh                                       → Expected 50/50 PASSED
node scripts/check-dead-integrations.mjs            → Expected clean (no new exports)
```

Sacred-file manifest hashes: unchanged (no source files modified).
`vitest run` / `tsc --noEmit`: blocked by sandbox network constraints (consistent with all passes ≥ 36).
