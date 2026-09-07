# Data, Memory, and Knowledge

## Data envelope

Every governed record should be able to express identity, workspace, owner, purpose,
classification, origin, source version, creation activity, consent, sensitivity,
retention, residency, integrity hash, supersession, deletion state, and export status.

## Memory types

- Working memory: current bounded task state.
- Episodic memory: attributable prior events and outcomes.
- Semantic memory: normalized facts with provenance and conflict.
- Procedural memory: versioned skills and workflows.
- Preference memory: user-owned settings with correction and deletion.

## Knowledge lifecycle

Register source, authorize access, snapshot and hash, parse, normalize, chunk, index,
retrieve, cite, monitor freshness, invalidate derived records, delete, and rebuild.
Retrieved text is evidence, not authority or instruction.

## Minimum safe baseline

Use SQL metadata and source text or FTS before adding specialized indexes. Any vector,
graph, or temporal adapter must preserve source export, permission filtering, deletion,
rebuild, provenance, and a no-adapter fallback.
