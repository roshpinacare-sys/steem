// ─────────────────────────────────────────────────────────────────────
// /api/web/publish — העלאת חבילה לרשת-האחסון (פעולת-מפעיל) v3.
//
// R55 · שני מסלולי מסירה, הריבוני-המקומי הוא ברירת-המחדל:
//   · deliver=local (ברירת מחדל) — המחסן הריבוני המקומי: הקובץ נבדק
//     (זיפ תקין/גודל/אינדקס) → מאורז-מחדש בדחיסה מקסימלית → נכתב למחסן
//     + מניפסט pending-seal. אפס גיט. אפס ענן. התוכן לעולם לא נוגע בריפו
//     (דרישת המפעיל: משחקים ברשת בלבד). החותם ייחתם במסלול-מפתח עתידי.
//   · deliver=cloud — המסלול הישן: דואר נכנס בריפו → commit+push →
//     סוכן הענן (web-publish.yml) משדר צ׳אנקים ל-Steem בסמכות posting.
//     נדרש בקשה מפורשת — לא ברירת מחדל.
//
// R51: קבלת-קבצי-רשת בודדים (svg/png/json/css/js/md…) בנוסף ל-zip/html,
// ואומדן-הגירה כן (RC + ימים) בתשובה.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile, access } from "fs/promises";
import { execSync } from "child_process";
import path from "path";
import { operatorFromRequest } from "@/lib/operator-auth";
import { dispatchWorkflow } from "@/lib/live/cloud";
import {
  sha256Hex,
  parseZip,
  repackZipMaxDeflate,
  webRepoPaths,
  mimeOf,
  looksLikeSha256,
  estimateMigration,
  probeStorageRc,
  UPLOAD_SINGLE_EXTS,
  type WebInboxJob,
} from "@/lib/web/netstore";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_UPLOAD_BYTES = 400_000; // תקרת מציאות-RC: 400KB לחבילה

