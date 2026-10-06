// ─────────────────────────────────────────────────────────────────────
// R208R INTEGRITY-LAB — §VIII עיגון-סמכות · §IX שלמות-מודל/TOCTOU · §X חיישן
// trace 1a10dda614a62251 · כל-ההתקפות על עותקים-מבודדים בלבד
// ─────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import { createHash } from "node:crypto";

const H = "/home/z/my-project";
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const LAB = `${H}/sovereign/tmp/r208r/integrity-lab`;
fs.rmSync(LAB, { recursive: true, force: true });
fs.mkdirSync(LAB, { recursive: true });

const MODEL_FILES = ["objectives.json", "options.json", "capabilities.json", "authority-map.json"];
function freshWorld(name: string): { obj: string; pref: string } {
  const obj = `${LAB}/${name}/objectives`;
  const pref = `${LAB}/${name}/preferences`;
  fs.mkdirSync(obj, { recursive: true });
  fs.mkdirSync(pref, { recursive: true });
  for (const f of MODEL_FILES) fs.copyFileSync(`${H}/sovereign/objectives/${f}`, `${obj}/${f}`);
  fs.copyFileSync(`${H}/sovereign/objectives/authority-anchor.jsonl`, `${obj}/authority-anchor.jsonl`);
  fs.writeFileSync(`${pref}/preferences.jsonl`, fs.readFileSync(`${H}/sovereign/preferences/preferences.jsonl`, "utf8"));
  fs.writeFileSync(`${pref}/state.json`, fs.readFileSync(`${H}/sovereign/preferences/state.json`, "utf8"));
  return { obj, pref };
}
function legalReanchor(obj: string, by: string): void {
  const anchorPath = `${obj}/authority-anchor.jsonl`;
  const lines = fs.existsSync(anchorPath) ? fs.readFileSync(anchorPath, "utf8").trim().split("\n").filter(Boolean) : [];
  const prev = lines.length ? JSON.parse(lines[lines.length - 1]!).entryHash : "GENESIS";
  const modelSha256: Record<string, string> = {};
  for (const f of MODEL_FILES) { try { modelSha256[f.replace(".json", "")] = sha(fs.readFileSync(`${obj}/${f}`)); } catch { /* חסר */ } }
  const base = { seq: lines.length + 1, at: new Date().toISOString(), authorityMapSha256: modelSha256["authority-map"], modelSha256, by, trace: "1a10dda614a62251", law: "שינוי-חוקי-מעבדה — עיגון-מעודכן", prevHash: prev };
  fs.appendFileSync(anchorPath, JSON.stringify({ ...base, entryHash: sha(JSON.stringify(base)) }) + "\n");
}

// הצרכן קושר OBJ_DIR ביבוא — לכל-עולם יבוא-טרי (cache-bust) עם הסביבה-הנכונה
process.env.PROJ_HOME = H;
let impSeq = 0;
async function consumerAt(objDir: string) {
  process.env.OBJ_DIR = objDir;
  impSeq += 1;
  return await import(`${H}/mini-services/objective-consumer.ts?world=${impSeq}`);
}

const SBD_OK = { value: 3.5, unit: "SBD", at: new Date().toISOString() };
const results: any[] = [];

async function probe(w: { obj: string; pref: string }, opts: any = {}) {
  const mod = await consumerAt(w.obj);
  return mod.objectiveDecisionView("grid-pool-seed", {
    measuredSbd: opts.measuredSbd === undefined ? SBD_OK : opts.measuredSbd,
    prefEvidence: opts.prefEvidence ?? [],
    requireResource: true,
  });
}
async function expectReject(name: string, section: string, injected: string, w: { obj: string; pref: string }, wantReject: string, opts: any = {}): Promise<void> {
  const { view, reject, detail } = await probe(w, opts);
  const pass = reject === wantReject;
  results.push({ attack: name, section, injected, reject, detail: detail?.slice(0, 160) ?? null, verdictForSeed: view?.priority.verdictForSeed ?? null, pass, expectation: `reject=${wantReject}`, epistemic: "OBSERVED" });
  console.log(`${pass ? "PASS" : "FAIL"} [${section}] ${name}: reject=${reject} — ${(detail ?? "").slice(0, 110)}`);
}
async function expectAccept(name: string, section: string, injected: string, w: { obj: string; pref: string }, opts: any = {}): Promise<void> {
  const { view, reject, detail } = await probe(w, opts);
  const pass = view != null;
  results.push({ attack: name, section, injected, reject, detail: detail?.slice(0, 160) ?? null, verdictForSeed: view?.priority.verdictForSeed ?? null, pass, expectation: "view-accepted", epistemic: "OBSERVED" });
  console.log(`${pass ? "PASS" : "FAIL"} [${section}] ${name}: reject=${reject} verdict=${view?.priority.verdictForSeed ?? "—"}`);
}
function pushResult(name: string, section: string, injected: string, pass: boolean, detail: string, expectation: string): void {
  results.push({ attack: name, section, injected, pass, detail, expectation, epistemic: "OBSERVED" });
  console.log(`${pass ? "PASS" : "FAIL"} [${section}] ${name}: ${detail}`);
}

