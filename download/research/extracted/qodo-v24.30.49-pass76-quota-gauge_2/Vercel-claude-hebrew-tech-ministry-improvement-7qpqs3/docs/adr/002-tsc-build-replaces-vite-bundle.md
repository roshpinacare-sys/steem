# ADR-002: `tsc` emit replaces the vite lib bundle (dist mirrors src)

**Status:** accepted (2026-07)

## Context

The agent built with a single-entry vite lib bundle that externalized every
dependency and every node builtin — pure concatenation into one `dist/cli.js`
with no type-checking. Meanwhile four CI jobs dynamically imported granular
files (`dist/services/sbom-generator.js`, `license-checker.js`,
`env-validator.js`, `audit-log.js`, `slo-tracker.js`) that this bundle never
emitted, so the pipeline's security/preflight/audit/SLO jobs could never pass.

## Decision

`build = tsc -p tsconfig.build.json`: the same compiler that typechecks also
emits, `dist/` mirrors `src/` module-for-module, and the per-module contract
CI was written against becomes real. vite and vite-plugin-node were dropped
from the agent's toolchain (vitest carries its own vite internally).

## Consequences

- `dist/cli.js` path is unchanged; Docker/k8s/npm-script entry points intact.
- Bundle-level tree shaking is lost — irrelevant for a server-side CLI whose
  dependencies were all externalized anyway.
- Any future module must be NodeNext-resolvable (`.js` import specifiers),
  which the source already used throughout.
