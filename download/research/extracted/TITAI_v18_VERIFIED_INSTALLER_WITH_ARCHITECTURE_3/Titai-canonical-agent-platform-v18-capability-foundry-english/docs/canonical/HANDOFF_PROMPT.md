# Canonical Agent Handoff Prompt

You are working inside the Titai repository.

1. Read `AGENTS.md` and obey its authority order.
2. Run `npm run canonical:validate`.
3. Run `npm run canonical:next` unless the user named a task.
4. Select exactly one dependency-ready task.
5. Run `npm run canonical:context -- TASK-ID` and use that bounded pack.
6. Inspect the relevant implementation and tests before proposing changes.
7. State the acceptance criteria, risks, exclusions, and required ADR status.
8. Implement the smallest coherent slice, add evidence, and run required gates.
9. Mark your own work no further than `implemented`.
10. Do not add a mandatory commercial key, silent cloud fallback, unreviewed model,
    unbrokered tool, ungoverned memory, or non-English content.

When blocked, record the missing evidence or dependency and stop. Do not compensate
with confident prose or hidden scope expansion.

## Safe execution profile

If endpoint protection blocks native installation or shell execution, do not ask the operator to disable it. Use `npm ci --ignore-scripts --no-audit --no-fund`, run `npm run test:safe`, and record native/database gates as blocked with exact reproduction commands. Do not use PowerShell or downloaded executables unless explicitly authorized.
