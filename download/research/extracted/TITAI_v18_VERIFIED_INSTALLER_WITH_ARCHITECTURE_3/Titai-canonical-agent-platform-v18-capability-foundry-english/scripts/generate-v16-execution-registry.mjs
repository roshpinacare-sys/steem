import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = process.cwd();
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const packageScripts = packageJson.scripts ?? {};
const workflowDir = join(root, ".github", "workflows");
const workflowText = existsSync(workflowDir)
  ? readdirSync(workflowDir).filter((name) => /\.ya?ml$/.test(name)).map((name) => readFileSync(join(workflowDir, name), "utf8")).join("\n")
  : "";

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const absolute = join(dir, name);
    const info = statSync(absolute);
    if (info.isDirectory()) out.push(...walk(absolute));
    else if (info.isFile()) out.push(absolute);
  }
  return out;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const referencedText = `${Object.values(packageScripts).join("\n")}\n${workflowText}`;
const candidates = [
  ...walk(join(root, "scripts")),
  ...walk(join(root, "docs", "canonical", "skills")),
  ...walk(join(root, ".github", "workflows")),
].filter((path) => !path.includes("node_modules"));

const assets = candidates.map((absolute) => {
  const path = relative(root, absolute).replaceAll("\\", "/");
  const base = path.split("/").at(-1);
  const kind = path.startsWith("scripts/") ? "script" : path.includes("/skills/") ? "skill" : "workflow";
  const triggers = Object.entries(packageScripts)
    .filter(([, command]) => command.includes(path) || command.includes(base))
    .map(([name]) => `npm:${name}`);
  if (workflowText.includes(path) || workflowText.includes(base)) triggers.push("ci:workflow-reference");
  const text = readFileSync(absolute, "utf8");
  const networkHints = /https?:\/\/|fetch\(|axios|curl\s|wget\s|npm\s+(?:ci|install)|npx\s/i.test(text);
  const nativeHints = /better-sqlite3|node-gyp|\.node\b|spawn\(|execFile\(|child_process/i.test(text);
  const evidenceHints = [...text.matchAll(/docs\/canonical\/evidence\/[A-Za-z0-9_./-]+/g)].map((match) => match[0]);
  return {
    id: `asset-${createHash("sha256").update(path).digest("hex").slice(0, 16)}`,
    path,
    kind,
    sha256: sha256(absolute),
    bytes: statSync(absolute).size,
    active: triggers.length > 0,
    triggers: [...new Set(triggers)].sort(),
    dependencies: {
      networkHint: networkHints,
      nativeHint: nativeHints,
      packageLifecycleScriptsEnabled: /npm\s+(?:ci|install)(?![^\n]*--ignore-scripts)/i.test(text),
    },
    offlineCapability: networkHints ? "requires_review" : "offline_capable",
    evidencePaths: [...new Set(evidenceHints)].sort(),
    releaseGate: referencedText.includes(path) || referencedText.includes(base),
    recommendation: triggers.length > 0 ? "retain_and_test" : kind === "script" ? "review_or_deprecate" : "retain_as_reference",
  };
});

const registry = {
  format: "titai-execution-registry",
  version: 1,
  generatedAt: new Date().toISOString(),
  packageVersion: packageJson.version,
  counts: {
    total: assets.length,
    scripts: assets.filter((a) => a.kind === "script").length,
    skills: assets.filter((a) => a.kind === "skill").length,
    workflows: assets.filter((a) => a.kind === "workflow").length,
    active: assets.filter((a) => a.active).length,
    releaseGated: assets.filter((a) => a.releaseGate).length,
    reviewRequired: assets.filter((a) => a.recommendation === "review_or_deprecate").length,
  },
  assets,
};
const output = resolve(root, process.argv[2] ?? "docs/canonical/evidence/v16/execution-registry.json");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(registry, null, 2)}\n`);
console.log(JSON.stringify({ output: relative(root, output), ...registry.counts }));
