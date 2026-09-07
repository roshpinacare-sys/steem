import type { JsonSchema } from "../types";

export interface ToolArgumentValidation {
  ok: boolean;
  errors: string[];
}

function typeMatches(value: unknown, type: unknown): boolean {
  switch (type) {
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "boolean": return typeof value === "boolean";
    case "array": return Array.isArray(value);
    case "object": return !!value && typeof value === "object" && !Array.isArray(value);
    case "null": return value === null;
    default: return true;
  }
}

/** Validate the JSON-schema subset used by built-in tools. Fail closed. */
export function validateToolArguments(
  schema: JsonSchema,
  args: Record<string, unknown>,
): ToolArgumentValidation {
  const errors: string[] = [];
  if (schema.type !== "object") {
    return { ok: false, errors: ["tool_schema_root_must_be_object"] };
  }
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = Array.isArray(schema.required) ? schema.required.map(String) : [];
  for (const key of required) {
    if (!(key in args)) errors.push(`missing_required:${key}`);
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(args)) {
      if (!(key in properties)) errors.push(`unknown_property:${key}`);
    }
  }
  for (const [key, value] of Object.entries(args)) {
    const property = properties[key];
    if (!property) continue;
    if (!typeMatches(value, property.type)) {
      errors.push(`invalid_type:${key}:${String(property.type)}`);
      continue;
    }
    if (Array.isArray(property.enum) && !property.enum.includes(value)) {
      errors.push(`invalid_enum:${key}`);
    }
    if (typeof value === "string") {
      if (typeof property.minLength === "number" && value.length < property.minLength) {
        errors.push(`string_too_short:${key}`);
      }
      if (typeof property.maxLength === "number" && value.length > property.maxLength) {
        errors.push(`string_too_long:${key}`);
      }
      if (typeof property.pattern === "string") {
        try {
          if (!new RegExp(property.pattern, "u").test(value)) errors.push(`pattern_mismatch:${key}`);
        } catch {
          errors.push(`invalid_schema_pattern:${key}`);
        }
      }
    }
    if (typeof value === "number") {
      if (typeof property.minimum === "number" && value < property.minimum) errors.push(`number_too_small:${key}`);
      if (typeof property.maximum === "number" && value > property.maximum) errors.push(`number_too_large:${key}`);
    }
  }
  return { ok: errors.length === 0, errors };
}
