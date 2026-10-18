// db-custody.mjs — SCHEMA CUSTODY (Bytebase-pattern, chain-anchored, T-523).
// Bytebase's proven patterns — database-as-code + drift detection + audit —
// adapted to the sovereignty and surpassed: our audit trail anchors to a
// public chain (hive-beat payload dbFp), not to a platform's own DB.
//
// Two honest layers (no apples-vs-oranges hashing):
//  1. drift: expected tables (parsed from Git-declared schema.prisma models,
//     honoring @@map) vs live sqlite tables → MATCH | DRIFT | NO_* | LIVE_UNREADABLE
//  2. tamper-evidence: liveDdlFp = sha256 of sorted sqlite_master DDL +
//     user_version — anchored by hive-beat every beat; any unannounced schema
//     change between beats is then provable against the chain.
// Fail-closed honesty: absent pieces are reported, never invented. Public
// material only — fingerprints and object names, never row data, no secrets.
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const DECLARED_SCHEMA_PATHS = [
  process.env.DB_SCHEMA_DECLARED,
  "/home/z/my-project/prisma/schema.prisma",
  path.join(process.cwd(), "prisma/schema.prisma"),
  path.join(process.cwd(), "../../prisma/schema.prisma"),
].filter(Boolean);

const DB_GLOBS = [
  "/home/z/my-project/db",
  path.join(process.cwd(), "db"),
  path.join(process.cwd(), "../../db"),
];

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

function declaredSchema() {
  for (const p of DECLARED_SCHEMA_PATHS) {
    try {
      if (fs.existsSync(p)) return { file: p, text: fs.readFileSync(p, "utf8") };
    } catch { /* absent */ }
  }
  return null;
}

// Prisma model → table name: `model Foo` ⇒ "foo" unless `@@map("bar")`.
function expectedTables(schemaText) {
  const out = [];
  const re = /model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(schemaText))) {
    const body = m[2];
    const map = body.match(/@@map\(\s*"([^"]+)"\s*\)/);
    out.push(map ? map[1] : m[1]);
  }
  return out;
}

function listLiveDbs() {
  const found = [];
  for (const dir of DB_GLOBS) {
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith(".db") && !found.some((x) => x.path === path.join(dir, f))) {
          found.push({ path: path.join(dir, f), name: f });
        }
      }
    } catch { /* absent */ }
  }
  return found;
}

// bun:sqlite first (engine runs on bun), node:sqlite fallback.
async function inspectLive(dbPath) {
  try {
    const isBun = typeof Bun !== "undefined";
    const mod = isBun ? await import("bun:sqlite") : await import("node:sqlite");
    const Ctor = mod.Database ?? mod.DatabaseSync;
    const db = new Ctor(dbPath, isBun ? { readonly: true } : { readOnly: true });
    const q = (...args) => db.query(...args);
    const rows = q("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
    const uv = q("PRAGMA user_version").get();
    db.close();
    const h = crypto.createHash("sha256");
    for (const r of rows) h.update(`${r.type}\u0000${r.name}\u0000${r.sql ?? ""}\u0001`);
    h.update(`uv=${uv?.user_version ?? 0}`);
    return {
      fp: h.digest("hex"),
      tables: rows.filter((r) => r.type === "table").map((r) => r.name),
      objects: rows.length,
      userVersion: uv?.user_version ?? 0,
    };
  } catch (e) {
    return { error: String(e).slice(0, 120) };
  }
}

export async function dbCustodySnapshot() {
  const dec = declaredSchema();
  const expected = dec ? expectedTables(dec.text) : null;
  const dbs = [];
  for (const d of listLiveDbs()) {
    const ins = await inspectLive(d.path);
    const lc = (a) => (a ?? []).map((x) => String(x).toLowerCase());
    const missing = ins.tables && expected ? lc(expected).filter((t) => !lc(ins.tables).includes(t)) : null;
    dbs.push({
      name: d.name,
      liveDdlFp: ins.fp ?? null,
      tables: ins.tables ?? null,
      objects: ins.objects ?? null,
      userVersion: ins.userVersion ?? null,
      error: ins.error ?? null,
      missingExpected: missing,
    });
  }
  const readable = dbs.find((x) => x.liveDdlFp) ?? null;
  let verdict = "NO_DECLARED";
  if (dec && readable) verdict = readable.missingExpected?.length ? "DRIFT" : "MATCH";
  else if (dec && !readable && dbs.length) verdict = "LIVE_UNREADABLE";
  else if (dec && !dbs.length) verdict = "NO_LIVE_DB";
  return {
    declared: dec
      ? { fileFp: sha256(Buffer.from(dec.text)), file: path.basename(dec.file), expectedTables: expected }
      : null,
    liveDdlFp: readable?.liveDdlFp ?? null,
    dbs, verdict,
    drift: verdict === "DRIFT",
    t: new Date().toISOString(),
  };
}

// CLI mode: print one honest JSON verdict line.
if (process.argv[1]?.endsWith("db-custody.mjs")) {
  console.log(JSON.stringify(await dbCustodySnapshot(), null, 2));
}
