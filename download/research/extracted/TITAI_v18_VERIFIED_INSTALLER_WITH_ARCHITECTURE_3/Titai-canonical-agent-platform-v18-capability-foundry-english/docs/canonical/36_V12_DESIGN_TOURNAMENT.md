# TITAI v12 Design Tournament

## Method

Nine structurally different interaction systems were scored without treating the creative director preference as proof. Scores are design estimates, not a user study.

Criteria: stateComprehension, nextSafeAction, evidenceDiscovery, recoveryClarity, verificationClarity, accessibility, mobileViability, novelty, informationScale, implementationRisk.

## Directions

### D1 — Evidence Control Plane
- Mental model: A run is a chain of claims, authorities, and evidence.
- Score: 86/100
- Fatal flaws: None identified in desk review
- Result: `selected_core`

### D2 — Operational Command Map
- Mental model: A live map of jobs, workers, queues, and recovery debt.
- Score: 77/100
- Fatal flaws: None identified in desk review
- Result: `selected_operations_layer`

### D3 — Temporal Execution Ledger
- Mental model: A chronological, append-only operational record.
- Score: 79/100
- Fatal flaws: None identified in desk review
- Result: `retained_component`

### D4 — Dependency Graph Workspace
- Mental model: Tasks and agents are a navigable DAG.
- Score: 60/100
- Fatal flaws: mobile complexity, evidence details become secondary
- Result: `rejected_as_primary`

### D5 — Verification Dossier
- Mental model: Each run is an auditable case file.
- Score: 84/100
- Fatal flaws: None identified in desk review
- Result: `selected_verification_layer`

### D6 — Multi-Pane Engineering Cockpit
- Mental model: Persistent simultaneous views of state, evidence, and action.
- Score: 71/100
- Fatal flaws: poor narrow-screen behavior
- Result: `rejected_as_primary`

### D7 — Canonical Document Workspace
- Mental model: Decisions and tasks are executable documents.
- Score: 76/100
- Fatal flaws: live operational pressure is hidden
- Result: `retained_for_governance`

### D8 — Recovery-First Operations Console
- Mental model: Every state is organized around safe recovery actions.
- Score: 84/100
- Fatal flaws: None identified in desk review
- Result: `selected_recovery_layer`

### D9 — Human-Authority Control Surface
- Mental model: The primary object is the boundary between machine proposal and human authority.
- Score: 84/100
- Fatal flaws: None identified in desk review
- Result: `selected_approval_layer`

## Selected thesis

Evidence Control Plane with Recovery-First Operations and a Human-Authority boundary. Completion, verification, release readiness, and runtime health remain visually and semantically separate.

## Implemented surfaces
- Run execution dossier
- Evidence ledger
- Immutable verification plane
- Operations signal plane
- Pilot evidence gate
- Approval card

## Visual evidence

- `docs/canonical/evidence/v12/design-board.html` — responsive source concept.
- `docs/canonical/evidence/v12/design-board-print.html` — deterministic visual evidence.
- `docs/canonical/evidence/v12/screenshots/design-board-print.png` — visually inspected static render.

## Limitations

Scores are not blind user-study data.; Browser visual regression and real keyboard/screen-reader testing remain blocked.; The legacy application shell is not fully replaced.

Chromium-based browser screenshots and browser accessibility tests are environment-blocked. The static render is design evidence, not browser E2E evidence.
