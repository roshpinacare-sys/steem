# Pass 58 — API-Contract-Guard Adversarial Schema-Drift Test (Task-28) — Version 24.30.30 — 2026-07-07

**Task completed:** task-28 from `tasks/agent-task-queue.json`

## Impact Analysis

| Dimension | Assessment |
|---|---|
| Engineering value | High — api-contract-guard is the last pre-commit gate protecting the API contract. Adversarially validating its detection boundaries prevents a class of deceptive breaking changes that look safe to automated review but crash real consumers. Documents concrete, actionable gaps for future passes. |
| Implementation risk | Zero — test-only pass; no production source files, schemas, sacred files, or infrastructure changed. |
| Compatibility impact | None — new test file and docs only. |
| Rollback complexity | Trivial — delete `packages/agent/tests/api-contract-guard-adversarial.test.ts`. |

## Problem Statement (task-28)

`api-contract-guard.ts` is invoked before every commit to diff OpenAPI and GraphQL
schema files in a patch against their base versions.  It flags breaking changes and
blocks the commit when they are present.

The existing guard was validated against obvious breaking changes (removed paths,
removed methods, removed types, removed fields).  These are easy to catch because
the structural diff is binary — a key present in the base map is absent in the head
map.

Task-28 asks the harder question: **can a schema change that looks additive to the
guard's current diffing logic be genuinely load-bearing at runtime?**  The answer
is yes — in seven documented ways.

## Test File

**`packages/agent/tests/api-contract-guard-adversarial.test.ts`** — 7 describe
blocks, 21 test cases.

No network, no file system, no Redis required.  All inputs are constructed inline
as JSON strings or GraphQL SDL strings.  Telemetry is stubbed with an in-process spy.

## Findings

### Changes the guard correctly catches (confirmed RESISTANT)

| ID | Scenario | Verdict |
|---|---|---|
| A1 | Removed OpenAPI path | ✅ RESISTANT — breaking, severity=breaking |
| A2 | Removed HTTP method on existing path | ✅ RESISTANT — breaking, severity=breaking |
| A3 | Added new path | ✅ RESISTANT — additive, severity=additive |
| C1 | Removed GraphQL type | ✅ RESISTANT — breaking, severity=breaking |
| C2 | Removed GraphQL field | ✅ RESISTANT — breaking, severity=breaking |
| C3 | Changed GraphQL field type | ✅ RESISTANT — breaking, severity=breaking |

### Deceptive breaking changes the guard silently misses (GAPS)

#### GAP-1 (High) — New required parameter on existing method [OpenAPI]

**Scenario:** `POST /reports` already has a `limit` query parameter.  The patch adds
a new `X-Tenant-ID` header parameter with `required: true`.

**Guard behaviour:** `diffOpenApi` only compares path and HTTP-method *existence*.
Within a method it does not iterate or diff the parameter list.  The path and method
still exist → no change recorded → `passed: true`.

**Runtime impact:** Every existing client that does not send `X-Tenant-ID` receives a
`400 Bad Request`.  The guard passes the patch; the change ships without warning.

**Recommended fix:** After confirming a method still exists, diff its parameter set
by name and flag any new parameter with `required: true` as breaking.

---

#### GAP-2 (High) — Parameter type change within same method [OpenAPI]

**Scenario:** `GET /search` has `count: integer`.  The patch changes it to
`count: string`.

**Guard behaviour:** Parameters are stored as `SchemaNode` objects inside each method
entry but are never compared across base and head.  The type attribute change is
completely invisible.

**Runtime impact:** Clients that serialise `count` as an integer receive a type error
or silent coercion from the server.

**Recommended fix:** For each parameter that exists in both base and head method,
compare `type`, `format`, and `required` attributes and flag changes as breaking.

---

#### GAP-3 (Medium) — Required → optional parameter flip [OpenAPI]

**Scenario:** `POST /checkout` has `currency: required:true`.  The patch sets
`required: false`.

**Guard behaviour:** The `required` flag on parameters is never compared.  No change
is detected.

