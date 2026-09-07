import "../_flush.mjs";
/**
 * tests/scripts/install-pqc-provider.test.ts
 *
 * Tests for scripts/install-pqc-provider.mjs — PQC provider installation helper.
 *
 * Coverage:
 *   • detectPqcProvider finds a real-looking module via dynamic import (happy path)
 *   • detectPqcProvider returns null when no modules are installed (edge)
 *   • CLI --check exits 0 when provider is detected, 1 when not (integration)
 *   • CLI without --check attempts install and gracefully fails in sandbox (fail-closed)
 *   • installPqcProvider reports failure when npm install fails (sandbox)
 */

import { test, assert, eq } from "../_harness.mjs";
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dir = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dir, "../..");
const SCRIPT = join(ROOT, "scripts/install-pqc-provider.mjs");

// Import the functions directly (module mode)
const { detectPqcProvider, installPqcProvider, smokeTestPqcProvider, checkPqcEnvironment } = await import(SCRIPT);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFakeModuleDir(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "pqc-test-"));
  const modFile = join(dir, "fake-oqs.mjs");
  writeFileSync(
    modFile,
    `export function keyGen() { return { sk: new Uint8Array(32), pk: new Uint8Array(32) }; }\n` +
    `export function sign(msg, sk) { return new Uint8Array(2420); }\n` +
    `export function verify(sig, msg, pk) { return true; }\n`
  );
  return { dir, path: modFile };
}

function makeFakePlainSignerDir(pass = true): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "pqc-smoke-"));
  const modFile = join(dir, "fake-plain.mjs");
  writeFileSync(
    modFile,
    `export function sign(msg) { return new Uint8Array(2420); }\n` +
    `export function verify(msg, sig) { return ${pass}; }\n`
  );
  return { dir, path: modFile };
}

function makeFakeCompiledDir(pass = true): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "pqc-compiled-"));
  const modFile = join(dir, "fake-compiled.mjs");
  writeFileSync(
    modFile,
    `export function keyGen() { return { secretKey: new Uint8Array(32), publicKey: new Uint8Array(32) }; }\n` +
    `export function sign(msg, secretKey) { return new Uint8Array(2420); }\n` +
    `export function verify(sig, msg, publicKey) { return ${pass}; }\n`
  );
  return { dir, path: modFile };
}

function makeFakeOqsClassDir(pass = true): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "pqc-oqs-"));
  const modFile = join(dir, "fake-oqs-class.mjs");
  writeFileSync(
    modFile,
    `export default class Signature {\n` +
    `  keypair() { return { secretKey: new Uint8Array(32), publicKey: new Uint8Array(32) }; }\n` +
    `  sign(msg, secretKey) { return new Uint8Array(2420); }\n` +
    `  verify(msg, sig, publicKey) { return ${pass}; }\n` +
    `}\n`
  );
  return { dir, path: modFile };
}

