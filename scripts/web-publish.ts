#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// SAOS WEB · web-publish v2 — סוכן הענן של רשת-האחסון הריבונית.
//
// מה שנמדד בפועל (probe1/probe2, 2026-09-19 + R51):
//   · comment ב-Steem: בסיס 976M RC + 320k/תו — מסלול מת.
//   · custom_json ב-Steem: בסיס ~65M + ~320k לתו — המסלול החי.
//   · Hive: 509k/תו — יקר יותר. Steem הוא נתיב הבייטים; Hive רשת-ביטחון לחותם.
//   · ל-Steem יש מגבלת 100 רשומות לקריאת היסטוריה (נמדד חי ב-R51:
//     "upper limit is 100") — העימוד חייב להיות chain-aware.
//
// הארכיטקטורה על השרשרת (חשבון העוגן, סמכות posting):
//   · מניפסט: custom_json id=saos.web.v1 — חותם-sha256 של החבילה.
//     הולך ראשון. Steem ואם אין מנה — Hive (רשת-ביטחון).
//   · צ׳אנקים: custom_json id=saos.web.c.v1 {h,i,d} — הבייטים עצמם,
//     בגודל שנקבע לפי המנה החיה בעת השידור (adaptive). מטען קומפקטי
//     בכוונה (R51: כל תו עולה ~320k RC — שדה v הושמט; ה-op-id מזהה).
//   · שלמות = join(d) לפי רצף קונטיגואלי 1..k ⇒ אורך s + sha256.
//
// v2 (R51):
//   · לולאת-צ׳אנקים בריצה — כשהמאגר עמוס אחרי צבירה שקטה, כמה
//     צ׳אנקים עולים באותה ריצה עד ריקון התקציב (עד 10 לריצה).
//   · רצף קונטיגואלי — האינדקס וההיסט של הצ׳אנק הבא נגזרים מהקידומת
//     המוכחת 1..k בלבד, לא מסכום-אמון.
//   · חותם-כפילות — כשהחבילה שלמה והחותם רק על Hive, חותמים גם
//     על Steem (עמידות דו-שרשרתית, אחרי שהבייטים כבר בטוחים).
//   · אומדן-RC כולל מרווח — החישוב הכן לא מבטיח יותר מהמציאות.
//
// אידמפוטנטי לחלוטין: סריקת היסטוריה לפני כל שידור; דילוג-כנה כשאין
// RC; הקומיט מתעדכן רק בריצה חיה. ההיסטוריה השופטת היחידה: השרשרת.
// ─────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import {
  WEB_OP_ID,
  WEB_CHUNK_OP_ID,
  WEB_PROTOCOL,
  WEB_ACCOUNT,
  RC_MODEL,
  deepScanChain,
  contiguousPrefix,
  sha256Hex,
  type WebInboxJob,
  type WebManifest,
  type WebScanMeta,
  type ChainChunkRaw,
} from "@/lib/web/netstore";
import { steemBroadcast, hiveBroadcast, rpcV4, STEEM_RPC_NODES, HIVE_RPC } from "@/lib/weave/graphene";
import type { GrapheneOperation } from "steem";

const ROOT = path.resolve(__dirname, "..");
const INBOX = path.join(ROOT, "sovereign", "web", "inbox");
const MANIFESTS = path.join(ROOT, "sovereign", "web", "manifests");
const PACKAGES = path.join(ROOT, "sovereign", "web", "packages");

const DRY = process.argv.includes("--dry");
const VERIFY_ONLY = process.argv.includes("--verify-only");
const WIF = (process.env.WEAVE_STEEM_WIF || "").trim();
const ACCOUNT = WEB_ACCOUNT;

/** רצפת בטיחות: לא שולחים את הרשת מתחת לזה */
const RC_RESERVE = Number(process.env.WEB_RC_RESERVE || 20e6);
/** מודל המחיר שנלמד ממדידות probe2: cost ≈ BASE + K × אורך ה-json */
const RC_BASE = Number(process.env.WEB_RC_BASE || 65e6);
const RC_PER_CHAR = Number(process.env.WEB_RC_PER_CHAR || 320_000);
/** תוספת-בטיחות על האומדן */
const EST_MARGIN_STEEM = 1.15;
const EST_MARGIN_HIVE = 1.08; // מחירי Hive נמדדו ישירות ב-probe2 — מרווח קטן

