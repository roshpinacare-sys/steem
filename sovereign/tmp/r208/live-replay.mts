// R208 §XVIII — שחזור-חי-קריאה-בלבד אחרי-מוות: אותן-ראיות → אותה-הכרעה.
// קריאה בלבד לספרים החיים (בלי כתיבת-תחזיות — אלה נכתבות רק בגבול-חי אמיתי).
import { objectiveDecisionView, predictWaveDecision } from "/home/z/my-project/mini-services/objective-consumer.ts";
import { waveDecision } from "/home/z/my-project/mini-services/wave-decision.ts";
import { activeDown, verifyChain } from "/home/z/my-project/mini-services/preferences.ts";
import { createHash } from "node:crypto";

const sbdLive = 0.015; // מדידה-חיה 19:18Z (zero-point) — unit SBD
const run = (sbd: number, label: string) => {
  const prefEntry = activeDown("grid-pool-seed");
  const { view, reject, detail } = objectiveDecisionView("grid-pool-seed", {
    measuredSbd: { value: sbd, at: new Date().toISOString(), unit: "SBD" },
    prefEvidence: prefEntry?.evidence ?? [],
    requireResource: true,
  });
  const wd = waveDecision({
    now: new Date().toISOString(), today: "2030-01-01",
    measCredible: true, waveDelta: 220, idleNow: 210, totalSteemNow: 219.415,
    lastStreamDay: null, waveSteem: 200, share: 0.2,
    prefDown: prefEntry ? { seq: prefEntry.seq, expiresAt: String(prefEntry.expiresAt ?? ""), evidenceBooks: (prefEntry.evidence ?? []).map((e) => e.book.split("/").pop() ?? e.book), confidence: String(prefEntry.confidence ?? "medium") } : null,
    view, viewRejectReason: reject,
  });
  console.log(JSON.stringify({ label, sbd, prefActive: !!prefEntry, viewReject: reject, rejectDetail: detail, seedVerdict: view?.priority?.verdictForSeed ?? null, epistemic: view?.epistemicStatus ?? null, authorityForbidden: view?.authorityStatus?.forbidden ?? null, expected: predictWaveDecision({ waveFires: true, prefDown: !!prefEntry, view, viewRejectReason: reject, authorityForbidden: view?.authorityStatus?.forbidden === true }), decision: wd.kind, reasonHead: wd.reason.slice(0, 120), modelHashHead: view ? (view.modelHashes["authority-map.json"] ?? "").slice(0, 12) : null }));
  return wd.kind;
};
const chain = verifyChain();
console.log(JSON.stringify({ prefChain: chain }));
const a = run(sbdLive, "A-live-truth-post-restart");
const b = run(3.5, "B-one-variable-sbd-funded");
console.log(JSON.stringify({ sameDecision: a === b, changed: a !== b }));
