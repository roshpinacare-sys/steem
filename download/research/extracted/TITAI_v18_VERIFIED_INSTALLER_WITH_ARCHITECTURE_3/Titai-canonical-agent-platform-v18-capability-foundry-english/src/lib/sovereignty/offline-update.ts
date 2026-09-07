import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { sha256 } from "@/lib/durable/canonical-json";
import {
  signCanonicalPayload,
  verifyCanonicalPayload,
  type SignedCanonicalPayload,
  type SovereignSigningIdentity,
} from "./key-hierarchy";

export interface OfflineUpdateFile {
  path: string;
  bytesBase64: string;
  sha256: string;
  mode: number;
}

export interface OfflineUpdatePayload {
  format: "titai-offline-update";
  version: 1;
  updateId: string;
  fromVersion: string;
  toVersion: string;
  createdAt: string;
  expiresAt?: string;
  files: OfflineUpdateFile[];
  deletes: string[];
  migrationFiles: string[];
  compatibility: {
    minimumNodeMajor: number;
    maximumNodeMajor?: number;
    requiredPlatform?: string;
  };
  validationCommands: string[];
  releaseEvidenceHashes: string[];
  manifestSha256: string;
}

export type SignedOfflineUpdate = SignedCanonicalPayload<OfflineUpdatePayload>;

export interface OfflineUpdatePlan {
  updateId: string;
  fromVersion: string;
  toVersion: string;
  writes: Array<{ path: string; bytes: number; sha256: string }>;
  deletes: string[];
  migrations: string[];
  compatible: boolean;
  blockers: string[];
}

export interface AppliedOfflineUpdate {
  updateId: string;
  targetDir: string;
  backupDir: string;
  previousVersion: string;
  currentVersion: string;
  appliedAt: string;
}

function safeRelativePath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0")) {
    throw new Error("update_path_invalid");
  }
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("update_path_traversal");
  }
  return normalized;
}

function resolveInside(root: string, relativePath: string): string {
  const rootResolved = resolve(root);
  const target = resolve(rootResolved, safeRelativePath(relativePath));
  if (target !== rootResolved && !target.startsWith(`${rootResolved}${sep}`)) {
    throw new Error("update_path_escape");
  }
  return target;
}

