# TITAI v15 Sovereignty Architecture Delta

## Purpose
v15 adds a local-first sovereignty plane without replacing the existing durable, tenant-scoped, evidence-oriented architecture.

## New authoritative boundaries

### Local runtime boundary
The canonical runner may invoke a `LocalModelRuntime` adapter. The deterministic adapter proves zero-key integration and structured execution. Real CPU and GPU model adapters remain optional until artifact, license, hardware, quality, and energy evidence exist.

### Hardware feasibility before utility
A model is excluded before scoring when RAM, VRAM, disk, CPU architecture, GPU architecture, thermal state, network state, context capacity, tool support, or tenant constraints cannot be satisfied.

### Local memory authority
Canonical governed memory remains local and portable. Export/import preserves scope, provenance, confidence, authority, sensitivity, expiry, corrections, contradictions, and hashes. Derived search or embedding indexes are not authoritative.

### Key hierarchy
A root recovery secret derives purpose- and context-separated key material for installation, tenant, workspace, data encryption, and backup. Ed25519 signing identities are separate from encryption keys.

### Air-gap handoff boundary
A signed handoff bundle contains only bounded task context, memory evidence, capability grants, evidence references, expiry, sender, receiver, tenant, and workspace. A separately signed result is bound to the exact input task hash.

### Offline update boundary
A signed update bundle contains changed files, file hashes, deletes, migration declarations, compatibility, validation commands, and release evidence. It rejects downgrade, path traversal, invalid signatures, manifest drift, and target-version mismatch. Apply failures restore the previous installation.

### Sovereignty control plane
The UI displays separate sovereignty dimensions, mandatory dependencies, network attempts, model locality, key custody, recovery and update evidence, hardware and energy evidence, and blockers. Fatal weaknesses and unknown evidence are evaluated before classification.

## Trust boundaries
- Model output and memory are evidence, never authority.
- Remote providers remain optional adapters.
- Network attempts are evaluated through an explicit air-gap policy for sovereign adapters.
- Imported handoff and update bundles cannot grant authority outside signed scope.
- Private signing and root recovery keys are never written to release evidence.

## Remaining architecture gaps
- No real local generative model artifact was executed.
- No process-level outbound packet or socket audit was completed.
- Energy and thermal figures remain estimates.
- Offline dependency installation does not yet include a signed npm, browser, system-package, and model artifact bundle.
- Replay protection for imported handoffs is not yet backed by a durable import ledger.
- Update bundles declare migrations but do not yet execute the canonical migration engine automatically.