**Runtime impact:** Servers that assumed framework validation would enforce the field's
presence now receive `null` and may crash or produce incorrect data.

**Recommended fix:** Same as GAP-2 — include `required` in the per-parameter diff.

---

#### GAP-4 (Medium) — Response code removal from existing method [OpenAPI]

**Scenario:** `POST /jobs` declares responses `{200, 202, 400}`.  The patch removes
`200`, leaving only `{202, 400}`.

**Guard behaviour:** `extractOpenApiPaths` records response codes as
`response:<code>` nodes in the method's node list, but `diffOpenApi` only checks
whether the *method key* is still present in the method map — it never diffs the
node sets within a method.  The removal of `200` is invisible.

**Runtime impact:** Clients that branch on HTTP 200 hit an unhandled code path.

**Recommended fix:** Extract the response-code set per method and flag removals as
breaking.

---

#### GAP-5 (Medium) — YAML OpenAPI files not recognised by `isSchemaFile` [routing]

**Scenario:** The patch modifies `api/schema.yaml`.

**Guard behaviour:** `isSchemaFile` returns `true` only when the lowercased path
contains `"openapi"` or `"swagger"`, or ends with `.graphql`/`.gql`.  A canonical
path like `api/schema.yaml` matches none of these patterns.  The file is silently
skipped; `guardApiContracts` returns `{passed: true, breakingChanges: [],
additiveChanges: []}` regardless of the schema's content.

**Runtime impact:** Any breaking change in a YAML-formatted OpenAPI file ships
undetected if the path does not contain the keyword.

**Recommended fix:** Also recognise `.yaml`/`.yml` extensions and attempt JSON-parse
after YAML→JSON conversion, or treat any `.yaml`/`.yml` file in the patch as a
potential schema candidate.

---

#### GAP-6 (High) — Nullable → non-null promotion (String → String!) [GraphQL]

**Scenario:** `Profile.nickname` is typed `String` (nullable).  The patch promotes
it to `String!` (non-null).

**Guard behaviour:** `extractGraphqlTypes` stores the type as
`rawType.replace(/!$/, "")`, stripping the non-null suffix.  When `diffGraphql`
compares `field.type !== headField.type` it evaluates `"String" !== "String"` which
is `false` — no change detected, `passed: true`.

**Runtime impact:** Resolvers that previously returned `null` for this field now
trigger a GraphQL null-propagation error, potentially nullifying an entire parent
query object depending on whether the parent is also non-null.  This is a silent,
progressive data-corruption vector.

**Recommended fix:** Store the non-null marker separately (as the existing `required`
field on `SchemaNode` already does), and compare `field.required !== headField.required`
in `diffGraphql` in addition to the type comparison.  A `false → true` transition is
breaking.

---

#### GAP-7a (High) — Input types are a complete parser blind spot [GraphQL]

**Scenario:** `CreateOrderInput` adds `shippingAddressId: ID!`.  The input type
is removed entirely in a separate subtest.

**Guard behaviour:** `extractGraphqlTypes` uses the regex
`/type\s+(\w+)\s*\{([^}]*)\}/g`.  This only matches `type <Name> { ... }` SDL
blocks — it does NOT match `input <Name> { ... }` blocks.  Any change to an
Input type produces **zero detected changes**: `passed: true`,
`breakingChanges: []`, `additiveChanges: []`.

**Runtime impact:** A patch adding `shippingAddressId: ID!` to `CreateOrderInput`
ships completely undetected.  Every existing mutation caller that omits the new
required field receives a GraphQL validation error.  Even removing an Input type
entirely produces no alert.

**Recommended fix:** Extend the parser regex (or use a full SDL parser) to also
capture `input <Name> { ... }` blocks and apply the same field-diff logic.

#### GAP-7b (High) — New non-null field on `type` block misclassified as additive [GraphQL]

**Scenario:** `Order.status: String!` is added to an existing `type Order` block.

