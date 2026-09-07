#!/usr/bin/env node
/**
 * scripts/install-pqc-provider.mjs — PQC Provider Installation Helper
 *
 * Detects whether a real post-quantum crypto (ML-DSA-44) provider is installed.
 * If none is found, attempts to install one. In sandbox / no-network environments,
 * prints manual-install instructions instead of failing silently.
 *
 * Usage:
 *   node scripts/install-pqc-provider.mjs [--check]
 *
 * --check    Only verify detection; do not attempt installation.
 *
 * Exit codes:
 *   0 — real provider detected (or --check produced clear status output)
 *   1 — no real provider and install failed / not attempted
 *
 * Design: zero external dependencies, fully standalone (no lib/ imports).
 */

/**
 * @typedef {Object} DetectResult
 * @property {"oqs" | "wasm"} kind
 * @property {string} name
 */

/** Default OQS-style module names to probe (priority order). */
const DEFAULT_OQS_MODULES = [
  "@open-quantum-safe/liboqs",
  "liboqs-js",
];

/** Default WASM / pure-JS module names to probe (priority order). */
const DEFAULT_WASM_MODULES = [
  "ml-dsa",
  "@noble/post-quantum",
  "pqcrypto",
];

/**
 * Detect an installed real PQC provider by trying dynamic imports.
 *
 * @param {Object} [opts]
 * @param {string[]} [opts.oqsModules] — override default OQS module names
 * @param {string[]} [opts.wasmModules] — override default WASM module names
 * @returns {Promise<{kind: "oqs" | "wasm", name: string} | null>}
 */
export async function detectPqcProvider(opts = {}) {
  const oqsModules = opts.oqsModules ?? DEFAULT_OQS_MODULES;
  const wasmModules = opts.wasmModules ?? DEFAULT_WASM_MODULES;

  for (const name of oqsModules) {
    try {
      const mod = await import(name);
      const target = mod.default ?? mod;
      // OQS-style class or plain object with sign/verify
      if (
        typeof target === "function" ||
        (typeof target === "object" && target !== null &&
         (typeof target.sign === "function" || typeof target.keyGen === "function" || typeof target.keygen === "function"))
      ) {
        return { kind: "oqs", name };
      }
    } catch {
      // Module not installed — expected, not an error.
    }
  }

  for (const name of wasmModules) {
    try {
      const mod = await import(name);
      const target = mod.default ?? mod;
      if (
        typeof target === "object" && target !== null &&
        (typeof target.sign === "function" || typeof target.keyGen === "function" || typeof target.keygen === "function")
      ) {
        return { kind: "wasm", name };
      }
    } catch {
      // Module not installed — expected, not an error.
    }
  }

  return null;
}

/**
 * Attempt to install a real PQC provider via npm.
 *
 * @param {Object} [opts]
 * @param {string[]} [opts.packages] — npm package names to try (in order)
 * @param {string} [opts.cwd] — working directory for npm install
 * @param {number} [opts.timeout] — spawn timeout in ms
 * @param {boolean} [opts.envCheck] — if true, run checkPqcEnvironment first and fail fast if not ready
 * @param {Object} [opts.envCheckOpts] — options forwarded to checkPqcEnvironment when envCheck is true
 * @returns {Promise<{success: boolean, package?: string, error?: string}>}
 */
export async function installPqcProvider(opts = {}) {
  // Efficiency: fail fast before expensive npm install when environment is known to be unsuitable.
  if (opts.envCheck) {
    const envReport = await checkPqcEnvironment(opts.envCheckOpts);
    if (!envReport.ready) {
      return {
        success: false,
        error: `Environment not ready: ${envReport.summary}`,
      };
    }
  }

  const packages = opts.packages ?? ["@open-quantum-safe/liboqs"];
  const cwd = opts.cwd ?? process.cwd();
  const timeout = opts.timeout ?? 120_000;

  const { execSync } = await import("node:child_process");

  for (const pkg of packages) {
    try {
      execSync(`npm install ${pkg}`, {
        cwd,
        stdio: "pipe",
        timeout,
        encoding: "utf8",
      });
      // Verify the install actually made the module importable
      const after = await detectPqcProvider();
      if (after) {
        return { success: true, package: pkg };
      }
      // npm succeeded but module still not detectable — keep trying next
    } catch (e) {
      // Install failed — try next package or fall through to failure
    }
  }

  return { success: false, error: "All installation attempts failed" };
}

