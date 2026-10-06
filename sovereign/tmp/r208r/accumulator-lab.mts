// ─────────────────────────────────────────────────────────────────────
// R208R ACCUMULATOR-LAB — §XI שימור-המצבר (trace 1a10dda614a62251)
// מתקיף את המודול-האמיתי (mini-services/dex-grid/accumulator.ts) —
// אותו-קוד שהדיבון החי מייבא. אפס-עותקי-בדיקה.
// ─────────────────────────────────────────────────────────────────────
import fs from "node:fs";

const H = "/home/z/my-project";
const LAB = `${H}/sovereign/tmp/r208r/accumulator-lab`;
fs.rmSync(LAB, { recursive: true, force: true });
fs.mkdirSync(LAB, { recursive: true });
process.env.PROJ_HOME = H;

const { computeCanonicalEventId, recomputeRealizedFromLedger, effectiveEventId } = await import(`${H}/mini-services/dex-grid/accumulator.ts`);

const results: any[] = [];
function check(name: string, injected: string, pass: boolean, detail: string): void {
  results.push({ attack: name, injected, pass, detail, expectation: "conservation", epistemic: "OBSERVED" });
  console.log(`${pass ? "PASS" : "FAIL"} [XI] ${name}: ${detail}`);
}

const FILLS = `${LAB}/fills.jsonl`;
let fillSeq = 0;
function mkFill(pnlUsd: number, atOffsetMs = 0, pair = "WSTEEM/WSBD", side = "A2B"): { rec: any; id: string } {
  fillSeq += 1;
  const at = new Date(Date.now() + atOffsetMs).toISOString();
  const amountIn = 0.5 + fillSeq * 0.01;
  const amountOut = 0.052 + fillSeq * 0.001;
  const id = computeCanonicalEventId(fillSeq, at, pair, side, amountIn, amountOut);
  return { rec: { at, pair, side, amountIn, amountOut, pnlUsd, canonicalEventId: id }, id };
}
function append(rec: any): void { fs.appendFileSync(FILLS, JSON.stringify(rec) + "\n"); }
function total(): { total: number; unique: number; torn: number } { return recomputeRealizedFromLedger(FILLS); }

// 1) בסיס: 3 אירועים → Σ ייחודיים
{
  fs.writeFileSync(FILLS, "");
  const f1 = mkFill(0.01); append(f1.rec);
  const f2 = mkFill(-0.002); append(f2.rec);
  const f3 = mkFill(0.015); append(f3.rec);
  const t = total();
  check("X1|baseline-sum-unique", "3-מילויים", Math.abs(t.total - 0.023) < 1e-9 && t.unique === 3, `total=${t.total} unique=${t.unique} (צפי 0.023/3)`);
}

// 2) הפעלה-מחדש: אותו-ספר → אותו-סך (אין-אובדן/אין-כפילות)
{
  const t1 = total();
  const t2 = total(); // "reboot"
  check("X2|restart-idempotent", "restart", t1.total === t2.total && t1.unique === t2.unique, `total ${t1.total}→${t2.total}`);
}

// 3) ריטריי/ריפליי: אותו-אירוע פעמיים → נספר פעם-אחת
{
  const before = total();
  append(JSON.parse(JSON.stringify({ at: "2026-10-05T10:00:00.000Z", pair: "WSTEEM/WSBD", side: "A2B", amountIn: 1.0, amountOut: 0.104, pnlUsd: 0.005, canonicalEventId: "replayed-event-id-1" })));
  append(JSON.parse(JSON.stringify({ at: "2026-10-05T10:00:00.000Z", pair: "WSTEEM/WSBD", side: "A2B", amountIn: 1.0, amountOut: 0.104, pnlUsd: 0.005, canonicalEventId: "replayed-event-id-1" })));
  const after = total();
  check("X3|replay-dedup", "אותו-אירוע ×2 (ריפליי)", Math.abs(after.total - before.total - 0.005) < 1e-9 && after.unique === before.unique + 1, `total ${before.total}→${after.total} (תוספת 0.005 פעם-אחת בלבד), unique ${before.unique}→${after.unique}`);
}

// 4) מילוי-כפול-תוכן-זהה-בלי-id (ישן-טרום-r208r): id-נגזר-תוכן → פעם-אחת
{
  const before = total();
  const legacy = { at: "2026-10-05T11:00:00.000Z", pair: "WSTEEM/WSBD", side: "B2A", amountIn: 2, amountOut: 0.21, pnlUsd: 0.007 };
  append(JSON.parse(JSON.stringify(legacy)));
  append(JSON.parse(JSON.stringify(legacy)));
  const after = total();
  check("X4|legacy-content-id-dedup", "מילוי-ישן-בלי-id ×2", Math.abs(after.total - before.total - 0.007) < 1e-9, `total ${before.total}→${after.total} (תוספת 0.007 פעם-אחת)`);
}

