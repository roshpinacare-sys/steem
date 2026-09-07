import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

import { readArmyVault } from "@/lib/army-vault";
import { AGENT_DIR } from "@/lib/agent-env";
import { journal } from "@/lib/brain";

export const dynamic = "force-dynamic";

/**
 * SCI encrypted command bus (Task 44 · sovereign rail 95) — POST /api/ops/infra/command
 *
 * body: { to?: "all" | "<army-username>", cmd: "ping" | "status" | "sweep_now", args? }
 *
 * The command travels as a custom_json (id 'saos-cmd', 0.000 STEEM — posting
 * key ONLY) whose payload carries the memo ENCRYPTED with the operator's memo
 * key to each soldier's memo key (steem-js ECDH memo format, '#…'). Nobody
 * watching the chain can read it — but our daemon decodes it locally and
 * answers with an on-chain custom_json 'saos_ack' signed by the soldier's own
 * posting key. (95: the old 0.001-STEEM-transfer rail is retired — zero fees,
 * zero active-key use.)
 *
 * Iron rules:
 *  - operator MEMO_WIF + POSTING_WIF come from agent/.env only (95: no active key here)
 *  - soldier memo PUB comes from agent/keys/vault.json (never the wif)
 *  - every send is journaled; content stays machine-local
 */

const COMMANDS_SENT_PATH = path.join(AGENT_DIR, "commands_sent.json");
const ALLOWED = new Set(["ping", "status", "sweep_now"]);
const NAME_RE = /^[a-z][a-z0-9\-.]{2,15}$/;

interface SentEntry {
  nonce: string;
  to: string;
  cmd: string;
  txid: string;
  at: string;
}

function loadSent(): SentEntry[] {
  try {
    const j = JSON.parse(fs.readFileSync(COMMANDS_SENT_PATH, "utf8")) as SentEntry[];
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, sent: loadSent().slice(-10) });
}

export async function POST(req: NextRequest) {
  let body: { to?: string; cmd?: string; args?: Record<string, unknown> };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "גוף בקשה לא תקין" }, { status: 400 });
  }

  const cmd = String(body.cmd ?? "").trim();
  if (!ALLOWED.has(cmd)) {
    return NextResponse.json({ ok: false, error: "פקודה לא מוכרת (ping | status | sweep_now)" }, { status: 400 });
  }

  const envPath = path.join(AGENT_DIR, ".env");
  const env: Record<string, string> = {};
  try {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq > 0) env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    return NextResponse.json({ ok: false, error: "agent/.env לא קריא" }, { status: 500 });
  }
  const operator = (env.AGENT_ACCOUNT || "headcorner").toLowerCase();
  const memoWif = env.MEMO_WIF || "";
  const postingWif = env.POSTING_WIF || "";
  /* 95 — ריבוני-מלא: הפקודה עוברת custom_json (אפס-STEEM, מפתח-פרסום בלבד) —
   * לא עוד transfer של 0.001 STEEM עם המפתח-הפעיל. ההצפנה זהה (ECDH memo) —
   * רק הנשא השתנה; אף-מפתח-ראשי/פעיל לא נוגע יותר במסילת-הפיקוד. */
  if (!memoWif || !postingWif) {
    return NextResponse.json(
      { ok: false, error: "חסרים MEMO_WIF/POSTING_WIF בכספת הראשית — חבר מפתח-פרסום בכספת" },
      { status: 409 },
    );
  }

  // resolve targets
  const vault = readArmyVault();
  const all = vault.accounts.map((a) => a.username.toLowerCase());
  const toRaw = String(body.to ?? "all").trim().toLowerCase();
  let targets: Array<{ name: string; memoPub: string }> = [];
  if (toRaw === "all") {
    targets = vault.accounts
      .filter((a) => a.keys?.memo?.pub)
      .map((a) => ({ name: a.username.toLowerCase(), memoPub: a.keys.memo!.pub }));
  } else {
    if (!NAME_RE.test(toRaw)) {
      return NextResponse.json({ ok: false, error: "שם חשבון לא תקין" }, { status: 400 });
    }
    const entry = vault.accounts.find((a) => a.username.toLowerCase() === toRaw);
    if (!entry?.keys?.memo?.pub) {
      return NextResponse.json(
        { ok: false, error: `@${toRaw} לא בכספת או בלי מפתח-memo — חבר אותו דרך נוף הכספת` },
        { status: 404 },
      );
    }
    targets = [{ name: toRaw, memoPub: entry.keys.memo.pub }];
  }
  if (!targets.length) {
    return NextResponse.json({ ok: false, error: "אין חיילים עם מפתח-memo — הערוץ רדום" }, { status: 409 });
  }

  const mod = await import("steem");
  const steem = (mod.default ?? mod) as typeof import("steem");
  steem.api.setOptions({ url: process.env.RPC_URL || "https://api.steemit.com" });

  const sent: SentEntry[] = [];
  const errors: string[] = [];
  for (const t of targets) {
    const nonce = randomUUID();
    const plaintext = JSON.stringify({ v: 1, cmd, args: body.args ?? {}, nonce, ts: new Date().toISOString() });
    try {
      // ECDH memo encryption: operator memo priv → soldier memo pub.
      // steem-js contract: the message MUST start with '#' or encode()
      // passes plaintext through unchanged (measured live — Task 44 fix).
      const encrypted = steem.memo.encode(memoWif, t.memoPub, "#" + plaintext);
      if (!encrypted.startsWith("#")) {
        throw new Error("memo encryption failed (no # prefix) — aborting send");
      }
      /* 95 — נשא-ריבוני: custom_json 'saos-cmd' — אפס-STEEM · מפתח-פרסום בלבד */
      const conf = (await steem.broadcast.sendAsync(
        {
          operations: [
            [
              "custom_json",
              {
                required_auths: [],
                required_posting_auths: [operator],
                id: "saos-cmd",
                json: JSON.stringify({ v: 95, to: t.name, nonce, enc: encrypted }),
              },
            ],
          ],
          extensions: [],
        },
        [postingWif],
      )) as { id?: string };
      sent.push({ nonce, to: t.name, cmd, txid: conf?.id ?? "", at: new Date().toISOString() });
    } catch (e) {
      errors.push(`@${t.name}: ${String((e as Error).message || e).slice(0, 120)}`);
    }
  }

  if (sent.length) {
    try {
      fs.writeFileSync(COMMANDS_SENT_PATH, JSON.stringify([...loadSent(), ...sent].slice(-100), null, 2) + "\n");
    } catch {
      /* non-fatal */
    }
    await journal(
      "sci_command",
      `פקודה מוצפנת נשלחה: ${cmd} → ${sent.map((s) => "@" + s.to).join(", ")} (memo ECDH — תוכן סמוי על-השרשרת)`,
      `txids: ${sent.map((s) => s.txid.slice(0, 12) + "…").join(", ")} · ack צפוי ע"י saos_ack חתום במפתח-הפרסום של החייל`,
    );
  }

  return NextResponse.json({ ok: sent.length > 0, sent, errors }, { status: sent.length ? 200 : 502 });
}