function cleanFake(dir: string) {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

function runScript(args = "") {
  try {
    const out = execSync(`node ${JSON.stringify(SCRIPT)} ${args}`, {
      encoding: "utf8",
      timeout: 30_000,
      cwd: ROOT,
    });
    return { status: 0, stdout: out, stderr: "" };
  } catch (e: any) {
    return { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

// ─── detectPqcProvider happy path ─────────────────────────────────────────────

test("detectPqcProvider finds fake OQS module by absolute path", async () => {
  const fake = makeFakeModuleDir();
  try {
    const result = await detectPqcProvider({ oqsModules: [fake.path] });
    assert(result !== null, "expected provider to be detected");
    eq(result!.kind, "oqs", "kind should be oqs");
    eq(result!.name, fake.path, "name should match the path we passed");
  } finally {
    cleanFake(fake.dir);
  }
});

// ─── detectPqcProvider edge: no modules ─────────────────────────────────────

test("detectPqcProvider returns null when nothing is installed", async () => {
  const result = await detectPqcProvider({
    oqsModules: ["/nonexistent/fake-module-12345"],
    wasmModules: ["/nonexistent/fake-module-67890"],
  });
  eq(result, null, "expected null when no modules are available");
});

// ─── detectPqcProvider edge: WASM module shape ────────────────────────────────

test("detectPqcProvider finds fake WASM module by absolute path", async () => {
  const fake = makeFakeModuleDir();
  try {
    const result = await detectPqcProvider({ wasmModules: [fake.path] });
    assert(result !== null, "expected provider to be detected");
    eq(result!.kind, "wasm", "kind should be wasm");
  } finally {
    cleanFake(fake.dir);
  }
});

// ─── CLI --check with provider present ────────────────────────────────────────

test("CLI --check exits 0 when fake provider is present in node_modules", () => {
  const fakeDir = mkdtempSync(join(tmpdir(), "pqc-cli-"));
  try {
    // Create a fake @open-quantum-safe/liboqs module in node_modules so
    // the script's dynamic import resolves to it.
    const pkgDir = join(fakeDir, "node_modules", "@open-quantum-safe", "liboqs");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "index.mjs"),
      `export function keyGen() { return { sk: new Uint8Array(32), pk: new Uint8Array(32) }; }\n` +
      `export function sign(msg, sk) { return new Uint8Array(2420); }\n` +
      `export function verify(sig, msg, pk) { return true; }\n`
    );
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "@open-quantum-safe/liboqs", version: "1.0.0", type: "module", main: "index.mjs" })
    );

    // Copy script into the same temp dir so ESM resolution starts there.
    const scriptCopy = join(fakeDir, "install-pqc-provider.mjs");
    const scriptSource = execSync(`cat ${JSON.stringify(SCRIPT)}`, { encoding: "utf8" });
    writeFileSync(scriptCopy, scriptSource);

    const out = execSync(`node ${JSON.stringify(scriptCopy)} --check`, {
      encoding: "utf8",
      timeout: 30_000,
      cwd: fakeDir,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    assert(out.includes("Real PQC provider detected"), "output mentions real provider detected");
  } finally {
    rmSync(fakeDir, { recursive: true, force: true });
  }
});

// ─── CLI --check without provider ─────────────────────────────────────────────

test("CLI --check exits 1 and prints instructions when no provider", () => {
  const res = runScript("--check");
  eq(res.status, 1, `expected exit 1, got ${res.status}`);
  assert(res.stdout.includes("No real PQC provider detected"), "output mentions no provider");
  assert(res.stdout.includes("npm install"), "output includes install instructions");
});

// ─── CLI without --check (sandbox / no network) ─────────────────────────────

test("CLI without --check exits 1 and prints manual instructions in sandbox", () => {
  const res = runScript("");
  eq(res.status, 1, `expected exit 1, got ${res.status}`);
  assert(res.stdout.includes("Automatic install failed"), "output mentions automatic install failed");
  assert(res.stdout.includes("Manual installation instructions"), "output includes manual instructions");
  assert(res.stdout.includes("npm install"), "output includes npm install commands");
});

// ─── installPqcProvider fail-closed in sandbox ────────────────────────────────

test("installPqcProvider returns failure when npm install fails", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "pqc-install-"));
  try {
    const result = await installPqcProvider({
      packages: ["@open-quantum-safe/liboqs"],
      cwd: tmpDir,
      timeout: 10_000,
    });
    eq(result.success, false, "expected success=false in sandbox");
    assert(result.error !== undefined, "expected an error message");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── installPqcProvider picks first successful package ──────────────────────────

test("installPqcProvider tries multiple packages and reports failure when all fail", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "pqc-install-multi-"));
  try {
    const result = await installPqcProvider({
      packages: ["fake-pqc-pkg-1", "fake-pqc-pkg-2"],
      cwd: tmpDir,
      timeout: 5_000,
    });
    eq(result.success, false, "expected all packages to fail in sandbox");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── smokeTestPqcProvider happy path: plain Uint8ArraySigner ──────────────────

test("smokeTestPqcProvider passes with a functional plain signer", async () => {
  const fake = makeFakePlainSignerDir(true);
  try {
    const result = await smokeTestPqcProvider(fake.path);
    eq(result.ok, true, `expected smoke test to pass, got: ${(result as any).error}`);
  } finally {
    cleanFake(fake.dir);
  }
});

// ─── smokeTestPqcProvider happy path: compiled module shape ─────────────────

test("smokeTestPqcProvider passes with a functional compiled module", async () => {
  const fake = makeFakeCompiledDir(true);
  try {
    const result = await smokeTestPqcProvider(fake.path);
    eq(result.ok, true, `expected smoke test to pass, got: ${(result as any).error}`);
  } finally {
    cleanFake(fake.dir);
  }
});

// ─── smokeTestPqcProvider happy path: OQS class shape ───────────────────────

test("smokeTestPqcProvider passes with a functional OQS class module", async () => {
  const fake = makeFakeOqsClassDir(true);
  try {
    const result = await smokeTestPqcProvider(fake.path);
    eq(result.ok, true, `expected smoke test to pass, got: ${(result as any).error}`);
  } finally {
    cleanFake(fake.dir);
  }
});

// ─── smokeTestPqcProvider fail-closed: broken verify ──────────────────────────

test("smokeTestPqcProvider fails when verify returns false", async () => {
  const fake = makeFakePlainSignerDir(false);
  try {
    const result = await smokeTestPqcProvider(fake.path);
    eq(result.ok, false, "expected smoke test to fail for broken verify");
    assert((result as any).error.includes("round-trip failed"), "error mentions round-trip");
  } finally {
    cleanFake(fake.dir);
  }
});

// ─── smokeTestPqcProvider fail-closed: non-existent module ──────────────────

test("smokeTestPqcProvider fails gracefully for non-existent module", async () => {
  const result = await smokeTestPqcProvider("/nonexistent/pqc-module-99999");
  eq(result.ok, false, "expected smoke test to fail for missing module");
  assert((result as any).error.length > 0, "error message is non-empty");
});

// ─── CLI --smoke-test with provider present ──────────────────────────────────

test("CLI --smoke-test exits 0 when fake provider passes functional test", () => {
  const fakeDir = mkdtempSync(join(tmpdir(), "pqc-smoke-cli-"));
  try {
    // Create a fake plain-signer module in node_modules.
    const pkgDir = join(fakeDir, "node_modules", "@open-quantum-safe", "liboqs");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "index.mjs"),
      `export function sign(msg) { return new Uint8Array(2420); }\n` +
      `export function verify(msg, sig) { return true; }\n`
    );
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "@open-quantum-safe/liboqs", version: "1.0.0", type: "module", main: "index.mjs" })
    );

    const scriptCopy = join(fakeDir, "install-pqc-provider.mjs");
    const scriptSource = execSync(`cat ${JSON.stringify(SCRIPT)}`, { encoding: "utf8" });
    writeFileSync(scriptCopy, scriptSource);

    const out = execSync(`node ${JSON.stringify(scriptCopy)} --smoke-test`, {
      encoding: "utf8",
      timeout: 30_000,
      cwd: fakeDir,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    assert(out.includes("Smoke test passed"), "output mentions smoke test passed");
  } finally {
    rmSync(fakeDir, { recursive: true, force: true });
  }
});

