# ADR-003: Process guards are not a security boundary

**Status:** Accepted

Language-level monkey patching or restricted-process wrappers are not valid isolation for untrusted code. Native calls can bypass them.

The production candidate must be selected through attack-driven comparison of:

- rootless container;
- WASI component runtime;
- microVM where risk justifies the cost.

The environment currently lacks these runtimes, so no production isolation candidate is selected.
