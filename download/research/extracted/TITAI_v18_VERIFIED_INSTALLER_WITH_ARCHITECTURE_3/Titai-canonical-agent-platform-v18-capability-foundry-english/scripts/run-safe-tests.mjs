import { spawn } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";

// The monolithic Vitest command is retained as a diagnostic, but release
// validation uses the isolated runner so every test process must terminate.
const runner = resolve(process.cwd(), "scripts/run-complete-tests.mjs");
const child = spawn(process.execPath, [runner, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: {
    ...process.env,
    TITAI_SQLITE_DRIVER: process.env.TITAI_SQLITE_DRIVER ?? "auto",
    NODE_NO_WARNINGS: "1",
  },
});
child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Safe tests terminated by signal ${signal}.`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