// ─── Environment pre-flight check ───────────────────────────────────────────

/**
 * Check whether the current environment is ready for a real PQC provider install.
 *
 * Validates Node version, platform, available memory, C++ compiler, and npm
 * without attempting an actual install. Returns a detailed diagnostics object
 * that ops can use to fix gaps before running `npm install`.
 *
 * @param {Object} [opts]
 * @param {string} [opts.requiredNode] — minimum Node version (default "22.0.0")
 * @param {number} [opts.requiredMemoryMb] — minimum free memory in MB (default 512)
 * @param {string[]} [opts.supportedPlatforms] — platforms known to work with OQS/WASM (default common set)
 * @returns {Promise<PqcEnvReport>}
 */
export async function checkPqcEnvironment(opts = {}) {
  const requiredNode = opts.requiredNode ?? "22.0.0";
  const requiredMemoryMb = opts.requiredMemoryMb ?? 512;
  const supportedPlatforms = opts.supportedPlatforms ?? [
    "linux",
    "darwin",
    "win32",
    "freebsd",
    "openbsd",
  ];

  const { execSync } = await import("node:child_process");
  const os = await import("node:os");

  // 1. Node version
  const nodeVersion = process.versions.node;
  const nodeOk = versionGte(nodeVersion, requiredNode);

  // 2. Platform
  const platform = os.platform();
  const platformOk = supportedPlatforms.includes(platform);

  // 3. Memory
  const freeMemMb = Math.floor(os.freemem() / (1024 * 1024));
  const memoryOk = freeMemMb >= requiredMemoryMb;

  // 4. Compiler (zero-dep probe via child_process)
  let compiler = null;
  let compilerOk = false;
  const compilerCommands = platform === "win32"
    ? [{ cmd: "cl", args: ["/?"] }]
    : [
        { cmd: "g++", args: ["--version"] },
        { cmd: "clang++", args: ["--version"] },
        { cmd: "c++", args: ["--version"] },
      ];
  for (const { cmd, args } of compilerCommands) {
    try {
      execSync(`${cmd} ${args.join(" ")}`, { stdio: "pipe", timeout: 5_000 });
      compiler = cmd;
      compilerOk = true;
      break;
    } catch {
      // try next compiler
    }
  }

  // 5. npm
  let npmVersion = null;
  let npmOk = false;
  try {
    const out = execSync("npm --version", { encoding: "utf8", stdio: "pipe", timeout: 5_000 }).trim();
    npmVersion = out;
    npmOk = true;
  } catch {
    // npm not available
  }

  const ready = nodeOk && platformOk && memoryOk && compilerOk && npmOk;

  return {
    ready,
    node: { ok: nodeOk, current: nodeVersion, required: requiredNode },
    platform: { ok: platformOk, current: platform, supported: supportedPlatforms },
    memory: { ok: memoryOk, availableMb: freeMemMb, requiredMb: requiredMemoryMb },
    compiler: { ok: compilerOk, found: compiler },
    npm: { ok: npmOk, version: npmVersion },
    summary: ready
      ? "Environment is ready for PQC provider installation."
      : [
          !nodeOk && `Node ${nodeVersion} < required ${requiredNode}`,
          !platformOk && `Platform "${platform}" is not in the supported list`,
          !memoryOk && `Free memory ${freeMemMb}MB < required ${requiredMemoryMb}MB`,
          !compilerOk && "No C++ compiler found (install g++, clang++, or MSVC build tools)",
          !npmOk && "npm is not available in PATH",
        ].filter(Boolean).join("; "),
  };
}

/** Simple semver comparison: a >= b */
function versionGte(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const av = pa[i] || 0;
    const bv = pb[i] || 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return true;
}

// ─── Smoke test ─────────────────────────────────────────────────────────────

// Module-level TextEncoder — stateless, safe to reuse, eliminates per-call allocation.
const TEXT_ENCODER = new TextEncoder();

