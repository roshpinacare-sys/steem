# Research Synthesis

## Cross-cutting conclusions

### Durability precedes autonomy

An intelligent model cannot recover work that the platform did not checkpoint, and
retrying a non-idempotent side effect can be worse than losing the run. Durable state,
cancellation, error taxonomy, replay safety, and recovery are foundational.

### Intelligence is a controlled allocation problem

Reasoning quality depends on selecting context, model, decomposition, search, tools,
critique, verification, and stopping under budgets. The platform needs an observable
controller, not a universal instruction to think longer.

### Memory and RAG are governed data systems

Useful memory requires ownership, provenance, correction, conflict, forgetting,
permissions, retention, export, and evaluation. A vector database is only an optional
index behind those contracts.

### Protocol support is not a security boundary

MCP and A2A improve interoperability but do not replace identity, authorization,
consent, validation, budgets, isolation, provenance, or audit. They belong at adapters
outside the internal trust core.

### Sovereignty is operational

Local inference alone is insufficient. Sovereignty requires inspectable state,
portable formats, deletion, backup, restore, offline behavior, replacement of providers,
and explicit remote consent.

### Advantage comes from trusted outcomes

The product should optimize selected workflows for measurable quality, control,
recovery, privacy, and operator effort. A long provider or plugin list without reliable
outcomes increases surface area rather than advantage.
