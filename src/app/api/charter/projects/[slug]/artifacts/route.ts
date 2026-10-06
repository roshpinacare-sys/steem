// ─────────────────────────────────────────────────────────────────────
// POST /api/charter/projects/[slug]/artifacts — פרסום מסמך לקנון.
//
// הבונה מפרסם מסמך (markdown/json) לתיקיית הפרויקט בקנון Defi.
// שער-הסודות נאכף על שם-הקובץ והתוכן; התקציב נספר ב-DB; האירוע
// נרשם append-only. ה-PAT נשאר בסנדבוקס — הבונה לעולם לא רואה אותו.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { CHARTER, secretGate, verifyBuilderToken, budgetLeft, publishCanon, canonEventId, appendCanonEvents } from "@/lib/charter";
import { appendAttestation } from "@/lib/weave/ledger";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  const builder = await verifyBuilderToken(m ? m[1].trim() : null);
  if (!builder) {
    return NextResponse.json({ ok: false, error: "טוקן-בונה חסר או לא-תקף" }, { status: 401 });
  }

  const project = await db.charterProject.findUnique({ where: { slug }, include: { builder: true } });
  if (!project) {
    return NextResponse.json({ ok: false, error: `פרויקט "${slug}" לא נמצא` }, { status: 404 });
  }
  // הבונה מפרסם רק לפרויקטים שלו — סעיף בעלות
  if (project.builderId !== builder.agentId) {
    return NextResponse.json(
      { ok: false, error: "הפרויקט שייך לבונה אחר — אין הרשאת פרסום" },
      { status: 403 },
    );
  }
  if (project.status === "ARCHIVED") {
    return NextResponse.json(
      { ok: false, error: "הפרויקט בארכיון — פרויקט מאוכלס אינו מקבל מסמכים" },
      { status: 409 },
    );
  }

  let body: { filename?: unknown; content?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "גוף JSON חסר או שבור" }, { status: 400 });
  }
  const filename = typeof body.filename === "string" ? body.filename.trim() : "";
  const content = typeof body.content === "string" ? body.content : "";
  if (!CHARTER.filePattern.test(filename)) {
    return NextResponse.json(
      { ok: false, error: "שם הקובץ חייב תווית לטיניות/ספרות/נקודה/מקף/קו-תחתון, עד 60 תווים, בלי נתיבים" },
      { status: 422 },
    );
  }
  if (content.length === 0) {
    return NextResponse.json({ ok: false, error: "תוכן ריק אינו מסמך" }, { status: 422 });
  }
  if (Buffer.byteLength(content, "utf8") > CHARTER.artifactMaxBytes) {
    return NextResponse.json(
      { ok: false, error: `המסמך חורג מ-${Math.round(CHARTER.artifactMaxBytes / 1024)}KB` },
      { status: 422 },
    );
  }
  const leak = secretGate(filename + "\n" + content);
  if (leak) {
    return NextResponse.json(
      { ok: false, error: `שער-הסודות חסם: זוהה ${leak} — אף מפתח לא נכנס לקנון` },
      { status: 422 },
    );
  }

  const budget = await budgetLeft(builder.agentId);
  if (budget.artifacts <= 0) {
    return NextResponse.json(
      { ok: false, error: `תקציב הפרסום להיום (UTC) אזל — ${CHARTER.artifactsPerDay} מסמכים ליום לבונה` },
      { status: 429 },
    );
  }

  // מניעת דריסה: מסמך קיים באותו שם באותו יום נדחה — מסמך הוא אירוע, לא קובץ
  const dayTag = new Date().toISOString().slice(0, 10);
  const canonPath = `${CHARTER.projectDir}/${slug}/${dayTag}-${filename}`;
  const existsToday = await db.charterEvent.findFirst({
    where: { kind: "ARTIFACT", detail: { contains: canonPath } },
  });
  if (existsToday) {
    return NextResponse.json(
      { ok: false, error: `המסמך "${filename}" כבר פורסם היום — פרסם בשם אחר או מחר (append-only)` },
      { status: 409 },
    );
  }

  const header = [
    `<!-- artifact: ${project.slug} · by ${builder.name} · ${new Date().toISOString()} -->`,
    ``,
  ].join("\n");
  const res = await publishCanon(
    canonPath,
    header + content,
    `charter: artifact "${filename}" → ${slug} (by ${builder.name})`,
  );

  const eventId = canonEventId(slug, "ARTIFACT", new Date().toISOString(), canonPath);

  const updated = await db.charterProject.update({
    where: { slug },
    data: {
      artifactsCount: { increment: 1 },
      events: {
        create: {
          kind: "ARTIFACT",
          detail: JSON.stringify({
            eventId,
            filename,
            canonPath,
            bytes: Buffer.byteLength(content, "utf8"),
            canonOk: res.ok,
            canonUrl: res.url ?? null,
          }),
        },
      },
    },
  });

  // R92: המסמך עצמו בקנון — והאירוע שלו ביומן האירועים הקנוני.
  // r125a · חוק הכנות: הפרסום עצמו כבר מדווח ב-canon (res.ok) — אבל כתיבת
  // יומן-האירועים שנפלה/נדחתה לא נבלעת עוד מאחורי ok:true: canonError
  // מתעד בגלוי את אובדן הראייה (הפעולה — הפרסום — מדווחת אמת).
  let canonError: string | null = null;
  const canonEv = await appendCanonEvents([
    {
      id: eventId,
      at: new Date().toISOString(),
      slug,
      kind: "ARTIFACT",
      detail: {
        filename,
        canonPath,
        bytes: Buffer.byteLength(content, "utf8"),
        canonOk: res.ok,
        canonUrl: res.url ?? null,
      },
    },
  ]).catch((e) => {
    canonError = "CANON-ERROR: " + String((e as Error)?.message ?? e).slice(0, 120);
    return null;
  });
  if (!canonError && canonEv && !canonEv.ok) {
    canonError = canonEv.error ?? "כתיבת יומן הקנון נכשלה";
  }

  return NextResponse.json(
    {
      ok: true,
      artifact: {
        filename,
        canonPath,
        bytes: Buffer.byteLength(content, "utf8"),
        project: slug,
      },
      canon: { ...res, eventsLog: canonEv },
      ...(canonError ? { canonError } : {}),
      artifactsTotal: updated.artifactsCount,
    },
    { status: 201 },
  );
}
