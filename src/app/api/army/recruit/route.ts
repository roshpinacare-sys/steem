// ─────────────────────────────────────────────────────────────────────
// /api/army/recruit · שער-הגיוס של הצבא (r145-b · מחלקת-"army")
//
// החוק החדש של הגיוס: הצבא מגייס תפקיד בעצמו — אבל בדיוק כמו כל
// הכרעה ריבונית — בהחלטה חתומה על יומן hash-chained + רישום במצבת-
// התפקידים (sovereign/army/roles.json), עם ראיה = מדידת-ריצה-ראשונה.
// אין גיוס בלי מדידה: טענה בלי מספר נדחית בשער (חוק-הברזל של היומן).
//
// חוקי-ברזל:
//   · אידמפוטנטי מול היומן — אותו decisionId לא נחתם פעמיים
//   · ראיה-חובה: firstRun חייב לשאת מספרים (measured) — לא הצהרה
//   · כתיבת roles.json אטומית (tmp+rename) · אפס סודות בתשובה
//   · הראיה נשמרת ביומן כמחרוזת-מסכמת — הארטיפקטים עצמם בקבצים
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { appendDecision, readDecisionLog, verifyDecisionLog } from "@/lib/weave/sovereign-decisions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ROLES_PATH = path.join(process.cwd(), "sovereign", "army", "roles.json");

interface RecruitRole {
  role: string;
  mission?: string;
  where?: string;
  cadence?: string;
  pairsWith?: string;
  honestNote?: string;
  firstRun: Record<string, unknown> & { measured?: Record<string, unknown> };
}

function readRoles(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(ROLES_PATH, "utf8")) as Record<string, unknown>;
  } catch {
    return { roles: [] };
  }
}