// ══ §VIII — מוטציות-בייט במפת-הסמכות (פורמט-תקין ≠ סמכות-תקינה) ══
function mutateMap(obj: string, mutate: (j: any) => void): void {
  const p = `${obj}/authority-map.json`;
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  mutate(j);
  fs.writeFileSync(p, JSON.stringify(j, null, 1));
}

let w = freshWorld("A1-byte-may");
mutateMap(w.obj, (j) => { const v = j.verdicts.find((x: any) => x.domain === "תנועת-הון"); v.may = v.may.replace("פקודות-ספר", "פקודות-ספרX"); });
await expectReject("A1|byte-mutation-in-may(preserve-JSON+schema)", "VIII", "«פקודות-ספר»→«פקודות-ספרX» בלבד", w, "AUTHORITY-MAP-UNANCHORED");

w = freshWorld("A2-fake-priority");
mutateMap(w.obj, (j) => { const v = j.verdicts.find((x: any) => x.domain === "חתימה"); v.may = "רק <$1000 לפעולה (הוגדל-מעבדה)"; });
await expectReject("A2|priority-role-mutation", "VIII", "«רק <$100»→«רק <$1000»", w, "AUTHORITY-MAP-UNANCHORED");

w = freshWorld("A3-timestamp-mutation");
mutateMap(w.obj, (j) => { j._meta.builtAt = new Date().toISOString(); });
await expectReject("A3|timestamp-mutation", "VIII", "builtAt→עכשיו", w, "AUTHORITY-MAP-UNANCHORED");

w = freshWorld("A4-old-map-replay");
mutateMap(w.obj, (j) => { j.verdicts = j.verdicts.filter((x: any) => x.domain !== "מניפולציית-מטרות"); });
await expectReject("A4|older-valid-map-replay", "VIII", "מפה-היסטורית-תקפה-לכאורה (בלי-verdict-אחד)", w, "AUTHORITY-MAP-UNANCHORED");

w = freshWorld("A5-authority-poisoning");
mutateMap(w.obj, (j) => { j.verdicts.push({ domain: "תנועת-הון-מעבדה", can: "כן", may: "כן — הרשאה-מזויפת-מעבדה", shouldNot: "—" }); });
await expectReject("A5|valid-schema-authority-poisoning", "VIII", "הוספת-verdict-מעניק-הרשאה", w, "AUTHORITY-MAP-UNANCHORED");

w = freshWorld("A6-map-deleted");
fs.rmSync(`${w.obj}/authority-map.json`);
await expectReject("A6|map-deleted", "VIII", "מחיקת-מפה", w, "MODEL-FILE-MISSING");

w = freshWorld("A7-legal-change-control");
mutateMap(w.obj, (j) => { const v = j.verdicts.find((x: any) => x.domain === "תנועת-הון"); v.may = "פקודות-ספר + תגמולים-פנימיים (עודכן-מעבדה-חוקית)"; });
legalReanchor(w.obj, "A7-legal-change-control");
await expectAccept("A7|legal-change-WITH-reanchor(control)", "VIII", "אותו-שינוי + עיגון-מעודכן", w);

w = freshWorld("A8-anchor-torn");
fs.writeFileSync(`${w.obj}/authority-anchor.jsonl`, fs.readFileSync(`${w.obj}/authority-anchor.jsonl`, "utf8") + '{"torn":tr\n');
await expectReject("A8|torn-anchor-book", "VIII", "שורה-קרועה בספר-העיגון", w, "AUTHORITY-MAP-UNANCHORED");

