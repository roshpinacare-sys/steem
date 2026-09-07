# ADR-0046 — Platform-Specific Offline Installer Bundles

## Status
Accepted

## Context
The v16 offline proof required a preinstalled Node runtime and prepared package cache.

## Decision
Build separate installer bundles containing a pinned Node runtime, production build, dependency payload, migrations, file manifest, provenance, and Ed25519 signature. Model weights, browser payloads, secrets, and source release remain separately governed artifacts.

## Consequences
The installer is platform-specific and may be large. Ephemeral signing is development evidence only. Pilot promotion requires a trusted signing identity and a clean external target proof.