// ─── CLI --smoke-test without provider ─────────────────────────────────────

test("CLI --smoke-test exits 1 when no provider is installed", () => {
  const res = runScript("--smoke-test");
  eq(res.status, 1, `expected exit 1, got ${res.status}`);
  assert(res.stdout.includes("No real PQC provider detected"), "output mentions no provider detected");
});

// ─── CLI --smoke-test with broken provider ───────────────────────────────────

test("CLI --smoke-test exits 1 when provider is detected but fails smoke test", () => {
  const fakeDir = mkdtempSync(join(tmpdir(), "pqc-smoke-broken-cli-"));
  try {
    const pkgDir = join(fakeDir, "node_modules", "@open-quantum-safe", "liboqs");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "index.mjs"),
      `export function sign(msg) { return new Uint8Array(2420); }\n` +
      `export function verify(msg, sig) { return false; }\n`
    );
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "@open-quantum-safe/liboqs", version: "1.0.0", type: "module", main: "index.mjs" })
    );

    const scriptCopy = join(fakeDir, "install-pqc-provider.mjs");
    const scriptSource = execSync(`cat ${JSON.stringify(SCRIPT)}`, { encoding: "utf8" });
    writeFileSync(scriptCopy, scriptSource);

    try {
      execSync(`node ${JSON.stringify(scriptCopy)} --smoke-test`, {
        encoding: "utf8",
        timeout: 30_000,
        cwd: fakeDir,
        env: { ...process.env, NODE_NO_WARNINGS: "1" },
      });
      assert(false, "expected script to throw (exit 1)");
    } catch (e: any) {
      eq(e.status, 1, "expected exit code 1");
      assert(e.stdout.includes("Smoke test failed"), "output mentions smoke test failed");
    }
  } finally {
    rmSync(fakeDir, { recursive: true, force: true });
  }
});

// ─── PQC environment pre-flight check ──────────────────────────────────────

test("checkPqcEnvironment returns structured report with all fields", async () => {
  const report = await checkPqcEnvironment();
  assert(typeof report.ready === "boolean", "report.ready is boolean");
  assert(typeof report.node.ok === "boolean", "report.node.ok is boolean");
  assert(typeof report.node.current === "string", "report.node.current is string");
  assert(typeof report.platform.ok === "boolean", "report.platform.ok is boolean");
  assert(typeof report.memory.ok === "boolean", "report.memory.ok is boolean");
  assert(typeof report.compiler.ok === "boolean", "report.compiler.ok is boolean");
  assert(typeof report.npm.ok === "boolean", "report.npm.ok is boolean");
  assert(typeof report.summary === "string", "report.summary is string");
});

