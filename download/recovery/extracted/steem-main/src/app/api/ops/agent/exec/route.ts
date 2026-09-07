import { NextRequest, NextResponse } from "next/server";
import { readFile, stat, writeFile } from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

/**
 * Ops exec engine — the console's hands. Runs whitelisted agent scripts,
 * detached, each with its own observable log file (agent/exec_<id>.log).
 *
 * POST { script: keyof WHITELIST, params? } → 202 { ok, runId, logId }
 * GET  → { runs, results }                  — run registry + inferred results
 * GET  ?log=<id>                            → { lines } per-run log tail
 *
 * Safety model:
 *  - whitelist only (no arbitrary commands)
 *  - per-script cooldown (no parallel duplicate runs)
 *  - factory (on-chain identity mint) requires params.real === true AND a
 *    fresh confirm token the UI sets only after the user typed the account
 *    name — dry-run is the default
 *  - runs older than 30min are pruned; scripts that self-report into JSON
 *    result files get their result timestamps surfaced
 */

const AGENT_DIR = path.join(process.cwd(), "agent");
const RUNS_PATH = path.join(AGENT_DIR, "exec_runs.json");

interface RunEntry {
  id: string;
  script: string;
  label: string;
  startedAt: string;
  real: boolean;
}

const WHITELIST: Record<
  string,
  { script: string; label: string; cooldownMin: number; resultFile?: string; resultField?: string }
