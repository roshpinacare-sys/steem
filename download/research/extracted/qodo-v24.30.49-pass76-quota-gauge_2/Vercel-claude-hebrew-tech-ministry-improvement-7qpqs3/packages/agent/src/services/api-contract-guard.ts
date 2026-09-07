/**
 * API Contract Guard (R1) — OpenAPI / GraphQL breaking-change detection.
 *
 * Before commit, diff the patch's effect on any OpenAPI or GraphQL schema file
 * against the previous version. Flags breaking changes distinctly from additive
 * ones, giving blast-radius.ts a concept of "this matches the objective but
 * breaks every external consumer of this API."
 */
import { log } from "./logger.js";
import type { Telemetry } from "./telemetry.js";

export interface ContractChange {
  path: string; // schema file path
  type: "openapi" | "graphql";
  breaking: boolean;
  severity: "breaking" | "additive";
  summary: string;
  details: string[];
}

export interface ContractGuardResult {
  passed: boolean;
  breakingChanges: ContractChange[];
  additiveChanges: ContractChange[];
}

interface SchemaNode {
  name: string;
  type?: string;
  required?: boolean;
  deprecated?: boolean;
}

// ---------------------------------------------------------------------------
// OpenAPI helpers
// ---------------------------------------------------------------------------

function extractOpenApiPaths(schema: unknown): Map<string, Map<string, SchemaNode[]>> {
  const result = new Map<string, Map<string, SchemaNode[]>>();
  const paths = (schema as Record<string, unknown>)?.paths as Record<string, Record<string, unknown>> | undefined;
  if (!paths) return result;

  for (const [path, methods] of Object.entries(paths)) {
    const methodMap = new Map<string, SchemaNode[]>();
    for (const [method, spec] of Object.entries(methods)) {
      const parameters = ((spec as Record<string, unknown>)?.parameters as Array<Record<string, unknown>>) || [];
      const requestBody = (spec as Record<string, unknown>)?.requestBody as Record<string, unknown> | undefined;
      const responses = (spec as Record<string, unknown>)?.responses as Record<string, unknown> | undefined;

      const nodes: SchemaNode[] = [];
      for (const p of parameters) {
        nodes.push({
          name: String(p.name ?? ""),
          type: String((p.schema as Record<string, unknown>)?.type ?? ""),
          required: p.required === true,
          deprecated: p.deprecated === true,
        });
      }
      if (requestBody) {
        nodes.push({ name: "requestBody", type: "object" });
      }
      if (responses) {
        for (const code of Object.keys(responses)) {
          nodes.push({ name: `response:${code}`, type: "object" });
        }
      }
      methodMap.set(method.toUpperCase(), nodes);
    }
    result.set(path, methodMap);
  }
  return result;
}

function diffOpenApi(baseSchema: unknown, headSchema: unknown): ContractChange[] {
  const base = extractOpenApiPaths(baseSchema);
  const head = extractOpenApiPaths(headSchema);
  const changes: ContractChange[] = [];

  // Removed paths or methods are breaking
  for (const [path, methods] of base) {
    const headMethods = head.get(path);
    if (!headMethods) {
      changes.push({
        path,
        type: "openapi",
        breaking: true,
        severity: "breaking",
        summary: `Removed path ${path}`,
        details: Array.from(methods.keys()).map((m) => `removed method ${m}`),
      });
      continue;
    }
    for (const [method] of methods) {
      if (!headMethods.has(method)) {
        changes.push({
          path,
          type: "openapi",
          breaking: true,
          severity: "breaking",
          summary: `Removed method ${method.toUpperCase()} on ${path}`,
          details: [],
        });
      }
    }
  }

  // New paths/methods are additive
  for (const [path, methods] of head) {
    if (!base.has(path)) {
      changes.push({
        path,
        type: "openapi",
        breaking: false,
        severity: "additive",
        summary: `Added path ${path}`,
        details: Array.from(methods.keys()).map((m) => `added method ${m}`),
      });
    }
  }

  return changes;
}

// ---------------------------------------------------------------------------
// GraphQL helpers
// ---------------------------------------------------------------------------