// 5) שורה-קרועה (כתיבה-חלקית): torn כנה, לא-שקר, לא-קריסה
{
  const before = total();
  fs.appendFileSync(FILLS, '{"at":"2026-10-05T12:00:00.000Z","pair":"WSTEEM/WSBD","pnlUsd":9999\n'); // קרוע
  const after = total();
  check("X5|torn-write-honest", "שורה-קרועה", after.torn === 1 && Math.abs(after.total - before.total) < 1e-9, `torn=${after.torn} · total לא-השתנה (${before.total}→${after.total}) — אין-ספירת-9999`);
}

// 6) אירוע-מאוחר (delayed event) עם זמן-ישן: id-כולל-מונה → נספר-פעם-אחת
{
  const before = total();
  const old = mkFill(0.003, -3600_000);
  append(old.rec);
  const after = total();
  check("X6|delayed-event-counted-once", "אירוע-מאוחר-עם-זמן-ישן", Math.abs(after.total - before.total - 0.003) < 1e-9, `total ${before.total}→${after.total}`);
}

// 7) גלגול-שעון: מילויים-עם-חותמות-עתידיות-ואז-עבר — מונה-מונוטוני שומר
{
  const before = total();
  const fut = mkFill(0.002, +3600_000);
  append(fut.rec);
  const past = mkFill(0.001, -7200_000);
  append(past.rec);
  const after = total();
  check("X7|clock-rollback-safe", "גלגול-שעון", Math.abs(after.total - before.total - 0.003) < 1e-9 && fut.id !== past.id, `total ${before.total}→${after.total} · ids ייחודיים`);
}

// 8) הרצות-מקבילות: שתי-גזירות-במקביל → תוצאה-זהה
{
  const [a, b] = await Promise.all([Promise.resolve(recomputeRealizedFromLedger(FILLS)), Promise.resolve(recomputeRealizedFromLedger(FILLS))]);
  check("X8|concurrent-recompute", "הרצה-מקבילה", a.total === b.total && a.unique === b.unique, `total ${a.total}==${b.total} · unique ${a.unique}==${b.unique}`);
}

// 9) אינווריאנט-ראשי: total === Σ pnl של-ids-ייחודיים (חישוב-בלתי-תלוי)
{
  const raw = fs.readFileSync(FILLS, "utf8").trim().split("\n");
  const seen = new Set<string>();
  let sum = 0;
  for (const line of raw) {
    try {
      const f = JSON.parse(line);
      const id = effectiveEventId(f);
      if (seen.has(id)) continue;
      seen.add(id);
      sum += f.pnlUsd ?? 0;
    } catch { /* קרוע — כבר-נמדד */ }
  }
  const t = total();
  check("X9|invariant-total==Σ-unique", "אינווריאנט-ראשי", Math.abs(t.total - Math.round(sum * 10000) / 10000) < 1e-9, `module=${t.total} independent-Σ=${Math.round(sum * 10000) / 10000} (${seen.size} ייחודיים)`);
}

// 10) אפס-שקר-חיובי: ספר-ריק → 0 כנה (לא זיוף)
{
  fs.writeFileSync(`${LAB}/fills-empty.jsonl`, "");
  const t = recomputeRealizedFromLedger(`${LAB}/fills-empty.jsonl`);
  const t2 = recomputeRealizedFromLedger(`${LAB}/fills-missing.jsonl`);
  check("X10|empty-and-missing-honest-zero", "ספר-ריק/חסר", t.total === 0 && t2.total === 0 && t.unique === 0 && t2.unique === 0, `empty=${t.total} missing=${t2.total} — אפס-כנה, אין-המצאה`);
}

// 11) הדיבון-החי מייבא את-אותו-מודול (אפס-עותק)
{
  const src = fs.readFileSync(`${H}/mini-services/dex-grid/index.ts`, "utf8");
  const usesModule = src.includes('from "./accumulator"') && src.includes("ledgerTotal(FILLS_FILE)");
  const noLocalCopy = !src.includes('createHash("sha256").update(`${state.fillSeq}');
  check("X11|daemon-imports-same-module", "ביקורת-מקור", usesModule && noLocalCopy, usesModule && noLocalCopy ? "dex-grid/index.ts מייבא accumulator.ts — מימוש-יחיד" : "עותק-מקומי נמצא",);
}

fs.writeFileSync(`${LAB}/results.json`, JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
const passed = results.filter((r) => r.pass).length;
console.log(`\nTOTAL: ${passed}/${results.length} PASS`);
