// ─────────────────────────────────────────────────────────────────────
// POST /api/charter/projects/[slug]/status — קידום מצב הפרויקט.
// קדימה בלבד (CHARTERED→BUILDING→COMPLETE→ARCHIVED): מצב שהושג הוא
// עובדה רשומה, לא מחיקה. כל מעבר נרשם כאירוע + אימות חתום.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { CHARTER, verifyBuilderToken, canonEventId, appendCanonEvents } from "@/lib/charter";
import { appendAttestation } from "@/lib/weave/ledger";

export const dynamic = "force-dynamic";

const ORDER = ["CHARTERED", "BUILDING", "COMPLETE", "ARCHIVED"] as const;

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

  let body: { status?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "גוף JSON חסר או שבור" }, { status: 400 });
  }
  const status = typeof body.status === "string" ? body.status.trim().toUpperCase() : "";
  if (!ORDER.includes(status as (typeof ORDER)[number])) {
    return NextResponse.json(
      { ok: false, error: `מצב חייב להיות אחד מ-${ORDER.join(" | ")}` },
      { status: 422 },
    );
  }

  const project = await db.charterProject.findUnique({ where: { slug }, include: { builder: true } });
  if (!project) {
    return NextResponse.json({ ok: false, error: `פרויקט "${slug}" לא נמצא` }, { status: 404 });
  }
  if (project.builderId !== builder.agentId) {
    return NextResponse.json(
      { ok: false, error: "הפרויקט שייך לבונה אחר — אין הרשאת קידום" },
      { status: 403 },
    );
  }

  const from = project.status;
  if (ORDER.indexOf(status as (typeof ORDER)[number]) <= ORDER.indexOf(from as (typeof ORDER)[number])) {
    return NextResponse.json(
      { ok: false, error: `קידום בלבד: מ-${from} לא ניתן לחזור או להישאר — ההיסטוריה היא עובדה` },
      { status: 409 },
    );
  }

  // מעבר מצב נרשם גם בספר האימותים — BUILD חתום חדש
  const att = await appendAttestation({
    agentId: builder.agentId,
    claim: `charter-status: ${project.slug} ${from}→${status}`,
    claimType: "BUILD",
    evidence: JSON.stringify(
      { project: project.slug, from, to: status, by: builder.name, at: new Date().toISOString() },
      null,
      2,
    ),
  });

  const eventId = canonEventId(slug, "STATUS", att.createdAt.toISOString(), `${from}-${status}-${att.seq}`);

  const updated = await db.charterProject.update({
    where: { slug },
    data: {
      status,
      events: {
        create: {
          kind: "STATUS",
          detail: JSON.stringify({
            eventId,
            from,
            to: status,
            attSeq: att.seq,
            entryHash: att.entryHash,
          }),
        },
      },
    },
  });

  // R92: גם המעבר-מצב נכנס לזיכרון הקנוני — הסרט, לא רק התמונה.
  // r125a · חוק הכנות: המעבר-מצב עצמו בוצע (DB + אימות) — זו האמת
  // שמדווחת. כתיבת הקנון היא ראיה; כשלה או נפלה — אובדן-הראיה מתועד
  // בגלוי בתשובה (canonError), לא נעלם בשקט מאחורי ok:true.
  let canonError: string | null = null;
  const canonEv = await appendCanonEvents([
    {
      id: eventId,
      at: att.createdAt.toISOString(),
      slug,
      kind: "STATUS",
      detail: { from, to: status, attSeq: att.seq, entryHash: att.entryHash },
      attSeq: att.seq,
      attEntryHash: att.entryHash,
    },
  ]).catch((e) => {
    canonError = "CANON-ERROR: " + String((e as Error)?.message ?? e).slice(0, 120);
    return null;
  });
  if (!canonError && canonEv && !canonEv.ok) {
    canonError = canonEv.error ?? "כתיבת יומן הקנון נכשלה";
  }

  return NextResponse.json({
    ok: true,
    project: { slug: updated.slug, status: updated.status },
    attestation: { seq: att.seq, entryHash: att.entryHash, claim: att.claim },
    canon: { eventsLog: canonEv },
    ...(canonError ? { canonError } : {}),
  });
}