let estBase = RC_BASE;
let estPerChar = RC_PER_CHAR;

/** תקרת-ריצה: עד 10 צ׳אנקים לריצה, ולא יותר מ-15 דקות עבודה */
const MAX_CHUNKS_PER_RUN = 10;
const RUN_DEADLINE_MS = 15 * 60_000;
const runStartedAt = Date.now();

function timeLeft(): number {
  return RUN_DEADLINE_MS - (Date.now() - runStartedAt);
}

// ── עזרי ריצה ────────────────────────────────────────────────────────

function log(msg: string): void {
  console.log(`[web-publish ${new Date().toISOString()}] ${msg}`);
}

function sh(cmd: string): string {
  return execSync(cmd, { cwd: ROOT, encoding: "utf8", timeout: 90_000, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rpcRead<T>(method: string, params: unknown): Promise<T | null> {
  for (const node of STEEM_RPC_NODES) {
    try {
      return await rpcV4<T>(node, method, params, 20_000);
    } catch {
      /* הצומת הבא */
    }
  }
  return null;
}

async function hiveRead<T>(method: string, params: unknown): Promise<T | null> {
  try {
    return await rpcV4<T>(HIVE_RPC, method, params, 20_000);
  } catch {
    return null;
  }
}

// ── מצב ה-RC החי — שתי השרשראות ──────────────────────────────────────

interface RcAccount {
  max_rc: string | number;
  rc_manabar: { current_mana: string | number; last_update_time: number };
}

async function liveMana(): Promise<{ mana: number; max: number } | null> {
  return liveManaOn("steem");
}

async function liveManaOn(chain: "steem" | "hive"): Promise<{ mana: number; max: number } | null> {
  const res = await (chain === "steem"
    ? rpcRead<{ rc_accounts: RcAccount[] }>("rc_api.find_rc_accounts", { accounts: [ACCOUNT] })
    : hiveRead<{ rc_accounts: RcAccount[] }>("rc_api.find_rc_accounts", { accounts: [ACCOUNT] }));
  const a = res?.rc_accounts?.[0];
  if (!a) return null;
  let nowSec = Math.floor(Date.now() / 1000);
  try {
    const dgp = await (chain === "steem"
      ? rpcRead<{ time: string }>("condenser_api.get_dynamic_global_properties", [])
      : hiveRead<{ time: string }>("condenser_api.get_dynamic_global_properties", []));
    if (dgp?.time) nowSec = Math.floor(new Date(dgp.time + "Z").getTime() / 1000);
  } catch {
    /* שעון מקומי */
  }
  const max = Number(a.max_rc);
  const lut = Number(a.rc_manabar.last_update_time);
  const mana = Math.min(max, Number(a.rc_manabar.current_mana) + Math.max(0, nowSec - lut) * (max / 432_000));
  return { mana: Math.round(mana), max };
}

// ── סריקת ההיסטוריה — עמוקה, chain-aware ──────────────────────────────

interface HistoryScan {
  manifestOp: { block?: number; txid?: string } | null;
  chunks: Array<{ i: number; chars: number; block?: number; txid?: string }>;
  /** הגופים הגולמיים לשלב האימות הסופי */
  rawChunkMap: Map<number, ChainChunkRaw>;
  scan: WebScanMeta;
}

/**
 * סריקה על-גבי deepScanChain של הרשת: עימוד chain-aware (Steem 100,
 * Hive 1,000 — נמדד חי ב-R51), התקדמות עד תקציב-הרשומות.
 */
async function scanChain(hash: string, chain: "steem" | "hive" = "steem", entries = 2000): Promise<HistoryScan> {
  const deep = await deepScanChain(chain, { entries });
  const entry = deep.byHash.get(hash);
  return {
    manifestOp: entry?.manifest?.block
      ? { block: entry.manifest.block, txid: entry.manifest.txid }
      : null,
    chunks: entry
      ? [...entry.chunks.values()].sort((a, b) => a.i - b.i).map((c) => ({ i: c.i, chars: c.chars, block: c.block, txid: c.txid }))
      : [],
    rawChunkMap: entry ? entry.chunks : new Map<number, ChainChunkRaw>(),
    scan: deep.meta,
  };
}

// ── שידור עם שער-RC לומד ─────────────────────────────────────────────

function estimateCost(jsonLen: number, chain: "steem" | "hive" = "steem"): number {
  // מודל למד ממדידות probe2: Steem 65M+320k/תו · Hive 81M+509k/תו
  const perChar = chain === "hive" ? Math.max(estPerChar, 509_000) : estPerChar;
  const margin = chain === "hive" ? EST_MARGIN_HIVE : EST_MARGIN_STEEM;
  return Math.round((estBase + perChar * jsonLen) * margin);
}

interface BroadcastOutcome {
  ok: boolean;
  skipped?: string;
}

async function guardedBroadcast(
  ops: GrapheneOperation[],
  jsonLen: number,
  label: string,
  chain: "steem" | "hive" = "steem"
): Promise<BroadcastOutcome> {
  if (DRY || VERIFY_ONLY || !WIF) {
    return { ok: false, skipped: DRY ? "dry" : VERIFY_ONLY ? "verify-only" : "no-wif" };
  }
  const m = await liveManaOn(chain);
  if (!m) return { ok: false, skipped: `rc-unreachable (${chain})` };
  const need = estimateCost(jsonLen, chain);
  if (m.mana < RC_RESERVE + need) {
    return {
      ok: false,
      skipped: `rc-budget (${chain}: live=${(m.mana / 1e6).toFixed(0)}M < reserve=${(RC_RESERVE / 1e6).toFixed(0)}M + est=${(need / 1e6).toFixed(0)}M — דילוג-כנה, ה-cron ינסה שוב)`,
    };
  }
  const before = m.mana;
  const res = chain === "steem" ? await steemBroadcast(ops, WIF) : await hiveBroadcast(ops, WIF);
  const accepted = chain === "steem" ? !!res.txid : (res as { accepted?: boolean }).accepted === true;
  if (!accepted) {
    const note = res.note ?? "no-confirmation";
    const mm = /needs (\d+) RC/.exec(note);
    if (mm) {
      const real = Number(mm[1]);
      estBase = Math.max(1e6, Math.round(real - estPerChar * jsonLen));
      log(`  · מחיר אמיתי מהדחיה (${chain}): ${real} RC ⇒ בסיס נלמד ${(estBase / 1e6).toFixed(0)}M`);
    }
    return { ok: false, skipped: `broadcast-rejected (${chain}): ${note.slice(0, 140)}` };
  }
  const after = await liveManaOn(chain);
  if (after) {
    const cost = Math.max(0, before - after.mana);
    if (cost > 0) {
      estBase = Math.max(1e6, cost - estPerChar * jsonLen);
      log(`  · עלות נמדדה (${chain}): ${(cost / 1e6).toFixed(1)}M RC (בסיס נלמד ${(estBase / 1e6).toFixed(0)}M)`);
    }
  }
  log(`  · ${label} שודר ✓ (${chain})`);
  return { ok: true };
}

// ── בניית הפעולות ─────────────────────────────────────────────────────

function manifestOp(manifest: WebManifest): { op: GrapheneOperation; jsonLen: number } {
  // החותם על השרשרת — קומפקטי בכוונה: כל תו עולה ~0.3-0.5M RC.
  // ה-id (saos.web.v1) מזהה את הפרוטוקול — אין צורך לשאוח אותו גם בגוף.
  const payload = {
    name: manifest.name,
    sha256: manifest.sha256,
    bytes: manifest.bytes,
    mime: manifest.mime,
    entry: manifest.entry || "",
    s: manifest.b64len,
    at: manifest.at.replace(/\.\d{3}Z$/, "Z"),
  };
  const json = JSON.stringify(payload);
  return {
    op: ["custom_json", {
      required_auths: [],
      required_posting_auths: [ACCOUNT],
      id: WEB_OP_ID,
      json,
    }],
    jsonLen: json.length,
  };
}

function chunkOp(hash: string, i: number, data: string): { op: GrapheneOperation; jsonLen: number } {
  // מטען קומפקטי (R51): שדה v הושמט — 8 תווים × ~320k RC לכל צ׳אנק.
  // הקוראים (netstore + הסוכן) מזהים לפי op-id ומפרשים h/i/d בלבד.
  const json = JSON.stringify({ h: hash, i, d: data });
  return {
    op: ["custom_json", {
      required_auths: [],
      required_posting_auths: [ACCOUNT],
      id: WEB_CHUNK_OP_ID,
      json,
    }],
    jsonLen: json.length,
  };
}

/**
 * גודל צ׳אנק שהמנה החיה מרשה — האומדן כולל את מרווח-הבטיחות
 * (R51: בלי המרווח החישוב הבטיח יותר מהמציאות והריצה דילגה לחינם).
 *
 * R120 · תיקון-שורש חי: affordableChars חישבה תקציב לתווי-המטען (d)
 * בלבד — אבל guardedBroadcast מודד את אורך ה-JSON המלא ({"h":64-hex,
 * "i":N,"d":…} ≈ 87 תווי עטיפה). הפער (~32M RC אחרי מרווח) גרם לכך
 * שגם במנה מלאה 100% האומדן עבר את התקציב והסוכן דילג לנצח — זה שורש
 * "הצ׳אנקים שלא עלו אף-פעם". העטיפה נשמרת עכשיו מראש בתקציב.
 */
const CHUNK_WRAPPER_CHARS = 96; // {"h":"<64 hex>","i":<n>,"d":""} — במרווח למפתח גדול

function affordableChars(mana: number, remaining: number): number {
  const margin = EST_MARGIN_STEEM;
  const wrapperCost = (estBase + estPerChar * CHUNK_WRAPPER_CHARS) * margin;
  const budget = Math.floor((mana - RC_RESERVE - wrapperCost) / (estPerChar * margin));
  return Math.max(0, Math.min(remaining, Math.min(budget, RC_MODEL.chunkCharsMax)));
}

// ── רשומת המניפסט בריפו ──────────────────────────────────────────────

interface RepoRecord {
  manifest: WebManifest;
  status: "pending-seal" | "partial" | "complete";
  chain: {
    manifestOp?: { block?: number | null; txid?: string | null } | null;
    chunks?: Array<{ i: number; chars: number; block?: number | null; txid?: string | null }>;
  };
  inboxJob?: WebInboxJob;
  publishedBy?: string;
  verifiedAt?: string;
  note?: string;
}

function writeRecord(rec: RepoRecord): void {
  fs.mkdirSync(MANIFESTS, { recursive: true });
  fs.writeFileSync(path.join(MANIFESTS, `${rec.manifest.sha256}.json`), JSON.stringify(rec, null, 2) + "\n");
}

function readRecord(hash: string): RepoRecord | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(MANIFESTS, `${hash}.json`), "utf8")) as RepoRecord;
  } catch {
    return null;
  }
}

