// ─────────────────────────────────────────────────────────────────────
// /api/charter/projects — לב החוזה.
//
// POST: הקמת פרויקט-צ'רטר על הרשת (טוקן-בונה נדרש):
//   1. אימות הטוקן → זהות Agent אמיתית.
//   2. אכיפת הסעיפים: שם, מטרה, תקציב, שער-הסודות, ייחודיות slug.
//   3. רישום BUILD חתום EIP-191 בספר hash-chained (appendAttestation).
//   4. פרסום לקנון: charter/registry.json + כרטיס הפרויקט.
//   5. אירוע CHARTER בספר-האירועים ה-append-only.
//
// GET: הרשימה החיה. ריפוי-עצמי: אם ה-DB ריק (איפוס-סנדבוקס) והקנון
// מחזיק מרשם — מיובא מהקנון (הקנון הוא הזיכרון, הסנדבוקס הידיים).
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  CHARTER,
  secretGate,
  verifyBuilderToken,
  budgetLeft,
  publishCanon,
  readCanonRegistry,
  readCanonEvents,
  appendCanonEvents,
  canonEventId,
  publishRegistryFromDB,
  type CanonEvent,
} from "@/lib/charter";
import { appendAttestation } from "@/lib/weave/ledger";
import { ensureDaemonAgent } from "@/lib/weave/daemons";

export const dynamic = "force-dynamic";

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 39);
}

function projectDTO(p: {
  slug: string; name: string; purpose: string; status: string;
  attSeq: number | null; attEntryHash: string | null;
  artifactsCount: number; createdAt: Date; updatedAt: Date;
  builder: { name: string; ethAddress: string };
}) {
  return {
    slug: p.slug,
    name: p.name,
    purpose: p.purpose,
    status: p.status,
    builder: { name: p.builder.name, address: p.builder.ethAddress },
    attestation: p.attSeq != null ? { seq: p.attSeq, entryHash: p.attEntryHash } : null,
    artifacts: p.artifactsCount,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    canon: `https://github.com/${CHARTER.canonRepo}/blob/main/${CHARTER.projectDir}/${p.slug}/README.md`,
  };
}

/** ריפוי-עצמי: ייבוא המרשם מהקנון כשה-DB ריק (איפוס-יומי). */
async function selfHeal(): Promise<void> {
  const count = await db.charterProject.count();
  if (count > 0) return;
  const reg = (await readCanonRegistry()) as { projects?: Array<Record<string, unknown>> } | null;
  if (!reg?.projects?.length) return;
  for (const p of reg.projects) {
    const slug = String(p.slug ?? "");
    if (!CHARTER.slugPattern.test(slug)) continue;
    const builderName = String(p.builderName ?? `healed-${slug}`);
    const builderAddress = String(p.builderAddress ?? "");
    if (!/^0x[0-9a-fA-F]{40}$/.test(builderAddress)) continue;
    // הבונה מוקם מחדש מהקנון — בלי מפתח חתימה (היסטורי, לקריאה בלבד)
    const builder = await db.agent.upsert({
      where: { ethAddress: builderAddress },
      create: {
        name: builderName,
        role: "BUILDER",
        ethAddress: builderAddress,
        pubKeyHex: "(healed-from-canon)",
        devKeyHex: null,
        status: "ACTIVE",
      },
      update: {},
    }).catch(() => null);
    if (!builder) continue;
    // R114 (חוק הסנדבוקס-הנופל): createdAt היסטורי מהמרשם (charterAt) —
    // בלעדיו כל ריפוי-מחדש מחתים "עכשיו", שורש המצב משתנה בכל ייבוא,
    // והדופק משדר עיגון חוזר על אותו תוכן בדיוק (סחף-שקר מזמני-ייבוא).
    const charterAtRaw = String(p.charterAt ?? "");
    const charterAt =
      charterAtRaw && !Number.isNaN(Date.parse(charterAtRaw))
        ? new Date(charterAtRaw)
        : null;
    await db.charterProject.upsert({
      where: { slug },
      create: {
        slug,
        name: String(p.name ?? slug),
        purpose: String(p.purpose ?? ""),
        status: String(p.status ?? "CHARTERED"),
        builderId: builder.id,
        attSeq: typeof p.attSeq === "number" ? p.attSeq : null,
        attEntryHash: p.attEntryHash ? String(p.attEntryHash) : null,
        artifactsCount: typeof p.artifacts === "number" ? p.artifacts : 0,
        ...(charterAt ? { createdAt: charterAt } : {}),
        meta: JSON.stringify({ healedFromCanon: true }),
      },
      // גם שורה קיימת מריפוי באגי (זמן-ייבוא) מותקנת לזמן ההיסטורי
      update: charterAt ? { createdAt: charterAt } : {},
    }).catch(() => undefined);
  }
}

