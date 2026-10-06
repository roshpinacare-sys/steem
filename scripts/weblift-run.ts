#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────
// WEBLIFT-RUN (R120) — הרמת תוכן ריבוני מהכספת אל השרשרת.
//
// הרקע (חוק הסנדבוקס-הנופל, שכבה 5): הכספת המקומית של רשת-האחסון
// (sovereign/web/) נמחקה בנפילת הסשן — החבילות שוחזרו מהיסטוריית
// הגיט, אבל הענן מעולם לא העלה את הצ׳אנקים (0 מתוך 12,860 תווים
// על השרשרת). עמוד המשחקים טען "הכול זורם מהרשת" — שקר חתום.
//
// הריפוי: להפוך את הטענה לאמת — להעלות את הבייטים בפועל.
//
// הנתיב הריבוני (חוקי-ברזל):
//   1. כספת: סיסמת-האב → active-STEEM חי → חותמת → מפתח-אב →
//      WIF-posting של חשבון העוגן (cashmachine). זיכרון-הרצה בלבד —
//      לא נכתב, לא מודפס, לא נכנס ללוג, לא חוזר בשום פלט.
//   2. השרשרת השופטת: הפומבי הנגזר חייב להתאים לרשות ה-posting
//      החיה של החשבון ב-RPC הציבורי — לפני כל שידור. אי-התאמה = סירוב.
//   3. הסוכן המוכח: scripts/web-publish.ts (R50/R51 — idempotent,
//      RC-gated, chain-aware) מוזנק כתהליך-בן עם ה-WIF ב-env בלבד.
//
// הרצה: node scripts/weblift-run.ts   (Node ≥ v24 — node:sqlite לכספת)
// ─────────────────────────────────────────────────────────────────────

import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import { createRequire } from "node:module";

const HOME = "/home/z/my-project";
const ACCOUNT = "cashmachine";
const STEEM_RPC = "https://api.steemit.com";

// כספת — ייבוא יחסי (Node v24 מפשט טיפוסים בזמן-ריצה)
const nodeRequire = createRequire(path.join(HOME, "package.json"));
// @ts-ignore — Node v24 (type-stripping) מחייב סיומת .ts בייבוא יחסי בזמן-ריצה;
// tsc תחת moduleResolution=bundler אוסר זאת (TS5097) — מדוכא במקום לשנות זמן-ריצה.
const { openVaultKey } = (await import("../src/lib/dex/wallet-vault.ts")) as {
  openVaultKey: (chain: "steem", account: string, role: string) => {
    ok: boolean; wif?: string; pub?: string; entryPub?: string; detail?: string;
  };
};

function log(msg: string): void {
  console.log(`[weblift-run ${new Date().toISOString()}] ${msg}`);
}

// ── 1) הכספת ────────────────────────────────────────────────────────
log(`פותח כספת: steem/${ACCOUNT}/posting …`);
const v = openVaultKey("steem", ACCOUNT, "posting");
if (!v.ok || !v.wif || !v.pub) {
  console.error(`VAULT-REFUSED: ${v.detail}`);
  process.exit(2);
}
log(`כספת נפתחה ✓ (${v.detail}) — פומבי נגזר ${v.pub.slice(0, 12)}… (לא מודפס מעולם)`);

// ── 2) השרשרת השופטת — הרשות החיה מול הנגזרת ─────────────────────────
let chainPub: string;
try {
  const res = await fetch(STEEM_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "condenser_api.get_accounts",
      params: [[ACCOUNT]],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await res.json()) as {
    result?: Array<{ posting?: { key_auths?: Array<[string, number]> } }>;
  };
  const kp = j.result?.[0]?.posting?.key_auths?.[0]?.[0];
  if (!kp) throw new Error("אין רשות posting בתשובת ה-RPC");
  chainPub = kp;
} catch (e) {
  console.error(`CHAIN-JUDGE-UNREACHABLE: ${String((e as Error).message ?? e)}`);
  process.exit(3);
}
if (chainPub !== v.pub) {
  console.error(
    `CHAIN-JUDGE-REFUSED: הפומבי מהכספת (${v.pub.slice(0, 12)}…) אינו הרשות החיה (${chainPub.slice(0, 12)}…) — לא משדרים`
  );
  process.exit(4);
}
log(`השרשרת שופטת: הרשות החיה ${chainPub.slice(0, 12)}… ≡ הנגזרת ✓`);

// ── 3) שימור זהות-הגיט (הסוכן כותב user.name בעצמו — משחזרים אחריו) ──
const gitCfg = (k: string): string => {
  try {
    return execFileSync("git", ["config", "--get", k], { cwd: HOME, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};
const savedName = gitCfg("user.name");
const savedEmail = gitCfg("user.email");

// ── 4) הסוכן המוכח — תהליך-בן, ה-WIF ב-env בלבד ───────────────────────
log("מזניק את סוכן web-publish (idempotent · RC-gated) …");
const child = spawn("bun", ["scripts/web-publish.ts"], {
  cwd: HOME,
  env: { ...process.env, WEAVE_STEEM_WIF: v.wif, WEAVE_STEEM_ACCOUNT: ACCOUNT },
  stdio: ["ignore", "inherit", "inherit"],
});
const code: number = await new Promise((resolve) => {
  child.on("close", (c) => resolve(c ?? 1));
  child.on("error", () => resolve(1));
});

// ── 5) שחזור זהות-הגיט ────────────────────────────────────────────────
try {
  if (savedName) execFileSync("git", ["config", "user.name", savedName], { cwd: HOME });
  if (savedEmail) execFileSync("git", ["config", "user.email", savedEmail], { cwd: HOME });
} catch {
  /* לא קריטי */
}

log(`סוכן הסתיים בקוד ${code}`);
process.exit(code);
