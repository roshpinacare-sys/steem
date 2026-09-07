# TITAI v13 Architecture Delta

## Scope Plane

A minimal tenant and workspace domain now scopes runs, steps, approvals, artifacts, memories, policies, templates, model profiles, durable jobs, receipts, and verification attestations. Built-in read-only configuration is explicitly global; user configuration is private and scope-bound.

## Durable Approval Plane

A tool approval is identified by a deterministic continuation key. The durable worker releases the job while the approval is pending. Resolution uses revision compare-and-set, requeues the job, and resumes at the stored checkpoint. A repeated side effect is prevented by its durable receipt.

## Evidence Plane

Pilot readiness loads live facts from the database and evaluates them fail-closed. It distinguishes runtime completion from verification and release eligibility.

## Validation Plane

Source-safe controls run on the protected workstation. Native SQLite, build, browser, accessibility, and multi-process gates run only in a disposable pinned CI lane. The source archive contains no generated native binary.

## Remaining Architectural Boundary

The pilot does not serialize remote model conversations. Live provider execution remains outside the pilot until model request intents and response references are fully durable and repeatable.
