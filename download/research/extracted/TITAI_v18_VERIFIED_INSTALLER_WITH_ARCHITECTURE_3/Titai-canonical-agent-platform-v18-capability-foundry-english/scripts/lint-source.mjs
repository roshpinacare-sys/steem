import fs from "node:fs";
import path from "node:path";

const roots = ["src", "tests", "scripts"];
const extensions = new Set([".ts", ".tsx", ".js", ".mjs", ".json"]);
const failures = [];

for (const root of roots) walk(root);

if (failures.length > 0) {
  console.error("Repository source lint failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Repository source lint passed: syntax hygiene and client-boundary checks are clean.");

function walk(entry) {
  if (!fs.existsSync(entry)) return;
  const stat = fs.statSync(entry);
  if (stat.isDirectory()) {
    for (const child of fs.readdirSync(entry)) {
      if (["node_modules", ".next", "coverage"].includes(child)) continue;
      walk(path.join(entry, child));
    }
    return;
  }
  if (!extensions.has(path.extname(entry))) return;

  const content = fs.readFileSync(entry, "utf8");
  if (content.includes("\0")) failures.push(`${entry}: contains a NUL byte`);
  if (/^(<{7}|={7}|>{7})/m.test(content)) {
    failures.push(`${entry}: contains an unresolved merge-conflict marker`);
  }
  if (/\@ts-(ignore|nocheck)/.test(content)) {
    failures.push(`${entry}: suppresses TypeScript validation`);
  }
  if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(content)) {
    failures.push(`${entry}: contains dynamic code execution`);
  }

  if (path.extname(entry) === ".json") {
    try {
      JSON.parse(content);
    } catch (error) {
      failures.push(`${entry}: invalid JSON (${error.message})`);
    }
  }

  const firstStatement = content.trimStart().split(/\r?\n/, 1)[0];
  const isClient = firstStatement === '"use client";' || firstStatement === "'use client';";
  if (isClient && /from\s+["'](?:node:|server-only)/.test(content)) {
    failures.push(`${entry}: client component imports a server-only module`);
  }
}
