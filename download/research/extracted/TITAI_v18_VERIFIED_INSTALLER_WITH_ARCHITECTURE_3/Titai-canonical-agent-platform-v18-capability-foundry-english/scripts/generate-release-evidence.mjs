import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import process from "node:process";

const root = process.cwd();
const outDir = resolve(root, "docs/canonical/evidence/release");
const forbiddenAnywhere = new Set(["node_modules", ".next", ".git", "coverage", "test-results", "playwright-report"]);
const forbiddenAtRoot = new Set(["data", "dist", "backups"]);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const filePath = join(dir, entry.name);
    const rel = relative(root, filePath).replaceAll("\\", "/");
    if (forbiddenAnywhere.has(entry.name) || (forbiddenAtRoot.has(rel) && !rel.includes("/"))) continue;
    if (entry.isDirectory()) files.push(...(await walk(filePath)));
    else if (entry.isFile()) files.push(filePath);
  }
  return files;
}

function hashBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const lock = JSON.parse(await readFile(resolve(root, "package-lock.json"), "utf8"));
const components = [];
for (const [path, value] of Object.entries(lock.packages ?? {})) {
  if (!path || !path.includes("node_modules/")) continue;
  const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
  if (!value.version) continue;
  const licenses = value.license ? [{ license: { id: value.license } }] : undefined;
  components.push({
    type: "library",
    name,
    version: value.version,
    purl: `pkg:npm/${encodeURIComponent(name)}@${value.version}`,
    ...(licenses ? { licenses } : {}),
  });
}
components.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));

const files = (await walk(root)).sort();
const sourceEntries = [];
const sourceHasher = createHash("sha256");
for (const path of files) {
  const rel = relative(root, path).replaceAll("\\", "/");
  if (rel.startsWith("docs/canonical/evidence/release/") || rel === "docs/roast/RELEASE_MANIFEST.json") continue;
  const bytes = await readFile(path);
  const digest = hashBytes(bytes);
  sourceEntries.push({ path: rel, sha256: digest, bytes: bytes.length });
  sourceHasher.update(`${rel}\0${digest}\n`);
}
const sourceTreeSha256 = sourceHasher.digest("hex");
const generatedAt = new Date().toISOString();

const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  serialNumber: `urn:uuid:${randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: generatedAt,
    component: { type: "application", name: pkg.name, version: pkg.version },
    tools: { components: [{ type: "application", name: "titai-release-evidence", version: "1" }] },
  },
  components,
};

const licenseInventory = {
  format: "titai-license-inventory",
  version: 1,
  generatedAt,
  packages: components.map((component) => ({
    name: component.name,
    version: component.version,
    licenses: component.licenses?.map((entry) => entry.license.id) ?? ["UNKNOWN"],
  })),
};

let sovereignRegistry = null;
try { sovereignRegistry = JSON.parse(await readFile(resolve(root, "docs/canonical/evidence/v17/model/qualification.json"), "utf8")); } catch {}
const modelInventory = {
  format: "titai-model-inventory",
  version: 3,
  generatedAt,
  bundledModelWeights: [],
  supportedAdapters: ["anthropic", "openai", "google", "openrouter", "ollama", "loopback-openai-compatible", "llama-cpp-subprocess", "simulation", "deterministic-local-runtime", "no-model"],
  runtimeConfiguredModels: "Stored per user in provider_configs; secrets and runtime values are excluded from source releases.",
  sovereignRegistry,
  sovereigntyNote: "The runtime-neutral lifecycle, loopback adapter, subprocess integrity boundary and no-model failure path are implemented. No model weights are bundled. Physical model qualification remains blocked; the v18 capability subsystem does not depend on a real model for its bounded deterministic pilot.",
};

const provenance = {
  format: "titai-build-provenance",
  version: 1,
  generatedAt,
  project: { name: pkg.name, version: pkg.version },
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    ci: process.env.CI === "true",
  },
  sourceTreeSha256,
  sourceFileCount: sourceEntries.length,
  sourceFiles: sourceEntries,
  gitCommit: process.env.GITHUB_SHA ?? process.env.GIT_COMMIT ?? null,
  statement: "This record describes the source tree used to assemble the release evidence. It is not a remote transparency-log attestation.",
};

await mkdir(outDir, { recursive: true });
await Promise.all([
  writeFile(join(outDir, "SBOM.cyclonedx.json"), `${JSON.stringify(sbom, null, 2)}\n`),
  writeFile(join(outDir, "LICENSE_INVENTORY.json"), `${JSON.stringify(licenseInventory, null, 2)}\n`),
  writeFile(join(outDir, "MODEL_INVENTORY.json"), `${JSON.stringify(modelInventory, null, 2)}\n`),
  writeFile(join(outDir, "BUILD_PROVENANCE.json"), `${JSON.stringify(provenance, null, 2)}\n`),
]);
console.log(`Release evidence generated: ${components.length} package components, ${sourceEntries.length} source files.`);
