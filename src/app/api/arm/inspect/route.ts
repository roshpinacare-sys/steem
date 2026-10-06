// ─────────────────────────────────────────────────────────────────────
// /api/arm/inspect — רופא-המפתחות (r136). התשובה ל"הדבקתי וזה לא
// עובד ולא יודע מה זה".
//
// המפעיל מדביק כל ערך סוד — ומקבל באותה שנייה אבחנה מדויקת:
//   · מה הערך שבידו (WIF או סיסמת-אב)
//   · לאילו תפקידים באילו שרשראות הוא שולט — נשפט מול הרשויות
//     החיות בשרשרת עצמה (steem · hive · blurt), ביט מול ביט
//   · האם הוא פותח את כספת-הארנק (התאמת-חותמה)
//   · ומה הצעד הנכון איתו — בשפה פשוטה
//
// אבטחה: הערך חי בזיכרון-הבקשה בלבד — לא נשמר, לא נכתב, לא נכנס
// ללוג, ולא חוזר בשום תשובה. האבחנה היא התשובה היחידה.
// מגבלת-קצב: 10 אבחנות לשעה לכל IP.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import steemLibRaw from "steem";
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { fetchAuthoritiesAllChains } from "@/lib/live/authorities";
import { OPERATOR_ACCOUNT } from "@/lib/operator-auth";

interface SteemAuth {
  auth: { toWif(account: string, password: string, role: string): string; wifToPublic(wif: string): string };
}
const steemLib = steemLibRaw as unknown as SteemAuth;

export const dynamic = "force-dynamic";

const hits = new Map<string, number[]>();
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60 * 60 * 1000;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (list.length >= RATE_LIMIT) return true;
  list.push(now);
  hits.set(ip, list);
  return false;
}

const HOME = "/home/z/my-project";
const WALLET_DB = path.join(HOME, "db", "wallet-vault.db");
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };

interface KeySeal {
  pub: string;
}

