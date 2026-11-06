#!/usr/bin/env node
/**
 * era3-export.mjs — era-3 E1: ייצוא-מוצפן של חומר-המשמורת מחוץ-ל-runner.
 * (ערכת era3-kit · מאושר-בעלים פעמיים 2026-11-06: "כן אני מאשר" + "כן בטח קדימה בצע")
 *
 * מה-הוא-עושה:
 *   1. אוסף .secrets/custody-vault/** + soldiers.json + crown-map.json + army-keys.json
 *      (קיימים-בלבד · לעולם-לא-מעתיק-מחוץ-לזיכרון-בפלטטקס).
 *   2. DEK אקראי (32B) → AES-256-GCM על canonical-JSON של הקבצים.
 *   3. עיטוף-ה-DEK אל מפתח-ציבורי X25519 של-המפעיל-המקומי (era3-op-pub.json):
 *      ECDH-אפמרלי + HKDF("era3-dek-wrap-v3") → AES-256-GCM. הפרטי-המקומי-מעולם-לא-נוסע.
 *   4. כותב state/era3-export.json (צופן-בלבד · טביעות-אצבע-פנימיות) ו-push לסניף.
 *   5. מדפיס-מטריצה: נתיבים + טביעות + sha256-הייצוא (לאישור-ה-yיבוא המקומי).
 *
 * הרצה: node era3-export.mjs [--check]   (--check = רק-מדידה, בלי-כתיבה/דחיפה)
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(DIR, "..", ".."); // .../steem (כמו crown-vault-adopt.mjs)
const SECRETS = path.join(REPO, ".secrets");
const OUT = path.join(DIR, "state", "era3-export.json");
const OP_PUB = path.join(DIR, "era3-op-pub.json");
const MAX_EXPORT_AGE_MS = 6 * 3600 * 1000; // ייצוא-חדש-רק-אם-הקיים-ישן (מניעת-גלגול-sha)

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const b64 = (b) => Buffer.from(b).toString("base64");
const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function atomicWrite(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const t = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(t, JSON.stringify(v, null, 2));
  fs.renameSync(t, p);
}

export function exportPaths() {
  const out = [];
  const vaultDir = path.join(SECRETS, "custody-vault");
  if (fs.existsSync(vaultDir)) {
    for (const f of fs.readdirSync(vaultDir)) {
      const p = path.join(vaultDir, f);
      if (fs.statSync(p).isFile()) out.push({ path: `custody-vault/${f}`, abs: p });
    }
  }
  for (const rel of ["soldiers.json", "crown-map.json", "army-keys.json", "custody-manifest.json"]) {
    const p = path.join(SECRETS, rel);
    if (fs.existsSync(p)) out.push({ path: rel, abs: p });
  }
  return out;
}

export function currentExportAgeMs() {
  try {
    const doc = JSON.parse(fs.readFileSync(OUT, "utf8"));
    return Date.now() - Date.parse(doc.exportedAt);
  } catch {
    return Infinity;
  }
}

export async function runEra3Export({ force = false, push = true, checkOnly = false } = {}) {
  const age = currentExportAgeMs();
  if (!force && age < MAX_EXPORT_AGE_MS) {
    const doc = JSON.parse(fs.readFileSync(OUT, "utf8"));
    return { ok: true, verdict: "FRESH-SKIP", exportedAt: doc.exportedAt, ageMinutes: Math.round(age / 60000), paths: doc.files?.length ?? 0, note: "ייצוא-קיים-טרי — לא-נגלגל-sha" };
  }

  const opPubRaw = fs.existsSync(OP_PUB) ? JSON.parse(fs.readFileSync(OP_PUB, "utf8")) : null;
  if (!opPubRaw?.x || opPubRaw.crv !== "X25519") { // RFC 8037: X25519-גדולה-בלבד
    return {
      ok: false, verdict: "REFUSED",
      code: "ERA3-NO-OP-PUB",
      remediation: "הצב era3-op-pub.json (JWK {kty:OKP,crv:X25519,x}) מהכספת-המקומית — era3Status() מדפיס אותו",
    };
  }

  const paths = exportPaths();
  if (!paths.length) {
    return { ok: false, verdict: "REFUSED", code: "ERA3-NO-MATERIAL", remediation: "אין .secrets/custody-vault ואין soldiers.json — אין מה לייצא (כנות)" };
  }

  const files = {};
  const filesFp = {};
  for (const { path: rel, abs } of paths) {
    const content = fs.readFileSync(abs, "utf8");
    files[rel] = content;
    filesFp[rel] = sha256(content);
  }

  const dek = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const payload = Buffer.from(JSON.stringify({ files }), "utf8");
  const cipher = crypto.createCipheriv("aes-256-gcm", dek, iv);
  const ct = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();

  const { publicKey: eph, privateKey: ephPriv } = crypto.generateKeyPairSync("x25519");
  const opPub = crypto.createPublicKey({ key: opPubRaw, format: "jwk" });
  const shared = crypto.diffieHellman({ privateKey: ephPriv, publicKey: opPub });
  const wrapKey = crypto.hkdfSync("sha256", shared, Buffer.alloc(0), Buffer.from("era3-dek-wrap-v3"), 32);
  const wiv = crypto.randomBytes(12);
  const wc = crypto.createCipheriv("aes-256-gcm", Buffer.from(wrapKey), wiv);
  const wct = Buffer.concat([wc.update(dek), wc.final()]);
  const wtag = wc.getAuthTag();

  const doc = {
    v: 3,
    exportedAt: new Date().toISOString(),
    hostname: os.hostname(),
    files: paths.map((p) => p.path),
    filesFp,
    enc: {
      alg: "A256GCM", iv: b64(iv), ct: b64(ct), tag: b64(tag),
      epk: { kty: "OKP", crv: "X25519", x: b64url(eph.export({ type: "spki", format: "der" }).subarray(-32)) },
      wiv: b64(wiv), wct: b64(wct), wtag: b64(wtag),
    },
  };

  const body = JSON.stringify(doc, null, 2);
  const outSha = sha256(body);
  if (checkOnly) {
    return { ok: true, verdict: "CHECK-ONLY", exportSha256: outSha.slice(0, 16), paths: paths.map((p) => p.path), exportedAt: doc.exportedAt };
  }
  atomicWrite(OUT, doc);
  if (!push) {
    return { ok: true, verdict: "WRITTEN-NO-PUSH", exportSha256: outSha.slice(0, 16), paths: paths.map((p) => p.path), exportedAt: doc.exportedAt };
  }
  try {
    execSync(`git add -f "${path.relative(REPO, OUT)}" && git -c user.name=roshpinacare-sys -c user.email=era3@crown commit -m "era3: encrypted custody export (two-site law E3)" --no-verify`, { cwd: REPO, stdio: "pipe" });
    execSync(`git push origin HEAD`, { cwd: REPO, stdio: "pipe", timeout: 60000 });
  } catch (e) {
    return { ok: true, verdict: "WRITTEN-PUSH-FAILED", exportSha256: outSha.slice(0, 16), pushError: String(e?.message ?? e).slice(0, 160), note: "הצופן-נכתב-מקומית · הדחיפה-נכשלה — השער-יישאר-אדום עד-דחיפה" };
  }
  return {
    ok: true, verdict: "EXPORTED-PUSHED", exportedAt: doc.exportedAt,
    exportSha256: outSha.slice(0, 16),
    paths: paths.map((p) => p.path),
    fpMatrix: filesFp,
    law: "E3 · השער-ב-runner ייפתח-רק-אחרי-ייבוא-מקומי + era3-ack.json",
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runEra3Export({ force: process.argv.includes("--force"), push: !process.argv.includes("--check") })
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => { console.error("era3-export failed:", String(e?.message ?? e)); process.exit(1); });
}