function writeRecordIfLive(rec: RepoRecord): void {
  if (!DRY && !VERIFY_ONLY) writeRecord(rec);
}

// ── פרסום חבילה אחת ──────────────────────────────────────────────────

async function publishJob(job: WebInboxJob): Promise<"complete" | "progress" | "skipped"> {
  const hash = job.sha256;
  log(`חבילה: ${job.name} · ${job.bytes}B · sha256=${hash.slice(0, 16)}…`);

  const b64Path = path.join(INBOX, hash, "package.b64");
  if (!fs.existsSync(b64Path)) {
    log("  package.b64 חסר — דילוג");
    return "skipped";
  }
  const b64 = fs.readFileSync(b64Path, "utf8").trim();
  const bytes = Buffer.from(b64, "base64");
  if (sha256Hex(bytes) !== hash || bytes.length !== job.bytes) {
    log("  שלמות נכשלה — דילוג");
    return "skipped";
  }

  // עותק כתובת-חשיש למשמרת (ההגשה מאמתת אותו מול החותם שעל השרשרת)
  const binPath = path.join(PACKAGES, `${hash}.bin`);
  if (!fs.existsSync(binPath)) {
    fs.mkdirSync(PACKAGES, { recursive: true });
    fs.writeFileSync(binPath, bytes);
  }

  const manifest: WebManifest = {
    v: 1,
    protocol: WEB_PROTOCOL,
    name: job.name,
    sha256: hash,
    bytes: job.bytes,
    mime: job.mime,
    entry: job.entry,
    b64len: b64.length,
    chunkSize: 0, // גדלים אדפטיביים — השלמות נקבעת באורך+חשיש, לא בספירה
    mode: "chunks",
    by: ACCOUNT,
    at: job.createdAt || new Date().toISOString(),
  };

  const rec: RepoRecord = readRecord(hash) || {
    manifest,
    status: "pending-seal",
    chain: { manifestOp: null, chunks: [] },
    inboxJob: job,
    publishedBy: "cloud/web-publish",
  };
  // רענון שדות המשימה
  rec.inboxJob = job;

  const chain = await scanChain(hash, "steem");
  const chainHive = await scanChain(hash, "hive");
  const prefix0 = contiguousPrefix([...chain.rawChunkMap.values()].map((c) => ({ i: c.i, chars: c.chars })));
  const sealed = chain.manifestOp || chainHive.manifestOp;
  log(
    `  שרשרת: חותם steem ${chain.manifestOp ? "✓" : "—"} · hive ${chainHive.manifestOp ? "✓" : "—"} · רצף ${prefix0.count} צ׳אנקים · תווים ${prefix0.chars}/${b64.length} · סריקה ${chain.scan.entriesScanned}/${chain.scan.entriesTotal ?? "?"}`
  );

  // 1. החותם (המניפסט) — הולך ראשון, וברשת-ביטחון דו-שרשרתית:
  //    Steem זול לבייט אבל מרוקן; אם אין לו מנה — החותם נחתם על Hive
  //    (שתי השרשראות ציבוריות; הצ׳אנקים עצמם נודדים ל-Steem בלבד).
  if (!sealed) {
    const { op, jsonLen } = manifestOp(manifest);
    let out = await guardedBroadcast([op], jsonLen, "מניפסט", "steem");
    let onChain: "steem" | "hive" = "steem";
    if (!out.ok && /rc-budget/.test(out.skipped || "")) {
      log("  · Steem בדילוג-RC — מנסים לחתום על Hive (רשת-ביטחון)");
      out = await guardedBroadcast([op], jsonLen, "מניפסם", "hive");
      onChain = "hive";
    }
    if (!out.ok) {
      rec.note = `מניפסט: ${out.skipped}`;
      writeRecordIfLive(rec);
      log(`  ⏳ ${rec.note}`);
      return "progress";
    }
    // אימות מההיסטוריה — השופטת היחידה
    let ok = false;
    for (let t = 0; t < 6 && !ok; t++) {
      await sleep(4000);
      const againS = await scanChain(hash, "steem", 600);
      const againH = await scanChain(hash, "hive", 600);
      const found = againS.manifestOp || againH.manifestOp;
      if (found) {
        rec.chain.manifestOp = found;
        rec.note = `חותם ${againS.manifestOp ? "Steem" : "Hive"} בלוק ${found.block ?? "?"}`;
        ok = true;
      }
    }
    if (!ok) {
      rec.note = `המניפסט שודר (${onChain}) אך טרם נראה בהיסטוריה — נאמת בריצה הבאה`;
      writeRecordIfLive(rec);
      return "progress";
    }
    log(`  · החותם על השרשרת ✓ ${JSON.stringify(rec.chain.manifestOp)}`);
  } else {
    rec.chain.manifestOp = chain.manifestOp || chainHive.manifestOp;
  }
  rec.status = "partial";

  // 2. הצ׳אנקים — לולאה בקצב ה-RC האמיתי: כשהמאגר עמוס, כמה צ׳אנקים
  //    באותה ריצה. הרצף הקונטיגואלי 1..k הוא המקור היחיד ל"מה כבר שם".
  let nextIdx = prefix0.nextMissing;
  let start = prefix0.chars;
  let sent = 0;
  let lastNote = "";

  while (sent < MAX_CHUNKS_PER_RUN && start < b64.length && timeLeft() > 120_000) {
    const m = await liveMana();
    if (!m) {
      lastNote = "RC לא נקרא — דילוג-כנה";
      break;
    }
    const size = affordableChars(m.mana, b64.length - start);
    if (size < RC_MODEL.chunkCharsMin) {
      lastNote = `צ׳אנק ${nextIdx} ממתין ל-RC (מנה ${(m.mana / 1e6).toFixed(0)}M ⇒ נדרש ${(estBase / 1e6).toFixed(0)}M בסיס + ${((RC_MODEL.chunkCharsMin * estPerChar) / 1e6).toFixed(0)}M ל-500 תווים, במרווח)`;
      break;
    }
    const data = b64.slice(start, start + size);
    const { op, jsonLen } = chunkOp(hash, nextIdx, data);
    const out = await guardedBroadcast([op], jsonLen, `צ׳אנק ${nextIdx} (${size} תווים)`);
    if (!out.ok) {
      lastNote = `צ׳אנק ${nextIdx}: ${out.skipped}`;
      break;
    }
    // אימות נחיתה מההיסטוריה — השופטת היחידה (3s לבלוק)
    let landed = false;
    for (let t = 0; t < 4 && !landed; t++) {
      await sleep(3000);
      const again = await scanChain(hash, "steem", 600);
      if (again.rawChunkMap.has(nextIdx)) {
        rec.chain.chunks = again.chunks;
        landed = true;
      }
    }
    if (!landed) {
      lastNote = `צ׳אנק ${nextIdx} שודר אך טרם נראה — נאמת בריצה הבאה`;
      break;
    }
    log(`  · צ׳אנק ${nextIdx} על השרשרת ✓ (${size} תווים · רצף ${nextIdx})`);
    sent++;
    start += size;
    nextIdx++;
  }

  // 3. שלמות? (צ׳אנקים חיים על Steem בלבד — הנתיב הזול לבייט)
  const finalScan = await scanChain(hash, "steem");
  const finalHive = await scanChain(hash, "hive");
  const finalPrefix = contiguousPrefix([...finalScan.rawChunkMap.values()].map((c) => ({ i: c.i, chars: c.chars })));
  const finalChars = finalPrefix.chars;
  rec.chain.chunks = finalScan.chunks;
  if (finalScan.manifestOp || finalHive.manifestOp) {
    rec.chain.manifestOp = finalScan.manifestOp || finalHive.manifestOp;
  }
  if (finalChars === b64.length) {
    // הרכבה מסודרת-אינדקס ואימות סופי — sha256 הוא השופט
    const parts = [...finalScan.rawChunkMap.keys()].sort((a, b) => a - b).map((i) => {
      const c = finalScan.rawChunkMap.get(i);
      if (!c) throw new Error(`צ׳אנק ${i} חסר בסריקה — סתירה פנימית`);
      return c.d;
    });
    const gotBytes = Buffer.from(parts.join(""), "base64");
    if (sha256Hex(gotBytes) === hash && gotBytes.length === job.bytes) {
      rec.status = "complete";
      rec.verifiedAt = new Date().toISOString();
      rec.note = "כל הבייטים על השרשרת ומאומתים";
      // 4. חותם-כפילות: אם החותם רק על Hive — חותמים גם על Steem
      //    (רק אחרי שהבייטים כבר שלמים: לעולם לא מתחרה על תקציב ההגירה)
      if (!finalScan.manifestOp && finalHive.manifestOp) {
        const { op, jsonLen } = manifestOp(manifest);
        const sealOut = await guardedBroadcast([op], jsonLen, "חותם-כפילות Steem", "steem");
        if (sealOut.ok) {
          for (let t = 0; t < 5; t++) {
            await sleep(3000);
            const again = await scanChain(hash, "steem", 600);
            if (again.manifestOp) {
              rec.chain.manifestOp = again.manifestOp;
              rec.note = "כל הבייטים על השרשרת ומאומתים · חותם כפול: Steem+Hive";
              break;
            }
          }
        } else {
          rec.note = `כל הבייטים על השרשרת · חותם-כפילות Steem: ${sealOut.skipped}`;
        }
      }
      writeRecordIfLive(rec);
      log("  ✓ החבילה שלמה על השרשרת — מקצה לקצה");
      return "complete";
    }
    rec.note = "אימות-סופי נכשל — הריצה הבאה תחזור";
    writeRecordIfLive(rec);
    return "skipped";
  }

  rec.note = sent > 0
    ? `התקדם הריצה: ${sent} צ׳אנקים חדשים · ${finalChars}/${b64.length} תווים ברצף · ${lastNote || "ממשיכים בריצה הבאה"}`
    : lastNote || `מתקדם: ${finalChars}/${b64.length} תווים על השרשרת`;
  writeRecordIfLive(rec);
  log(`  ⏳ ${rec.note}`);
  return "progress";
}

