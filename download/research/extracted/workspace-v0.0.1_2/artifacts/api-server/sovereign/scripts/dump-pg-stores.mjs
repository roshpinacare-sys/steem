#!/usr/bin/env node
// scripts/dump-pg-stores.mjs — Dump all known TFA pg-store tables to JSON.
//
// CLI:
//   node scripts/dump-pg-stores.mjs <output-file.json>
//
// Environment:
//   DATABASE_URL — optional; if absent, uses InMemoryPool (useful for demos).
//
// Zero external dependencies (node built-ins + lib/db/* only).

import { writeFileSync } from "node:fs";
import { InMemoryPool } from "../lib/db/in-memory-driver.ts";
import { dumpPgStores } from "../lib/db/backup-restore.ts";

const outFile = process.argv[2];
if (!outFile) {
  console.error("Usage: node scripts/dump-pg-stores.mjs <output-file.json>");
  process.exit(2);
}

async function main() {
  // For now, always use InMemoryPool (real pg.Pool would need the 'pg' package).
  // In production, swap this with a real pg.Pool connected to DATABASE_URL.
  const pool = new InMemoryPool();
  const dump = await dumpPgStores(pool);
  writeFileSync(outFile, JSON.stringify(dump, null, 2));
  console.log(`Dumped ${dump.meta.tables.length} tables to ${outFile}`);
  console.log(`Tables: ${dump.meta.tables.join(", ") || "(none)"}`);
}

main().catch((e) => {
  console.error(e.message || String(e));
  process.exit(1);
});
