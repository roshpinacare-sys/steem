import { readFileSync } from "node:fs";
import type { SovereigntyDependency } from "./types";

interface PackageLock {
  packages?: Record<string, { version?: string; license?: string; resolved?: string; hasInstallScript?: boolean }>;
}

export function dependencyLedgerFromPackageLock(lockPath: string): SovereigntyDependency[] {
  const lock = JSON.parse(readFileSync(lockPath, "utf8")) as PackageLock;
  return Object.entries(lock.packages ?? {})
    .filter(([path]) => path.startsWith("node_modules/"))
    .map(([path, value]) => {
      const name = path.slice("node_modules/".length);
      const native = /better-sqlite3|sharp|swc|oxide|esbuild|lightningcss|playwright/.test(name);
      const browser = /playwright/.test(name);
      return {
        id: `npm:${name}`,
        name,
        version: value.version,
        purpose: "JavaScript package dependency",
        license: value.license,
        phase: browser ? "build" : "both",
        locality: "local_authoritative",
        mandatory: !browser,
        networkRequired: false,
        authenticationRequired: false,
        dataSentExternally: [],
        updateSource: value.resolved,
        integrityMethod: "package-lock integrity and release SBOM",
        offlineReplacement: native ? "signed offline dependency bundle or built-in runtime capability" : "signed npm cache bundle",
        removalStrategy: native ? "prefer standards-based or built-in adapter where feasible" : "replace behind internal adapter",
        failureBehavior: browser ? "degrade" : "fail_closed",
        sovereigntyImpact: native
          ? "Native artifact provenance must be verified in an isolated build lane."
          : "Runtime remains local after installation; public registry is an update-time dependency only.",
        evidence: [value.hasInstallScript ? "package_has_install_script" : "lockfile_recorded"],
      } satisfies SovereigntyDependency;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function builtInSovereigntyDependencies(): SovereigntyDependency[] {
  return [
    {
      id: "runtime:node-sqlite",
      name: "Node.js built-in SQLite",
      purpose: "Authoritative local database fallback",
      phase: "runtime",
      locality: "local_authoritative",
      mandatory: true,
      networkRequired: false,
      authenticationRequired: false,
      dataSentExternally: [],
      integrityMethod: "Node runtime provenance and release hash",
      offlineReplacement: "better-sqlite3 adapter",
      removalStrategy: "database adapter boundary",
      failureBehavior: "fail_closed",
      sovereigntyImpact: "Removes mandatory external native binding for local persistence.",
      evidence: ["tests/sqlite-driver-fallback.test.ts", "tests/canonical-migrations.test.ts"],
    },
    {
      id: "provider:local-deterministic",
      name: "Deterministic local runtime",
      purpose: "Zero-key structured execution and sovereign test workflow",
      phase: "runtime",
      locality: "local_authoritative",
      mandatory: true,
      networkRequired: false,
      authenticationRequired: false,
      dataSentExternally: [],
      integrityMethod: "source-tree hash and unit tests",
      offlineReplacement: "local model runtime adapter",
      removalStrategy: "replace with verified local inference adapter",
      failureBehavior: "fail_closed",
      sovereigntyImpact: "Core workflow can start and complete without a commercial API key.",
      evidence: ["tests/sovereign-zero-key-workflow.test.ts"],
    },
    {
      id: "registry:npm-public",
      name: "Public npm registry",
      purpose: "Initial dependency acquisition and updates",
      phase: "build",
      locality: "remote_optional",
      mandatory: false,
      networkRequired: true,
      authenticationRequired: false,
      dataSentExternally: ["package names", "versions", "network metadata"],
      integrityMethod: "package-lock integrity",
      offlineReplacement: "signed dependency cache bundle",
      removalStrategy: "offline installation manifest and local cache",
      failureBehavior: "degrade",
      sovereigntyImpact: "Not required after dependencies are locally installed, but remains an update supply-chain dependency.",
      evidence: ["package-lock.json"],
    },
    {
      id: "provider:commercial-optional",
      name: "Commercial model providers",
      purpose: "Optional capability enhancement",
      phase: "runtime",
      locality: "remote_optional",
      mandatory: false,
      networkRequired: true,
      authenticationRequired: true,
      dataSentExternally: ["task prompts", "selected context", "tool schemas"],
      integrityMethod: "provider adapter configuration and audit",
      offlineReplacement: "local model runtime",
      removalStrategy: "disable provider profiles and use air-gap mode",
      failureBehavior: "degrade",
      sovereigntyImpact: "Optional only; restricted tasks must fail closed rather than silently route remotely.",
      evidence: ["src/lib/engine/providers", "src/lib/models/router.ts"],
    },
  ];
}