function closeJob(hash: string): void {
  const dir = path.join(INBOX, hash);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

// ── main ─────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  log(`סוכן שידור v2 · חשבון=${ACCOUNT} · dry=${DRY} · verify-only=${VERIFY_ONLY} · wif=${WIF ? "יש" : "אין"}`);

  const m0 = await liveMana();
  if (m0) {
    log(`RC חי: ${(m0.mana / 1e6).toFixed(0)}M / ${(m0.max / 1e6).toFixed(0)}M (${((m0.mana / m0.max) * 100).toFixed(1)}%) · מודל מחיר: בסיס ${(estBase / 1e6).toFixed(0)}M + ${(estPerChar / 1e3).toFixed(0)}k/תו · תקרת-צ׳אנק ${RC_MODEL.chunkCharsMax} תווים · עד ${MAX_CHUNKS_PER_RUN} צ׳אנקים בריצה`);
  }

  if (!fs.existsSync(INBOX)) {
    log("אין דואר נכנס");
    return 0;
  }
  const jobs: WebInboxJob[] = [];
  for (const d of fs.readdirSync(INBOX)) {
    const jp = path.join(INBOX, d, "job.json");
    if (!fs.existsSync(jp)) continue;
    try {
      jobs.push(JSON.parse(fs.readFileSync(jp, "utf8")) as WebInboxJob);
    } catch {
      log(`משימה שחורה בתיקייה ${d}`);
    }
  }
  if (!jobs.length) {
    log("אפס משימות ממתינות");
    return 0;
  }
  log(`${jobs.length} משימות בתור`);

  let completed = 0;
  let progressed = 0;
  for (const job of jobs) {
    const res = await publishJob(job);
    if (res === "complete") {
      closeJob(job.sha256);
      completed++;
    } else if (res === "progress") {
      progressed++;
    }
    const m = await liveMana();
    if (m && m.mana < RC_RESERVE) {
      log(`RC ברצפה (${(m.mana / 1e6).toFixed(0)}M) — עוצרים; ה-cron ימשיך`);
      break;
    }
    if (timeLeft() < 120_000) {
      log("מגבלת-זמן ריצה — עוצרים; ה-cron ימשיך");
      break;
    }
  }

  if (DRY || VERIFY_ONLY) {
    log("דריי — אין גיט");
  } else {
    try {
      // זהות גיט לרצ׳ הענן (לקח הריצה הראשונה: Author identity unknown)
      sh('git config user.name "saos-web-publish"');
      sh('git config user.email "actions@github.com"');
      sh("git add -A sovereign/web");
      const status = sh("git status --porcelain -- sovereign/web");
      if (status.trim() !== "") {
        sh(`git commit -m "web-publish: ${completed} complete · ${progressed} in-progress · ${new Date().toISOString().slice(0, 16)}Z"`);
        // דחיפה עמידה למרוצים: pull-rebase ואז push, עד שני ניסיונות
        let pushedOk = false;
        let lastPushErr = "";
        for (let t = 0; t < 2 && !pushedOk; t++) {
          try {
            sh("git push origin main");
            pushedOk = true;
          } catch (pe) {
            lastPushErr = String(pe).slice(0, 160);
            try {
              sh("git pull --rebase origin main");
            } catch {
              /* הניסיון הבא */
            }
          }
        }
        if (!pushedOk) throw new Error(`push-failed-after-retry: ${lastPushErr}`);
        log("נדחף לריפו הריבוני");
      } else {
        log("אין שינויים לדחיפה");
      }
    } catch (e) {
      log(`שגיאת גיט: ${String(e).slice(0, 300)}`);
      // דילוג-RC כנה אינו כשל-מדינה: המשימות נשארות בתור וה-cron ימשיך.
      // אדום אמיתי רק כשבאמת אבד מצב (הודעה שונה מהדילוגים).
      const benign = /nothing to commit|Author identity/i;
      if (benign.test(String(e))) return 0;
      return 1;
    }
  }
  return 0;
}

process.exit(await main());