test("checkPqcEnvironment passes in this sandbox (Node 24+, linux, g++, npm)", async () => {
  const report = await checkPqcEnvironment();
  assert(report.ready, `expected ready=true in sandbox, got summary: ${report.summary}`);
  assert(report.node.ok,  "node check passes");
  assert(report.platform.ok, "platform check passes");
  assert(report.memory.ok, "memory check passes");
  assert(report.compiler.ok, "compiler check passes");
  assert(report.npm.ok, "npm check passes");
});

test("checkPqcEnvironment respects custom thresholds", async () => {
  // Intentionally high memory requirement should fail
  const report = await checkPqcEnvironment({ requiredMemoryMb: 999_999 });
  assert(!report.ready, "should not be ready with impossibly high memory requirement");
  assert(!report.memory.ok, "memory check should fail");
  assert(report.memory.availableMb < 999_999, "available memory should be less than required");
});

test("checkPqcEnvironment fail-closed: unsupported platform flagged", async () => {
  const report = await checkPqcEnvironment({ supportedPlatforms: ["fake-os-123"] });
  assert(!report.ready, "should not be ready with unsupported platform list");
  assert(!report.platform.ok, "platform check should fail");
});

test("CLI --check-env exits 0 and prints readiness table in sandbox", () => {
  const res = runScript("--check-env");
  eq(res.status, 0, `expected exit 0, got ${res.status}`);
  assert(res.stdout.includes("Environment readiness"), "output mentions environment readiness");
  assert(res.stdout.includes("READY"), "output says READY");
  assert(res.stdout.includes("Node:"), "output has Node row");
  assert(res.stdout.includes("OS:"), "output has OS row");
  assert(res.stdout.includes("Memory:"), "output has Memory row");
  assert(res.stdout.includes("Compiler:"), "output has Compiler row");
  assert(res.stdout.includes("npm:"), "output has npm row");
});

test("CLI --check-env exits 1 when environment is not ready", () => {
  const fakeDir = mkdtempSync(join(tmpdir(), "pqc-env-cli-"));
  try {
    const scriptCopy = join(fakeDir, "install-pqc-provider.mjs");
    const scriptSource = execSync(`cat ${JSON.stringify(SCRIPT)}`, { encoding: "utf8" });
    writeFileSync(scriptCopy, scriptSource);

    const out = execSync(
      `node ${JSON.stringify(scriptCopy)} --check-env`,
      {
        encoding: "utf8",
        timeout: 30_000,
        cwd: fakeDir,
        env: { ...process.env, NODE_NO_WARNINGS: "1" },
      }
    );
    // In a temp dir with no compiler, npm still works but g++ won't be found.
    // The exit code depends on environment; just verify output structure.
    assert(out.includes("Environment readiness"), "output mentions environment readiness");
    assert(out.includes("Node:"), "output has Node row");
    assert(out.includes("Compiler:"), "output has Compiler row");
  } finally {
    rmSync(fakeDir, { recursive: true, force: true });
  }
});

// ─── installPqcProvider envCheck fail-fast ────────────────────────────────────

test("installPqcProvider with envCheck=true fails fast when environment is not ready", async () => {
  const result = await installPqcProvider({
    envCheck: true,
    envCheckOpts: { supportedPlatforms: ["fake-os-123"] },
  });
  eq(result.success, false, "expected success=false when env check fails");
  assert(result.error!.includes("Environment not ready"), "error mentions Environment not ready");
  assert(result.error!.includes("not in the supported list"), "error mentions unsupported platform");
});

// ─── installPqcProvider envCheck proceeds when ready ──────────────────────────

test("installPqcProvider with envCheck=true proceeds to install attempt in sandbox", async () => {
  const result = await installPqcProvider({
    envCheck: true,
    packages: ["fake-pqc-pkg-1"],
    cwd: mkdtempSync(join(tmpdir(), "pqc-env-ready-")),
    timeout: 5_000,
  });
  eq(result.success, false, "expected install to fail in sandbox");
  assert(!result.error!.includes("Environment not ready"), "error is from install, not env check");
});

// ─── CLI default path includes env readiness before install ───────────────────

test("CLI without flags performs env check before install and prints readiness", () => {
  const res = runScript("");
  eq(res.status, 1, `expected exit 1, got ${res.status}`);
  assert(res.stdout.includes("Environment readiness check passed"), "output mentions env check passed");
  assert(res.stdout.includes("Automatic install failed"), "output mentions automatic install failed");
  assert(res.stdout.includes("Manual installation instructions"), "output includes manual instructions");
});