function compareVersion(a: string, b: string): number {
  const parse = (value: string) => value.split(/[.+-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
  const av = parse(a);
  const bv = parse(b);
  for (let index = 0; index < 3; index += 1) {
    if (av[index] !== bv[index]) return av[index] - bv[index];
  }
  return a.localeCompare(b);
}

function readVersion(targetDir: string): string {
  const statePath = resolveInside(targetDir, ".titai-version");
  if (existsSync(statePath)) return readFileSync(statePath, "utf8").trim();
  const packagePath = resolveInside(targetDir, "package.json");
  if (existsSync(packagePath)) {
    const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: string };
    if (parsed.version) return parsed.version;
  }
  throw new Error("update_current_version_unknown");
}

function collectFiles(root: string, base = root): string[] {
  if (!existsSync(root)) return [];
  const output: string[] = [];
  for (const name of readdirSync(root)) {
    const absolute = join(root, name);
    const info = lstatSync(absolute);
    if (info.isSymbolicLink()) throw new Error("update_symlink_not_supported");
    if (info.isDirectory()) output.push(...collectFiles(absolute, base));
    else if (info.isFile()) output.push(relative(base, absolute).replaceAll("\\", "/"));
  }
  return output.sort();
}

export function createOfflineUpdate(options: {
  fromVersion: string;
  toVersion: string;
  files: Array<{ path: string; bytes: Buffer | string; mode?: number }>;
  deletes?: string[];
  migrationFiles?: string[];
  validationCommands?: string[];
  releaseEvidenceHashes?: string[];
  compatibility?: Partial<OfflineUpdatePayload["compatibility"]>;
  signer: SovereignSigningIdentity;
  updateId?: string;
  now?: Date;
  expiresAt?: string;
}): SignedOfflineUpdate {
  if (compareVersion(options.toVersion, options.fromVersion) <= 0) throw new Error("update_downgrade_or_equal_rejected");
  const now = options.now ?? new Date();
  if (options.expiresAt && new Date(options.expiresAt).getTime() <= now.getTime()) {
    throw new Error("update_expiry_invalid");
  }
  const files = options.files
    .map((file) => {
      const path = safeRelativePath(file.path);
      const bytes = Buffer.isBuffer(file.bytes) ? file.bytes : Buffer.from(file.bytes, "utf8");
      return {
        path,
        bytesBase64: bytes.toString("base64"),
        sha256: sha256(bytes.toString("base64")),
        mode: file.mode ?? 0o600,
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
  const deletes = [...new Set(options.deletes ?? [])].map(safeRelativePath).sort();
  const migrationFiles = [...new Set(options.migrationFiles ?? [])].map(safeRelativePath).sort();
  const manifest = { files: files.map(({ path, sha256, mode }) => ({ path, sha256, mode })), deletes, migrationFiles };
  const payload: OfflineUpdatePayload = {
    format: "titai-offline-update",
    version: 1,
    updateId: options.updateId ?? `update-${sha256({ from: options.fromVersion, to: options.toVersion, manifest }).slice(0, 20)}`,
    fromVersion: options.fromVersion,
    toVersion: options.toVersion,
    createdAt: now.toISOString(),
    expiresAt: options.expiresAt,
    files,
    deletes,
    migrationFiles,
    compatibility: {
      minimumNodeMajor: options.compatibility?.minimumNodeMajor ?? 22,
      maximumNodeMajor: options.compatibility?.maximumNodeMajor,
      requiredPlatform: options.compatibility?.requiredPlatform,
    },
    validationCommands: [...new Set(options.validationCommands ?? [])],
    releaseEvidenceHashes: [...new Set(options.releaseEvidenceHashes ?? [])].sort(),
    manifestSha256: sha256(manifest),
  };
  return signCanonicalPayload({ payload, identity: options.signer, now });
}

export function verifyOfflineUpdate(options: {
  update: SignedOfflineUpdate;
  publicKeyPem: string;
  expectedKeyId?: string;
  targetDir: string;
  now?: Date;
  nodeMajor?: number;
  platform?: string;
}): OfflineUpdatePlan {
  if (!verifyCanonicalPayload({ envelope: options.update, publicKeyPem: options.publicKeyPem, expectedKeyId: options.expectedKeyId })) {
    throw new Error("update_signature_invalid");
  }
  const payload = options.update.payload;
  if (payload.format !== "titai-offline-update" || payload.version !== 1) throw new Error("update_format_invalid");
  if (payload.expiresAt && new Date(payload.expiresAt).getTime() <= (options.now ?? new Date()).getTime()) {
    throw new Error("update_expired");
  }
  const currentVersion = readVersion(options.targetDir);
  const blockers: string[] = [];
  if (currentVersion !== payload.fromVersion) blockers.push("source_version_mismatch");
  if (compareVersion(payload.toVersion, currentVersion) <= 0) blockers.push("downgrade_or_equal_rejected");
  const nodeMajor = options.nodeMajor ?? Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (nodeMajor < payload.compatibility.minimumNodeMajor) blockers.push("node_version_too_old");
  if (payload.compatibility.maximumNodeMajor && nodeMajor > payload.compatibility.maximumNodeMajor) blockers.push("node_version_too_new");
  const platform = options.platform ?? process.platform;
  if (payload.compatibility.requiredPlatform && payload.compatibility.requiredPlatform !== platform) blockers.push("platform_incompatible");
  const manifest = {
    files: payload.files.map(({ path, sha256: fileHash, mode }) => ({ path, sha256: fileHash, mode })),
    deletes: payload.deletes,
    migrationFiles: payload.migrationFiles,
  };
  if (sha256(manifest) !== payload.manifestSha256) blockers.push("manifest_integrity_invalid");
  for (const file of payload.files) {
    safeRelativePath(file.path);
    const bytes = Buffer.from(file.bytesBase64, "base64");
    if (sha256(bytes.toString("base64")) !== file.sha256) blockers.push(`file_integrity_invalid:${file.path}`);
  }
  for (const path of [...payload.deletes, ...payload.migrationFiles]) safeRelativePath(path);
  return {
    updateId: payload.updateId,
    fromVersion: payload.fromVersion,
    toVersion: payload.toVersion,
    writes: payload.files.map((file) => ({ path: file.path, bytes: Buffer.from(file.bytesBase64, "base64").length, sha256: file.sha256 })),
    deletes: [...payload.deletes],
    migrations: [...payload.migrationFiles],
    compatible: blockers.length === 0,
    blockers,
  };
}

export function applyOfflineUpdate(options: {
  update: SignedOfflineUpdate;
  publicKeyPem: string;
  expectedKeyId?: string;
  targetDir: string;
  validate?: (targetDir: string, update: OfflineUpdatePayload) => void;
  faultInjector?: (point: "after_backup" | "after_writes" | "after_version") => void;
  now?: Date;
}): AppliedOfflineUpdate {
  const plan = verifyOfflineUpdate({
    update: options.update,
    publicKeyPem: options.publicKeyPem,
    expectedKeyId: options.expectedKeyId,
    targetDir: options.targetDir,
    now: options.now,
  });
  if (!plan.compatible) throw new Error(`update_incompatible:${plan.blockers.join(",")}`);
  const targetDir = resolve(options.targetDir);
  const nonce = randomBytes(8).toString("hex");
  const backupDir = `${targetDir}.rollback-${options.update.payload.fromVersion}-${nonce}`;
  if (existsSync(backupDir)) throw new Error("update_backup_exists");
  cpSync(targetDir, backupDir, { recursive: true, preserveTimestamps: true });
  options.faultInjector?.("after_backup");
  try {
    for (const file of options.update.payload.files) {
      const target = resolveInside(targetDir, file.path);
      mkdirSync(dirname(target), { recursive: true });
      const temp = `${target}.tmp-${nonce}`;
      writeFileSync(temp, Buffer.from(file.bytesBase64, "base64"), { mode: file.mode });
      renameSync(temp, target);
    }
    for (const deletion of options.update.payload.deletes) {
      rmSync(resolveInside(targetDir, deletion), { recursive: true, force: true });
    }
    options.faultInjector?.("after_writes");
    writeFileSync(resolveInside(targetDir, ".titai-version"), `${options.update.payload.toVersion}\n`, { mode: 0o600 });
    options.faultInjector?.("after_version");
    options.validate?.(targetDir, options.update.payload);
    return {
      updateId: options.update.payload.updateId,
      targetDir,
      backupDir,
      previousVersion: options.update.payload.fromVersion,
      currentVersion: options.update.payload.toVersion,
      appliedAt: (options.now ?? new Date()).toISOString(),
    };
  } catch (error) {
    rmSync(targetDir, { recursive: true, force: true });
    renameSync(backupDir, targetDir);
    throw error;
  }
}

export function rollbackOfflineUpdate(applied: AppliedOfflineUpdate): void {
  if (!existsSync(applied.backupDir)) throw new Error("rollback_bundle_missing");
  const currentVersion = readVersion(applied.targetDir);
  if (currentVersion !== applied.currentVersion) throw new Error("rollback_target_version_mismatch");
  const displaced = `${applied.targetDir}.failed-${randomBytes(6).toString("hex")}`;
  renameSync(applied.targetDir, displaced);
  try {
    renameSync(applied.backupDir, applied.targetDir);
    const restoredVersion = readVersion(applied.targetDir);
    if (restoredVersion !== applied.previousVersion) throw new Error("rollback_version_integrity_failed");
    rmSync(displaced, { recursive: true, force: true });
  } catch (error) {
    if (!existsSync(applied.targetDir) && existsSync(displaced)) renameSync(displaced, applied.targetDir);
    throw error;
  }
}

export function verifyDirectoryFileHashes(targetDir: string, expected: Record<string, string>): boolean {
  for (const [path, expectedHash] of Object.entries(expected)) {
    const absolute = resolveInside(targetDir, path);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) return false;
    const bytes = readFileSync(absolute);
    if (sha256(bytes.toString("base64")) !== expectedHash) return false;
  }
  return true;
}

export function inventoryDirectory(targetDir: string): string[] {
  return collectFiles(resolve(targetDir));
}
