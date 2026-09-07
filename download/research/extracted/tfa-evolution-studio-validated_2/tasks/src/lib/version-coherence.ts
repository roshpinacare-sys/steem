/**
 * TFA Evolution Studio v29 — Version Coherence
 *
 * PLATFORM_VERSION is derived from package.json at module load time.
 * No hardcoded version literals anywhere in the platform.
 */

import fs from "fs";
import path from "path";

let PLATFORM_VERSION = "0.0.0";

try {
  const pkgPath = path.join(process.cwd(), "package.json");
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    PLATFORM_VERSION = pkg.version || "0.0.0";
  }
} catch {
  // Fallback already set
}

export { PLATFORM_VERSION };
