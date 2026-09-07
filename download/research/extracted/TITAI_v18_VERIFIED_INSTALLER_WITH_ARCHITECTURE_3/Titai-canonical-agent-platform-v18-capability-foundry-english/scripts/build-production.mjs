import { spawn } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";

const nextBin = resolve(process.cwd(), "node_modules/next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, "build"], {
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1",
  },
});
child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Next.js build terminated by signal ${signal}.`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