/** האם קיימת חותמת-כספת תחת הפומבי הזה (יכולת-פתיחה בלבד — שום דבר לא נפתח כאן) */
function vaultSealExists(controlPub: string): boolean | null {
  try {
    if (!fs.existsSync(WALLET_DB)) return null;
    const nodeRequire = createRequire(path.join(HOME, "package.json"));
    const { DatabaseSync } = nodeRequire("node:sqlite") as {
      DatabaseSync: new (p: string, o?: { readOnly?: boolean }) => {
        prepare(q: string): { get(...a: unknown[]): Record<string, unknown> | undefined };
      };
    };
    const db = new DatabaseSync(WALLET_DB, { readOnly: true });
    const cfgRow = db.prepare("SELECT keySeals FROM GateConfig WHERE id = 'gate'").get() as
      | { keySeals: string }
      | undefined;
    if (!cfgRow?.keySeals) return null;
    const seals = JSON.parse(cfgRow.keySeals) as KeySeal[];
    return seals.some((s) => s.pub === controlPub);
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "local";
  if (rateLimited(ip)) {
    return NextResponse.json(
      { ok: false, error: "rate-limited", detail: "10 אבחנות לשעה — נסה שוב מאוחר יותר" },
      { status: 429 },
    );
  }

  let value = "";
  try {
    const body = (await req.json()) as { value?: unknown };
    value = typeof body.value === "string" ? body.value.trim() : "";
  } catch {
    return NextResponse.json({ ok: false, error: "bad-body" }, { status: 400 });
  }
  if (!value || value.length < 8 || value.length > 200) {
    return NextResponse.json(
      { ok: false, error: "format", detail: "הערך קצר מדי או ארוך מדי לאבחנה. שום דבר לא נשמר." },
      { status: 400 },
    );
  }

  // הרשויות החיות של המפקד — שלוש-השרשראות
  const auths = await fetchAuthoritiesAllChains(OPERATOR_ACCOUNT);

  const looksLikeWif = /^[5JKL][1-9A-HJ-NP-Za-km-z]{39,59}$/.test(value);
  const candidates: { label: string; pub: string }[] = [];

  if (looksLikeWif) {
    try {
      candidates.push({ label: "WIF ישיר", pub: steemLib.auth.wifToPublic(value) });
    } catch {
      return NextResponse.json(
        { ok: false, error: "bad-wif", detail: "נראה כמו WIF אך בדיקת-checksum נכשלה — כנראה קלט פגום. שום דבר לא נשמר." },
        { status: 400 },
      );
    }
  } else {
    // סיסמת-אב — גזירת כל התפקידים של המפקד (תקן Steemit)
    for (const role of ["owner", "active", "posting", "memo"] as const) {
      try {
        const wif = steemLib.auth.toWif(OPERATOR_ACCOUNT, value, role);
        candidates.push({ label: `סיסמת-אב → תפקיד ${role}`, pub: steemLib.auth.wifToPublic(wif) });
      } catch {
        /* גזירה כושלת — ממשיכים */
      }
    }
  }

  // השיפוט — כל נגזרת מול כל רשות חיה
  const verdicts: { chain: string; role: string; matched: boolean; source: string }[] = [];
  for (const auth of auths) {
    if (!auth.ok) {
      for (const role of ["owner", "active", "posting", "memo"]) {
        verdicts.push({ chain: auth.chain, role, matched: false, source: `שרשרת לא נקראה (${auth.detail ?? "?"})` });
      }
      continue;
    }
    for (const r of auth.roles) {
      const hit = candidates.find((c) => c.pub === r.pub);
      verdicts.push({
        chain: auth.chain,
        role: r.role,
        matched: Boolean(hit),
        source: hit ? hit.label : "אין התאמה מהערך שהודבק",
      });
    }
  }

  const matched = verdicts.filter((v) => v.matched);
  // יכולת-פתיחת-כספת: ה-KEK נגזר מה-WIF-שליטה (ה-active). אם לא הדבקת WIF
  // ישיר — ה-control הוא הנגזרת מסיסמת-האב לתפקיד active.
  let controlPub = "";
  if (looksLikeWif) {
    controlPub = candidates[0]?.pub ?? "";
  } else {
    try {
      controlPub = steemLib.auth.wifToPublic(steemLib.auth.toWif(OPERATOR_ACCOUNT, value, "active"));
    } catch {
      controlPub = "";
    }
  }
  const opensVault = controlPub ? vaultSealExists(controlPub) : null;

  const activeMatch = matched.some((v) => v.chain === "steem" && v.role === "active");
  const ownerMatch = matched.some((v) => v.chain === "steem" && v.role === "owner");

  let guidanceHe: string;
  if (activeMatch && opensVault === true) {
    guidanceHe =
      "יש בידך את מפתח-השליטה המלא — הוא פותח את הכספת ומחמש את הכל. מעתה אין צורך להדביק כלום: גוף ריק ל-/api/arm/all שואב את השליטה מכספת הסוכנים ומעיר את הרשת במחזור אחד.";
  } else if (activeMatch) {
    guidanceHe =
      "יש בידך את ה-active של @headcorner — המפתח שחותם עסקאות. מעתה אין צורך להדביק כלום: גוף ריק ל-/api/arm/all שואב את השליטה מכספת הסוכנים.";
  } else if (ownerMatch && !activeMatch) {
    guidanceHe =
      "יש בידך את מפתח-ה-owner — מפתח-הזהות העליון. הוא מוכיח שהחשבון שלך אבל לא חותם עסקאות ולא פותח את הכספת. החימוש כבר לא ממתין לך: הסוכנים שואבים את ה-active מכספת הסוכנים בעצמם.";
  } else if (matched.length > 0) {
    guidanceHe =
      "הערך שבידך שולט בתפקידים המפורטים למטה — אך לא ב-active של @headcorner. לחימוש מלא אין צורך בהדבקה: גוף ריק ל-/api/arm/all שואב את השליטה מכספת הסוכנים.";
  } else {
    guidanceHe =
      "הערך שהודבק אינו מתאים לאף רשות חיה של @headcorner בשלוש-השרשראות — כנראה סיסמה/מפתח של דבר אחר. שום דבר לא נשמר ושום דבר לא השתנה.";
  }

  return NextResponse.json({
    ok: true,
    valueKind: looksLikeWif ? "wif" : "password",
    matchedCount: matched.length,
    opensVault,
    verdicts,
    guidanceHe,
    noteHe: "הערך חי בזיכרון-הבקשה בלבד — לא נשמר, לא נכתב, לא בלוג. האבחנה היחידה שנשארת היא פסק-הדין למעלה.",
  });
}
