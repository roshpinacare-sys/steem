/**
 * pin-textzoom.mjs — pin the Android WebView's textZoom to 100 so the system
 * font-size setting cannot inflate the app's fixed-px layout (which clips
 * content off-screen). Runs in CI right after `npx cap add android` rewrites
 * the generated MainActivity. Hard-fails on generator drift so a silent
 * regression can't ship.
 *
 * Usage: node ../../scripts/pin-textzoom.mjs   (cwd: apps/mission-control)
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "android", "app", "src", "main", "java");

function findMainActivity(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      const hit = findMainActivity(p);
      if (hit) return hit;
    } else if (name === "MainActivity.java") {
      return p;
    }
  }
  return null;
}

const path = findMainActivity(ROOT);
if (!path) {
  console.error(`pin-textzoom: MainActivity.java not found under ${ROOT}`);
  process.exit(1);
}

const src = readFileSync(path, "utf8");
if (src.includes("setTextZoom")) {
  console.log(`pin-textzoom: already patched — ${path}`);
  process.exit(0);
}

// Capacitor generates: `public class MainActivity extends BridgeActivity {}`
const marker = "public class MainActivity extends BridgeActivity {";
if (!src.includes(marker)) {
  console.error(`pin-textzoom: expected generated BridgeActivity shape not found in ${path} — Capacitor template drift; update this script.`);
  process.exit(1);
}

let out = src.replace(
  marker,
  marker +
    "\n    @Override\n" +
    "    public void onCreate(android.os.Bundle savedInstanceState) {\n" +
    "        super.onCreate(savedInstanceState);\n" +
    "        getBridge().getWebView().getSettings().setTextZoom(100);\n" +
    "    }\n",
);

writeFileSync(path, out);
if (!readFileSync(path, "utf8").includes("setTextZoom(100)")) {
  console.error("pin-textzoom: write verification failed");
  process.exit(1);
}
console.log(`pin-textzoom: patched ${path}`);
