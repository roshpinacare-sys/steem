# PROVENANCE — vercel-labs/openreview

- **Repo**: https://github.com/vercel-labs/openreview
- **HEAD measured**: `672deb21e70e471e0536d5ad7a67c14b8359e97e` (2026-03-06 "Update globals.css")
- **Wave**: r167, evaluated 2026-10-03 (clone at `/home/z/laya-eval/openreview-src`, shallow)
- **License**: **NONE FOUND** — no LICENSE file in repo root (verified: `ls LICENSE*` empty; raw main/master 404), `package.json` declares `"private": true, "version": "0.1.0"` → **verbatim code vendoring FORBIDDEN** (same rule as r165 Hands-On-AI-Engineering).
- **What it is**: self-hosted AI code-review bot for GitHub PRs. GitHub App webhook → Vercel Workflow (durable) → Vercel Sandbox → Claude Sonnet 4.6 agent (AI SDK) → posts inline PR comments with suggestion blocks → can commit+push fixes → 👍/👎 reactions gate acceptance.

## Hard evidence (measured, not assumed)

1. **Platform-locked deps** (package.json): `@vercel/sandbox ^1.7.1`, `@vercel/analytics`, `@vercel/speed-insights`, `@workflow/ai 4.0.1-beta.54` + `workflow 4.1.0-beta.56` (Vercel Workflow durable execution), `@chat-adapter/state-redis` (Upstash KV), model hard-coded `anthropic/claude-sonnet-4.6`.
2. **Required env** (README): `ANTHROPIC_API_KEY`, `GITHUB_APP_ID/INSTALLATION_ID/PRIVATE_KEY/WEBHOOK_SECRET` — none exist in our sandbox; webhook needs a public URL.
3. **Runnable here? NO.** Verdict: not deployable without Vercel platform + Anthropic key + Upstash + GitHub App registration.
4. **Skill sources**: `.agents/skills/` populated from `vercel-labs/next-skills` (NO license detectable — distill-only) and `vercel-labs/agent-skills` (MIT verified on GitHub HTML) via `skills-lock.json` hash pinning (`computedHash` per skill).
5. **Distillable core confirmed by reading `lib/agent.ts` + `lib/skills.ts` + `workflow/index.ts`**:
   - Skills registry: frontmatter (`name/description/user-invocable`) SKILL.md + hash-pinned lockfile.
   - **Lazy loading**: system prompt carries only names+descriptions; a `loadSkill` tool fetches full body on demand → token economy.
   - Review prompt craft: "reference file paths and line numbers", "explain what/why/how to fix", "Don't nitpick style or formatting", "Start by running `gh pr diff`".
   - Durable step decomposition: checkPushAccess → createSandbox → installDeps → configureGit → runAgent → hasUncommittedChanges → commitAndPush → stopSandbox (each `"use step"`).
   - Human reaction gate (👍/👎) as lightweight acceptance loop.

## What was taken (patterns only — zero verbatim code)

- **Skills-registry + lazy-load pattern** → reimplemented in `scripts/pre-push-review.mjs` (2-phase: router picks skills by index → verdict call with chosen bodies).
- **Skills format** → `sovereign/knowledge/review-skills/*/SKILL.md` (our OWN content: fleet laws + Next.js 16 rules in our wording; next-skills content NOT copied — no license).
- **Review-gate pattern** (agent reviews diff → machine verdict) → sovereign pre-push gate over our own llm-bridge (r166 asset), no Anthropic key, no Vercel, no webhook.
- **Prompt craft rules** → copied as *rules* (ideas, not code) into the gate system prompt.

## Activation routes

- `pre-push-route` — LIVE: `node scripts/pre-push-review.mjs` before `git push`; block on exit 1.
- `pr-route` — BLOCKED: external PR review requires GitHub App + public webhook URL (absent in sandbox).

## whyNotRevenue

The gate earns nothing directly. It protects the revenue engine: fewer broken/leaky pushes → less repair time, fewer reputation holes → more autonomous push cycles per day. Pure infrastructure (same class as fleet audit r164).
