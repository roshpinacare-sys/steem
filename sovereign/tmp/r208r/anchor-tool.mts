// ─────────────────────────────────────────────────────────────────────
// R208R ANCHOR TOOL — כלי-העיגון-הרשמי (§VIII/§IX, trace 1a10dda614a62251)
// כתיבת-עיגון חדש על ספר-עיגון-האש. זהו הנתיב-החוקי היחיד לשינוי-מודל:
// מי-משנה-מודל — מעדכן-עיגון. הצרכן מאמת בייטס-דיסק מול העיגון-האחרון.
// ─────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import { createHash } from "node:crypto";

const H = "/home/z/my-project";
const OBJ = `${H}/sovereign/objectives`;
const shaBuf = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

const MODEL_FILES = ["objectives.json", "options.json", "capabilities.json", "authority-map.json"];
const hashes: Record<string, string> = {};
for (const f of MODEL_FILES) hashes[f.replace(".json", "")] = shaBuf(fs.readFileSync(`${OBJ}/${f}`));

const anchorPath = `${OBJ}/authority-anchor.jsonl`;
const lines = fs.existsSync(anchorPath) ? fs.readFileSync(anchorPath, "utf8").trim().split("\n").filter(Boolean) : [];
const prev = lines.length ? JSON.parse(lines[lines.length - 1]!).entryHash : "GENESIS";
const base = {
  seq: lines.length + 1,
  at: new Date().toISOString(),
  authorityMapSha256: hashes["authority-map"],
  modelSha256: hashes,
  by: `r208r-anchor-tool (trace 1a10dda614a62251) — עיגון-מלא לארבעת-קבצי-המודל`,
  trace: "1a10dda614a62251",
  law: "פורמט-תקין ≠ סמכות-תקינה · שינוי-מודל-בלי-עיגון = דחייה (fail-closed)",
  prevHash: prev,
};
const entry = { ...base, entryHash: shaBuf(JSON.stringify(base)) };
fs.appendFileSync(anchorPath, JSON.stringify(entry) + "\n");
console.log(JSON.stringify({ seq: entry.seq, modelSha256: hashes, entryHash: entry.entryHash }, null, 1));
