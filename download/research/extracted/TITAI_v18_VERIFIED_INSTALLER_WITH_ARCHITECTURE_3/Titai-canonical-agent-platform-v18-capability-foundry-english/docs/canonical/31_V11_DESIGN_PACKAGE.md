# TITAI v11 Design Package

## Design thesis

TITAI is not a chat application and not a generic analytics dashboard. It is an evidence-controlled execution environment. The interface must reveal authority, causality, uncertainty, side effects, recovery debt, and verification boundaries before it celebrates completion.

The selected direction is **Evidence Control Plane**: an asymmetric dossier for a single run plus a linear signal plane for fleet-level pressure. It avoids repeated decorative cards, separates evidence from truth, and keeps failure and recovery visible.

## Seven structurally distinct directions

| Direction | Primary object | Navigation grammar | Strength | Fatal risk | Decision |
|---|---|---|---|---|---|
| Operational command map | Live jobs and resources | Spatial topology | Fast incident awareness | Graph overload at scale | Rejected as default |
| Evidence-first dossier | Claims, controls, proof | Document sections and seals | Strong audit comprehension | Can feel dense | Selected for run detail |
| Temporal execution timeline | Causal events | Time axis | Excellent replay and recovery | Weak portfolio overview | Retained as secondary view |
| Dependency graph workspace | Tasks and prerequisites | Graph traversal | Strong planning | Accessibility and mobile complexity | Retained for specialist canvas |
| Multi-pane engineering cockpit | Queues, logs, metrics | Persistent panes | High operator throughput | Generic enterprise feel | Rejected as visual thesis |
| Spatial agent organization | Agents and delegation | Rooms and territories | Memorable agent identity | Risks decorative anthropomorphism | Rejected |
| Canonical document workspace | Specs, ADRs, evidence | Linked documents | Strong governance | Weak live operations | Retained for canonical artifacts |

## Evaluation matrix

Scores are 1-5 and are not sufficient to override fatal-flaw gates.

| Criterion | Command map | Dossier | Timeline | Dependency graph | Cockpit | Spatial agents | Documents |
|---|---:|---:|---:|---:|---:|---:|---:|
| State comprehension | 5 | 5 | 4 | 4 | 5 | 3 | 2 |
| Evidence discoverability | 3 | 5 | 4 | 3 | 4 | 2 | 5 |
| Recovery clarity | 4 | 5 | 5 | 3 | 4 | 2 | 3 |
| Accessibility | 2 | 4 | 4 | 2 | 3 | 3 | 5 |
| Mobile viability | 2 | 4 | 4 | 1 | 2 | 2 | 5 |
| Distinctiveness | 4 | 5 | 3 | 4 | 2 | 5 | 3 |
| Implementation risk | 2 | 4 | 5 | 2 | 3 | 2 | 5 |

## Implemented direction

### Run dossier

The Dossier tab shows six ordered control signals: execution authority, model decision, governed context, human authority, tool boundary, and recovery evidence. The top budget strip exposes context and output limits. A truth statement explicitly separates authority from model output.

### Operations signal plane

The Operations route uses a horizontal pressure model rather than a grid of success cards. It shows local service posture, throughput, human waits, durable state, outbox pressure, and each declared SLO. It warns that absence of local failures is not proof of production health.

## Design token and state contract

- Semantic OKLCH tokens remain authoritative.
- Status is represented by text, icon, border position, and color.
- No hosted fonts or icon CDNs are required.
- Motion is disabled under `prefers-reduced-motion`.
- The dossier collapses from 12 to 6 to 12-column rows across breakpoints.
- Long model reasons and memory provenance wrap rather than clip.
- Critical terms are not hidden behind hover-only interactions.

## Component state requirements

The implemented surfaces distinguish good, warning, danger, and neutral evidence. Remaining work must add screenshot-based regression for empty, offline, expired, reconciliation, permission-denied, stale, and verification-failed states.

## Honest design limitation

The code is type-checked and responsive CSS is present, but Playwright, accessibility automation, and screenshot regression were not executed in this environment. The design is implemented, not independently browser-verified.
