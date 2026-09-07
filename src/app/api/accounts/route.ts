import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Cockpit account registry — managed real-Steem accounts (READ-ONLY registry:
 * usernames/roles only, NEVER keys).
 *
 * GET    /api/accounts          → { accounts: [{username,label,role,createdAt}] }
 * POST   /api/accounts          { username, label?, role? } → { account }
 * DELETE /api/accounts?username=X → { ok }
 *
 * On first GET, seeds @headcorner (platform owner account).
 */
const USERNAME_RE = /^[a-z0-9\-.]{3,16}$/i;
const ROLES = new Set(["main", "bot-content", "bot-capital", "vault"]);

async function seedIfEmpty() {
  const count = await db.managedAccount.count();
  if (count === 0) {
    await db.managedAccount.create({
      data: { username: "headcorner", label: "החשבון הראשי", role: "main" },
    });
  }
}

export async function GET() {
  await seedIfEmpty();
  const rows = await db.managedAccount.findMany({ orderBy: { createdAt: "asc" } });
  return NextResponse.json({ accounts: rows });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { username?: string; label?: string; role?: string };
    const username = (body.username ?? "").trim().replace(/^@/, "");
    if (!USERNAME_RE.test(username)) {
      return NextResponse.json({ error: "שם משתמש לא תקין (3-16 תווים)" }, { status: 400 });
    }
    const role = body.role && ROLES.has(body.role) ? body.role : "main";
    const account = await db.managedAccount.upsert({
      where: { username },
      update: { label: body.label ?? "", role },
      create: { username, label: body.label ?? "", role },
    });
    return NextResponse.json({ account });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "שגיאה" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const username = (req.nextUrl.searchParams.get("username") ?? "").trim().replace(/^@/, "");
  if (!username) return NextResponse.json({ error: "חסר username" }, { status: 400 });
  await db.managedAccount.deleteMany({ where: { username } });
  return NextResponse.json({ ok: true });
}
