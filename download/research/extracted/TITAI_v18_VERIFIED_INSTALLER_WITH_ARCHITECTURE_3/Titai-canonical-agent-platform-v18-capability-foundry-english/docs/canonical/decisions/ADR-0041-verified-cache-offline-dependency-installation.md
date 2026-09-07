# ADR-0041: Verified-cache offline dependency installation

## Status
Accepted with a platform-runtime limitation.

## Problem
Runtime sovereignty requires a clean installation path that does not contact npm or GitHub. Packaging `node_modules` inside the source archive would be large, platform-coupled, and opaque.

## Alternatives
1. Require public registry access during every installation.
2. Package a generated `node_modules` directory in the source ZIP.
3. Prepare and verify npm's content-addressable cache before disconnection, then run `npm ci --offline --ignore-scripts` against the lockfile on a clean source copy.

## Decision
Adopt option 3. The source release remains free of dependency trees and generated native binaries. The offline dependency proof uses a separately prepared cache and a compatible preinstalled Node runtime.

## Limitations
This is not a bare-metal installer. Node itself remains a separately verified platform prerequisite. Cache preparation occurs before disconnection.

## Acceptance evidence
- `scripts/prove-v16-offline-install.mjs`
- `docs/canonical/evidence/v16/offline-install-manual/summary.json`
