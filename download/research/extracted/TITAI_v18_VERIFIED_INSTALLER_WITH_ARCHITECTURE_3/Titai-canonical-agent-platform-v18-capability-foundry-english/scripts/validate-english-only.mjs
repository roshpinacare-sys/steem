import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const ignored = new Set([".git", "node_modules", ".next", "dist", "coverage", "artifacts"]);
const textExtensions = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".jsonl",
  ".md", ".mdc", ".txt", ".yml", ".yaml", ".css", ".scss", ".html",
  ".xml", ".svg", ".sql", ".toml", ".ini", ".env", ".example", ""
]);

// English text may contain punctuation and mathematical symbols, but release text and
// path names must not contain letters from non-Latin writing systems.
const disallowedScripts = /[\u0370-\u03FF\u0400-\u052F\u0590-\u08FF\u0900-\u0DFF\u0E00-\u0FFF\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/u;
const violations = [];

function inspectPath(relativePath) {
  if (disallowedScripts.test(relativePath)) violations.push(`${relativePath}: path name`);
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const relative = path.relative(root, full);
    inspectPath(relative);
    if (entry.isDirectory()) { walk(full); continue; }
    const ext = path.extname(entry.name).toLowerCase();
    if (!textExtensions.has(ext) && !entry.name.endsWith(".SKILL.md")) continue;
    let content;
    try { content = fs.readFileSync(full, "utf8"); } catch { continue; }
    content.split(/\r?\n/).forEach((line, index) => {
      if (disallowedScripts.test(line)) violations.push(`${relative}:${index + 1}`);
    });
  }
}
walk(root);
if (violations.length) {
  console.error("English-only validation failed. Non-Latin script content found:");
  violations.forEach((v) => console.error(`- ${v}`));
  process.exit(1);
}
console.log("English-only validation passed: no non-Latin writing-system content found.");