// ── R92: ריפוי האירועים מיומן הקנון ───────────────────────────────────
//
// המרשם הוא התמונה; יומן האירועים הוא הסרט. אחרי איפוס-סנדבוקס
// ה-DB מקבל בחזרה את ההיסטוריה מ-charter/events.jsonl — אידמפוטנטי
// לפי eventId (דה-דופ), עם זמנים היסטוריים אמיתיים.

let canonEventsCache: { at: number; events: CanonEvent[] } | null = null;

async function canonEventsFresh(): Promise<CanonEvent[]> {
  if (canonEventsCache && Date.now() - canonEventsCache.at < 5 * 60_000) {
    return canonEventsCache.events;
  }
  const events = await readCanonEvents();
  canonEventsCache = { at: Date.now(), events };
  return events;
}

async function healEventsFromCanon(): Promise<number> {
  const events = await canonEventsFresh();
  if (events.length === 0) return 0;
  let imported = 0;
  for (const e of events) {
    const project = await db.charterProject.findUnique({ where: { slug: e.slug } });
    if (!project) continue; // אירוע של פרויקט שנוקה — נשאר בקנון, אין לו בית
    const marker = `"eventId":"${e.id}"`;
    const dup = await db.charterEvent.findFirst({
      where: { kind: e.kind, detail: { contains: marker } },
    });
    if (dup) continue;
    // ה-provenance נכנס ל-detail עצמו — מה ששוחזר מסומן בכנות גם ב-DB
    const detail = {
      ...(e.detail ?? {}),
      eventId: e.id,
      ...(e.restored ? { restored: true } : {}),
      ...(e.restoredFrom ? { restoredFrom: e.restoredFrom } : {}),
    };
    const at = new Date(e.at);
    if (Number.isNaN(at.getTime())) continue; // זמן שבור — לא מייבאים רפאים
    await db.charterEvent.create({
      data: {
        projectId: project.id,
        kind: e.kind,
        detail: JSON.stringify(detail),
        createdAt: at,
      },
    }).catch(() => undefined);
    imported++;
  }
  if (imported > 0) {
    // האירועים הם מקור-האמת של המונה אחרי ריפוי — מה שנספר הוא מה שקיים
    const groups = await db.charterEvent.groupBy({
      by: ["projectId"],
      where: { kind: "ARTIFACT" },
      _count: { _all: true },
    });
    for (const g of groups) {
      await db.charterProject.update({
        where: { id: g.projectId },
        data: { artifactsCount: g._count._all },
      }).catch(() => undefined);
    }
  }
  return imported;
}

// ── R92: שלמות הפניות ספר↔מרשם ────────────────────────────────────────
//
// כל פרויקט מפנה לאימות חתום (attSeq + entryHash). אם ההפניה לא
// מתרצה מול הספר — האימות המקורי חי בשושלת שאבדה — נכתבת עדות
// RESTORE חתומה (זהות DAEMON נגזרת-רשת) שמתעדת את הפער בכנות
// והופכת להפניה החדשה. שום דבר לא נמחק; האמת הישנה מתועדת בתוך
// העדות החדשה.

const RESTORE_WITNESS = "weave-charter-restore";

