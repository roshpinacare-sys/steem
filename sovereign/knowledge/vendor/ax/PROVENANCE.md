# PROVENANCE — vendor/ax

- **Upstream**: https://github.com/google/ax (Google, official)
- **Pinned HEAD**: `ac2332829f22360ff97b0ba34d94dd0dd782f17e`
- **License**: Apache-2.0 (verified in shallow clone)
- **Status**: NOT runnable in our sandbox — hard-blocked by its own prerequisites: Kubernetes cluster + Agent Substrate control plane + Go toolchain + `ko` + container registry. Measured: `go` absent, `kubectl` absent, no cluster. This is a cluster-grade orchestrator ("run billions of autonomous agent workloads"), not an in-process tool.
- **Operator request (r164)**: "תבחן את זה גם ויישם מה שניתן וראוי" — examined; implemented the possible-and-worthy part: the declarative pattern, not the platform.

## What was distilled (docs/concepts.md + docs/manifests.md, verbatim concepts)

- **Task** = smallest unit of isolated execution: image+command, compute **requests and limits**, env, workspace refs. Lifecycle: `status.phase` (Running/Suspended/Failed/Terminating) + **conditions** (`WorkspaceReady`, `Ready`) — detail lives in conditions, one word in phase.
- **Workspace** = declarative pre-warming: git repos at pinned revisions, MCP servers, skill registries, `files:` inline content, and a `goal` an agent completes on first boot. Declared once, bound by many tasks.
- **Model** = provider config as a managed resource (rotate a key = one apply, not a hunt).
- **suspend/resume** = checkpoint+pause instead of kill; `ax ssh` = look over the agent's shoulder.
- Manifest discipline: `ax apply` rejects bad names up front rather than failing later.

## What we implemented from it (r164, all measured)

- `sovereign/fleet/fleet.yaml` — manifest of record for all 16 fleet services, `sovereign.io/v1alpha1`, modeled on ax's Task shape: port, healthPath, entry, **resources.limits.memoryMB**, phase (Running/Suspended), suspendPolicy, warm **workspaces** (decision-brain's venv + HF cache — the ax Workspace pattern applied to our reality).
- `scripts/fleet-manifests-audit.mjs` — declared-vs-actual auditor: probes health, maps listeners→pids→RSS from /proc, scans 3000-3060 for **undeclared listeners** (manifest drift), writes `sovereign/fleet/audit-latest.json` as evidence. First run caught 2 wrong healthPaths, 1 undeclared-limit service (home 1596MB), and 6 unmanaged services (pulse/hunter/keeper/student/fleet-verify/weblift) — all reconciled; final run: **16/16 alive, 0 violations, 0 undeclared**.
- `sovereign/knowledge/fleet-doctrine.json` — rules FLO-1..FLO-7 with the r163 OOM as motivating evidence.
