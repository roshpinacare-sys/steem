/**
 * api-contract-guard-adversarial.test.ts — Task-28 (Pass 58)
 *
 * ADVERSARIAL AUDIT: API-Contract-Guard schema-drift detection
 *
 * ─── Background ────────────────────────────────────────────────────────────
 * `api-contract-guard.ts` (R1) is the pre-commit gate that diffs OpenAPI and
 * GraphQL schema files in a patch against their base versions and flags
 * breaking changes before they can be committed.  It is the last structural
 * defence between a merged patch and a broken production API contract.
 *
 * The existing test landscape covers obvious, unambiguous breaking changes:
 * a removed path, a removed HTTP method, a removed GraphQL type or field.
 * These are easy for the guard to catch because the structural diff is
 * immediately visible — a key present in the base map is absent in the head
 * map.
 *
 * This pass (task-28) targets the harder failure mode: schema changes that
 * look additive or neutral to the guard's current diffing logic but are
 * genuinely load-bearing at runtime.  A naive API diff that only compares
 * key presence — "does this path / method / type / field still exist?" —
 * will silently pass several categories of deceptive changes that break real
 * consumers.
 *
 * ─── Findings summary ──────────────────────────────────────────────────────
 *
 * A. OpenAPI
 *    A1. Removing a path → BREAKING (correctly caught)          → RESISTANT
 *    A2. Removing an HTTP method → BREAKING (correctly caught)  → RESISTANT
 *    A3. Adding a new path → ADDITIVE (correctly classified)    → RESISTANT
 *    A4. New required parameter on existing method
 *        → Guard sees same path + method still present; new param is not
 *          diffed at the parameter level.  Classified as ADDITIVE (pass).
 *        → Existing clients that do not send the new required field receive
 *          a 400 error at runtime.
 *        → GAP-1 (High) — silently missed
 *    A5. Parameter type change (integer → string) on existing method
 *        → Guard does not diff parameter attributes within a method.
 *          Classified as no-change (pass).
 *        → Clients that serialise the value as an integer break.
 *        → GAP-2 (High) — silently missed
 *    A6. Required parameter becomes optional (required:true → required:false)
 *        → Guard does not compare required flags.  No change detected.
 *        → Servers that assume the field is always present now receive null
 *          and may crash.
 *        → GAP-3 (Medium) — silently missed
 *    A7. Response code removed from existing method
 *        → Guard tracks response code keys as SchemaNodes inside each
 *          method, but only compares method *existence*, never the node set
 *          within a method.  Removal of `response:200` is invisible.
 *        → Clients branching on the now-removed status code receive
 *          unexpected runtime behaviour.
 *        → GAP-4 (Medium) — silently missed
 *    A8. YAML-formatted OpenAPI files (.yaml / .yml) are not recognised
 *        by `isSchemaFile()` — only paths containing "openapi" or "swagger"
 *        in their basename trigger the guard.  A patch to
 *        `api/schema.yaml` (no keyword in path) is silently skipped.
 *        → GAP-5 (Medium) — silent skip; no breaking-change detection at all
 *
 * B. GraphQL
 *    B1. Removing a type → BREAKING (correctly caught)          → RESISTANT
 *    B2. Removing a field → BREAKING (correctly caught)         → RESISTANT
 *    B3. Field type change → BREAKING (correctly caught)        → RESISTANT
 *    B4. Nullable → non-null promotion (String → String!)
 *        → `extractGraphqlTypes` strips the `!` suffix before storing the
 *          type string, so `field.type === headField.type` evaluates to
 *          `"String" === "String"`.  The change is classified as no-change.
 *        → Resolvers that previously returned null now trigger a runtime
 *          GraphQL null-propagation error.
 *        → GAP-6 (High) — silently missed
 *    B5. New non-null field added to existing type
 *        → A brand-new field with `!` is classified as ADDITIVE (new field
 *          in an existing type).  Clients submitting mutations that omit
 *          this field receive a validation error at runtime.
 *        → GAP-7 (High) — misclassified as additive
 *
 * ─── Attack surfaces investigated ─────────────────────────────────────────
 *
 * A. OpenAPI diffing (guardApiContracts + diffOpenApi path)
 * B. GraphQL diffing (guardApiContracts + diffGraphql path)
 * C. isSchemaFile routing gate
 * D. Telemetry decision events
 * E. Cross-format batch (mixed OpenAPI + GraphQL in one patch)
 *
 * ─── Test structure ────────────────────────────────────────────────────────
 *
 *  Suite A: OpenAPI — changes the guard correctly catches (3 tests)
 *  Suite B: OpenAPI — deceptive additive-looking breaking changes (5 tests)
 *  Suite C: GraphQL — changes the guard correctly catches (3 tests)
 *  Suite D: GraphQL — deceptive additive-looking breaking changes (3 tests)
 *  Suite E: isSchemaFile routing gate (4 tests)
 *  Suite F: Telemetry event fidelity (2 tests)
 *  Suite G: Mixed-format batch (2 tests)
 *
 * Total: 7 describe blocks, 22 test cases.
 *
 * ─── Implementation notes ─────────────────────────────────────────────────
 * No network, no file system, no Redis required.
 * All inputs are constructed inline as JSON strings / GraphQL SDL strings.
 * Telemetry is stubbed with a minimal in-process spy.
 */

