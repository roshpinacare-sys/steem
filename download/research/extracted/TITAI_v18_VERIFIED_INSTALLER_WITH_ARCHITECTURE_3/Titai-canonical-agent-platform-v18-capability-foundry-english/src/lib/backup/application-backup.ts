import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

const HEADER = "TITAI-APPLICATION-BACKUP-V1\n";
const AAD = Buffer.from("titai-application-backup:v1", "utf8");
const REQUIRED_TABLES = [
  "users",
  "tenants",
  "workspaces",
  "workspace_memberships",
  "agents",
  "runs",
  "run_steps",
  "run_events",
  "approvals",
  "artifacts",
  "audit_log",
  "durable_jobs",
  "durable_receipts",
  "durable_outbox",
  "memories",
  "model_profiles",
  "verification_attestations",
] as const;

interface BackupPayload {
  format: "titai-application-database";
  version: 1;
  createdAt: string;
  appVersion: string;
  databaseSha256: string;
  databaseBytes: number;
  migrationFiles: string[];
  databaseBase64: string;
}

interface BackupEnvelope {
  format: "titai-application-backup";
  version: 1;
  kdf: "scrypt";
  cipher: "aes-256-gcm";
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
  plaintextSha256: string;
}

export interface ApplicationBackupResult {
  outputPath: string;
  databaseSha256: string;
  databaseBytes: number;
  createdAt: string;
}

export type ApplicationRestoreFaultPoint =
  | "after_temp_verified"
  | "after_target_displaced"
  | "before_commit";

export interface ApplicationRestoreResult {
  targetPath: string;
  databaseSha256: string;
  databaseBytes: number;
  restoredAt: string;
  displacedDatabasePath: string | null;
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  if (passphrase.length < 12) throw new Error("backup_passphrase_too_short");
  return scryptSync(passphrase, salt, 32, { N: 16_384, r: 8, p: 1 });
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function verifyDatabase(path: string): void {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const quick = db.prepare("PRAGMA quick_check").get() as { quick_check?: string };
    if (quick.quick_check !== "ok") throw new Error("database_integrity_check_failed");
    const violations = db.prepare("PRAGMA foreign_key_check").all();
    if (violations.length > 0) throw new Error("database_foreign_key_check_failed");
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
        (row) => row.name,
      ),
    );
    const missing = REQUIRED_TABLES.filter((table) => !tables.has(table));
    if (missing.length > 0) throw new Error(`database_required_tables_missing:${missing.join(",")}`);
  } finally {
    db.close();
  }
}

function decryptEnvelope(bytes: Buffer, passphrase: string): BackupPayload {
  const text = bytes.toString("utf8");
  if (!text.startsWith(HEADER)) throw new Error("unsupported_backup_format");
  const envelope = JSON.parse(text.slice(HEADER.length)) as BackupEnvelope;
  if (
    envelope.format !== "titai-application-backup" ||
    envelope.version !== 1 ||
    envelope.kdf !== "scrypt" ||
    envelope.cipher !== "aes-256-gcm"
  ) {
    throw new Error("unsupported_backup_format");
  }
  const salt = Buffer.from(envelope.salt, "base64");
  const iv = Buffer.from(envelope.iv, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");
  const key = deriveKey(passphrase, salt);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const expected = Buffer.from(envelope.plaintextSha256, "hex");
    const actual = Buffer.from(sha256(plaintext), "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new Error("backup_integrity_mismatch");
    }
    const payload = JSON.parse(plaintext.toString("utf8")) as BackupPayload;
    if (payload.format !== "titai-application-database" || payload.version !== 1) {
      throw new Error("unsupported_backup_payload");
    }
    return payload;
  } finally {
    key.fill(0);
  }
}

