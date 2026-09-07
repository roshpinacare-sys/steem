# ADR-0027: Freeze a Controlled Pilot Scope and Persist Resource Boundaries

- Status: Accepted
- Date: 2026-07-11
- Owners: Systems Architect, Identity and Tenancy Engineer

## Problem

The v12 platform had ownership checks but did not persist a complete tenant and workspace boundary across the Golden Pilot Workflow. A pilot classification would be misleading if runs were scoped while models, policies, templates, approvals, artifacts, or verification evidence remained implicitly global.

## Constraints

- Preserve the local single-user experience.
- Deny incomplete or mismatched scope.
- Avoid claiming general enterprise multi-tenancy.
- Keep the migration reversible by retaining the existing owner identifiers.

## Alternatives

1. Continue with owner-only filtering. Lowest migration cost, but it cannot prove workspace isolation.
2. Add a full organization and enterprise IAM system. Stronger future flexibility, but excessive scope and risk for one pilot.
3. Add a minimal tenant/workspace membership model and require scope on every pilot resource.

## Decision

Adopt alternative 3. Every pilot user receives a deterministic personal tenant and primary workspace. Pilot resources persist tenant, workspace, owner, and visibility. Backend access checks resolve membership before data access. Built-in read-only resources remain explicitly global.

## Consequences

- Cross-scope access can be tested as a safety property.
- Existing rows are backfilled into deterministic personal scopes.
- This is a bounded pilot tenancy model, not a claim of full enterprise multi-tenancy.
- A future shared-workspace design requires a separate ADR and migration.

## Acceptance Evidence

- `drizzle/0007_v13_pilot_scope.sql`
- `src/lib/auth/pilot-scope.ts`
- `tests/tenant-isolation-property.test.ts`
- `npm run db:migrations:validate`
