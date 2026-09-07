/**
 * templates.ts — starter projects mounted into the Studio's WebContainer.
 *
 * The default "Static site" is zero-dependency (npm install is a no-op) so the
 * create → run → preview → build loop works instantly and offline. It runs a
 * tiny Node HTTP server with no packages, which is the most reliable way to
 * demonstrate the full runtime in any environment.
 */
import type { FileSystemTree } from "@webcontainer/api";

export interface Template {
  id: string;
  name: string;
  blurb: string;
  /** File to open in the editor first. */
  entry: string;
  tree: FileSystemTree;
}

const SERVER_MJS = `import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };
const ROOT = new URL("./public/", import.meta.url).pathname;
const PORT = 3000;

createServer(async (req, res) => {
  let path = decodeURIComponent((req.url || "/").split("?")[0]);
  if (path === "/") path = "/index.html";
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { "Content-Type": MIME[extname(path)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found: " + path);
  }
}).listen(PORT, () => console.log("Dev server listening on http://localhost:" + PORT));
`;

const BUILD_MJS = `import { mkdir, cp } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await cp("public", "dist", { recursive: true });
console.log("Build complete → dist/ (" + new Date().toISOString() + ")");
`;

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Qodo Studio</title>
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body>
    <main>
      <div class="badge">running in your browser</div>
      <h1>Hello from <span>Qodo Studio</span></h1>
      <p>This page is served by a Node.js server running inside a WebContainer — no backend, no install. Edit <code>public/index.html</code> and press <b>Dev</b> again to see changes.</p>
      <button id="btn">Clicked <span id="n">0</span> times</button>
    </main>
    <script src="/app.js"></script>
  </body>
</html>
`;

const STYLE_CSS = `:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: 'Inter', system-ui, sans-serif;
  background: radial-gradient(1200px 800px at 70% -10%, #1e1b4b, #070b16 60%); color: #e2e8f0; }
main { text-align: center; padding: 40px; max-width: 560px; }
.badge { display: inline-block; font-size: 12px; letter-spacing: 1px; text-transform: uppercase; color: #a5b4fc;
  background: rgba(99,102,241,0.14); border: 1px solid rgba(99,102,241,0.35); padding: 5px 12px; border-radius: 999px; margin-bottom: 20px; }
h1 { font-size: 40px; margin: 0 0 14px; }
h1 span { background: linear-gradient(90deg, #818cf8, #34d399); -webkit-background-clip: text; background-clip: text; color: transparent; }
p { color: #94a3b8; line-height: 1.6; }
code, b { color: #cbd5e1; }
button { margin-top: 24px; padding: 12px 22px; font-size: 15px; font-weight: 600; color: #0a0e1a; cursor: pointer;
  background: linear-gradient(135deg, #818cf8, #6366f1); border: none; border-radius: 12px; }
`;

const APP_JS = `let n = 0;
const btn = document.getElementById("btn");
const label = document.getElementById("n");
btn.addEventListener("click", () => { n += 1; label.textContent = String(n); });
`;

export const STATIC_TEMPLATE: Template = {
  id: "static",
  name: "Static site",
  blurb: "Zero-dependency Node server. Instant dev + preview + build, fully offline.",
  entry: "public/index.html",
  tree: {
    "package.json": { file: { contents: JSON.stringify({
      name: "qodo-studio-app",
      private: true,
      type: "module",
      scripts: { dev: "node server.mjs", build: "node build.mjs", start: "node server.mjs" },
    }, null, 2) } },
    "server.mjs": { file: { contents: SERVER_MJS } },
    "build.mjs": { file: { contents: BUILD_MJS } },
    "public": { directory: {
      "index.html": { file: { contents: INDEX_HTML } },
      "style.css": { file: { contents: STYLE_CSS } },
      "app.js": { file: { contents: APP_JS } },
    } },
    "README.md": { file: { contents: "# Qodo Studio project\n\nEdit files, then Install → Dev → Preview → Build.\n" } },
  },
};

export const TEMPLATES: Template[] = [STATIC_TEMPLATE];