/**
 * Run a functional smoke test on a detected PQC provider module.
 *
 * Dynamically imports the module, wraps it into a testable signer (handling
 * OQS class, compiled keyGen/keygen, and plain Uint8ArraySigner shapes),
 * signs a test message, and verifies the signature.
 *
 * @param {string} moduleName — npm module name or absolute path
 * @returns {Promise<{ok: true} | {ok: false, error: string}>}
 */
export async function smokeTestPqcProvider(moduleName) {
  try {
    const mod = await import(moduleName);
    const target = mod.default ?? mod;

    let signFn;
    let verifyFn;

    // 1. OQS class style: new Signature(alg) → instance.keypair() / sign() / verify()
    if (
      typeof target === "function" &&
      target.prototype &&
      typeof target.prototype.keypair === "function"
    ) {
      let instance;
      try {
        instance = new target("ML-DSA-44");
      } catch {
        instance = new target("Dilithium2");
      }
      const keys = instance.keypair();
      if (
        !keys ||
        !(keys.secretKey instanceof Uint8Array) ||
        !(keys.publicKey instanceof Uint8Array)
      ) {
        return { ok: false, error: "OQS keypair() returned invalid keys" };
      }
      signFn = (msg) => instance.sign(msg, keys.secretKey);
      verifyFn = (msg, sig) => instance.verify(msg, sig, keys.publicKey);
    }
    // 2. Compiled module style: keyGen/keygen + sign(msg, sk) + verify(sig, msg, pk)
    else if (
      typeof target === "object" && target !== null &&
      (typeof target.keyGen === "function" || typeof target.keygen === "function") &&
      typeof target.sign === "function"
    ) {
      const keys = (target.keyGen ?? target.keygen)();
      if (
        !keys ||
        !(keys.secretKey instanceof Uint8Array) ||
        !(keys.publicKey instanceof Uint8Array)
      ) {
        return { ok: false, error: "Compiled module key generation returned invalid keys" };
      }
      signFn = (msg) => target.sign(msg, keys.secretKey);
      verifyFn = (msg, sig) => target.verify(sig, msg, keys.publicKey);
    }
    // 3. Plain Uint8ArraySigner pass-through
    else if (
      typeof target === "object" && target !== null &&
      typeof target.sign === "function" &&
      typeof target.verify === "function"
    ) {
      signFn = target.sign.bind(target);
      verifyFn = target.verify.bind(target);
    } else {
      return { ok: false, error: "Module does not expose a recognizable sign/verify interface" };
    }

    const testMsg = TEXT_ENCODER.encode("TFA PQC smoke test");
    const sig = signFn(testMsg);
    if (!(sig instanceof Uint8Array) || sig.length === 0) {
      return {
        ok: false,
        error: `sign() returned invalid signature (type=${typeof sig}, length=${sig?.length})`,
      };
    }
    const valid = verifyFn(testMsg, sig);
    if (!valid) {
      return {
        ok: false,
        error: "Sign/verify round-trip failed: signature does not verify against the message it was generated from",
      };
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: `Smoke test threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

async function main(args) {
  const checkOnly = args.includes("--check");
  const smokeTest = args.includes("--smoke-test");
  const checkEnvFlag = args.includes("--check-env");

  if (checkEnvFlag) {
    const report = await checkPqcEnvironment();
    process.stdout.write(
      `[install-pqc] Environment readiness: ${report.ready ? "READY" : "NOT READY"}\n` +
      `  Node:    ${report.node.ok ? "✅" : "❌"} ${report.node.current} (required ${report.node.required})\n` +
      `  OS:      ${report.platform.ok ? "✅" : "❌"} ${report.platform.current}\n` +
      `  Memory:  ${report.memory.ok ? "✅" : "❌"} ${report.memory.availableMb}MB free (required ${report.memory.requiredMb}MB)\n` +
      `  Compiler:${report.compiler.ok ? "✅" : "❌"} ${report.compiler.found ?? "not found"}\n` +
      `  npm:     ${report.npm.ok ? "✅" : "❌"} ${report.npm.version ?? "not found"}\n` +
      `\n${report.summary}\n`
    );
    process.exit(report.ready ? 0 : 1);
  }

  const provider = await detectPqcProvider();

  if (provider) {
    if (smokeTest) {
      process.stdout.write(
        `[install-pqc] 🔍  Provider detected: ${provider.name} (${provider.kind}). Running smoke test …\n`
      );
      const smoke = await smokeTestPqcProvider(provider.name);
      if (smoke.ok) {
        process.stdout.write(
          `[install-pqc] ✅  Smoke test passed: ${provider.name} is functional.\n`
        );
        process.exit(0);
      } else {
        process.stdout.write(
          `[install-pqc] ❌  Smoke test failed: ${smoke.error}\n`
        );
        process.exit(1);
      }
    }

    process.stdout.write(
      `[install-pqc] ✅  Real PQC provider detected: ${provider.name} (${provider.kind})\n`
    );
    process.exit(0);
  }

  process.stdout.write(
    `[install-pqc] ⚠️  No real PQC provider detected.\n`
  );

  if (checkOnly) {
    process.stdout.write(
      `\nTo install a real provider, run one of:\n` +
      `  npm install @open-quantum-safe/liboqs\n` +
      `  npm install ml-dsa\n` +
      `  npm install @noble/post-quantum\n` +
      `\nThen set TFA_SIGNER_KIND=hybrid-ed25519-mldsa and restart the server.\n`
    );
    process.exit(1);
  }

  // Pre-flight environment check before attempting expensive npm install.
  const envReport = await checkPqcEnvironment();
  if (!envReport.ready) {
    process.stdout.write(
      `[install-pqc] ❌  Environment is not ready for PQC provider installation.\n` +
      `  Node:    ${envReport.node.ok ? "✅" : "❌"} ${envReport.node.current} (required ${envReport.node.required})\n` +
      `  OS:      ${envReport.platform.ok ? "✅" : "❌"} ${envReport.platform.current}\n` +
      `  Memory:  ${envReport.memory.ok ? "✅" : "❌"} ${envReport.memory.availableMb}MB free (required ${envReport.memory.requiredMb}MB)\n` +
      `  Compiler:${envReport.compiler.ok ? "✅" : "❌"} ${envReport.compiler.found ?? "not found"}\n` +
      `  npm:     ${envReport.npm.ok ? "✅" : "❌"} ${envReport.npm.version ?? "not found"}\n` +
      `\n${envReport.summary}\n`
    );
    process.exit(1);
  }

  process.stdout.write(
    `[install-pqc] ✅  Environment readiness check passed.\n`
  );

  if (smokeTest) {
    process.stdout.write(
      `[install-pqc] → Provider not detected; attempting automatic install before smoke test …\n`
    );
  } else {
    process.stdout.write(
      `[install-pqc] → Attempting automatic install of @open-quantum-safe/liboqs …\n`
    );
  }

  const result = await installPqcProvider();
  if (result.success) {
    if (smokeTest) {
      const smoke = await smokeTestPqcProvider(result.package);
      if (smoke.ok) {
        process.stdout.write(
          `[install-pqc] ✅  Installation and smoke test passed: ${result.package}\n` +
          `Set TFA_SIGNER_KIND=hybrid-ed25519-mldsa and restart the server.\n`
        );
      } else {
        process.stdout.write(
          `[install-pqc] ❌  Installed ${result.package} but smoke test failed: ${smoke.error}\n`
        );
        process.exit(1);
      }
    } else {
      process.stdout.write(
        `[install-pqc] ✅  Installation successful: ${result.package}\n` +
        `Set TFA_SIGNER_KIND=hybrid-ed25519-mldsa and restart the server.\n`
      );
    }
    process.exit(0);
  }

  process.stdout.write(
    `[install-pqc] ❌  Automatic install failed (expected in sandbox / no-network environments).\n` +
    `\nManual installation instructions:\n` +
    `  1. Ensure you have network access and a C++ compiler.\n` +
    `  2. Run: npm install @open-quantum-safe/liboqs\n` +
    `  3. Set TFA_SIGNER_KIND=hybrid-ed25519-mldsa\n` +
    `  4. Restart the server.\n` +
    `\nAlternative WASM providers (no compiler needed):\n` +
    `  npm install ml-dsa\n` +
    `  npm install @noble/post-quantum\n`
  );
  process.exit(1);
}

// Run main only when executed as a script, not when imported as a module.
const isMain =
  typeof import.meta !== "undefined" &&
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("install-pqc-provider.mjs") ||
   process.argv[1].endsWith("install-pqc-provider.ts"));

if (isMain) {
  main(process.argv.slice(2));
}
