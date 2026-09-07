import { defineConfig } from "vitest/config";

/**
 * Opt-in config for the CPU-heavy scale suites (see tests/scale/).
 * Run with: npm run test:scale -w packages/agent
 */
export default defineConfig({
  resolve: {
    extensions: [".ts", ".js", ".mjs", ".json"],
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/scale/**/*.test.ts"],
    reporters: ["verbose"],
    // ts-morph renaming is quadratic; these suites legitimately run minutes.
    testTimeout: 1_200_000,
  },
});
