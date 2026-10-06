// ─────────────────────────────────────────────────────────────────────
// GET /api/charter/projects/[slug] — פרטי פרויקט-צ'רטר.
// מחזיר את הפרויקט, הבונה, אימות-ההקמה החתום מהספר, וספר-האירועים
// ה-append-only שלו. קריאה פומבית — האמת של הרשת פתוחה לכל.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { CHARTER } from "@/lib/charter";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const project = await db.charterProject.findUnique({
    where: { slug },
    include: {
      builder: true,
      events: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!project) {
    return NextResponse.json(
      { ok: false, error: `פרויקט "${slug}" לא נמצא במרשם הרשת` },
      { status: 404 },
    );
  }

  // אימות-ההקמה מהספר — אם קיים (פרויקט מרופא עשוי שלא להחזיק אותו מקומית)
  let attestation: {
    seq: number;
    claim: string;
    claimType: string;
    status: string;
    prevHash: string;
    entryHash: string;
    sig: string | null;
    signer: string | null;
    createdAt: string;
  } | null = null;
  if (project.attSeq != null) {
    const att = await db.attestation.findUnique({ where: { seq: project.attSeq } });
    if (att) {
      attestation = {
        seq: att.seq,
        claim: att.claim,
        claimType: att.claimType,
        status: att.status,
        prevHash: att.prevHash,
        entryHash: att.entryHash,
        sig: att.sig,
        signer: att.signerAddr,
        createdAt: att.createdAt.toISOString(),
      };
    }
  }

  return NextResponse.json({
    ok: true,
    project: {
      slug: project.slug,
      name: project.name,
      purpose: project.purpose,
      status: project.status,
      builder: {
        name: project.builder.name,
        address: project.builder.ethAddress,
        role: project.builder.role,
      },
      attestation,
      artifacts: project.artifactsCount,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      canon: {
        card: `https://github.com/${CHARTER.canonRepo}/blob/main/${CHARTER.projectDir}/${project.slug}/README.md`,
        dir: `https://github.com/${CHARTER.canonRepo}/tree/main/${CHARTER.projectDir}/${project.slug}`,
      },
    },
    events: project.events.map((e) => ({
      kind: e.kind,
      detail: safeJson(e.detail),
      at: e.createdAt.toISOString(),
    })),
  });
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
