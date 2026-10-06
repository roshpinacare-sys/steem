#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · brain-import — הבאת המוח הביתה (Task 21)
//
// פותח את ארכיון-הגיבוי של הכספת הריבונית (KEYS-BACKUP — הוראת המפעיל:
// "להקים בבית הכל"), מפענח את מפתחות ה-NVIDIA מתוך ה-DB הישן
// (headcorner key → key-seal → master → AES-256-GCM), מאמת חי מול
// integrate.api.nvidia.com (1-token chat — האמת היחידה), ואוטם אותם
// בבית ה-WEAVE — מוצפנים תחת מפתח-הרשת (אותה גזירה כמו ה-DAEMONs).
//
// חוק ברזל: אפס סוד בפלט. מודפס רק טביעת-אצבע בלתי-הפיכה + סטטוס.
// ─────────────────────────────────────────────────────────────────────
import crypto from "node:crypto";
import fs from "node:fs";
import { db } from "@/lib/db";
import { Database } from "bun:sqlite";

// ─── 1. פתיחת הכספת הישנה ───
const BACKUP_ENV = "/tmp/keys-extracted/agent/.env";
const OLD_DB = "/tmp/wallet-repo/db/custom.db";

const env = fs.readFileSync(BACKUP_ENV, "utf8");
const wifs: string[] = [];
for (const m of env.matchAll(/^(?:OWNER|ACTIVE|POSTING|MEMO)_WIF=(\S+)$/gm)) {
  wifs.push(m[1]);
}
if (wifs.length === 0) throw new Error("no control keys in backup .env");

const old = new Database(OLD_DB, { readonly: true });
const cfg = old.query("SELECT keySeals FROM GateConfig WHERE id='gate'").get() as { keySeals: string } | null;
if (!cfg?.keySeals) throw new Error("no keySeals in old GateConfig");
const seals = JSON.parse(cfg.keySeals) as Array<{
  pub: string; chain: string; account: string; role: string;
  kdfSalt: string; encMaster: string; sealIv: string; sealTag: string;
}>;

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };
function deriveKek(pass: string, saltHex: string): Buffer {
  return crypto.scryptSync(pass, Buffer.from(saltHex, "hex"), 32, SCRYPT);
}
function openGcm(key: Buffer, ct: string, iv: string, tag: string): string {
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
  d.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([d.update(Buffer.from(ct, "hex")), d.final()]).toString("utf8");
}

// master: המפתח שפותח את כל רשומות הכספת. נשאר בזיכרון בלבד.
let master: Buffer | null = null;
let openedWith = "";
for (const wif of wifs) {
  for (const s of seals) {
    try {
      const hex = openGcm(deriveKek(wif, s.kdfSalt), s.encMaster, s.sealIv, s.sealTag);
      if (hex.length === 64 && /^[0-9a-f]+$/.test(hex)) {
        master = Buffer.from(hex, "hex");
        openedWith = `${s.chain}/${s.account}/${s.role}`;
        break;
      }
    } catch { /* GCM rejects wrong key instantly — try next */ }
  }
  if (master) break;
}
if (!master) throw new Error("vault master could not be opened with any backup key");
console.log(`[1] master opened via key-seal (${openedWith}) — 32B in memory`);

// ─── 2. פענוח מפתחות NVIDIA ───
const rows = old
  .query("SELECT id, pub, encPriv, privIv, privTag, status, verifyNote FROM VaultEntry WHERE chain='nvidia'")
  .all() as Array<{ id: string; pub: string | null; encPriv: string; privIv: string; privTag: string; status: string; verifyNote: string }>;

interface BrainKey {
  fingerprint: string;
  key: string; // בזיכרון בלבד — נחתם מיד
  oldStatus: string;
  oldNote: string;
}
const brainKeys: BrainKey[] = [];
for (const r of rows) {
  const plain = openGcm(master, r.encPriv, r.privIv, r.privTag);
  const fp = "nv-fp:" + crypto.createHash("sha256").update(plain).digest("hex").slice(0, 16);
  if (r.pub && r.pub.startsWith("nv-fp:") && r.pub !== fp) {
    throw new Error(`fingerprint mismatch for ${r.id} — vault tampered?`);
  }
  brainKeys.push({ fingerprint: fp, key: plain, oldStatus: r.status, oldNote: r.verifyNote });
}
console.log(`[2] ${brainKeys.length} NVIDIA keys decrypted; fingerprints verified against vault pub-field`);
master = null; // ה-master לא נדרש עוד — מקופל מיד

// ─── 3. אימות חי (האמת של 1-token chat — לא /v1/models הציבורי) ───
async function probe(key: string): Promise<{ live: boolean; code: number | string }> {
  try {
    const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-oss-20b",
        messages: [{ role: "user", content: "1" }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    return { live: res.ok, code: res.status };
  } catch (e) {
    return { live: false, code: e instanceof Error ? e.message.slice(0, 40) : "err" };
  }
}

const probed: Array<{ fingerprint: string; live: boolean; code: number | string }> = [];
for (const bk of brainKeys) {
  const p = await probe(bk.key);
  probed.push({ fingerprint: bk.fingerprint, ...p });
}
for (const p of probed) {
  console.log(`[3] probe ${p.fingerprint} → ${p.live ? "LIVE" : "not-live"} (${p.code})`);
}

// ─── 4. אטימה בבית: WEAVE NetworkKey-derivation (Prisma) ───
const { keccak256, toUtf8Bytes } = await import("ethers");
const nk = await db.networkKey.findUnique({ where: { id: "weave-network" } });
if (!nk?.devKeyHex) throw new Error("WEAVE network key not found — run the seal import first");

// אותה גזירה כמו ה-DAEMONs: keccak256("weave-daemon/v1:weave-brain:<netkey>")
const brainKek = keccak256(toUtf8Bytes(`weave-daemon/v1:weave-brain:${nk.devKeyHex}`));
const brainKekBuf = Buffer.from(brainKek.slice(2), "hex");

// dedup by fingerprint — אותו מפתח לא נכנס פעמיים (חוק הכספת)
const existing = new Set((await db.brainKey.findMany()).map((r: { fingerprint: string }) => r.fingerprint));
let sealed = 0;
for (const bk of brainKeys) {
  if (existing.has(bk.fingerprint)) {
    console.log(`[4] ${bk.fingerprint} — already sealed at home, skip`);
    continue;
  }
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", brainKekBuf, iv);
  const ct = Buffer.concat([c.update(bk.key, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  const p = probed.find((x) => x.fingerprint === bk.fingerprint)!;
  await db.brainKey.create({
    data: {
      id: `brain-${bk.fingerprint.slice(7)}`,
      fingerprint: bk.fingerprint,
      encKey: ct.toString("hex"),
      keyIv: iv.toString("hex"),
      keyTag: tag.toString("hex"),
      status: p.live ? "verified" : "unverified",
      lastCode: String(p.code),
      verifiedAt: p.live ? new Date() : null,
      cooldownUntil: null,
    },
  });
  sealed++;
  bk.key = ""; // מחיקה מיידית מהזיכרון
}
console.log(`[4] sealed ${sealed} new brain keys at home (AES-256-GCM under network-key derivation)`);

const total = await db.brainKey.count();
const live = await db.brainKey.count({ where: { status: "verified" } });
console.log(`[done] home brain pool: ${total} keys · ${live} verified-live · zero secrets printed`);
old.close();
