import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, openSync, closeSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { spawnSync } from "node:child_process";

export const root = resolve(import.meta.dirname, "..");
export const stateDir = join(root, ".titai-installer");
export const pidFile = join(stateDir, "server.pid");
export const logFile = join(stateDir, "server.log");
export const installationFile = join(root, "INSTALLATION.json");

export function sha256File(path) {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

export function ensureDirs() {
  for (const path of [stateDir, join(root, "data"), join(root, "logs"), join(root, "backups")]) {
    mkdirSync(path, { recursive: true });
  }
}

export function parseEnv(path = join(root, ".env")) {
  const env = {};
  if (!existsSync(path)) return env;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx < 1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    env[key] = value;
  }
  return env;
}

export function installerEnv(extra = {}) {
  return {
    ...process.env,
    ...parseEnv(),
    NEXT_TELEMETRY_DISABLED: "1",
    TITAI_SQLITE_DRIVER: process.env.TITAI_SQLITE_DRIVER ?? "node:sqlite",
    ...extra,
  };
}

export function findNpmCli() {
  const candidates = [
    resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
    resolve(dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js"),
    "/opt/nvm/versions/node/v22.16.0/lib/node_modules/npm/bin/npm-cli.js",
  ];
  for (const path of candidates) if (existsSync(path)) return path;
  throw new Error("npm_cli_not_found: install Node.js with npm included");
}

export function runNpm(args, options = {}) {
  const result = spawnSync(process.execPath, [findNpmCli(), ...args], {
    cwd: root,
    env: installerEnv(options.env),
    stdio: options.capture ? "pipe" : "inherit",
    encoding: options.capture ? "utf8" : undefined,
    timeout: options.timeout ?? 30 * 60_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stdout ?? ""}\n${result.stderr ?? ""}` : "";
    throw new Error(`npm_failed_${args.join("_")}_exit_${result.status}${detail}`);
  }
  return result;
}

export function checkNode() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || major > 24) throw new Error(`unsupported_node_${process.versions.node}: use Node 22, 23, or 24`);
  if (major === 22 && minor < 16) throw new Error(`node_too_old_${process.versions.node}: use 22.16.0 or newer`);
  return process.versions.node;
}

export function generateEnvFile() {
  const path = join(root, ".env");
  if (existsSync(path)) return { path, created: false };
  const auth = randomBytes(32).toString("base64");
  const encryption = randomBytes(32).toString("base64");
  const content = [
    `AUTH_SECRET="${auth}"`,
    `ENCRYPTION_KEY="${encryption}"`,
    'DATABASE_PATH="./data/titai.db"',
    "ALLOW_PUBLIC_REGISTRATION=false",
    "TRUST_PROXY_HEADERS=false",
    "TITAI_DURABLE_STORE=sqlite",
    "TITAI_SQLITE_DRIVER=node:sqlite",
    "NEXT_TELEMETRY_DISABLED=1",
    'HOSTNAME="127.0.0.1"',
    'PORT="3210"',
    "",
  ].join("\n");
  writeFileSync(path, content, { mode: 0o600 });
  return { path, created: true };
}

export function writeInstallation(data) {
  writeFileSync(installationFile, `${JSON.stringify(data, null, 2)}\n`);
}

export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function tail(path, max = 60) {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8").split(/\r?\n/).slice(-max).join("\n");
}

export function openLogHandles() {
  ensureDirs();
  const fd = openSync(logFile, "a");
  return { out: fd, err: fd, close: () => closeSync(fd) };
}