async function verifyAndRepairRefs(): Promise<string[]> {
  const projects = await db.charterProject.findMany();
  const repaired: string[] = [];
  for (const p of projects) {
    if (p.attSeq == null || !p.attEntryHash) continue;
    const att = await db.attestation.findUnique({ where: { seq: p.attSeq } });
    if (att && att.entryHash === p.attEntryHash) continue; // ההפניה מתרצת — תקין
    const daemon = await ensureDaemonAgent(RESTORE_WITNESS, "DAEMON");
    const evidence = JSON.stringify(
      {
        kind: "charter-reference-restore",
        slug: p.slug,
        dangling: { attSeq: p.attSeq, attEntryHash: p.attEntryHash },
        reason:
          "האימות המקורי נכתב לשושלת-ספר של הסנדבוקס ולא הוספק לשושלת ששרדה (איפוס/חוסר-סנכרון) — ההפניה תלתה באוויר",
        replacedAt: new Date().toISOString(),
      },
      null,
      2,
    );
    const att2 = await appendAttestation({
      agentId: daemon.id,
      claim: `charter-restore: ${p.slug} — הפניית אימות תלויה (seq ${p.attSeq}, hash ${p.attEntryHash.slice(0, 10)}…) הוחלפה בעדות זו`,
      claimType: "RESTORE",
      evidence,
    });
    const eventId = canonEventId(p.slug, "RESTORE", att2.createdAt.toISOString(), `restore-${att2.seq}`);
    const detail = {
      eventId,
      originalAtt: { seq: p.attSeq, entryHash: p.attEntryHash, dangling: true },
      restoredAtt: { seq: att2.seq, entryHash: att2.entryHash },
      witness: RESTORE_WITNESS,
      reason: "איפוס-סנדבוקס — האימות המקורי לא היה בשושלת הספר ששרדה",
    };
    await db.charterProject.update({
      where: { slug: p.slug },
      data: {
        attSeq: att2.seq,
        attEntryHash: att2.entryHash,
        events: {
          create: { kind: "RESTORE", detail: JSON.stringify(detail), createdAt: att2.createdAt },
        },
      },
    });
    await appendCanonEvents([
      {
        id: eventId,
        at: att2.createdAt.toISOString(),
        slug: p.slug,
        kind: "RESTORE",
        detail,
        attSeq: att2.seq,
        attEntryHash: att2.entryHash,
      },
    ]).catch(() => undefined);
    repaired.push(p.slug);
  }
  if (repaired.length > 0) {
    await publishRegistryFromDB({ restoredAt: new Date().toISOString() });
  }
  return repaired;
}

export async function GET() {
  await selfHeal();
  const eventsImported = await healEventsFromCanon();
  const refsRepaired = await verifyAndRepairRefs();
  const projects = await db.charterProject.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { _count: { select: { events: true } } },
  });
  return NextResponse.json({
    ok: true,
    count: projects.length,
    healed: { eventsImported, refsRepaired },
    projects: projects.map((p) => ({
      slug: p.slug,
      name: p.name,
      status: p.status,
      attestation: p.attSeq != null ? { seq: p.attSeq, entryHash: p.attEntryHash } : null,
      artifacts: p.artifactsCount,
      events: p._count.events,
      createdAt: p.createdAt.toISOString(),
    })),
  });
}

