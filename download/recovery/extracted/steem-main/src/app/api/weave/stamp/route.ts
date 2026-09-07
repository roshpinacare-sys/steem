import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { replayWeave, injectTxs, rateLimit } from "@/lib/weave";

export const dynamic = "force-dynamic";

/**
 * /api/weave/stamp — W3: חותמת-קיום על רשת-האמת.
 *
 * POST { content?|h?, kind?, by?, salt? } → קבלה מיידית מהספר:
 *   · content (≤4KB) → h = sha256(content) — ה-API מזהק את התוכן האמיתי
 *   · h ישיר (64hex) — כשהמחשבה נעשית אצל הלקוח
 *   הזרקה דרך הצומת (--inject, בלוק-אחד תחת-beat.lock) — הקרנל מאמת הכל.
 *   הקבלה = אישור-מה-replay: seq + גובה + מצב-איטום. "הוכחה או לא-קרה".
 *
 * GET → 20 החותמות האחרונות (מה-block-log) + מצב-איטומן.
 */

const HEX64 = /^[0-9a-f]{64}$/;
const KIND = /^[a-z0-9-]{2,16}$/;
const BY = /^[a-z0-9-_.]{2,24}$/;

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, err: "bad-json" }, { status: 400 });
  }

  if (!rateLimit("weave-stamp", 30)) {
    return NextResponse.json({ ok: false, err: "rate-limited", note: "30 stamps/min wall — honest" }, { status: 429 });
  }

  // h: מתוכן או ישיר
  let h = "";
  if (typeof body.content === "string" && body.content.length) {
    if (body.content.length > 4096) {
      return NextResponse.json({ ok: false, err: "content-too-large", max: 4096 }, { status: 400 });
    }
    h = createHash("sha256").update(body.content as string).digest("hex");
  } else if (typeof body.h === "string") {
    h = (body.h as string).toLowerCase();
    if (!HEX64.test(h)) return NextResponse.json({ ok: false, err: "bad-hash", expect: "64 hex" }, { status: 400 });
  } else {
    return NextResponse.json({ ok: false, err: "need-content-or-h" }, { status: 400 });
  }

  const kind = typeof body.kind === "string" && body.kind ? (body.kind as string).toLowerCase() : "text";
  if (!KIND.test(kind)) return NextResponse.json({ ok: false, err: "bad-kind", expect: "^[a-z0-9-]{2,16}$" }, { status: 400 });

  const by = typeof body.by === "string" && body.by ? (body.by as string).toLowerCase() : "headcorner";
  if (!BY.test(by)) return NextResponse.json({ ok: false, err: "bad-by", expect: "^[a-z0-9-_.]{2,24}$" }, { status: 400 });

  const salt = typeof body.salt === "string" && body.salt ? (body.salt as string).toLowerCase() : null;
  if (salt && !HEX64.test(salt)) return NextResponse.json({ ok: false, err: "bad-salt", expect: "64 hex" }, { status: 400 });

  // גילוי-מוקדם-כנה (ה-confirm בהמשך נשאר-הסמכות)
  const pre = replayWeave();
  if (pre.ok && pre.stampLog && pre.weave) {
    const entry = pre.stampLog.find((e) => e.h === h);
    if (entry || pre.weave.stamps[h]) {
      return NextResponse.json({
        ok: false,
        err: "exists",
        h,
        seq: entry?.seq ?? null,
        note: "hash already woven — dedupe is a kernel guarantee",
      });
    }
  }

  const tx: Record<string, unknown> = { type: "stamp", h, kind, by, at: new Date().toISOString() };
  if (salt) tx.salt = salt;

  const inj = await injectTxs([tx]);
  if (!inj.ok) {
    return NextResponse.json({
      ok: false,
      err: "inject-failed",
      why: inj.why,
      note: inj.why === "beat-lock-held" ? "the node beat holds the lock — retry in a few seconds" : "node refused — nothing was written",
    });
  }

  // הקבלה-מה-אמת: replay ומציאת-הרישום
  const rp = replayWeave();
  const entry = rp.ok ? (rp.stampLog || []).find((e) => e.h === h) : undefined;
  if (!entry) {
    return NextResponse.json({
      ok: false,
      err: "not-applied",
      h,
      inject: inj,
      note: "kernel rejected (exists/bad-*) or replay lag — nothing claimed",
    });
  }

  const w = rp.weave!;
  const pendingSeal = (w.seals as any[])?.find((s) => entry.seq >= s.from && entry.seq <= s.to) || null;

  return NextResponse.json({
    ok: true,
    stamped: {
      h,
      seq: entry.seq,
      kind: entry.kind,
      by: entry.by,
      at: entry.at,
      block: entry.block,
      live: !pendingSeal,
      seal: pendingSeal ? { seq: pendingSeal.seq, root: pendingSeal.root } : null,
      note: pendingSeal
        ? "already sealed in batch #" + pendingSeal.seq + " — certificate at /api/weave/proof?h=" + h
        : "live on the book — sealed in the next hourly batch, root anchored to 4 chains",
    },
    chain: { height: rp.height, nextSeq: w.nextSeq, liveStamps: Object.keys(w.stamps || {}).length },
  });
}

export async function GET() {
  const rp = replayWeave();
  if (!rp.ok) return NextResponse.json({ ok: false, state: "unavailable", why: rp.why });
  const stamps = (rp.stampLog || []).slice(-20).reverse();
  const w = rp.weave!;
  return NextResponse.json({
    ok: true,
    total: w.total || 0,
    live: Object.keys(w.stamps || {}).length,
    stamps: stamps.map((e) => {
      const seal = (w.seals as any[])?.find((s) => e.seq >= s.from && e.seq <= s.to) || null;
      return { ...e, status: seal ? "sealed" : "live", sealRoot: seal?.root ?? null, sealSeq: seal?.seq ?? null };
    }),
  });
}