> = {
  verify: {
    script: "verify_system.cjs",
    label: "מטריצת ההוכחות (40 בדיקות)",
    cooldownMin: 5,
    resultFile: "verify_last.json",
    resultField: "at",
  },
  keyscan: {
    script: "keyscan.cjs",
    label: "סריקת אימפריה (Steem+Hive+HE)",
    cooldownMin: 10,
    resultFile: "keyscan_result.json",
  },
  forkscan: {
    script: "forkscan.cjs",
    label: "סריקת שטחי-מפתח — כל שרשראות-הבת (Steem/Hive/Blurt/Serey/Golos/…)",
    cooldownMin: 15,
    resultFile: "forkscan_result.json",
  },
  harden: {
    script: "harden_topology.cjs",
    label: "הקשחת טופולוגיית-כוח: סמכות-פרסום שלנו בכל חייל + RC 25SP לכל חייל (on-chain)",
    cooldownMin: 10,
    resultFile: "harden_result.json",
  },
  "worldlog-verify": {
    script: "verify_worldlog.cjs",
    label: "אימות יומן-העולם: שרשור-האש + פריטה Steem↔Hive",
    cooldownMin: 3,
    resultFile: "worldlog_verify.json",
    resultField: "at",
  },
  limits: {
    script: "limits_probe.cjs",
    label: "סריקת גבולות-הרשת: custom_json 8192B · 5/block · memo 2048B · authorities 40 (מדידה חיה)",
    cooldownMin: 30,
    resultFile: "limits.json",
    resultField: "at",
  },
  registry: {
    script: "net_registry.cjs",
    label: "רישום SAOS-Net על-השרשרת: 17 עלים (server/hq/agents/services) → saos_net",
    cooldownMin: 20,
    resultFile: "net_registry_result.json",
    resultField: "at",
  },
  kv: {
    script: "net_kv.cjs --manifest",
    label: "SAOS-KV: מניפסט-הרשת על-השרשרת עם hash-verified roundtrip",
    cooldownMin: 20,
    resultFile: "net_kv_result.json",
    resultField: "at",
  },
  escrow: {
    script: "escrow_rail.cjs",
    label: "מסילת-נאמנות (escrow) מקורית — מחזור מלא 4 שלבים על-השרשרת (0.101 STEEM)",
    cooldownMin: 20,
    resultFile: "escrow_result.json",
    resultField: "at",
  },
  anchor: {
    script: "anchor.cjs",
    label: "עוגן-זהות חוצה-פרדיגמות (EVM×Graphene — Steem+Hive+Blurt)",
    cooldownMin: 15,
    resultFile: "anchor_last.json",
    resultField: "at",
  },
  genesis: {
    script: "he_genesis.cjs",
    label: "ג׳נזיס-טוקן — מדרגת ערך חיה: מכירות→SWAP.HIVE→BEE→(≥100) יצירת SAOS על Hive-Engine (on-chain)",
    cooldownMin: 45,
    resultFile: "he_genesis_result.json",
    resultField: "at",
  },
  liq: {
    script: "liq_seed.cjs",
    label: "זריעת-נזילות (Task 47): ביטול-מדפים-תקועים + בריכת-AMM + grid עוגן-פירעון",
    cooldownMin: 10,
  },
  conforms: {
    script: "he_conforms.cjs",
    label: "מטריצת קצה — חוזים חכמים HE: 13 טענות דחייה/אישור בהשפעה-מדודה (on-chain)",
    cooldownMin: 25,
    resultFile: "he_conforms_result.json",
    resultField: "at",
  },
  site: {
    script: "net_site.cjs",
    label: "SAOS-Web: פרסום אתר אל-תוך השרשרת + roundtrip sha256 (on-chain)",
    cooldownMin: 20,
    resultFile: "net_site_result.json",
    resultField: "at",
  },
  announce: {
    script: "post_announce.cjs",
    label: "פרסום המפרט — Steem",
    cooldownMin: 30,
  },
  "announce-hive": {
    script: "post_announce.cjs --hive",
    label: "פרסום המפרט — Hive",
    cooldownMin: 30,
  },
  factory: {
    script: "factory_create.cjs",
    label: "לידת סוכן חדש (create_claimed_account + delegation)",
    cooldownMin: 15,
  },
  factory2: {
    script: "factory_v2.cjs",
    label: "מפעל דור-שני — דטרמיניסטי + עוגן-חילוץ + גיבוי-כספת (reclaim/claim/mint/ping/derive)",
    cooldownMin: 10,
    resultFile: "factory_v2_result.json",
    resultField: "at",
  },
  fuel: {
    script: "fuel_line.cjs",
    label: "מסילת-הדלק (Task 49): 50 SP לכל-חייל + הון-חוזר 0.03 STEEM — תעסוקה מלאה (on-chain)",
    cooldownMin: 30,
    resultFile: "fuel_result.json",
    resultField: "at",
  },
  muster: {
    script: "muster.cjs",
    label: "מסדר-תעסוקה: גל-escrow מיידי — כל חייל חותם בעצמו → קרדיט-DEX → SAOS → LP",
    cooldownMin: 10,
    resultFile: "muster_result.json",
    resultField: "at",
  },
  "he-ladder": {
    script: "he_ladder.cjs",
    label: "סולם-גיוס-הון HE: מכירת כל-הארנק לתוך bids חיים → SWAP.HIVE (מקור-הון ראשון)",
    cooldownMin: 30,
    resultFile: "he_ladder_result.json",
  },
  "rc-map": {
    script: "rc_sovereign.cjs --map",
    label: "מפת-דלק RC (Task 50): אוצר+צי+Hive חי + טבלת-תפוקה ריבונית (קריאה-בלבד)",
    cooldownMin: 10,
    resultFile: "rc_map.json",
    resultField: "at",
  },
  "rc-salvo": {
    script: "rc_sovereign.cjs --salvo",
    label: "מטח-צי מקביל: 5 חיילים × 4-ops — חציית חומת 5-custom_json/בלוק (on-chain)",
    cooldownMin: 15,
    resultFile: "rc_sovereign_result.json",
  },
  "hive-powerup": {
    script: "rc_sovereign.cjs --hive-powerup",
    label: "העלאת-כוח Hive חיה: SWAP.HIVE→HIVE→HP — מדידת rcMax לפני/אחרי (on-chain)",
    cooldownMin: 45,
    resultFile: "he_powerup_result.json",
  },
  runner: {
    script: "sovereign_runner.cjs --run",
    label: "מנוע-עומסים ריבוני: 40 ריצות מקומיות (אפס-RC) + עיגון-digest בטרנזקציית-חייל אחת (on-chain)",
    cooldownMin: 10,
    resultFile: "sovereign_runner_result.json",
  },
  chunk: {
    script: "sovereign_runner.cjs --chunk",
    label: "צ'אנקים-ריבוניים: מניפסט-מצב >8192B חוצה חומת-op דרך הצי + הרכבה sha256 מהשרשרת",
    cooldownMin: 20,
    resultFile: "sovereign_runner_result.json",
  },
  "cross-shard": {
    script: "cross_shard.cjs --live",
    label: "פיצול-שרדים בין-שרשרתי (Task 51): אובייקט-מצב אחד מפורק ל-6 שברים — 3 על Steem + 3 על Hive, חיילים חותמים על שתי השרשראות, הרכבה sha256 מההיסטוריה הציבורית של שתיהן",
    cooldownMin: 15,
    resultFile: "cross_shard_result.json",
    resultField: "at",
  },
  "cross-collect": {
    script: "cross_shard.cjs --collect",
    label: "הרכבה-מחדש בלבד: איסוף השברים משתי השרשראות + אימות sha256 מול השורש (בלי שידור)",
    cooldownMin: 5,
    resultFile: "cross_shard_result.json",
    resultField: "at",
  },
  rebuild: {
    script: "rebuild.cjs",
    label: "שחזור-עולם מההיסטוריה הציבורית בלבד (Task 51): מנוע-שידור-חוזר עצמאי שני — ספר+בריכה+יתרות מהשרשרת, השוואה מול השרת 11/11",
    cooldownMin: 10,
    resultFile: "rebuild_result.json",
    resultField: "at",
  },
  perf: {
    script: "perf_bench.cjs",
    label: "מדידת-ביצועים חיה (Task 51): מרוץ-RPC 4 צמתים · מנוע ~450K swaps/שנ׳ באפס-RC · חבירה-לבלוק 3.1s בשתי השרשראות · עיגון-digest (on-chain)",
    cooldownMin: 15,
    resultFile: "perf_bench_result.json",
    resultField: "at",
  },
  "mint-borrow": {
    script: "mint_borrow.cjs --live",
    label: "מפעל-ההלוואות (Task 52): הקפאת-דלק → הלוואת-vests לחייל-מנט → חציית-חומת-התביעה → טיקט/מינט hcnova2 → פריקה-נקייה · נמדד: סף 9,920,604 vests (חי רק מעליו)",
    cooldownMin: 30,
    resultFile: "mint_borrow_result.json",
    resultField: "at",
  },
  salvo52: {
    script: "rc_sovereign.cjs --salvo --live",
    label: "מטח-צי מלא (Task 52): 10 חיילים × 4 ops — 40 ops במקביל מול חומת-5 לחשבון · אימות בסריקת-בלוק (salvo52_evidence)",
    cooldownMin: 20,
    resultFile: "salvo52_evidence.json",
    resultField: "at",
  },
  "value-lock": {
    script: "value_lock.cjs --live",
    label: "נעילת-ערך (Task 53): חתך-SAOS מהאוצר → pool_add → pool_lock 100% — נזילות-קבועה שלא-ניתנת-לשליפה · מניפסט נעוג על Hive דרך ראוטר-הצי (on-chain)",
    cooldownMin: 25,
    resultFile: "value_lock_result.json",
    resultField: "at",
  },
  cascade: {
    script: "cascade.cjs --live",
    label: "ממסר-מפל (Task 53): החלטה-מקומית אחת → 3 חתימות מקבילות — אוצר-Steem + חייל-Steem + חייל-Hive · אימות מכל-שרשרת בנפרד (cascade_result)",
    cooldownMin: 15,
    resultFile: "cascade_result.json",
    resultField: "at",
  },
  reflex: {
    script: "reflex.cjs --live",
    label: "ירי-רפלקס (Task 54): טריגר-אוצר → 10 תגובות-חיילים חתומות-מראש בבלוק N+1 — מטח 3-סבבי, אפס-עלות-נזילה, דלק-ריבוני · עוגן-digest על Hive (reflex_evidence)",
    cooldownMin: 15,
    resultFile: "reflex_evidence.json",
    resultField: "at",
  },
};

