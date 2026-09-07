import "./stop.mjs";
import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { root } from "./common.mjs";
const removeData = process.argv.includes("--remove-data");
for (const name of ["node_modules", ".next", ".titai-installer", "logs"]) rmSync(join(root, name), { recursive: true, force: true });
if (removeData) for (const name of ["data", "backups", ".env", "FIRST_LOGIN.txt", "INSTALLATION.json"]) rmSync(join(root, name), { recursive: true, force: true });
console.log(removeData ? "TITAI runtime and local data removed. Delete this folder to finish." : "TITAI runtime removed; data, backups and .env were preserved. Delete this folder manually when no longer needed.");