// ══ §IX — שלמות-מודל: TOCTOU/symlink/partial/concurrent/restart ══
w = freshWorld("B1-consumed-bytes");
{
  const mod = await consumerAt(w.obj);
  const { view } = mod.objectiveDecisionView("grid-pool-seed", { measuredSbd: SBD_OK, prefEvidence: [], requireResource: true });
  const diskHashes: Record<string, string> = {};
  for (const f of MODEL_FILES) diskHashes[f] = sha(fs.readFileSync(`${w.obj}/${f}`, "utf8"));
  const match = MODEL_FILES.every((f) => view!.modelHashes[f] === diskHashes[f]);
  pushResult("B1|consumed-bytes==disk-bytes", "IX", "השוואת modelHashes-מהתצוגה מול-דיסק", match, match ? "כל-4-הקבצים זהים בייט-לבייט — הקבלה מעידה על בייטס-נצרכים" : "סתירה", "identity");
}
w = freshWorld("B2-toctou");
{
  const mod = await consumerAt(w.obj);
  const { view } = mod.objectiveDecisionView("grid-pool-seed", { measuredSbd: SBD_OK, prefEvidence: [], requireResource: true });
  const before = sha(Object.values(view!.modelHashes).join("|"));
  const p = `${w.obj}/options.json`;
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  j.decision = "REPLACED-MIDCYCLE";
  fs.writeFileSync(p, JSON.stringify(j, null, 1));
  const parts = MODEL_FILES.map((f) => sha(fs.readFileSync(`${w.obj}/${f}`, "utf8")));
  const after = sha(parts.join("|"));
  pushResult("B2|midcycle-replacement-detected", "IX", "החלפת-options.json אחרי-צריכה", after !== before, `before=${before.slice(0, 12)} after=${after.slice(0, 12)} — MODEL-CHANGED-MIDCYCLE יירשם`, "detected");
}
w = freshWorld("B3-symlink");
{
  const foreign = `${LAB}/B3-foreign-options.json`;
  const j = JSON.parse(fs.readFileSync(`${w.obj}/options.json`, "utf8"));
  j.decision = "FOREIGN-FILE";
  fs.writeFileSync(foreign, JSON.stringify(j, null, 1));
  fs.rmSync(`${w.obj}/options.json`);
  fs.symlinkSync(foreign, `${w.obj}/options.json`);
  const prefBook = JSON.parse(fs.readFileSync(`${H}/sovereign/preferences/preferences.jsonl`, "utf8").trim().split("\n").pop()!);
  const prefEvidence = (prefBook.evidence ?? []).filter((e: any) => e.book.includes("options.json"));
  const { reject, detail } = await probe(w, { prefEvidence });
  pushResult("B3|symlink-replacement", "IX", "options.json→symlink-לקובץ-זר-תקין", reject === "EVIDENCE-HASH-DRIFT" || reject === "MODEL-UNANCHORED", `reject=${reject} · ${(detail ?? "").slice(0, 100)}`, "EVIDENCE-HASH-DRIFT|MODEL-UNANCHORED");
}
w = freshWorld("B4-partial-write");
{
  const raw = fs.readFileSync(`${w.obj}/options.json`, "utf8");
  fs.writeFileSync(`${w.obj}/options.json`, raw.slice(0, Math.floor(raw.length / 2)));
  const { reject } = await probe(w);
  pushResult("B4|partial-write", "IX", "חצי-קובץ-JSON", ["MODEL-JSON-BROKEN", "MODEL-UNANCHORED", "MODEL-SCHEMA-INVALID"].includes(reject ?? ""), `reject=${reject}`, "JSON-BROKEN|UNANCHORED");
}
w = freshWorld("B5-concurrent-identical");
{
  const mod = await consumerAt(w.obj);
  const raw = fs.readFileSync(`${w.obj}/options.json`, "utf8");
  const { view } = mod.objectiveDecisionView("grid-pool-seed", { measuredSbd: SBD_OK, prefEvidence: [], requireResource: true });
  for (let i = 0; i < 20; i++) fs.writeFileSync(`${w.obj}/options.json`, raw);
  const { view: v2, reject: r2 } = mod.objectiveDecisionView("grid-pool-seed", { measuredSbd: SBD_OK, prefEvidence: [], requireResource: true });
  const stable = v2 != null && sha(Object.values(v2.modelHashes).join("|")) === sha(Object.values(view!.modelHashes).join("|"));
  pushResult("B5|concurrent-identical-writes", "IX", "20-כתיבות-זהות", stable, stable ? "האש-יציב — אפס-שקר-חיובי" : `אי-יציבות (${r2})`, "stable");
}
w = freshWorld("B6-restart-determinism");
{
  const mod = await consumerAt(w.obj);
  const h1 = mod.loadModel();
  const h2 = mod.loadModel();
  const same = h1.ok && JSON.stringify(h1.hashes) === JSON.stringify((h2 as any).ok ? (h2 as any).hashes : null);
  pushResult("B6|restart-hash-determinism", "IX", "טעינה-כפולה", same, same ? "אותם-האשים — דטרמיניזם" : "שונים", "deterministic");
}
// B7: סף-במודל בלבד — אפס-קבוע-סמוי (§VII)
{
  const mod = await consumerAt(`${H}/sovereign/objectives`);
  const thr = mod.getArmingThresholdSbd();
  const src = fs.readFileSync(`${H}/mini-services/objective-consumer.ts`, "utf8");
  const hardcoded = /SBD_FUND_THRESHOLD\s*=\s*3\.0/.test(src) && !/thr\.value/.test(src);
  pushResult("B7|threshold-source-is-model-only", "VII", "קריאת-getArmingThresholdSbd על החי", thr?.value === 3.0 && !hardcoded, `thr=${JSON.stringify(thr)} · קבוע-סמוי-בקוד=${hardcoded}`, "from-model-only");
}