function extractGraphqlTypes(schemaText: string): Map<string, Map<string, SchemaNode>> {
  const types = new Map<string, Map<string, SchemaNode>>();
  const typeRegex = /type\s+(\w+)\s*\{([^}]*)\}/g;
  const fieldRegex = /(\w+)(?:\([^)]*\))?\s*:\s*([^\s!]+!?)?/g;
  let match: RegExpExecArray | null;
  while ((match = typeRegex.exec(schemaText)) !== null) {
    const typeName = match[1];
    const body = match[2];
    const fields = new Map<string, SchemaNode>();
    let fieldMatch: RegExpExecArray | null;
    // Reset lastIndex so the same regex can be reused for each type body.
    fieldRegex.lastIndex = 0;
    while ((fieldMatch = fieldRegex.exec(body)) !== null) {
      const name = fieldMatch[1];
      const rawType = fieldMatch[2] || "";
      const full = fieldMatch[0];
      if (!name || fields.has(name)) continue;
      fields.set(name, {
        name,
        type: rawType.replace(/!$/, ""),
        required: full.includes("!"),
        deprecated: full.includes("@deprecated"),
      });
    }
    types.set(typeName, fields);
  }
  return types;
}

function diffGraphql(baseText: string, headText: string): ContractChange[] {
  const base = extractGraphqlTypes(baseText);
  const head = extractGraphqlTypes(headText);
  const changes: ContractChange[] = [];

  for (const [typeName, baseFields] of base) {
    const headFields = head.get(typeName);
    if (!headFields) {
      changes.push({
        path: `type:${typeName}`,
        type: "graphql",
        breaking: true,
        severity: "breaking",
        summary: `Removed type ${typeName}`,
        details: [],
      });
      continue;
    }
    for (const [fieldName, field] of baseFields) {
      const headField = headFields.get(fieldName);
      if (!headField) {
        changes.push({
          path: `type:${typeName}`,
          type: "graphql",
          breaking: true,
          severity: "breaking",
          summary: `Removed field ${typeName}.${fieldName}`,
          details: [],
        });
      } else if (field.type && headField.type && field.type !== headField.type) {
        changes.push({
          path: `type:${typeName}`,
          type: "graphql",
          breaking: true,
          severity: "breaking",
          summary: `Changed type of ${typeName}.${fieldName}: ${field.type} → ${headField.type}`,
          details: [],
        });
      }
    }
  }

  for (const [typeName, headFields] of head) {
    if (!base.has(typeName)) {
      changes.push({
        path: `type:${typeName}`,
        type: "graphql",
        breaking: false,
        severity: "additive",
        summary: `Added type ${typeName}`,
        details: Array.from(headFields.keys()).map((f) => `added field ${f}`),
      });
      continue;
    }

    // New fields in an existing type are additive.
    const baseFields = base.get(typeName)!;
    for (const [fieldName] of headFields) {
      if (!baseFields.has(fieldName)) {
        changes.push({
          path: `type:${typeName}`,
          type: "graphql",
          breaking: false,
          severity: "additive",
          summary: `Added field ${typeName}.${fieldName}`,
          details: [`added field ${fieldName}`],
        });
      }
    }
  }

  return changes;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Identify whether a file path is a schema file we can guard. */
export function isSchemaFile(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.includes("openapi") || lower.includes("swagger") || lower.endsWith(".graphql") || lower.endsWith(".gql");
}

/**
 * Diff OpenAPI/GraphQL schema files found in a patch.
 *
 * `baseFiles` and `headFiles` are maps of schema path → content.
 */
export function guardApiContracts(
  baseFiles: Record<string, string>,
  headFiles: Record<string, string>,
  telemetry?: Telemetry,
): ContractGuardResult {
  const breakingChanges: ContractChange[] = [];
  const additiveChanges: ContractChange[] = [];

  for (const path of Object.keys(headFiles)) {
    if (!isSchemaFile(path)) continue;
    const baseText = baseFiles[path];
    const headText = headFiles[path];

    let changes: ContractChange[] = [];
    if (path.toLowerCase().endsWith(".graphql") || path.toLowerCase().endsWith(".gql")) {
      changes = diffGraphql(baseText || "", headText);
    } else {
      try {
        const baseSchema = baseText ? (JSON.parse(baseText) as unknown) : {};
        const headSchema = JSON.parse(headText) as unknown;
        changes = diffOpenApi(baseSchema, headSchema);
      } catch (e: unknown) {
        log.warn("api-contract-guard: schema parse failed", { path, error: e instanceof Error ? e.message : String(e) });
        continue;
      }
    }

    for (const c of changes) {
      if (c.breaking) breakingChanges.push(c);
      else additiveChanges.push(c);
    }
  }

  const passed = breakingChanges.length === 0;
  log.info("api-contract-guard: evaluated", {
    passed,
    breaking: breakingChanges.length,
    additive: additiveChanges.length,
  });
  telemetry?.decision("api-contract-guard", passed ? "passed" : "breaking-detected", {
    breaking: breakingChanges.length,
    additive: additiveChanges.length,
  });

  return { passed, breakingChanges, additiveChanges };
}
