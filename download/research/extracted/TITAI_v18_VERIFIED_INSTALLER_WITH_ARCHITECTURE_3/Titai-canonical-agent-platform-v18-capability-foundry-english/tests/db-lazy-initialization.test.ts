import { describe, expect, it } from "vitest";

describe("database module initialization", () => {
  it("can be imported without opening the native SQLite connection", async () => {
    const module = await import("@/lib/db");
    expect(module.db).toBeDefined();
    expect(module.getDb).toBeTypeOf("function");
  });
});
