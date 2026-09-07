import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Console v2 — managed-account registry (docs/CONSOLE_PLAN.md §7 v2).
 * Multi-account runbook support: the console stores usernames + labels ONLY
 * (never keys) and the live panels consume the operator's selected account.
 * A new username is verified against the chain (read-only get_accounts)
 * before it is stored.
 *
 * GET            → { ok, accounts: [{ username, label, role, createdAt }] }
 * POST {username, label?, role?} → verified upsert
 * DELETE ?username=              → remove (headcorner is protected)
 */

const USERNAME_RE = /^[a-z0-9\-.]{3,16}$/i;
const RPC_URL = "https://api.steemit.com";
const MAIN_ACCOUNT = "headcorner";

let rpcId = 900;
async function accountExists(username: string): Promise<boolean | null> {
  try {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "condenser_api.get_accounts",
        params: [[username]],
        id: ++rpcId,
      }),
      cache: "no-store",
    });
    const json = (await res.json()) as { result?: unknown[] };
    return Array.isArray(json.result) && json.result.length > 0;
  } catch {
    return null; // RPC unavailable — cannot verify
  }
}

export async function GET() {
  const accounts = await db.managedAccount.findMany({
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ ok: true, accounts });
}

export async function POST(req: NextRequest) {
  let body: { username?: string; label?: string; role?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "גוף בקשה לא תקין" }, { status: 400 });
  }

  const username = (body.username ?? "").trim().replace(/^@/, "").toLowerCase();
  if (!USERNAME_RE.test(username)) {
    return NextResponse.json(
      { ok: false, error: "שם משתמש לא תקין (3-16 תווים a-z 0-9 - .)" },
      { status: 400 },
    );
  }
  const role = ["main", "bot-content", "bot-capital", "vault"].includes(body.role ?? "")
    ? (body.role as string)
    : "bot-capital";

  const exists = await accountExists(username);
  if (exists === null) {
    return NextResponse.json(
      { ok: false, error: "לא ניתן לאמת את החשבון מול השרשרת כרגע" },
      { status: 502 },
    );
  }
  if (!exists) {
    return NextResponse.json(
      { ok: false, error: `חשבון ${username} לא נמצא ברשת` },
      { status: 400 },
    );
  }

  const account = await db.managedAccount.upsert({
    where: { username },
    update: { label: body.label?.trim() ?? "", role },
    create: { username, label: body.label?.trim() ?? "", role },
  });
  return NextResponse.json({ ok: true, account });
}

export async function DELETE(req: NextRequest) {
  const username = (req.nextUrl.searchParams.get("username") ?? "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
  if (!username) {
    return NextResponse.json({ ok: false, error: "חסר username" }, { status: 400 });
  }
  if (username === MAIN_ACCOUNT) {
    return NextResponse.json(
      { ok: false, error: "לא ניתן למחוק את החשבון הראשי" },
      { status: 400 },
    );
  }
  const deleted = await db.managedAccount
    .delete({ where: { username } })
    .catch(() => null);
  if (!deleted) {
    return NextResponse.json({ ok: false, error: "החשבון לא נמצא" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
