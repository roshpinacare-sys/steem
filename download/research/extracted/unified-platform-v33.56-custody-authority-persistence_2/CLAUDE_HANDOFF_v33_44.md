# Claude Handoff — V33.44

Canonical version: **33.44**.

V33.44 implements a signed dependency-update planner with deterministic candidate selection, graph-impact limits, offline compatibility rehearsal, three-role approval, canary monitoring, threshold-triggered rollback and multi-generation retention.

Authoritative evidence is under `release-evidence/v33.44/`. The proof status is `LOCAL_DEPENDENCY_UPDATE_PLANNER_PROVEN`; candidate versions and canary metrics are local fixtures. `productionAuthority` remains `NONE`, external effects remain zero, G3 remains blocked and production promotion is forbidden.

Next work must qualify a real independently sourced package candidate and real canary telemetry on separately administered infrastructure without weakening the truth boundary.
