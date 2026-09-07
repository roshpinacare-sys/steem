import "./_flush.mjs";
import { test, eq } from "./_harness.mjs";
const microcents = (usd: number): bigint => BigInt(Math.round(usd * 10000));
test("μ¢ conversion is exact (sovereign-money primitive from ECOS)", () => {
  eq(microcents(1), 10000n);
  eq(microcents(0.0001), 1n);
});
test("BigInt money never loses precision", () => {
  const a = 999999999999n, b = 1n;
  eq(a + b, 1000000000000n);
});
