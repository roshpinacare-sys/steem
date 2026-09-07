import { describe, it, expect } from "vitest";
import { evaluateExpression, calculatorTool } from "@/lib/engine/tools/calculator";

describe("calculator", () => {
  it("evaluates arithmetic with precedence", () => {
    expect(evaluateExpression("42 * 3 + 7")).toBe(133);
    expect(evaluateExpression("2 + 3 * 4")).toBe(14);
    expect(evaluateExpression("(2 + 3) * 4")).toBe(20);
    expect(evaluateExpression("2 ^ 3 ^ 2")).toBe(512); // right-assoc
    expect(evaluateExpression("-5 + 3")).toBe(-2);
    expect(evaluateExpression("10 % 3")).toBe(1);
  });

  it("tool returns ok result", async () => {
    const res = await calculatorTool.execute(
      { expression: "6 * 7" },
      {} as never,
    );
    expect(res.ok).toBe(true);
    expect((res.output as { result: number }).result).toBe(42);
  });

  it("tool fails gracefully on garbage", async () => {
    const res = await calculatorTool.execute(
      { expression: "2 +* 3" },
      {} as never,
    );
    expect(res.ok).toBe(false);
  });
});