import { describe, it, expect, vi } from "vitest";
import {
  guardApiContracts,
  isSchemaFile,
  type ContractGuardResult,
} from "../src/services/api-contract-guard.js";
import type { Telemetry } from "../src/services/telemetry.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build a minimal OpenAPI JSON schema string. */
function openApiSchema(paths: Record<string, unknown>): string {
  return JSON.stringify({ openapi: "3.0.0", info: { title: "T", version: "1" }, paths });
}

/** Canonical path key used by the guard to detect an OpenAPI file. */
const OPENAPI_PATH = "openapi.json";

/** A GraphQL path the guard recognises. */
const GRAPHQL_PATH = "schema.graphql";

/** Minimal telemetry spy. */
function makeTelemetrySpy(): { telemetry: Telemetry; calls: Array<[string, string, Record<string, unknown>]> } {
  const calls: Array<[string, string, Record<string, unknown>]> = [];
  const telemetry: Telemetry = {
    decision: vi.fn((service: string, decision: string, meta: Record<string, unknown>) => {
      calls.push([service, decision, meta]);
    }) as unknown as Telemetry["decision"],
  } as unknown as Telemetry;
  return { telemetry, calls };
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite A — OpenAPI: Changes the guard correctly catches (RESISTANT)
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite A — OpenAPI: correctly-caught breaking changes (RESISTANT)", () => {
  it("A1: removed path is flagged as breaking", () => {
    const base = openApiSchema({
      "/users": { get: { parameters: [], responses: { 200: {} } } },
      "/orders": { get: { parameters: [], responses: { 200: {} } } },
    });
    const head = openApiSchema({
      "/users": { get: { parameters: [], responses: { 200: {} } } },
      // /orders removed
    });

    const result: ContractGuardResult = guardApiContracts(
      { [OPENAPI_PATH]: base },
      { [OPENAPI_PATH]: head },
    );

    expect(result.passed).toBe(false);
    expect(result.breakingChanges).toHaveLength(1);
    expect(result.breakingChanges[0].summary).toMatch(/Removed path \/orders/);
    expect(result.breakingChanges[0].severity).toBe("breaking");
  });

  it("A2: removed HTTP method is flagged as breaking", () => {
    const base = openApiSchema({
      "/items": {
        get:  { parameters: [], responses: { 200: {} } },
        post: { requestBody: {}, responses: { 201: {} } },
      },
    });
    const head = openApiSchema({
      "/items": {
        get: { parameters: [], responses: { 200: {} } },
        // POST removed
      },
    });

    const result = guardApiContracts(
      { [OPENAPI_PATH]: base },
      { [OPENAPI_PATH]: head },
    );

    expect(result.passed).toBe(false);
    expect(result.breakingChanges.some((c) => c.summary.includes("POST"))).toBe(true);
  });

  it("A3: added path is classified as additive, not breaking", () => {
    const base = openApiSchema({
      "/users": { get: { parameters: [], responses: { 200: {} } } },
    });
    const head = openApiSchema({
      "/users":    { get: { parameters: [], responses: { 200: {} } } },
      "/invoices": { get: { parameters: [], responses: { 200: {} } } },
    });

    const result = guardApiContracts(
      { [OPENAPI_PATH]: base },
      { [OPENAPI_PATH]: head },
    );

    expect(result.passed).toBe(true);
    expect(result.breakingChanges).toHaveLength(0);
    expect(result.additiveChanges.some((c) => c.summary.includes("/invoices"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite B — OpenAPI: Deceptive additive-looking breaking changes (GAPS)
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite B — OpenAPI: deceptive breaking changes silently missed (GAPS)", () => {
  /**
   * GAP-1 (High) — New required parameter on existing method.
   *
   * The guard's diffOpenApi only compares path and method *existence*.
   * Within a method it does not diff the parameter list.  Adding a new
   * parameter marked `required: true` is invisible to the guard — the path
   * and method still exist, so no breaking change is recorded.
   *
   * Runtime impact: Existing clients that do not send `X-Tenant-ID` receive
   * a 400 Bad Request.  The guard passes the patch and the change ships.
   */
  it("B1 — GAP-1: new required parameter is silently classified as passed (not caught)", () => {
    const base = openApiSchema({
      "/reports": {
        get: {
          parameters: [
            { name: "limit", in: "query", required: false, schema: { type: "integer" } },
          ],
          responses: { 200: {} },
        },
      },
    });
    // Head adds a new REQUIRED header parameter — breaks all existing callers.
    const head = openApiSchema({
      "/reports": {
        get: {
          parameters: [
            { name: "limit",      in: "query",  required: false, schema: { type: "integer" } },
            { name: "X-Tenant-ID", in: "header", required: true,  schema: { type: "string"  } },
          ],
          responses: { 200: {} },
        },
      },
    });

    const result = guardApiContracts(
      { [OPENAPI_PATH]: base },
      { [OPENAPI_PATH]: head },
    );

    // DOCUMENTED GAP-1: guard passes — the new required parameter is invisible.
    expect(result.passed).toBe(true);
    expect(result.breakingChanges).toHaveLength(0);

    // Demonstration: a future fix should detect this.  The change is real:
    // the head schema has an extra required parameter that base did not have.
    const baseObj = JSON.parse(base) as { paths: Record<string, { get: { parameters: Array<{ required?: boolean }> } }> };
    const headObj = JSON.parse(head) as { paths: Record<string, { get: { parameters: Array<{ required?: boolean }> } }> };
    const baseRequiredParams = baseObj.paths["/reports"].get.parameters.filter((p) => p.required).length;
    const headRequiredParams = headObj.paths["/reports"].get.parameters.filter((p) => p.required).length;
    expect(headRequiredParams).toBeGreaterThan(baseRequiredParams); // real breaking change exists
  });

  /**
   * GAP-2 (High) — Parameter type change within same method.
   *
   * The guard tracks parameters only as named SchemaNodes for the purpose
   * of recording their presence.  It never compares `type` attributes
   * between the base and head node for the same parameter name.
   *
   * Runtime impact: A client that serialises `count` as an integer will
   * receive a 400 or a silent type-coercion error once the server expects
   * a string.
   */
  it("B2 — GAP-2: parameter type change (integer → string) is silently passed (not caught)", () => {
    const base = openApiSchema({
      "/search": {
        get: {
          parameters: [
            { name: "count", in: "query", required: false, schema: { type: "integer" } },
          ],
          responses: { 200: {} },
        },
      },
    });
    const head = openApiSchema({
      "/search": {
        get: {
          parameters: [
            // type changed from integer to string — breaking for typed clients
            { name: "count", in: "query", required: false, schema: { type: "string" } },
          ],
          responses: { 200: {} },
        },
      },
    });

    const result = guardApiContracts(
      { [OPENAPI_PATH]: base },
      { [OPENAPI_PATH]: head },
    );

    // DOCUMENTED GAP-2: guard passes — parameter type change is invisible.
    expect(result.passed).toBe(true);
    expect(result.breakingChanges).toHaveLength(0);
  });

  /**
   * GAP-3 (Medium) — Required → optional flip on existing parameter.
   *
   * Servers that relied on the framework's built-in required-field
   * validation now receive null instead of a validation error.  The
   * server code that assumed the field is always present may crash.
   */
  it("B3 — GAP-3: required→optional flip on existing parameter is silently passed (not caught)", () => {
    const base = openApiSchema({
      "/checkout": {
        post: {
          parameters: [
            { name: "currency", in: "query", required: true, schema: { type: "string" } },
          ],
          requestBody: {},
          responses: { 200: {} },
        },
      },
    });
    const head = openApiSchema({
      "/checkout": {
        post: {
          parameters: [
            // required downgraded to false — server may now receive null
            { name: "currency", in: "query", required: false, schema: { type: "string" } },
          ],
          requestBody: {},
          responses: { 200: {} },
        },
      },
    });

    const result = guardApiContracts(
      { [OPENAPI_PATH]: base },
      { [OPENAPI_PATH]: head },
    );

    // DOCUMENTED GAP-3: guard passes — required flag change is invisible.
    expect(result.passed).toBe(true);
    expect(result.breakingChanges).toHaveLength(0);
  });

  /**
   * GAP-4 (Medium) — Response status code removed from existing method.
   *
   * `extractOpenApiPaths` records response codes as `response:<code>` nodes
   * in the method's node list, but `diffOpenApi` only compares whether the
   * *method key* still exists in the method map — it never diffs the node
   * sets within a method.  Removing `200` from the response codes is
   * therefore completely invisible.
   *
   * Runtime impact: Clients that branch on HTTP 200 may hit an unhandled
   * code path when the server now only returns 202 or 204.
   */
  it("B4 — GAP-4: response code removal from existing method is silently passed (not caught)", () => {
    const base = openApiSchema({
      "/jobs": {
        post: {
          requestBody: {},
          responses: { 200: {}, 202: {}, 400: {} },
        },
      },
    });
    const head = openApiSchema({
      "/jobs": {
        post: {
          requestBody: {},
          // 200 removed — clients expecting synchronous result are broken
          responses: { 202: {}, 400: {} },
        },
      },
    });

    const result = guardApiContracts(
      { [OPENAPI_PATH]: base },
      { [OPENAPI_PATH]: head },
    );

    // DOCUMENTED GAP-4: guard passes — response code set not diffed.
    expect(result.passed).toBe(true);
    expect(result.breakingChanges).toHaveLength(0);
  });

  /**
   * GAP-5 (Medium) — YAML OpenAPI file not recognised by isSchemaFile.
   *
   * `isSchemaFile` checks whether the path contains "openapi" or "swagger"
   * in the lowercased string, or ends with ".graphql"/".gql".  A canonical
   * path like `api/schema.yaml` matches none of those patterns.  The file
   * is silently skipped — `guardApiContracts` returns passed:true with zero
   * changes even though the patch contains a totally rewritten schema.
   */
  it("B5 — GAP-5: YAML OpenAPI file not in recognised path pattern is silently skipped", () => {
    // A schema file whose path does NOT contain "openapi" or "swagger"
    // and does NOT end with .graphql / .gql.  This is a common real-world
    // convention: api/schema.yaml, src/types/api.yaml, etc.
    const yamlPath = "api/schema.yaml";

    // Sanity-check that our test premise is correct: the guard does not
    // recognise this path as a schema file.
    expect(isSchemaFile(yamlPath)).toBe(false);

    // Even if we pass JSON content under this path, the guard skips it.
    const base = openApiSchema({ "/users": { get: { responses: { 200: {} } } } });
    const head = openApiSchema({}); // all paths removed — maximally breaking

    const result = guardApiContracts(
      { [yamlPath]: base },
      { [yamlPath]: head },
    );

    // DOCUMENTED GAP-5: guard passes because the file is not routed at all.
    expect(result.passed).toBe(true);
    expect(result.breakingChanges).toHaveLength(0);
    expect(result.additiveChanges).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite C — GraphQL: Changes the guard correctly catches (RESISTANT)
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite C — GraphQL: correctly-caught breaking changes (RESISTANT)", () => {
  it("C1: removed GraphQL type is flagged as breaking", () => {
    const base = `
      type Query { user: User orders: [Order] }
      type User  { id: ID! name: String }
      type Order { id: ID! total: Float }
    `;
    const head = `
      type Query { user: User }
      type User  { id: ID! name: String }
      # Order type removed
    `;

    const result = guardApiContracts(
      { [GRAPHQL_PATH]: base },
      { [GRAPHQL_PATH]: head },
    );

    expect(result.passed).toBe(false);
    expect(result.breakingChanges.some((c) => c.summary.includes("Order"))).toBe(true);
  });

  it("C2: removed GraphQL field is flagged as breaking", () => {
    const base = `
      type User { id: ID! name: String email: String }
    `;
    const head = `
      type User { id: ID! name: String }
      # email field removed
    `;

    const result = guardApiContracts(
      { [GRAPHQL_PATH]: base },
      { [GRAPHQL_PATH]: head },
    );

    expect(result.passed).toBe(false);
    expect(result.breakingChanges.some((c) => c.summary.includes("email"))).toBe(true);
  });

  it("C3: changed GraphQL field type is flagged as breaking", () => {
    const base = `
      type Product { id: ID! price: Float }
    `;
    const head = `
      type Product { id: ID! price: String }
    `;

    const result = guardApiContracts(
      { [GRAPHQL_PATH]: base },
      { [GRAPHQL_PATH]: head },
    );

    expect(result.passed).toBe(false);
    expect(result.breakingChanges.some((c) => c.summary.includes("price"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite D — GraphQL: Deceptive additive-looking breaking changes (GAPS)
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite D — GraphQL: deceptive breaking changes silently missed (GAPS)", () => {
  /**
   * GAP-6 (High) — Nullable → non-null promotion (String → String!).
   *
   * `extractGraphqlTypes` stores the type as `rawType.replace(/!$/, "")`,
   * stripping the non-null suffix before saving.  When `diffGraphql`
   * compares `field.type !== headField.type` it therefore sees
   * `"String" !== "String"` which is `false` — no change detected.
   *
   * Runtime impact: A resolver that previously returned null for this field
   * now triggers a GraphQL null-propagation error, potentially nullifying
   * an entire parent query object (depending on whether the parent is also
   * non-null).  This is a silent, progressive data-corruption vector.
   */
  it("D1 — GAP-6: nullable → non-null promotion (String → String!) is silently passed (not caught)", () => {
    const base = `
      type Profile {
        id:       ID!
        nickname: String
        bio:      String
      }
    `;
    // `nickname` is promoted from nullable to non-null — resolvers returning
    // null will now propagate errors upward.
    const head = `
      type Profile {
        id:       ID!
        nickname: String!
        bio:      String
      }
    `;

    const result = guardApiContracts(
      { [GRAPHQL_PATH]: base },
      { [GRAPHQL_PATH]: head },
    );

    // DOCUMENTED GAP-6: guard passes — the ! suffix is stripped before comparison.
    expect(result.passed).toBe(true);
    expect(result.breakingChanges).toHaveLength(0);

    // Sanity-check: the head schema genuinely contains the non-null marker.
    expect(head).toContain("nickname: String!");
  });

  /**
   * GAP-7a (High) — Input types are invisible to the GraphQL parser.
   *
   * `extractGraphqlTypes` uses the regex `/type\s+(\w+)\s*\{([^}]*)\}/g`.
   * This matches only `type <Name> { ... }` blocks — it does NOT match
   * `input <Name> { ... }` blocks.  An `input` type (the primary mechanism
   * for mutation arguments in GraphQL) is completely skipped.  Any change
   * to an Input type — including adding a new non-null required field that
   * will break every existing mutation caller — produces zero detected
   * changes: `passed: true`, `breakingChanges: []`, `additiveChanges: []`.
   *
   * Runtime impact: A patch that adds `shippingAddressId: ID!` to
   * `CreateOrderInput` ships undetected.  Every existing client that submits
   * the mutation without the new field receives a GraphQL validation error.
   */
  it("D2 — GAP-7a: input type completely invisible to parser — new required field fully missed", () => {
    const base = `
      input CreateOrderInput {
        productId: ID!
        quantity:  Int!
      }
    `;
    // `shippingAddressId: ID!` is a new non-null required field.
    // Every existing mutation caller that doesn't include it will break.
    const head = `
      input CreateOrderInput {
        productId:         ID!
        quantity:          Int!
        shippingAddressId: ID!
      }
    `;

    const result = guardApiContracts(
      { [GRAPHQL_PATH]: base },
      { [GRAPHQL_PATH]: head },
    );

    // DOCUMENTED GAP-7a: guard produces zero changes — the entire `input`
    // block is invisible to the `type\s+` regex in extractGraphqlTypes.
    // The result is a full miss, not a misclassification.
    expect(result.passed).toBe(true);
    expect(result.breakingChanges).toHaveLength(0);
    expect(result.additiveChanges).toHaveLength(0);

    // Demonstrate the parser blind spot explicitly: the guard also produces
    // zero changes when the input type is removed entirely.
    const headEmpty = `# input type removed`;
    const resultRemoved = guardApiContracts(
      { [GRAPHQL_PATH]: base },
      { [GRAPHQL_PATH]: headEmpty },
    );
    expect(resultRemoved.passed).toBe(true);       // Full miss — not flagged as breaking
    expect(resultRemoved.breakingChanges).toHaveLength(0);
  });

  /**
   * GAP-7b (High) — New non-null field on existing `type` block misclassified as additive.
   *
   * For `type` blocks (as opposed to `input` blocks, which are invisible),
   * `diffGraphql` classifies any new field — regardless of nullability — as
   * ADDITIVE.  A new `!`-suffixed field on an output type (e.g., on a type
   * returned by a Query resolver) can still break consumers: if the resolver
   * currently returns an object without the new field, the GraphQL runtime
   * will emit a field-error.  The guard reports `passed: true` and records
   * the change as additive rather than breaking.
   *
   * Note: unlike GAP-7a, the guard DOES detect and report this change — the
   * failure is in severity classification, not in detection.
   */
  it("D3 — GAP-7b: new non-null field in `type` block misclassified as additive (not breaking)", () => {
    const base = `
      type Order {
        id:    ID!
        total: Float!
      }
    `;
    // `status: String!` is new and non-null — resolvers returning an Order
    // without this field will cause a GraphQL null-propagation error.
    const head = `
      type Order {
        id:     ID!
        total:  Float!
        status: String!
      }
    `;

    const result = guardApiContracts(
      { [GRAPHQL_PATH]: base },
      { [GRAPHQL_PATH]: head },
    );

    // DOCUMENTED GAP-7b: guard passes and classifies the change as additive.
    expect(result.passed).toBe(true);
    expect(result.breakingChanges).toHaveLength(0);

    // The new field IS detected — but classified as additive, not breaking.
    const additiveSummaries = result.additiveChanges.map((c) => c.summary);
    expect(additiveSummaries.some((s) => s.includes("status"))).toBe(true);

    // A future fix: check the `required` flag (which extractGraphqlTypes
    // already populates) on newly-added fields and re-classify them as
    // breaking when `required: true`.
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite E — isSchemaFile routing gate
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite E — isSchemaFile routing gate", () => {
  it("E1: paths containing 'openapi' are recognised", () => {
    expect(isSchemaFile("openapi.json")).toBe(true);
    expect(isSchemaFile("src/openapi/v1.json")).toBe(true);
    expect(isSchemaFile("api-openapi-spec.yaml")).toBe(true); // keyword in name, any ext
  });

  it("E2: paths containing 'swagger' are recognised", () => {
    expect(isSchemaFile("swagger.json")).toBe(true);
    expect(isSchemaFile("docs/swagger-v2.json")).toBe(true);
  });

  it("E3: .graphql and .gql extensions are recognised", () => {
    expect(isSchemaFile("schema.graphql")).toBe(true);
    expect(isSchemaFile("src/schema.gql")).toBe(true);
  });

  it("E4: plain YAML / JSON schema files without keyword in path are NOT recognised — GAP-5", () => {
    // These are real-world conventions that the guard silently skips.
    expect(isSchemaFile("api/schema.yaml")).toBe(false);
    expect(isSchemaFile("src/types/api.yaml")).toBe(false);
    expect(isSchemaFile("contracts/v2.yml")).toBe(false);
    expect(isSchemaFile("schemas/user.json")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite F — Telemetry event fidelity
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite F — Telemetry event fidelity", () => {
  it("F1: telemetry.decision is emitted with 'passed' when no breaking changes", () => {
    const { telemetry, calls } = makeTelemetrySpy();
    const base = openApiSchema({ "/ping": { get: { responses: { 200: {} } } } });
    const head = openApiSchema({
      "/ping":   { get: { responses: { 200: {} } } },
      "/health": { get: { responses: { 200: {} } } },
    });

    guardApiContracts({ [OPENAPI_PATH]: base }, { [OPENAPI_PATH]: head }, telemetry);

    expect(calls).toHaveLength(1);
    const [service, decision, meta] = calls[0];
    expect(service).toBe("api-contract-guard");
    expect(decision).toBe("passed");
    expect(meta.breaking).toBe(0);
    expect(meta.additive).toBe(1);
  });

  it("F2: telemetry.decision is emitted with 'breaking-detected' when breaking changes exist", () => {
    const { telemetry, calls } = makeTelemetrySpy();
    const base = openApiSchema({ "/users": { get: { responses: { 200: {} } } } });
    const head = openApiSchema({}); // /users removed

    guardApiContracts({ [OPENAPI_PATH]: base }, { [OPENAPI_PATH]: head }, telemetry);

    expect(calls).toHaveLength(1);
    const [service, decision, meta] = calls[0];
    expect(service).toBe("api-contract-guard");
    expect(decision).toBe("breaking-detected");
    expect(meta.breaking).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite G — Mixed-format batch (OpenAPI + GraphQL in one patch)
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite G — Mixed-format batch", () => {
  it("G1: breaking change in GraphQL fails the whole batch even when OpenAPI is clean", () => {
    const baseOpenApi = openApiSchema({ "/users": { get: { responses: { 200: {} } } } });
    const headOpenApi = openApiSchema({ "/users": { get: { responses: { 200: {} } } } });

    const baseGraphql = `type Query { user: User } type User { id: ID! name: String }`;
    const headGraphql = `type Query { user: User } type User { id: ID! }`;
    // name field removed — breaking

    const result = guardApiContracts(
      { [OPENAPI_PATH]: baseOpenApi, [GRAPHQL_PATH]: baseGraphql },
      { [OPENAPI_PATH]: headOpenApi, [GRAPHQL_PATH]: headGraphql },
    );

    expect(result.passed).toBe(false);
    expect(result.breakingChanges.some((c) => c.type === "graphql")).toBe(true);
  });

  it("G2: deceptive changes in both formats both pass silently — compounding gap exposure", () => {
    // OpenAPI: required parameter added (GAP-1)
    const baseOpenApi = openApiSchema({
      "/events": { post: { parameters: [], requestBody: {}, responses: { 201: {} } } },
    });
    const headOpenApi = openApiSchema({
      "/events": {
        post: {
          parameters: [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string" } }],
          requestBody: {},
          responses: { 201: {} },
        },
      },
    });

    // GraphQL: nullable → non-null (GAP-6)
    const baseGraphql = `type Event { id: ID! payload: String }`;
    const headGraphql  = `type Event { id: ID! payload: String! }`;

    const result = guardApiContracts(
      { [OPENAPI_PATH]: baseOpenApi, [GRAPHQL_PATH]: baseGraphql },
      { [OPENAPI_PATH]: headOpenApi, [GRAPHQL_PATH]: headGraphql },
    );

    // DOCUMENTED: both deceptive breaking changes are silently passed.
    // A patch containing both would ship undetected.
    expect(result.passed).toBe(true);
    expect(result.breakingChanges).toHaveLength(0);
  });
});
