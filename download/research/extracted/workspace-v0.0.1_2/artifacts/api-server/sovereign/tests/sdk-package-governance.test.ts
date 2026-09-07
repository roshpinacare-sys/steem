import "./_flush.mjs";
// tests/sdk-package-governance.test.ts
// בדיקת package governance ל-SDK packages — license, naming, exports, types, npm pack clean

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { test, eq, assert } from "./_harness.mjs";

const ROOT = join(import.meta.dirname, "..");

function pkgDir(name: string) {
  return join(ROOT, "sdk", name);
}

function readJson(name: string) {
  const path = join(pkgDir(name), "package.json");
  return JSON.parse(readFileSync(path, "utf8"));
}

function readLicense(name: string) {
  const path = join(pkgDir(name), "LICENSE");
  return readFileSync(path, "utf8");
}

function runNpmPackDryRun(name: string) {
  const cwd = pkgDir(name);
  const out = execSync("npm pack --dry-run", { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  return out;
}

function includes(arr: string[], item: string): boolean {
  return arr.includes(item);
}

// ─── passport-client ───────────────────────────────────────────────────────────
{
  const pkg = readJson("passport-client");

  test("passport-client license is MIT", () => {
    eq(pkg.license, "MIT");
  });

  test("passport-client name is @tfa/passport-client", () => {
    eq(pkg.name, "@tfa/passport-client");
  });

  test("passport-client engines.node is >=22", () => {
    eq(pkg.engines?.node, ">=22");
  });

  test("passport-client exports root has types and default", () => {
    eq(pkg.exports?.["."]?.types, "./index.d.ts");
    eq(pkg.exports?.["."]?.default, "./index.mjs");
  });

  test("passport-client exports /verify has types and default", () => {
    eq(pkg.exports?.["./verify"]?.types, "./index.d.ts");
    eq(pkg.exports?.["./verify"]?.default, "./verify-passport.mjs");
  });

  test("passport-client types field is index.d.ts", () => {
    eq(pkg.types, "index.d.ts");
  });

  test("passport-client files includes LICENSE and index.d.ts", () => {
    assert(includes(pkg.files, "LICENSE"), "files missing LICENSE");
    assert(includes(pkg.files, "index.d.ts"), "files missing index.d.ts");
  });

  test("passport-client LICENSE exists with MIT text", () => {
    const text = readLicense("passport-client");
    assert(text.includes("MIT License"), "missing MIT License header");
    assert(text.includes("Permission is hereby granted"), "missing permission text");
  });

  test("passport-client index.d.ts declares verifyPassport and canonicalStringify", () => {
    const dts = readFileSync(join(pkgDir("passport-client"), "index.d.ts"), "utf8");
    assert(dts.includes("export function verifyPassport"), "missing verifyPassport");
    assert(dts.includes("export function canonicalStringify"), "missing canonicalStringify");
  });

  test("passport-client npm pack --dry-run has no warnings", () => {
    const out = runNpmPackDryRun("passport-client").toLowerCase();
    assert(!out.includes("warn"), "npm pack emitted warning");
    assert(!out.includes("deprecated"), "npm pack emitted deprecated");
    assert(!out.includes("unlicensed"), "npm pack emitted unlicensed");
  });
}

// ─── escrow-client ─────────────────────────────────────────────────────────────
{
  const pkg = readJson("escrow-client");

  test("escrow-client license is MIT", () => {
    eq(pkg.license, "MIT");
  });

  test("escrow-client name is @tfa/escrow-client", () => {
    eq(pkg.name, "@tfa/escrow-client");
  });

  test("escrow-client engines.node is >=22", () => {
    eq(pkg.engines?.node, ">=22");
  });

  test("escrow-client exports includes types subpath", () => {
    eq(pkg.exports?.["."]?.types, "./index.d.ts");
    eq(pkg.exports?.["."]?.default, "./index.mjs");
  });

  test("escrow-client types field is index.d.ts", () => {
    eq(pkg.types, "index.d.ts");
  });

  test("escrow-client files includes verify-webhook.mjs", () => {
    assert(includes(pkg.files, "verify-webhook.mjs"), "files missing verify-webhook.mjs");
  });

  test("escrow-client files includes LICENSE", () => {
    assert(includes(pkg.files, "LICENSE"), "files missing LICENSE");
  });

  test("escrow-client LICENSE exists with MIT text", () => {
    const text = readLicense("escrow-client");
    assert(text.includes("MIT License"), "missing MIT License header");
    assert(text.includes("Permission is hereby granted"), "missing permission text");
  });

  test("escrow-client npm pack --dry-run has no warnings", () => {
    const out = runNpmPackDryRun("escrow-client").toLowerCase();
    assert(!out.includes("warn"), "npm pack emitted warning");
    assert(!out.includes("deprecated"), "npm pack emitted deprecated");
    assert(!out.includes("unlicensed"), "npm pack emitted unlicensed");
  });
}

// ─── cli (@tfa/cli) ─────────────────────────────────────────────────────────────
{
  const pkg = readJson("cli");

  test("cli license is MIT", () => {
    eq(pkg.license, "MIT");
  });

  test("cli name is @tfa/cli", () => {
    eq(pkg.name, "@tfa/cli");
  });

  test("cli engines.node is >=22", () => {
    eq(pkg.engines?.node, ">=22");
  });

  test("cli bin.tfa points at bin/tfa.mjs", () => {
    eq(pkg.bin?.tfa, "bin/tfa.mjs");
  });

  test("cli files includes LICENSE and bin/tfa.mjs", () => {
    assert(includes(pkg.files, "LICENSE"), "files missing LICENSE");
    assert(includes(pkg.files, "bin/tfa.mjs"), "files missing bin/tfa.mjs");
  });

  test("cli main field points to bin/tfa.mjs", () => {
    eq(pkg.main, "./bin/tfa.mjs");
  });

  test("cli exports root has default entry", () => {
    eq(pkg.exports?.["."]?.default, "./bin/tfa.mjs");
  });

  test("cli exports includes ./package.json subpath", () => {
    eq(pkg.exports?.["./package.json"], "./package.json");
  });

  test("cli LICENSE exists with MIT text", () => {
    const text = readLicense("cli");
    assert(text.includes("MIT License"), "missing MIT License header");
    assert(text.includes("Permission is hereby granted"), "missing permission text");
  });

  test("cli bin/tfa.mjs is executable (mode bit set)", () => {
    const path = join(pkgDir("cli"), "bin", "tfa.mjs");
    const mode = statSync(path).mode;
    assert((mode & 0o111) !== 0, "bin/tfa.mjs should have at least one executable bit set");
  });

  test("cli npm pack --dry-run has no warnings", () => {
    const out = runNpmPackDryRun("cli").toLowerCase();
    assert(!out.includes("warn"), "npm pack emitted warning");
    assert(!out.includes("deprecated"), "npm pack emitted deprecated");
    assert(!out.includes("unlicensed"), "npm pack emitted unlicensed");
  });
}
