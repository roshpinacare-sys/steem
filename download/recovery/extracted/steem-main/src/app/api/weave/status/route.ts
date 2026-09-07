import { NextResponse } from "next/server";
import { replayWeave, readJson, FILES } from "@/lib/weave";

export const dynamic = "force-dynamic";

/**
 * GET /api/weave/status — W3: מצב-האריגה החי בתמונה-אחת.
 *
 * הכל מה-replay (הקרנל-עצמו, מהארכיון-המלא) + קבצי-הצומת/הבאצ'ר.
 * ה-API לעולם לא 500 — מצב-לא-זמין הוא מצב כנה, לא שגיאה.
 */
export async function GET() {
  const rp = replayWeave();
  if (!rp.ok) {
    return NextResponse.json({ ok: false, state: "unavailable", why: rp.why ?? "replay-failed" });
  }

  const w = rp.weave!;
  const [nodeSt, req, batcherLast, anchorState] = await Promise.all([
    readJson(FILES.NODE_STATE_FILE),
    readJson(FILES.REQ_FILE),
    readJson(FILES.LAST_FILE),
    readJson(FILES.ANCHOR_STATE_FILE),
  ]);

  const nodeStRoot = (nodeSt?.stateRoot as string) || null;
  // האימות-המתמטי = סריקת-צ'קפוינטים (עמיד-לטריות-סנפשוט-gitkeeper — ממצא-W3)
  const cps = rp.cps!;
  /* 104 — פסק-הדין-המשמעותי: שרשרת-העוגן-החי (ה-snapshot חסום-מול-הספר + cps-מעליו
   * + השורש-בגובה-הצ'קפוינט-האחרון). סריקת-הג'נזיס-המלאה נשארת-מתועדת-בכנות
   * (historicalCps) — היא-חסרה-בלוקים-עתיקים (703-709) ולכן אינה-עוד קנה-המידה. */
  const anchor = rp.anchor ?? null;
  /* 106 — פסק-הדין: hash-locks מקומיים (snapshot+root חסומים-לארכיון) + anchored-quorum
   * רשתי (≥3 חתימות-חיילים-מאומתות על הצ'קפוינט-האחרון) — דוקטרינת-המפרט. */
  const anchorOk = !!(anchor && anchor.hashMatched
    && (anchor as any).rootLocked !== false
    && anchor.finalRootMatched !== false
    && anchor.cpsAbove.matched >= 3);
  const integrity = anchor && anchor.hashMatched
    ? anchorOk
    : cps.checked > 0
      ? cps.matched === cps.checked
      : null;

  const witnesses = (w.witnesses as Record<string, string[]>) || {};
  const witnessTopics = Object.entries(witnesses).map(([k, v]) => ({
    key: k,
    topic: k.split(":")[0],
    claimHash: k.split(":")[1] || null,
    validators: v,
    quorum: v.length,
  }));

  return NextResponse.json({
    ok: true,
    chain: {
      height: rp.height,
      blocksKept: rp.blocksKept,
      truncated: rp.truncated,
      finalRoot: rp.finalRoot,
      nodeStateRoot: nodeStRoot,
      integrity,
      checkpoints: cps,
      historicalCps: cps,
      anchor,
      replayRejected: rp.rejected,
    },
    weave: {
      liveStamps: Object.keys(w.stamps || {}).length,
      cap: 1024,
      pressureSealAt: 768,
      totalStamps: w.total || 0,
      nextSeq: w.nextSeq || 1,
      lastSeal: w.lastSeal || null,
      seals: w.seals || [],
      totalSeals: (rp.st?.meta?.totalSeals as number) || 0,
      totalWitness: (rp.st?.meta?.totalWitness as number) || 0,
      witnessTopics,
    },
    pendingSealRequest: req,
    batcher: batcherLast
      ? { at: batcherLast.at, mode: batcherLast.mode, notes: batcherLast.notes, anchored: batcherLast.anchored }
      : null,
    anchorsRegistry: anchorState ? { seals: Object.keys(anchorState.anchored || {}).length, detail: anchorState.anchored || {} } : null,
    nodeWeave: nodeSt?.weave || null,
    endpoints: {
      stamp: "POST /api/weave/stamp {content|h, kind?, by?, salt?}",
      witness: "POST /api/weave/witness {topic, claimHash, validator}",
      proof: "GET /api/weave/proof?h=<64hex>",
      verifyPack: "GET /api/weave/verify-pack",
    },
  });
}
