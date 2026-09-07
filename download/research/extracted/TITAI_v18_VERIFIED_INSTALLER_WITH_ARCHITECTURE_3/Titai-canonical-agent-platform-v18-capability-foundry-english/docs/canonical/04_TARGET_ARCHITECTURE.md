# Target Architecture

```text
User and Operator Experience
  Mission control | approvals | evidence | recovery | settings | diagnostics
                              |
Identity, Tenancy, Data Policy, and Human Oversight
                              |
Canonical Orchestrator and Reasoning Controller
  context budget | model budget | tool budget | uncertainty | stopping
                              |
Durable Work Engine
  tasks | attempts | checkpoints | leases | cancellation | structured errors
             |                    |                    |
       Model Router         Capability Broker    Memory and Knowledge
  registry/capabilities   policy/approval/audit   provenance/lifecycle
             |                    |                    |
 Local and optional       Internal tools and      SQL/FTS baseline and
 remote providers         isolated adapters       optional retrieval adapters
             |                    |
      MCP adapter               A2A adapter
                              |
Data and Artifact Plane
  events | audit | artifacts | indexes | asset registry | export | backup
                              |
Observability and Evaluation Plane
  traces | metrics | exact usage ledger | SLOs | evals | experiments
                              |
Deployment Profiles
  embedded local | local worker | private server | explicit optional burst
```

## Internal contracts

Internal task, capability, data, identity, model, memory, provenance, telemetry, and
error contracts must remain stable and vendor-neutral. External protocols and storage
systems are adapters.

## Local baseline

The local profile uses one user-controlled installation, SQLite-compatible storage,
local artifacts, deterministic simulation, optional local models, no required remote
account, and exportable state.

## Scale path

A worker process, server database, queue, workload identity, stronger sandbox, object
store, and remote compute are introduced only when a measured workload and accepted ADR
justify them. The local profile remains supported rather than becoming an accidental
miniature cluster.
