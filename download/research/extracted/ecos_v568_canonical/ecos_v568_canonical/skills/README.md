# Skills (V225)

Each subdirectory carries a `SKILL.md` with a YAML-ish frontmatter (`name`, `description`, `type`) plus a markdown body. V225 ships only the directory layout + two example skills (`design`, `xlsx`); the V226 `loadSkills225()` loader will scan this directory, score `description` against the active task, and inject the best-match body into the agent system prompt.

Built-in skills live next to the patch; project-scoped user skills should be loaded from `<workspaceRoot>/.workspace/skills/`.
