import nextEnv from "@next/env";
import process from "node:process";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());
import { restoreApplicationBackup } from "../src/lib/backup/application-backup.ts";

const passphrase = process.env.TITAI_BACKUP_PASSPHRASE;
if (!passphrase) throw new Error("TITAI_BACKUP_PASSPHRASE is required.");
const backupPath = process.env.TITAI_BACKUP_PATH;
if (!backupPath) throw new Error("TITAI_BACKUP_PATH is required.");
const targetPath = process.env.DATABASE_PATH ?? "./data/titai.db";
const overwrite = process.env.TITAI_RESTORE_OVERWRITE === "1";
const result = restoreApplicationBackup({ backupPath, targetPath, passphrase, overwrite });
console.log(JSON.stringify(result, null, 2));