function sh(cmd: string): string {
  return execSync(cmd, { cwd: process.cwd(), encoding: "utf8", timeout: 45_000, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function sanitizeName(name: string): string {
  return name.replace(/[^\w.\-\u0590-\u05FF ]+/g, "_").slice(0, 80) || "package";
}

export async function POST(req: NextRequest) {
  // שער-מפעיל: בלי סשן חתום אין העלאה
  if (!operatorFromRequest(req)) {
    return NextResponse.json(
      {
        ok: false,
        locked: true,
        error: "העלאה לרשת-האחסון נעולה. התחבר בשער המפעיל (מפתח active של headcorner) ואז נסה שוב.",
      },
      { status: 401 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "נדרש multipart/form-data עם שדה file" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "לא התקבל קובץ (שדה file)" }, { status: 400 });
  }
  const rawName = file.name || "package";
  // Buffer רחב (ArrayBufferLike) — האריזה-מחדש מחזירה Buffer כללי
  let bytes: Buffer = Buffer.from(await file.arrayBuffer());
  if (bytes.length === 0) {
    return NextResponse.json({ ok: false, error: "קובץ ריק" }, { status: 400 });
  }
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        error: `החבילה גדולה מהתקרה (${bytes.length} > ${MAX_UPLOAD_BYTES} בייטים). תקציב ה-RC של השרשרת אמיתי — פצל או הקטן.`,
      },
      { status: 400 }
    );
  }

  const name = sanitizeName(String(form.get("name") || rawName));
  const ext = rawName.toLowerCase().split(".").pop() || "";
  let mime: string;
  let entry: string | undefined;
  let filesList: string[] = [];
  let repackNote: string | null = null;

  if (ext === "zip") {
    mime = "application/zip";
    try {
      const first = parseZip(bytes);
      filesList = first.map((e) => e.name);
      const hasIndex = first.some((e) => e.name === "index.html" || e.name.endsWith("/index.html"));
      if (!hasIndex) {
        return NextResponse.json(
          { ok: false, error: "ב-zip אין index.html — אין דלת כניסה לחבילה" },
          { status: 400 }
        );
      }
      entry = "index.html";
      // אריזה-מחדש בדחיסה מקסימלית — כל תו שנחסך הוא RC שלא נשרף על השרשרת
      const repack = repackZipMaxDeflate(bytes);
      if (repack.repacked && repack.savedPct > 0.5) {
        repackNote = `אורז מחדש בדחיסה מקסימלית: ${repack.originalBytes}→${repack.bytes.length} בייטים (${repack.savedPct}% חיסכון RC) — התוכן זהה בדיוק`;
        bytes = repack.bytes;
      }
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: `ZIP פגום: ${e instanceof Error ? e.message : "לא ניתן לפענוח"}` },
        { status: 400 }
      );
    }
  } else if (UPLOAD_SINGLE_EXTS.has(ext)) {
    mime = mimeOf(rawName);
    entry = name;
  } else {
    return NextResponse.json(
      {
        ok: false,
        error: "פורמט לא נתמך. קבל: ‎.zip‎ (חבילת אתר/אפליקציה/משחקים) או קובץ-רשת בודד (html/svg/png/jpg/gif/webp/ico/json/txt/md/csv/css/js/mjs/pdf).",
      },
      { status: 400 }
    );
  }

  const hash = sha256Hex(bytes);
  if (!looksLikeSha256(hash)) throw new Error("sha256 לא נוצר");
  const b64len = Math.ceil((bytes.length * 4) / 3);

  const root = process.cwd();
  const paths = webRepoPaths(root);

  // כבר על השרשרת? אמת-מקדימה מהאינדקס (הוודאות הסופית תמיד ב-verify)
  const manifestPath = path.join(paths.manifests, `${hash}.json`);
  if (await exists(manifestPath)) {
    return NextResponse.json(
      { ok: false, alreadyOnChain: true, hash, error: "חבילה זו (אותו sha256) כבר פורסמה לשרשרת" },
      { status: 409 }
    );
  }

  // ── R55 · מסלול ריבוני-מקומי (ברירת מחדל): מחסן + מניפסט pending-seal.
  // אפס גיט — התוכן לא נוגע בריפו. החותם ייחתם במסלול-מפתח של המפעיל.
  const deliver = String(form.get("deliver") || "local").toLowerCase();
  if (deliver !== "cloud") {
    await mkdir(paths.packages, { recursive: true });
    await mkdir(paths.manifests, { recursive: true });
    await writeFile(path.join(paths.packages, `${hash}.bin`), bytes);
    const record = {
      manifest: {
        v: 1,
        protocol: "saos-web/1",
        name,
        sha256: hash,
        bytes: bytes.length,
        mime,
        entry,
        b64len,
        chunkSize: 0,
        mode: "chunks",
        by: "sovereign-local",
        at: new Date().toISOString(),
      },
      status: "pending-seal",
      chain: { manifestOp: null, chunks: [] },
      publishedBy: "local/web-publish",
      note: "פורסם ריבונית-מקומית — לא נשלח דבר לריפו. ממתין לחותם-שרשרת במסלול-מפתח של המפעיל.",
    };
    await writeFile(manifestPath, JSON.stringify(record, null, 2) + "\n");
    return NextResponse.json(
      {
        ok: true,
        sovereign: true,
        hash,
        name,
        bytes: bytes.length,
        entry,
        status: "pending-seal",
        gate: `/api/web/c/${hash}/${entry || "index.html"}`,
        repackNote,
        note: "החבילה במחסן הריבוני המקומי — אפס גיט, אפס ענן, התוכן לא נוגע בריפו. החותם על השרשרת ייחתם במסלול-מפתח של המפעיל; עד אז ההגשה מסומנת pending-seal בכנות.",
        files: filesList,
      },
      { status: 200 }
    );
  }

  // ── מסלול הענן (מפורש בלבד) — הדואר הנכנס בריפו ──
  // עבודה כפולה בדואר הנכנס?
  const jobDir = path.join(paths.inbox, hash);
  if (await exists(jobDir)) {
    return NextResponse.json(
      { ok: false, pending: true, hash, error: "חבילה זו ממתינה כבר בתור השידור" },
      { status: 409 }
    );
  }

  // כתיבה: job + b64 + עותק מכותב-חשיש למחסן הריבוני
  const job: WebInboxJob = {
    id: hash,
    name,
    sha256: hash,
    bytes: bytes.length,
    mime,
    entry,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  await mkdir(jobDir, { recursive: true });
  await writeFile(path.join(jobDir, "job.json"), JSON.stringify(job, null, 2) + "\n");
  await writeFile(path.join(jobDir, "package.b64"), bytes.toString("base64"));
  await mkdir(paths.packages, { recursive: true });
  await writeFile(path.join(paths.packages, `${hash}.bin`), bytes);

  // גיט: הוספה ממוקדת בלבד, commit, push — ואז הזנקת סוכן הענן
  let committed = "";
  let pushed = false;
  let dispatched = false;
  try {
    sh(
      `git add "sovereign/web/inbox/${hash}/job.json" "sovereign/web/inbox/${hash}/package.b64" "sovereign/web/packages/${hash}.bin"`
    );
    committed = sh(`git commit -m "web-inbox: ${name} · ${bytes}B · ${hash.slice(0, 12)} — ממתין לשידור Steem"`);
    sh("git push origin main");
    pushed = true;
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: `הכתיבה לריפו הריבוני נכשלה: ${e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200)}`,
        committed: committed.slice(0, 120),
      },
      { status: 502 }
    );
  }
  // R122 · חוק המקור-החי: קצב-ה-RC אינו קבוע מהזיכרון (469.5M) — נמדד חי
  // מהשרשרת באותו probe שמשרת את /api/web/state. אין מדידה → null כנה,
  // ואומדן-ההגירה מתוודה על חוסר-הבסיס במקום להמציא ימים.
  const rc = await probeStorageRc();
  const migration = estimateMigration(b64len, rc?.regenPerDay ?? null);
  try {
    await dispatchWorkflow("Zip", "web-publish.yml");
    dispatched = true;
  } catch (e) {
    // ה-push הצליח — ה-cron יאסוף את זה בכל מקרה; מדווחים בכנות
    return NextResponse.json(
      {
        ok: true,
        job,
        pushed,
        dispatched: false,
        migration,
        repackNote,
        note: `נדחף לריפו אך הזנקת הענן נכשלה (${e instanceof Error ? e.message.slice(0, 120) : "?"}) — ה-cron המחזורי יאסוף את המשימה.`,
        files: filesList,
      },
      { status: 200 }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      job,
      pushed,
      dispatched,
      migration,
      repackNote,
      note: "המשימה נדחפה וסוכן הענן הוזנק — הצ׳אנקים יעלו ל-Steem כשתקציב ה-RC יאפשר",
      files: filesList,
    },
    { status: 200 }
  );
}

// GET — הסבר קצר למפתח
export async function GET() {
  return NextResponse.json({
    ok: true,
    hint: "POST multipart/form-data עם file=‎.zip‎/קובץ-רשת-בודד · דורש סשן-מפעיל · תקרה 400KB · deliver=local (ברירת מחדל: מחסן ריבוני מקומי, מניפסט pending-seal, אפס-גיט) · deliver=cloud (דואר-נכנס בריפו + סוכן-ענן — מפורש בלבד)",
    mime: mimeOf("x.zip"),
  });
}
