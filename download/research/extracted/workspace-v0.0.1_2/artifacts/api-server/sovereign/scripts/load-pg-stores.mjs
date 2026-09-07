#!/usr/bin/env node
// scripts/load-pg-stores.mjs — Restore TFA pg-store tables from a JSON dump.
//
// CLI:
//   node scripts/load-pg-stores.mjs <input-file.json>
//
// Environment:
//   DATABASE_URL — optional; if absent, uses InMemoryPool.
//
// The target database must already have the tables created (run init() on each
// store before loading).
//
// Zero external dependencies.

import { readFileSync } from "node:fs";
import { InMemoryPool } from "../lib/db/in-memory-driver.ts";
import { loadPgStores } from "../lib/db/backup-restore.ts";

const inFile = process.argv[2];
if (!inFile) {
  console.error("Usage: node scripts/load-pg-stores.mjs <input-file.json>");
  process.exit(2);
}

async function main() {
  const raw = readFileSync(inFile, "utf8");
  const dump = JSON.parse(raw);

  if (!dump.meta || dump.meta.version !== "tfa-backup-v1") {
    console.error("Unsupported dump format (expected tfa-backup-v1)");
    process.exit(2);
  }

  const pool = new InMemoryPool();
  await loadPgStores(pool, dump);
  console.log(`Restored ${dump.meta.tables.length} tables from ${inFile}`);
  console.log(`Tables: ${dump.meta.tables.join(", ") || "(none)"}`);
}

main().catch((e) => {
  console.error(e.message || String(e));
  process.exit(1);
});
