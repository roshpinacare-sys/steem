import semver from "semver";
import type { GitHubClient } from "../services/github-client.js";

interface LockPackage {
  version?: string;
  dependencies?: Record<string, LockPackage>;
  packages?: Record<string, LockPackage>;
}

function extractVersions(lock: LockPackage): Map<string, string> {
  const out = new Map<string, string>();
  const pkgs = lock.packages || lock.dependencies || {};
  for (const [name, entry] of Object.entries(pkgs)) {
    if (entry?.version) {
      const clean = name.replace(/^node_modules\//, "");
      out.set(clean, entry.version);
    }
  }
  return out;
}

export async function lockfileGuardian(gh: GitHubClient, baseRef: string, headRef: string) {
  try {
    const [baseRaw, headRaw] = await Promise.all([
      gh.getFileAtRef("package-lock.json", baseRef),
      gh.getFileAtRef("package-lock.json", headRef),
    ]);

    if (!baseRaw || !headRaw) {
      return { allowed: false, error: "package-lock.json missing at base or head", majorBumps: [] };
    }

    const base = JSON.parse(baseRaw) as LockPackage;
    const head = JSON.parse(headRaw) as LockPackage;
    const baseVersions = extractVersions(base);
    const headVersions = extractVersions(head);

    const bumps: { pkg: string; from: string; to: string; kind: string }[] = [];
    for (const [pkg, to] of headVersions) {
      const from = baseVersions.get(pkg);
      if (!from) continue;
      if (!semver.valid(from) || !semver.valid(to)) continue;
      const kind = semver.diff(from, to) || "same";
      if (kind === "major") bumps.push({ pkg, from, to, kind });
    }

    return { allowed: bumps.length === 0, majorBumps: bumps };
  } catch (e: unknown) {
    return { allowed: false, error: e instanceof Error ? e.message : String(e), majorBumps: [] };
  }
}
