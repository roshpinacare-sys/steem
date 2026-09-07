# TITAI v16 Architecture Delta

## Purpose
v16 closes operational reality gaps without replacing the durable, tenant-scoped, local-first architecture introduced in earlier releases.

## Added execution boundaries

### Local model runtime boundary
The canonical runner can target a vendor-neutral lifecycle. Implementations include a loopback-only OpenAI-compatible adapter, a hash-verified llama.cpp subprocess adapter, a deterministic test runtime, and a fail-closed no-model runtime. No real generative artifact was available during this release, so model-quality evidence remains blocked.

### Offline retrieval boundary
Canonical memory records remain authoritative. A local BM25 fallback applies tenant, workspace, sensitivity, expiry, status, contradiction, authority, confidence, and character-budget controls before ranking. The index is derived and reconstructable.

### Key-custody boundary
A portable encrypted keystore separates installation, tenant, workspace, data, backup, handoff, update, and verifier purposes. It supports rotation, retirement, revocation, expiry, and scope enforcement. OS or hardware custody remains a separate blocked adapter.

### Network-evidence boundary
Node connection APIs are instrumented and Linux process sockets are observed through `/proc`. Evidence associates attempts with PID, parent PID, executable, command, protocol, address, and port. This complements, rather than replaces, the application network policy.

### Offline installation boundary
The source release remains dependency-free. A verified npm content-addressable cache can install the exact lockfile on a clean source copy in offline mode with lifecycle scripts disabled. Node remains a separately verified platform prerequisite.

### Isolated execution identity
A controller process can issue a signed tenant/workspace capability lease to a separate worker process with a separate Ed25519 identity. Results are task-bound, integrity-checked, and replay-protected.

### Test authority
Every test file executes in a new bounded Vitest process. Process exit is part of the pass condition. The monolithic suite remains diagnostic.

## Preserved invariants
- Unknown evidence blocks pilot classification.
- No prompt, memory, or model response can grant authority.
- Remote model providers remain optional adapters.
- Model artifacts and runtime binaries are not packaged in the source release.
- Source archives exclude dependency trees, build output, databases, secrets, model weights, and generated native binaries.
