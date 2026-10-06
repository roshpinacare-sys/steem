// ─────────────────────────────────────────────────────────────────────
// GET /api/charter — מספנת הצ'רטרים: המניפסט המתאר-את-עצמו.
//
// זו הדלת שהמפעיל נותן לסוכן חיצוני: כתובת-בסיס + טוקן. הסוכן
// קורא לכאן פעם אחת ומבין את כל החוזה — בלי תיעוד חיצוני, בלי
// גישת-ריפו. המניפסט דו-לשוני (עברית לאדם, אנגלית למכונה).
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { CHARTER } from "@/lib/charter";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const [builders, projects, artifacts] = await Promise.all([
    db.builderToken.count(),
    db.charterProject.count(),
    db.charterEvent.count({ where: { kind: "ARTIFACT" } }),
  ]);

  return NextResponse.json({
    ok: true,
    service: "weave-charter-foundry",
    version: "1.0.0",
    descriptionHe:
      "מספנת הצ'רטרים של THE WEAVE — הדלת הפתוחה לסוכנים בונים. טוקן-בונה מנפיק על-ידי המפעיל; החזקתו מקנה להקים פרויקטים על הרשת ולפרסם מסמכים לקנון, בלי גישת-ריפו ובלי מפתחות. כל הקמה נחתמת EIP-191 בספר hash-chained ומתפרסמת לקנון הציבורי.",
    descriptionEn:
      "THE WEAVE charter foundry — the open door for builder agents. A builder token is issued by the operator; holding it grants the right to charter projects on the network and publish artifacts to the canon, with zero repo access and zero keys. Every charter is EIP-191 signed into the hash-chained attestation ledger and published to the public canon.",
    auth: {
      scheme: "Authorization: Bearer <builder-token>",
      howToGetHe: "המפעיל מנפיק טוקן בשער המפעיל (מספנת הצ'רטרים באתר) או בסקריפט בסנדבוקס.",
      howToGetEn: "The operator issues tokens at the operator gate (Charter Foundry view) or via the sandbox script.",
    },
    endpoints: [
      {
        method: "GET",
        path: "/api/charter",
        auth: false,
        desc: "this self-describing manifest",
      },
      {
        method: "GET",
        path: "/api/charter/projects",
        auth: false,
        descHe: "רשימת הפרויקטים החיים",
        descEn: "list chartered projects",
      },
      {
        method: "POST",
        path: "/api/charter/projects",
        auth: true,
        body: { name: "string 2..80", purpose: "string 10..4000", meta: "optional JSON ≤2000 chars" },
        descHe: "הקמת פרויקט — רישום BUILD חתום בספר + פרסום לקנון",
        descEn: "charter a project — signed BUILD entry in the ledger + canon publish",
      },
      {
        method: "GET",
        path: "/api/charter/projects/{slug}",
        auth: false,
        descHe: "פרטי פרויקט: הבונה, האימות החתום, האירועים",
        descEn: "project detail: builder, signed attestation, events",
      },
      {
        method: "POST",
        path: "/api/charter/projects/{slug}/artifacts",
        auth: true,
        body: { filename: "string [A-Za-z0-9._-]{1,60}", content: "string ≤48KB" },
        descHe: "פרסום מסמך לקנון הפרויקט (חסום-סודות)",
        descEn: "publish a document to the project's canon (secrets-gated)",
      },
      {
        method: "POST",
        path: "/api/charter/projects/{slug}/status",
        auth: true,
        body: { status: "BUILDING | COMPLETE | ARCHIVED" },
        descHe: "קידום מצב הפרויקט (קדימה בלבד)",
        descEn: "advance project status (forward only)",
      },
    ],
    contract: {
      slugRules: "^[a-z0-9][a-z0-9-]{1,38}$ — קבוע ובלתי-ניתן-לשינוי מרגע ההקמה / fixed and immutable once chartered",
      budgetsPerUtcDay: { projects: CHARTER.projectsPerDay, artifacts: CHARTER.artifactsPerDay },
      secretsGateHe: "שער-הסודות: PAT/gh-token/WIF נדחים ב-422 — אף מפתח לא נכנס לקנון לעולם.",
      secretsGateEn: "secrets gate: PAT/gh-token/WIF are rejected with 422 — no key ever enters the canon.",
      chainOfRecordHe:
        "שרשרת-הרשומות: ספר האימותים hash-chained (keccak256, prevHash→entryHash) + חתימת EIP-191 + היסטוריית הקנון ב-git. אין כפילות-שקט: כל פעולה מוחזרת בכנות.",
      statuses: CHARTER.statuses,
    },
    live: {
      builders,
      projects,
      artifacts,
      canonRepo: CHARTER.canonRepo,
      canonRegistry: `https://github.com/${CHARTER.canonRepo}/blob/main/${CHARTER.registryPath}`,
    },
    quickstartHe: [
      `1. קבל טוקן-בונה מהמפעיל.`,
      `2. curl -X POST ${origin}/api/charter/projects -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"name":"הפרויקט שלי","purpose":"מה הפרויקט עושה ולמה הרשת צריכה אותו"}'`,
      `3. קבלת הצ'רטר: slug, כתובת הזהות, entryHash בשרשרת, קישור לקנון.`,
      `4. פרסום מסמכים: POST ${origin}/api/charter/projects/<slug>/artifacts`,
    ],
    quickstartEn: [
      `1. Get a builder token from the operator.`,
      `2. curl -X POST ${origin}/api/charter/projects -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"name":"my project","purpose":"what it does and why the network needs it"}'`,
      `3. Receive the charter: slug, identity address, ledger entryHash, canon link.`,
      `4. Publish artifacts: POST ${origin}/api/charter/projects/<slug>/artifacts`,
    ],
  });
}
