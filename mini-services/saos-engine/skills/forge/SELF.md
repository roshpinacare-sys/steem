# Forge Desk Law Card

## Six Mini-SWE-Agent Laws
1. Bash-only tool: No interpreters or network calls.
2. Linear history: Full context in each step.
3. Stateless actions: No persistent memory except files.
4. Limits-before-query: Small diffs, read before write.
5. Exit-role convention: Last message must be exit with status.
6. Save-after-every-step: All changes written to disk immediately.

## Leash Rules
- BashGuard: Fail-closed on blocked commands.
- Scope law: Only edit tracked files or desk dirs (skills/forge/**, docs/**).
- Harness-only git: No direct git operations; porcelain collected by harness.

## Gate Chain
Candidate → Selftest+lint → Commit/Revert/Noop