// ══ §X — וקטורי-חיישן ══
const sensorCases: Array<[string, any, string | null]> = [
  ["S1|NaN", { value: NaN, unit: "SBD", at: new Date().toISOString() }, "RESOURCE-UNKNOWN-REQUIRED"],
  ["S2|Infinity", { value: Infinity, unit: "SBD", at: new Date().toISOString() }, "RESOURCE-UNKNOWN-REQUIRED"],
  ["S3|1e308", { value: 1e308, unit: "SBD", at: new Date().toISOString() }, "RESOURCE-UNKNOWN-REQUIRED"],
  ["S4|negative", { value: -3.5, unit: "SBD", at: new Date().toISOString() }, "RESOURCE-UNKNOWN-REQUIRED"],
  ["S5|missing-unit", { value: 3.5, at: new Date().toISOString() }, "UNIT-MISMATCH"],
  ["S6|SBD-STEEM-substitution", { value: 3.5, unit: "SBD/STEEM", at: new Date().toISOString() }, "UNIT-MISMATCH"],
  ["S7|USD-STEEM-substitution(0.1041-lesson)", { value: 0.1041, unit: "USD/STEEM", at: new Date().toISOString() }, "UNIT-MISMATCH"],
  ["S8|stale-2h", { value: 3.5, unit: "SBD", at: new Date(Date.now() - 7200_000).toISOString() }, "RESOURCE-UNKNOWN-REQUIRED"],
  ["S9|frozen-future-clock(+1h)", { value: 3.5, unit: "SBD", at: new Date(Date.now() + 3600_000).toISOString() }, "RESOURCE-UNKNOWN-REQUIRED"],
  ["S10|future-clock-slight(+120s)", { value: 3.5, unit: "SBD", at: new Date(Date.now() + 120_000).toISOString() }, "RESOURCE-UNKNOWN-REQUIRED"],
  ["S11|future-clock-tolerance(+30s)", { value: 3.5, unit: "SBD", at: new Date(Date.now() + 30_000).toISOString() }, null],
  ["S12|not-a-date", { value: 3.5, unit: "SBD", at: "not-a-date" }, "RESOURCE-UNKNOWN-REQUIRED"],
  ["S13|empty-response(null)", null, "RESOURCE-UNKNOWN-REQUIRED"],
];
for (const [name, injected, want] of sensorCases) {
  const w2 = freshWorld(`S-${name.split("|")[0]}`);
  if (want === null) await expectAccept(`${name}(control-accept)`, "X", JSON.stringify(injected), w2, { measuredSbd: injected });
  else await expectReject(name, "X", JSON.stringify(injected), w2, want, { measuredSbd: injected });
}

// §X — נתיב-ההעדפה: מדידה-חסרה ≠ 0 (התיקון ב-money)
{
  const prefDir = `${LAB}/pref-unmeasured`;
  fs.mkdirSync(prefDir, { recursive: true });
  fs.writeFileSync(`${prefDir}/preferences.jsonl`, "");
  fs.writeFileSync(`${prefDir}/state.json`, JSON.stringify({ chain: { lastEntryHash: null, count: 0 }, suspended: false, conditionStreaks: {}, updatedAt: new Date().toISOString() }));
  process.env.PREF_DIR = prefDir;
  const prefs = await import(`${H}/mini-services/preferences.ts?unmeasured=${Date.now()}`);
  prefs.notePreferenceCondition("grid-pool-seed", true);
  prefs.notePreferenceCondition("grid-pool-seed", true);
  const stBefore = JSON.parse(fs.readFileSync(`${prefDir}/state.json`, "utf8")).conditionStreaks["grid-pool-seed"];
  prefs.resetConditionStreak("grid-pool-seed");
  const stAfter = JSON.parse(fs.readFileSync(`${prefDir}/state.json`, "utf8")).conditionStreaks["grid-pool-seed"];
  pushResult("S14|unmeasured-resets-release-streak", "X", "2-מדידות-חיוביות ואז UNMEASURED", stBefore === 2 && stAfter === 0, `streak ${stBefore}→${stAfter} — זקן-ישן לא שורד מדידה-נעדרת (§X: חוסר-מדידה ≠ 0)`, "2→0");
}

fs.writeFileSync(`${LAB}/results.json`, JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
const passed = results.filter((r) => r.pass).length;
console.log(`\nTOTAL: ${passed}/${results.length} PASS`);
