import { describe, expect, it } from "vitest";
import { validateToolArguments } from "@/lib/engine/tools/validate";

const schema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1, maxLength: 20 },
    count: { type: "integer", minimum: 1, maximum: 10 },
    mode: { type: "string", enum: ["safe", "fast"] },
  },
  required: ["name", "count"],
  additionalProperties: false,
};

describe("tool argument validation", () => {
  it("accepts valid arguments", () => {
    expect(validateToolArguments(schema, { name: "report", count: 2, mode: "safe" })).toEqual({
      ok: true,
      errors: [],
    });
  });

  it("fails closed for missing, unknown, and wrong-type arguments", () => {
    const result = validateToolArguments(schema, {
      count: 1.5,
      extra: true,
      mode: "unsafe",
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "missing_required:name",
        "unknown_property:extra",
        "invalid_type:count:integer",
        "invalid_enum:mode",
      ]),
    );
  });
});
