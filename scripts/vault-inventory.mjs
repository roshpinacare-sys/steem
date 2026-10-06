#!/usr/bin/env bun
/**
 * vault-inventory — רשימת-תוכן הכספת בלבד (r181)
 *
 * רקע (דבר-ה-owner, trace 1a102dc504a2e6f9): "יש לך הכל" — המצאות-מפתחות
 * נמדדת, לא נניח. הסקריפט קורא את טבלת VaultEntry בקריאה-בלבד (bun:sqlite)
 * ומדפיס רק עמודות-ציבוריות: chain/account/role/pub/status.
 * אף-הצפנה לא נפתחת, אף-חומר-סוד לא נוגע, אף-בייט פרטי לא נדפס.
 *
 * Usage: bun scripts/vault-inventory.mjs
 */

import { Database } from "bun:sqlite";
import path from "node:path";
import { existsSync } from "node:fs";

const HOME = "/home/z/my-project";
const WALLET_DB = process.env.WALLET_DB || path.join(HOME, "db", "wallet-vault.db");

if (!existsSync(WALLET_DB)) {
  console.error(`[inventory] ✗ NO-WALLET-DB: ${WALLET_DB}`);
  process.exit(1);
}

const db = new Database(WALLET_DB, { readonly: true });

const entries = db
  .query("SELECT chain, account, role, pub, status, id FROM VaultEntry ORDER BY chain, account, role, id")
  .all();

console.log(`[inventory] VaultEntry rows: ${entries.length}`);
for (const e of entries) {
  console.log(`  ${e.chain} · ${e.account} · ${e.role} · ${e.pub} · ${e.status}`);
}

// חותמות-הפתיחה (מפתחות-ציבוריים בלבד)
try {
  const cfgRow = db.query("SELECT keySeals FROM GateConfig WHERE id = 'gate'").get();
  if (cfgRow && cfgRow.keySeals) {
    const seals = JSON.parse(cfgRow.keySeals);
    console.log(`[inventory] GateConfig.keySeals (control pubs): ${seals.length}`);
    for (const s of seals) {
      console.log(`  seal · ${s.pub} · ${s.chain || "?"}/${s.account || "?"}/${s.role || "?"}`);
    }
  }
} catch {
  console.log("[inventory] GateConfig.keySeals: לא נקרא");
}

try {
  const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  console.log(`[inventory] tables: ${tables.map((t) => t.name).join(", ")}`);
} catch {
  /* לא קריטי */
}