export function createApplicationBackup(options: {
  databasePath: string;
  outputPath: string;
  passphrase: string;
  appVersion: string;
  migrationFiles: string[];
  now?: Date;
}): ApplicationBackupResult {
  const databasePath = resolve(options.databasePath);
  const outputPath = resolve(options.outputPath);
  if (!existsSync(databasePath)) throw new Error("database_not_found");
  mkdirSync(dirname(outputPath), { recursive: true });
  const nonce = randomBytes(8).toString("hex");
  const snapshotPath = resolve(tmpdir(), `titai-snapshot-${process.pid}-${nonce}.sqlite`);
  const tempOutputPath = `${outputPath}.tmp-${process.pid}-${nonce}`;
  try {
    const source = new DatabaseSync(databasePath);
    try {
      source.exec("PRAGMA busy_timeout = 5000");
      source.exec("PRAGMA wal_checkpoint(FULL)");
      source.exec(`VACUUM INTO ${sqlString(snapshotPath)}`);
    } finally {
      source.close();
    }
    verifyDatabase(snapshotPath);
    const databaseBytes = readFileSync(snapshotPath);
    const databaseSha256 = sha256(databaseBytes);
    const createdAt = (options.now ?? new Date()).toISOString();
    const payload: BackupPayload = {
      format: "titai-application-database",
      version: 1,
      createdAt,
      appVersion: options.appVersion,
      databaseSha256,
      databaseBytes: databaseBytes.length,
      migrationFiles: [...options.migrationFiles].sort(),
      databaseBase64: databaseBytes.toString("base64"),
    };
    const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = deriveKey(options.passphrase, salt);
    try {
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(AAD);
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const envelope: BackupEnvelope = {
        format: "titai-application-backup",
        version: 1,
        kdf: "scrypt",
        cipher: "aes-256-gcm",
        salt: salt.toString("base64"),
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        ciphertext: ciphertext.toString("base64"),
        plaintextSha256: sha256(plaintext),
      };
      writeFileSync(tempOutputPath, `${HEADER}${JSON.stringify(envelope)}\n`, { mode: 0o600 });
      renameSync(tempOutputPath, outputPath);
    } finally {
      key.fill(0);
    }
    return { outputPath, databaseSha256, databaseBytes: databaseBytes.length, createdAt };
  } finally {
    rmSync(snapshotPath, { force: true });
    rmSync(tempOutputPath, { force: true });
  }
}

export function restoreApplicationBackup(options: {
  backupPath: string;
  targetPath: string;
  passphrase: string;
  overwrite?: boolean;
  now?: Date;
  faultInjector?: (point: ApplicationRestoreFaultPoint) => void;
}): ApplicationRestoreResult {
  const backupPath = resolve(options.backupPath);
  const targetPath = resolve(options.targetPath);
  if (!existsSync(backupPath)) throw new Error("backup_not_found");
  if (existsSync(targetPath) && !options.overwrite) throw new Error("restore_target_exists");
  mkdirSync(dirname(targetPath), { recursive: true });
  const payload = decryptEnvelope(readFileSync(backupPath), options.passphrase);
  const databaseBytes = Buffer.from(payload.databaseBase64, "base64");
  if (databaseBytes.length !== payload.databaseBytes || sha256(databaseBytes) !== payload.databaseSha256) {
    throw new Error("backup_database_integrity_mismatch");
  }
  const nonce = randomBytes(8).toString("hex");
  const tempTarget = `${targetPath}.restore-${process.pid}-${nonce}`;
  let displacedDatabasePath: string | null = null;
  try {
    writeFileSync(tempTarget, databaseBytes, { mode: 0o600 });
    verifyDatabase(tempTarget);
    options.faultInjector?.("after_temp_verified");
    if (existsSync(targetPath)) {
      displacedDatabasePath = `${targetPath}.pre-restore-${(options.now ?? new Date())
        .toISOString()
        .replaceAll(/[:.]/g, "-")}`;
      renameSync(targetPath, displacedDatabasePath);
      options.faultInjector?.("after_target_displaced");
    }
    options.faultInjector?.("before_commit");
    renameSync(tempTarget, targetPath);
    return {
      targetPath,
      databaseSha256: payload.databaseSha256,
      databaseBytes: payload.databaseBytes,
      restoredAt: (options.now ?? new Date()).toISOString(),
      displacedDatabasePath,
    };
  } catch (error) {
    if (displacedDatabasePath && !existsSync(targetPath) && existsSync(displacedDatabasePath)) {
      renameSync(displacedDatabasePath, targetPath);
      displacedDatabasePath = null;
    }
    throw error;
  } finally {
    rmSync(tempTarget, { force: true });
  }
}
