import nextEnv from "@next/env";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());
import { createApplicationBackup } from "../src/lib/backup/application-backup.ts";
import pkg from "../package.json" with { type: "json" };

const passphrase = process.env.TITAI_BACKUP_PASSPHRASE;
if (!passphrase) throw new Error("TITAI_BACKUP_PASSPHRASE is required.");
const databasePath = process.env.DATABASE_PATH ?? "./data/titai.db";
const outputPath = process.env.TITAI_BACKUP_PATH ?? `./backups/titai-${new Date().toISOString().slice(0, 10)}.backup`;
const migrationFiles = readdirSync(resolve(process.cwd(), "drizzle"))
  .filter((name) => name.endsWith(".sql"))
  .sort();
const result = createApplicationBackup({
  databasePath,
  outputPath,
  passphrase,
  appVersion: pkg.version,
  migrationFiles,
});
console.log(JSON.stringify(result, null, 2));