export async function POST(req: Request) {
  // ── סעיף 1: הטוקן ──
  const builder = await verifyBuilderToken(bearer(req));
  if (!builder) {
    return NextResponse.json(
      { ok: false, error: "טוקן-בונה חסר או לא-תקף — בקש מהמפעיל בשער המספנה" },
      { status: 401 },
    );
  }

  // ── סעיף 2: הגוף ──
  let body: { name?: unknown; purpose?: unknown; meta?: unknown; slug?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "גוף JSON חסר או שבור" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const purpose = typeof body.purpose === "string" ? body.purpose.trim() : "";
  let metaStr = "{}";
  if (body.meta != null) {
    try {
      metaStr = JSON.stringify(body.meta);
    } catch {
      return NextResponse.json({ ok: false, error: "meta אינו JSON-עביר" }, { status: 400 });
    }
  }
  if (name.length < CHARTER.nameMin || name.length > CHARTER.nameMax) {
    return NextResponse.json(
      { ok: false, error: `שם הפרויקט חייב ${CHARTER.nameMin}–${CHARTER.nameMax} תווים` },
      { status: 422 },
    );
  }
  if (purpose.length < CHARTER.purposeMin || purpose.length > CHARTER.purposeMax) {
    return NextResponse.json(
      { ok: false, error: `המטרה חייבת ${CHARTER.purposeMin}–${CHARTER.purposeMax} תווים — צ'רטר בלי מטרה מנוסחת אינו צ'רטר` },
      { status: 422 },
    );
  }
  if (metaStr.length > CHARTER.metaMax) {
    return NextResponse.json({ ok: false, error: "meta חורג מ-2000 תווים" }, { status: 422 });
  }
  const leak = secretGate(`${name}\n${purpose}\n${metaStr}`);
  if (leak) {
    return NextResponse.json(
      { ok: false, error: `שער-הסודות חסם: זוהה ${leak} בתוכן — אף מפתח לא נכנס לקנון` },
      { status: 422 },
    );
  }

  // ── סעיף 3: התקציב ──
  const budget = await budgetLeft(builder.agentId);
  if (budget.projects <= 0) {
    return NextResponse.json(
      { ok: false, error: `תקציב ההקמות להיום (UTC) אזל — ${CHARTER.projectsPerDay} ליום לבונה` },
      { status: 429 },
    );
  }

  // ── סעיף 4: ה-slug — מפורש אם ניתן, אחרת נגזר מהשם; ייחודי ובלתי-ניתן-לשינוי ──
  const slug = typeof body.slug === "string" && body.slug.trim() ? body.slug.trim() : slugify(name);
  if (!CHARTER.slugPattern.test(slug)) {
    return NextResponse.json(
      { ok: false, error: "לא ניתן לגזור slug תקני מהשם — השתמש באותיות לטיניות/ספרות/מקפים" },
      { status: 422 },
    );
  }
  const exists = await db.charterProject.findUnique({ where: { slug } });
  if (exists) {
    return NextResponse.json(
      { ok: false, error: `ה-slug "${slug}" תפוס — צ'רטר הוא חד-פעמי, בחר שם אחר` },
      { status: 409 },
    );
  }

  // ── סעיף 5: הרישום החתום — לב החוזה ──
  const evidence = JSON.stringify(
    {
      kind: "project-charter",
      slug,
      name,
      purpose,
      builder: builder.name,
      builderAddress: builder.address,
      metaHash: Buffer.from(metaStr).toString("base64").slice(0, 16),
      at: new Date().toISOString(),
    },
    null,
    2,
  );
  const att = await appendAttestation({
    agentId: builder.agentId,
    claim: `charter: ${name} [${slug}] — builder ${builder.name}`,
    claimType: "BUILD",
    evidence,
  });

  // ── סעיף 6: הפרויקט + האירוע ──
  const eventId = canonEventId(slug, "CHARTER", att.createdAt.toISOString(), att.entryHash);
  const project = await db.charterProject.create({
    data: {
      slug,
      name,
      purpose,
      status: "CHARTERED",
      builderId: builder.agentId,
      attSeq: att.seq,
      attEntryHash: att.entryHash,
      meta: metaStr,
      events: {
        create: {
          kind: "CHARTER",
          detail: JSON.stringify({
            eventId,
            attSeq: att.seq,
            entryHash: att.entryHash,
            signer: att.signerAddr,
            at: att.createdAt.toISOString(),
          }),
        },
      },
    },
    include: { builder: true },
  });

  // ── סעיף 7: הקנון — registry.json + כרטיס הפרויקט + יומן האירועים ──
  const canonCard = [
    `# ${project.name}`,
    ``,
    `| שדה | ערך |`,
    `| --- | --- |`,
    `| slug | \`${project.slug}\` |`,
    `| מצב | ${project.status} |`,
    `| בונה | ${project.builder.name} |`,
    `| זהות | \`${project.builder.ethAddress}\` |`,
    `| אימות-הקמה | seq ${att.seq} · entryHash \`${att.entryHash.slice(0, 18)}…\` |`,
    `| הוקם | ${project.createdAt.toISOString()} |`,
    ``,
    `## מטרה`,
    ``,
    project.purpose,
    ``,
    `---`,
    `צ'רטר זה נחתם EIP-191 בספר האימותים של THE WEAVE ומפורסם לקנון.`,
  ].join("\n");
  const [canonCardRes, canonRegRes, canonEvRes] = await Promise.all([
    publishCanon(
      `${CHARTER.projectDir}/${slug}/README.md`,
      canonCard,
      `charter: project "${name}" chartered by ${builder.name} (att seq ${att.seq})`,
    ),
    publishRegistryFromDB(),
    appendCanonEvents([
      {
        id: eventId,
        at: att.createdAt.toISOString(),
        slug,
        kind: "CHARTER",
        detail: {
          attSeq: att.seq,
          entryHash: att.entryHash,
          signer: att.signerAddr,
          builder: builder.name,
        },
        attSeq: att.seq,
        attEntryHash: att.entryHash,
      },
    ]),
  ]);

  return NextResponse.json(
    {
      ok: true,
      project: projectDTO(project),
      charter: {
        claim: att.claim,
        claimType: att.claimType,
        status: att.status,
        seq: att.seq,
        entryHash: att.entryHash,
        prevHash: att.prevHash,
        sig: att.sig,
        signer: att.signerAddr,
      },
      canon: {
        card: canonCardRes,
        registry: canonRegRes,
        eventsLog: canonEvRes,
      },
      budgetLeft: { projects: budget.projects - 1, artifacts: budget.artifacts },
    },
    { status: 201 },
  );
}
