# Codex Repository Instructions

`AGENTS.md` is authoritative. Work on exactly one ready task from
`docs/canonical/tasks/TASKS.json`, use a generated context pack, preserve the
English-only and zero-key invariants, and provide test evidence before changing status.


## v12 release note

Follow the v12 discipline in `AGENTS.md`. Treat step durability, verification, pilot readiness, and design evidence as separate claims. Never promote this package beyond DEVELOPMENT ONLY without the native, browser, live-restart, tenancy, and independent-verification gates.


## Sovereignty rules

- Treat remote providers as optional adapters, never hidden core dependencies.
- Do not claim a real local-model quality result from the deterministic zero-key adapter.
- Keep private signing keys, root recovery keys, model weights, generated native binaries, and runtime databases out of release archives.
- Unknown outbound network behavior, unmeasured energy, and unbenchmarked model artifacts remain blocking evidence.
- Signed handoffs and updates may not expand tenant, workspace, capability, receiver, version, or path scope.
- Use `npm run test:sovereignty` and `npm run sovereignty:prove` after sovereignty changes.
