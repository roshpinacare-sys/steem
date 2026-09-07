import "./stop.mjs";
import { checkNode, runNpm } from "./common.mjs";
checkNode();
console.log("Reinstalling locked dependencies while preserving .env and data...");
runNpm(["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { timeout: 45 * 60_000 });
runNpm(["run", "db:migrate"], { timeout: 5 * 60_000 });
runNpm(["run", "build"], { timeout: 45 * 60_000 });
runNpm(["run", "release:audit"], { timeout: 10 * 60_000 });
console.log("Repair complete. Run START.cmd.");
