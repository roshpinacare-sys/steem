# Skills

A **skill** is a reusable capability you attach to an agent. When a run starts,
each attached skill's body is injected into the agent's system prompt under a
`# Skills` section, so the agent applies it when relevant.

## Format (`SKILL.md`)

YAML frontmatter with a required `name` and `description`, followed by a markdown
body of instructions:

```markdown
---
name: Structured Researcher
description: Investigate a topic methodically and cite tradeoffs.
---
When researching:
1. Enumerate the candidate approaches.
2. Compare on cost, complexity, and reliability.
3. State an explicit recommendation with the reasoning.
```

- **`name`** — shown in the UI and as the section heading in the composed prompt.
- **`description`** — the agent uses this to decide *when* the skill applies, so
  write it as a trigger ("Use when…"). Required.
- **body** — the actual instructions, in Markdown.

## Versioning

Every save creates a new **skill version**. A run snapshots the exact version ids
it injected (`runs.skillVersionIds`), so editing a skill never changes what past
runs did. Built-in skills are read-only; duplicate the idea into a custom skill
to modify it.

## How injection works

`composeSystemPrompt(basePrompt, skills)` (in `src/lib/engine/skills.ts`) appends
a deterministic, name-sorted `# Skills` section to the agent's base prompt. You
can see the exact composed prompt for any run under **Run detail → Composed
system prompt**.

## Built-in skills

Seeded by `npm run seed`:

- **Concise Writer** — terse output, lead with the answer.
- **Structured Researcher** — methodical comparison + explicit recommendation.
- **Deploy Checklist** — safety checklist before any deployment.

## Authoring in the app

**Skills → New skill** opens the editor: fill name + description + body, preview
the rendered markdown and the raw `SKILL.md`, then save. Attach it to any agent
from **Agent Studio → Skills**.