function writeRoles(reg: Record<string, unknown>): { ok: boolean; note: string } {
  try {
    fs.mkdirSync(path.dirname(ROLES_PATH), { recursive: true });
    const tmp = `${ROLES_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(reg, null, 2), "utf8");
    fs.renameSync(tmp, ROLES_PATH);
    return { ok: true, note: "roles.json updated" };
  } catch (e) {
    return { ok: false, note: `roles.json write failed: ${String((e as Error)?.message ?? e).slice(0, 80)}` };
  }
}

/** ראיה-חוקית = מספרים. סורק את firstRun עד עומק 2 ומחפש ערך-מדידה כלשהו. */
function hasMeasuredEvidence(firstRun: RecruitRole["firstRun"]): boolean {
  const walk = (v: unknown, depth: number): boolean => {
    if (depth > 2 || v == null) return false;
    if (typeof v === "number") return Number.isFinite(v);
    if (typeof v === "string") return /^(success|ok|pass|true|\d)/i.test(v.trim());
    if (Array.isArray(v)) return v.some((x) => walk(x, depth + 1));
    if (typeof v === "object") return Object.values(v).some((x) => walk(x, depth + 1));
    return false;
  };
  return walk(firstRun, 0);
}

export async function GET() {
  const reg = readRoles();
  const chain = verifyDecisionLog();
  return NextResponse.json({
    ok: true,
    rolesPath: "sovereign/army/roles.json",
    roles: reg.roles ?? [],
    doctrine: reg.doctrine ?? null,
    chain,
  });
}

export async function POST(req: Request) {
  let body: { decisionId?: string; why?: string; boundary?: string; evidenceFiles?: string[]; task?: string; agent?: string; role?: RecruitRole };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "bad-json" }, { status: 400 });
  }

  const decisionId = String(body.decisionId ?? "").trim();
  const role = body.role;
  // r146-b — הגיוס ריבוני-גלי: כל גל-מהפכה (D-r14x-*) עובר באותו שער —
  // המחלקה "army" נשארת אחת, המזהים מסומנים-גל. אותם חוקי-ראיה בדיוק.
  if (!/^D-r14\d-[A-Z0-9-]{3,24}$/.test(decisionId)) {
    return NextResponse.json({ ok: false, error: "decisionId must match D-r14x-* (revolution wave)" }, { status: 400 });
  }
  if (!role || typeof role.role !== "string" || role.role.length < 3) {
    return NextResponse.json({ ok: false, error: "role.role missing" }, { status: 400 });
  }
  if (!role.firstRun || typeof role.firstRun !== "object") {
    return NextResponse.json({ ok: false, error: "role.firstRun missing — אין גיוס בלי מדידה" }, { status: 400 });
  }
  if (!hasMeasuredEvidence(role.firstRun)) {
    return NextResponse.json({ ok: false, error: "role.firstRun has no measured numbers — טענה בלי מדידה פסולה" }, { status: 400 });
  }

  // אידמפוטנציה מול היומן — החלטה חתומה כבר? אין חתימה-כפולה.
  const existing = readDecisionLog().find((d) => d.decisionId === decisionId);
  if (existing) {
    return NextResponse.json({
      ok: true,
      idempotent: true,
      decisionId,
      seq: existing.seq,
      entryHash: existing.entryHash,
      note: "כבר חתומה — אידמפוטנטי",
    });
  }

  const where = role.where ?? "unspecified";
  const measured = role.firstRun.measured ?? role.firstRun;
  const evidenceSummary = [
    `first-run measurement: ${JSON.stringify(measured).slice(0, 420)}`,
    ...(role.firstRun as { url?: string }).url ? [`runUrl=${(role.firstRun as { url: string }).url}`] : [],
    ...(body.evidenceFiles ?? []),
  ].join(" · ");

  let sealed;
  try {
    sealed = appendDecision({
      decisionId,
      class: "army",
      chosen: `recruit ${role.role} (${where}) — cadence ${role.cadence ?? "unspecified"}`,
      why:
        body.why ??
        `operator directive (r145 wave): the autonomy develops the army and recruits roles by themselves. ` +
          `${role.role}: ${role.mission ?? "measured recurring role"}. No duplication: verified against the existing roles/services before recruiting.`,
      boundary:
        body.boundary ??
        "auto (D-OP-01 standing approval) · recruitment = measurement infrastructure only: no keys materialize, no funds move, existing roles/services untouched (NO DUPLICATION LAW)",
      evidence: evidenceSummary,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: `appendDecision failed: ${String((e as Error)?.message ?? e).slice(0, 120)}` }, { status: 500 });
  }

  // רישום במצבת-התפקידים — אחרי החתימה (היומן הוא הסמכות; הרישום העדכון)
  const reg = readRoles();
  const roles = Array.isArray(reg.roles) ? (reg.roles as Array<Record<string, unknown>>) : [];
  const idx = roles.findIndex((r) => r.role === role.role);
  const entry: Record<string, unknown> = {
    role: role.role,
    status: "recruited",
    ...(role.where ? { where: role.where } : {}),
    ...(role.mission ? { mission: role.mission } : {}),
    ...(role.cadence ? { cadence: role.cadence } : {}),
    ...(role.pairsWith ? { pairsWith: role.pairsWith } : {}),
    ...(role.honestNote ? { honestNote: role.honestNote } : {}),
    firstRun: role.firstRun,
    recruitedAt: sealed.at,
    decisionId,
    seq: sealed.seq,
  };
  if (idx >= 0) roles[idx] = { ...roles[idx], ...entry };
  else roles.push(entry);
  reg.roles = roles;
  // r146-b — גל-הגיוס נרשם מגוף-הבקשה (שער-אחד, כל גל), עם ברירות-מחדל כנות
  reg.task = body.task ?? "r145-b";
  reg.agent = body.agent ?? "army-expansion";
  reg.at = sealed.at;
  const regWrite = writeRoles(reg);

  return NextResponse.json({
    ok: true,
    decisionId,
    seq: sealed.seq,
    entryHash: sealed.entryHash,
    roles: { path: "sovereign/army/roles.json", ...regWrite },
  });
}
