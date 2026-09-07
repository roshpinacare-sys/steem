import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    env: {
      DATABASE_PATH: ":memory:",
      ENCRYPTION_KEY: "dGVzdC1lbmNyeXB0aW9uLWtleS0zMi1ieXRlcy1sb25nISE=",
      AUTH_SECRET: "test-auth-secret-for-vitest-only-not-real",
      NODE_ENV: "test",
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "server-only": resolve(__dirname, "./tests/stubs/server-only.ts"),
    },
  },
});