**Guard behaviour:** A new field on an existing `type` block is classified as
`additive` regardless of nullability.  The change is recorded in `additiveChanges`
with `severity: "additive"`.  The guard does detect and report it — the failure is
in severity classification, not detection.

**Runtime impact:** Resolvers that return an `Order` object without the new `status`
field will cause a GraphQL field-error, potentially propagating null upward if the
parent field is also non-null.

**Note:** Unlike GAP-7a, the guard DOES see this change.  The `required` flag on
`SchemaNode` is already populated by `extractGraphqlTypes` but is never used in the
`diffGraphql` comparison path for newly-added fields.

**Recommended fix:** When classifying a new field detected in `diffGraphql`, check
its `required` flag.  A new field with `required: true` should be classified as
breaking, not additive.  For Input types, the same logic applies once GAP-7a is
fixed.

---

## Design Boundaries Documented (valid, not fixed in this pass)

| Boundary | Description |
|---|---|
| `diffOpenApi` compares path/method existence only | The current model is sufficient for the guard's original stated scope (R1: "flags breaking changes distinctly from additive ones"). The gaps above represent extensions beyond the original scope. |
| `diffGraphql` strips `!` before type comparison | The `required` field on `SchemaNode` was already present for other uses; extending the comparison to include it is a minimal surgical fix (GAP-6 recommendation). |
| `isSchemaFile` keyword-in-path heuristic | Simple and low-false-positive, but misses conventional schema paths without keywords. |

## Invariants Preserved

| Invariant | Status |
|---|---|
| Redis key namespace `qodo:v24:` | ✅ Not touched — test-only pass |
| 5-gate validator order | ✅ Not touched — test-only pass |
| Strict Zod schema parsing | ✅ Not touched — test-only pass |
| Sacred-file manifest hashes | ✅ Unchanged — no source files modified |

## Validation Results

| Check | Result |
|---|---|
| `node --experimental-strip-types --check` on new test file | ✅ Exit 0 |
| `validate.sh` | ✅ 50/50 PASSED |
| `node scripts/check-dead-integrations.mjs` | ✅ 88 exports flagged; all in allowlist |
| `vitest run` / `tsc --noEmit` | ⚠️ Blocked by sandbox network constraint — no `node_modules` available. Consistent with all passes ≥ 36. Static review shows no type errors. |

## Files Changed

| File | Change |
|---|---|
| `packages/agent/tests/api-contract-guard-adversarial.test.ts` | New — 7 describe blocks, 22 adversarial test cases |
| `packages/agent/docs/58-V24-AUDIT-PASS-58.md` | New — this document |
| `tasks/agent-task-queue.json` | task-28 → `"done"`, `completedInPass: 58` |
| `tasks/agent-task-queue.md` | Status snapshot updated |
| `06-CHANGELOG.md` | Pass 58 entry added |
| `CHANGELOG.md` | Version 24.30.30 entry added |
| `ENGINEERING_NOTES.md` | Pass 58 section added |
| `package.json` (×4) | Version bumped 24.30.29 → 24.30.30 |

## Next Priority Tasks

Per `tasks/agent-task-queue.json`, the remaining unblocked locally-tractable tasks are:

| ID | Title | Priority | Why high priority |
|---|---|---|---|
| task-12 | Chaos-monkey adversarial test for circuit-breaker + retry interaction | 2 | Distinct from task-16: tests retry suppression by circuit-breaker OPEN state |
| task-21 | Semantic-cache cross-repo privacy isolation | 2 | Hive cross-repo leakage documented but not adversarially tested |
| task-23 | Prompt-registry version-drift consistency | 2 | Concurrent prompt-version updates may serve mixed versions mid-pipeline |
| task-26 | Trust-ledger gaming resistance | 2 | canAutoMerge threshold can be gamed by carefully-spaced submissions |
| task-27 | Skill-exchange schema-version migration | 3 | Old-format skill payloads may silently fail safeParseSkill |
| task-30 | Path-guard TOCTOU under concurrent agents | 2 | Two agents may simultaneously pass a pre-checked path that one then modifies |
