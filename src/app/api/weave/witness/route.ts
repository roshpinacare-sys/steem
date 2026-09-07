import { NextRequest, NextResponse } from "next/server";
import { replayWeave, injectTxs, rateLimit } from "@/lib/weave";

export const dynamic = "force-dynamic";

/**
 * /api/weave/witness — W3: עדות-צי.
 *
 * POST { topic, claimHash, validator } → הצהרה חתומה-חייל על claim תחת topic.
 * dedupe לשלישייה (topic, claimHash, validator) — קוורום-ספירה = שכבת-השאילתה.
 * הזרקה דרך הצומת; הקרנל מאמת (bad-topic/bad-claim/bad-validator/dup-witness).
 *
 * GET → מפת-העדויות החיה (topics → validators).
 */
const HEX64 = /^[0-9a-f]{64}$/;
const TOPIC = /^[a-z0-9-]{2,32}$/;
const BY = /^[a-z0-9-_.]{2,24}$/;

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, err: "bad-json" }, { status: 400 });
  }

  if (!rateLimit("weave-witness", 30)) {
    return NextResponse.json({ ok: false, err: "rate-limited", note: "30 witnesses/min wall — honest" }, { status: 429 });
  }

  const topic = typeof body.topic === "string" ? (body.topic as string).toLowerCase() : "";
  if (!TOPIC.test(topic)) return NextResponse.json({ ok: false, err: "bad-topic", expect: "^[a-z0-9-]{2,32}$" }, { status: 400 });

  const claimHash = typeof body.claimHash === "string" ? (body.claimHash as string).toLowerCase() : "";
  if (!HEX64.test(claimHash)) return NextResponse.json({ ok: false, err: "bad-claim", expect: "64 hex" }, { status: 400 });

  const validator = typeof body.validator === "string" && body.validator ? (body.validator as string).toLowerCase() : "headcorner";
  if (!BY.test(validator)) return NextResponse.json({ ok: false, err: "bad-validator", expect: "^[a-z0-9-_.]{2,24}$" }, { status: 400 });

  const tx = { type: "witness", topic, claimHash, validator, at: new Date().toISOString() };
  const inj = await injectTxs([tx as Record<string, unknown>]);
  if (!inj.ok) {
    return NextResponse.json({
      ok: false,
      err: "inject-failed",
      why: inj.why,
      note: inj.why === "beat-lock-held" ? "the node beat holds the lock — retry in a few seconds" : "node refused — nothing was written",
    });
  }

  // הקבלה-מה-אמת
  const rp = replayWeave();
  const key = topic + ":" + claimHash;
  const arr = rp.ok ? ((rp.weave!.witnesses as Record<string, string[]>) || {})[key] : undefined;
  if (!arr || !arr.includes(validator)) {
    return NextResponse.json({
      ok: false,
      err: "not-applied",
      why: arr ? "dup-witness" : "missing-after-inject",
      note: "kernel rejected — nothing claimed",
    });
  }

  return NextResponse.json({
    ok: true,
    witnessed: {
      topic,
      claimHash,
      validator,
      quorum: arr.length,
      validators: arr,
      note: "witness #" + arr.length + " on this claim — quorum accrues on the book",
    },
  });
}

export async function GET() {
  const rp = replayWeave();
  if (!rp.ok) return NextResponse.json({ ok: false, state: "unavailable", why: rp.why });
  const witnesses = (rp.weave!.witnesses as Record<string, string[]>) || {};
  return NextResponse.json({
    ok: true,
    total: (rp.st?.meta?.totalWitness as number) || 0,
    topics: Object.entries(witnesses).map(([key, validators]) => ({
      topic: key.split(":")[0],
      claimHash: key.split(":")[1] || null,
      validators,
      quorum: validators.length,
    })),
  });
}