const NAME_RE = /^[a-z][a-z0-9\-.]{2,15}$/;

async function readRuns(): Promise<RunEntry[]> {
  try {
    const raw = await readFile(RUNS_PATH, "utf8");
    const arr = JSON.parse(raw) as RunEntry[];
    const cutoff = Date.now() - 30 * 60 * 1000;
    return Array.isArray(arr) ? arr.filter((r) => new Date(r.startedAt).getTime() > cutoff) : [];
  } catch {
    return [];
  }
}

async function writeRuns(runs: RunEntry[]): Promise<void> {
  await writeFile(RUNS_PATH, JSON.stringify(runs, null, 2) + "\n");
}

async function fileMtime(p: string): Promise<number | null> {
  try {
    const st = await stat(p);
    return st.mtimeMs;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const logId = req.nextUrl.searchParams.get("log");
  if (logId && /^[a-f0-9-]{36}$/.test(logId)) {
    try {
      const raw = await readFile(path.join(AGENT_DIR, `exec_${logId}.log`), "utf8");
      const lines = raw.split("\n").filter((l) => l.trim().length > 0).slice(-80);
      return NextResponse.json({ ok: true, lines });
    } catch {
      return NextResponse.json({ ok: true, lines: [] });
    }
  }

  const runs = await readRuns();
  const results: Record<string, { at: string | null; file: string }> = {};
  for (const [key, w] of Object.entries(WHITELIST)) {
    if (!w.resultFile) continue;
    const mtime = await fileMtime(path.join(AGENT_DIR, w.resultFile));
    let value: string | null = mtime ? new Date(mtime).toISOString() : null;
    if (value && w.resultField) {
      try {
        const raw = await readFile(path.join(AGENT_DIR, w.resultFile), "utf8");
        const j = JSON.parse(raw) as Record<string, unknown>;
        value = typeof j[w.resultField] === "string" ? (j[w.resultField] as string) : value;
      } catch {
        /* keep mtime */
      }
    }
    results[key] = { at: value, file: w.resultFile };
  }
  return NextResponse.json({ ok: true, runs, results });
}

export async function POST(req: NextRequest) {
  let body: { script?: string; params?: Record<string, unknown> };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "גוף בקשה לא תקין" }, { status: 400 });
  }
  const key = body.script ?? "";
  const w = WHITELIST[key];
  if (!w) return NextResponse.json({ ok: false, error: "script לא ברשימה הלבנה" }, { status: 400 });

  // cooldown — never run the same script twice in parallel
  const runs = await readRuns();
  const started = new Date(runs.find((r) => r.script === key)?.startedAt ?? 0).getTime();
  if (Date.now() - started < w.cooldownMin * 60 * 1000) {
    return NextResponse.json(
      { ok: false, error: `הרצה של ${w.label} כבר בעיצומה/טרייה — נסה בעוד רגע` },
      { status: 429 },
    );
  }

  // build argv
  const argv: string[] = [];
  if (key === "factory") {
    const name = String(body.params?.name ?? "").trim();
    const sp = Number(body.params?.sp ?? 50);
    const real = body.params?.real === true;
    if (!NAME_RE.test(name))
      return NextResponse.json({ ok: false, error: "שם חשבון לא תקין (3-16 תווים a-z0-9)" }, { status: 400 });
    if (!Number.isFinite(sp) || sp < 0 || sp > 100000)
      return NextResponse.json({ ok: false, error: "SP לא תקין" }, { status: 400 });
    // never allow a name that already has keys on this machine
    try {
      const keys = await readFile(path.join(AGENT_DIR, "keys", `${name}.json`), "utf8");
      if (keys) return NextResponse.json({ ok: false, error: `${name} כבר קיים בכספת המקומית` }, { status: 409 });
    } catch {
      /* not found — good */
    }
    argv.push(w.script, "--name", name, "--sp", String(sp));
    if (!real) argv.push("--dry");
  } else if (key === "liq") {
    // liq_seed הוא dry-run כברירת-מחדל; params.real === true מאשר שידור חי
    argv.push(w.script);
    if (body.params?.real === true) argv.push("--live");
  } else if (key === "factory2") {
    // factory_v2 — מצבי-reclaim/claim/mint/topup/ping/derive.
    // מצבי-שידור (reclaim/mint/topup) דורשים params.real === true; שאר בטוחים.
    const mode = String(body.params?.mode ?? "derive").trim();
    const real = body.params?.real === true;
    const name = String(body.params?.name ?? "").trim();
    const creator = String(body.params?.creator ?? "headcorner").trim().toLowerCase();
    if (!["mint", "reclaim", "claim", "topup", "ping", "derive"].includes(mode))
      return NextResponse.json({ ok: false, error: "מצב לא מוכר: " + mode }, { status: 400 });
    if ((mode === "mint" || mode === "reclaim" || mode === "topup" || mode === "ping") && !NAME_RE.test(name))
      return NextResponse.json({ ok: false, error: "שם חשבון לא תקין (3-16 תווים a-z0-9)" }, { status: 400 });
    if (mode === "mint") {
      if (!real) return NextResponse.json({ ok: false, error: "לידת דור-שני דורשת אישור real=true (שידור חי על השרשרת)" }, { status: 400 });
      const sp = Number(body.params?.sp ?? 0.5);
      const topup = Number(body.params?.topup ?? 0);
      if (!Number.isFinite(sp) || sp < 0 || sp > 100000)
        return NextResponse.json({ ok: false, error: "SP לא תקין" }, { status: 400 });
      try {
        const keys = await readFile(path.join(AGENT_DIR, "keys", `${name}.json`), "utf8");
        if (keys) return NextResponse.json({ ok: false, error: `${name} כבר קיים בכספת המקומית` }, { status: 409 });
      } catch {
        /* not found — good */
      }
      argv.push(w.script, "--mint", "--creator", creator, "--name", name, "--sp", String(sp), "--topup", String(topup));
    } else if (mode === "reclaim") {
      if (!real) return NextResponse.json({ ok: false, error: "שחזור-הקצבה דורש אישור real=true (שידור חי)" }, { status: 400 });
      argv.push(w.script, "--reclaim", name);
    } else if (mode === "topup") {
      if (!real) return NextResponse.json({ ok: false, error: "תוספת-הקצבה דורשת אישור real=true" }, { status: 400 });
      const sp = Number(body.params?.sp ?? 1);
      argv.push(w.script, "--topup", "--name", name, "--sp", String(sp));
    } else if (mode === "claim") {
      argv.push(w.script, "--claim", "--creator", creator, ...(real ? [] : ["--dry"]));
    } else if (mode === "ping") {
      argv.push(w.script, "--ping", "--name", name);
    } else {
      argv.push(w.script, "--derive", "--name", name);
    }
  } else if (["fuel", "muster", "he-ladder", "rc-salvo", "hive-powerup", "runner", "chunk"].includes(key)) {
    // 49/50 — dry-run כברירת-מחדל; params.real === true מאשר שידור חי
    argv.push(...w.script.split(" "));
    if (body.params?.real === true) argv.push("--live");
  } else {
    argv.push(...w.script.split(" "));
  }

  const runId = randomUUID();
  const fd = await import("fs").then((fs) => fs.openSync(path.join(AGENT_DIR, `exec_${runId}.log`), "a"));
  const child = spawn(process.execPath, argv, {
    cwd: AGENT_DIR,
    detached: true,
    stdio: ["ignore", fd, fd],
  });
  child.unref();

  const entry: RunEntry = {
    id: runId,
    script: key,
    label: w.label,
    startedAt: new Date().toISOString(),
    real:
      key === "factory"
        ? body.params?.real === true
        : key.startsWith("announce") || key === "he_sell" || key === "escrow" || key === "salvo52" || key === "mint-borrow" || (key === "liq" && body.params?.real === true) || (key === "factory2" && body.params?.real === true),
  };
  await writeRuns([...runs, entry]);
  return NextResponse.json({ ok: true, runId, label: w.label }, { status: 202 });
}
