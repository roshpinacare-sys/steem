import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { openSQLite } from "../src/lib/db/sqlite-client";
import { applyCanonicalMigrations } from "../src/lib/db/migrations";

const dbPath = resolve(
  process.cwd(),
  process.env.DATABASE_PATH ?? "./data/titai.db",
);
mkdirSync(dirname(dbPath), { recursive: true });

const sqlite = openSQLite(dbPath);
sqlite.pragma("journal_mode = WAL");
const result = applyCanonicalMigrations({
  client: sqlite,
  migrationsFolder: resolve(process.cwd(), "drizzle"),
});
console.log(`[titai] migrations applied to ${dbPath} using ${sqlite.driverName}: ${result.applied.length} applied, ${result.bootstrapped.length} bootstrapped, ${result.alreadyApplied.length} already present`);
sqlite.close();
