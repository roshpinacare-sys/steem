import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const output = resolve(root, process.env.TITAI_MODEL_EVIDENCE ?? "docs/canonical/evidence/v16/model/local-model-qualification.json");
const artifactPath = process.env.TITAI_LOCAL_MODEL_ARTIFACT;
const runtimeEndpoint = process.env.TITAI_LOCAL_MODEL_ENDPOINT;
const expectedHash = process.env.TITAI_LOCAL_MODEL_SHA256;
const modelId = process.env.TITAI_LOCAL_MODEL_ID ?? "qwen2.5-0.5b-instruct-q4_k_m";
const blockers = [];
function hashFile(path) { const hash = createHash("sha256"); hash.update(readFileSync(path)); return hash.digest("hex"); }
let artifact;
if (!artifactPath) blockers.push("model_artifact_path_missing");
else if (!existsSync(artifactPath)) blockers.push("model_artifact_missing");
else {
  const actualSha256 = hashFile(artifactPath);
  artifact = { path: artifactPath, actualSha256, expectedSha256: expectedHash ?? null, integrityVerified: Boolean(expectedHash && actualSha256 === expectedHash) };
  if (!expectedHash) blockers.push("model_artifact_expected_hash_missing");
  else if (actualSha256 !== expectedHash) blockers.push("model_artifact_hash_mismatch");
}
if (!runtimeEndpoint) blockers.push("local_runtime_endpoint_missing");
else {
  const parsed = new URL(runtimeEndpoint);
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname)) blockers.push("local_runtime_not_loopback");
}
const result = {
  format: "titai-v16-local-model-qualification",
  version: 1,
  generatedAt: new Date().toISOString(),
  candidate: { modelId, family: "Qwen2.5", format: "GGUF", quantization: "Q4_K_M", license: "Apache-2.0", runtimeContract: "OpenAI-compatible loopback or llama.cpp server", packagedWeights: false },
  artifact: artifact ?? null,
  runtimeEndpoint: runtimeEndpoint ?? null,
  status: blockers.length ? "blocked" : "ready_for_runtime_benchmark",
  blockers,
  benchmark: null,
  honestConclusion: blockers.length ? "A real local language model was not executed in this environment. Deterministic runtime evidence must not be treated as model-quality evidence." : "Artifact integrity and loopback runtime prerequisites are present; execute the benchmark lane before pilot classification.",
};
mkdirSync(resolve(output, ".."), { recursive: true });
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ output, status: result.status, blockers }));
process.exit(blockers.length ? 2 : 0);
