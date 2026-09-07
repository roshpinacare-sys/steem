# TFA Trust Gate — Agent Skill

A portable [Agent Skill](https://www.anthropic.com/news/skills) (`SKILL.md`)
that teaches any Claude-based agent when and how to gate a risky action
through TFA before executing it.

## Install

Drop `SKILL.md` into your skills directory (e.g. `.claude/skills/tfa-trust-gate/SKILL.md`
for Claude Code, or the equivalent path for your agent runtime). No code, no
dependencies — it's pure instructional content that an agent reads before
acting.

## What it teaches

- **When to gate**: destructive, irreversible, value-moving, or
  privacy-sensitive actions — not routine reads.
- **How to call** `POST /api/adapter/run` with a minimal `ActionIntent`.
- **How to interpret** the three possible decisions (`allowed` /
  `approval_required` / `denied`) and what to do for each.
- **Why the server overrides client risk claims** — fail-closed
  classification is intentional, not a bug to route around.
- **Common mistakes**: nonce reuse, treating `approval_required` as
  `allowed`, and trying to relabel actions to dodge classification.

## Relationship to the other TFA agent integrations

This skill is the *instructional* layer — it tells an agent what to do. It
pairs naturally with the enforcement layers already in this repo:

- `examples/claude-code-hook/` — a `PreToolUse` hook that *automatically*
  intercepts tool calls and gates the risky ones, so the agent doesn't have to
  remember to call TFA itself.
- `sdk/cli/` — the `tfa` command for shell/CI contexts.
- `lib/mcp-server/` — exposes the same gate as MCP tools/resources/prompts for
  agents that speak MCP directly.

Use the skill alone for agents you can't hook into directly (e.g. a custom
runtime); use the hook when you want enforcement, not just guidance.
