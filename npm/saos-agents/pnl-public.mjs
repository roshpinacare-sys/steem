/**
 * pnl-public.mjs — מדידת-תשואה-ציבורית (דפוס-Alpha-Arena: "השוק משלם למי-שמודד בפומבי").
 *
 * חוקי-המדידה (חוזה-קשה):
 *  1. מדוד-מול-מוערך נפרדים בברזל — estimated לעולם לא נספר לתוך measured.
 *  2. fail-closed כנה — state חסר/ישן/שבור = measured:false + reason; אין-המצאת-מספרים.
 *  3. stale אחרי-STALE_MS (24h) — המדידה נחתמת "אין-ראיה-טרייה", לא-מספר-ישן-שמוצג-כחי.
 *  4. אפס-סודות — רק-שדות-ציבוריים-מוכרים נדחפים החוצה (allowlist; שדה-לא-מוכר = נזרק).
 *  5. ראיה-קודם — כל-שורה נושאת מקור (observe/economics/custodian + txid-עוגן כשיש).
 *
 * CLI: bun pnl-public.mjs  → כותב docs/measured/pnl-latest.json + docs/measured/PNL.md
 */
import fs from "node:fs";
import path from "node:path";

export const STALE_MS = 24 * 60 * 60 * 1000;
const DIR = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(DIR, "..", "..");
const MEASURED_DIR = path.join(ROOT, "docs", "measured");

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/* ── pure: קריאת-עוגן-ראיה מ-state-custodian (txid/block בלבד — allowlist) */
export function anchorEvidence(custodian) {
  const head = custodian && typeof custodian === "object" ? custodian.head : null;
  if (!head || typeof head !== "object") return null;
  const txid = typeof head.txid === "string" && head.txid.length >= 8 ? head.txid.slice(0, 16) : null;
  const block = num(head.block);
  if (!txid && block === null) return null;
  return { txid, block, at: typeof head.at === "string" ? head.at : null };
}

/* ── pure: ראיה-למסילה מ-meta (allowlist-סגור: רק-מפתחות-יומן-מוכרים, אפס-דליפה) */
const JOURNAL_KEYS = ["fillsToday", "opsPerDay", "realizedSbdTotal"];
export function railEvidence(r) {
  const meta = r && typeof r === "object" && r.meta && typeof r.meta === "object" ? r.meta : null;
  if (!meta) return null;
  const journal = {};
  let has = false;
  for (const k of JOURNAL_KEYS) {
    const v = num(meta[k]);
    if (v !== null) { journal[k] = v; has = true; }
  }
  if (!has) return null;
  return { source: "engine-journal", journal };
}

/* ── pure: עדות-מאגרת (עקרון-5.0.0-של-REA: ראיה-מוצמדת לכל-פלט) —
 * chain = עוגן-על-השרשרת (custody-anchor.json), commit = ראש-ה-custodian,
 * push = דחיפה-אחרונה (push-custody.json). משהו-שבור = null-כנה, לא-המצאה. */
export function buildEvidence({ custodian = null, custodyAnchor = null, pushCustody = null } = {}) {
  let chain = null, commit = null, push = null;
  const old = anchorEvidence(custodian);
  if (old) chain = { txid: old.txid, block: old.block ?? null, at: old.at ?? null };
  const headSha = custodian && typeof custodian === "object" && typeof custodian.head === "string" && custodian.head.length >= 40 ? custodian.head.slice(0, 12) : null;
  if (headSha) commit = { sha: headSha, at: typeof custodian.at === "string" ? custodian.at : null };
  if (custodyAnchor && typeof custodyAnchor === "object") {
    const txid = typeof custodyAnchor.txid === "string" && custodyAnchor.txid.length >= 8 ? custodyAnchor.txid.slice(0, 16) : null;
    if (txid) chain = { txid, block: num(custodyAnchor.block), at: num(custodyAnchor.at) !== null ? new Date(custodyAnchor.at).toISOString() : null };
  }
  if (pushCustody && typeof pushCustody === "object") {
    const sha = typeof pushCustody.lastPushedSha === "string" && pushCustody.lastPushedSha.length >= 40 ? pushCustody.lastPushedSha.slice(0, 12) : null;
    if (sha) push = { sha, branch: typeof pushCustody.branch === "string" ? pushCustody.branch : null, pushedAt: typeof pushCustody.pushedAt === "string" ? pushCustody.pushedAt : null };
  }
  if (!chain && !commit && !push) return null;
  return { chain, commit, push };
}

/* ── pure: טקסט-ראיה-קומפקטי למסילה — "—" כשאין-ראיה (כנות) */
export function railEvidenceText(e) {
  if (!e || typeof e !== "object" || !e.journal) return "—";
  const parts = [];
  if (e.journal.fillsToday !== undefined) parts.push(`fills=${e.journal.fillsToday}`);
  if (e.journal.opsPerDay !== undefined) parts.push(`ops=${e.journal.opsPerDay}/יום`);
  if (e.journal.realizedSbdTotal !== undefined) parts.push(`realized=${e.journal.realizedSbdTotal}SBD`);
  return parts.length ? `journal:${parts.join(" · ")}` : "—";
}

/* ── pure: בונה-מדידת-ה-PnL-הציבורית — allowlist-מלא, מדוד-מול-מוערך-מופרדים */
export function buildPublicPnl({ observe, economics, custodian = null, custodyAnchor = null, pushCustody = null, now = Date.now() } = {}) {
  const evidence = custodyAnchor || pushCustody ? buildEvidence({ custodian, custodyAnchor, pushCustody }) : anchorEvidence(custodian);
  const base = { measured: false, reason: null, generatedAt: new Date(now).toISOString(), account: null, pnl: null, inventory: null, parity: null, rails: [], totals: { measuredUsdPerDay: null, estimatedUsdPerDay: null }, evidence, source: "engine-state via pnl-public.mjs" };

  if (!observe || typeof observe !== "object") return { ...base, reason: "no-observe-state" };
  const at = typeof observe.at === "string" ? Date.parse(observe.at) : NaN;
  if (!Number.isFinite(at)) return { ...base, reason: "observe-at-unreadable" };
  const ageMs = now - at;
  if (ageMs < -60000) return { ...base, reason: "observe-at-in-future" };
  const stale = ageMs > STALE_MS;
  if (stale) return { ...base, reason: `observe-stale-${Math.round(ageMs / 3600000)}h`, observedAt: observe.at };

  /* allowlist: רק-שדות-מוכרים עוברים — שאר-ה-state נזרק בשקט (אפס-דליפה) */
  const out = { ...base, measured: true, observedAt: observe.at, ageHours: Math.round((ageMs / 3600000) * 10) / 10, account: typeof observe.account === "string" ? observe.account : null };
  if (observe.pnl && typeof observe.pnl === "object") out.pnl = { realizedSbd: num(observe.pnl.realizedSbd), realizedUsd: num(observe.pnl.realizedUsd) };
  if (observe.inventory && typeof observe.inventory === "object") out.inventory = { steem: num(observe.inventory.steem), sbd: num(observe.inventory.sbd), spOwn: num(observe.inventory.spOwn), rcPct: num(observe.inventory.rcPct) };
  if (observe.parity && typeof observe.parity === "object" || observe.band || num(observe.steemUsd) !== null) out.parity = { steemUsd: num(observe.steemUsd) ?? (observe.parity ? num(observe.parity.steemUsd) : null), sbdUsd: num(observe.sbdUsd) ?? (observe.parity ? num(observe.parity.sbdUsd) : null), bps: observe.band ? num(observe.band.bps) : null, bandOk: observe.band?.ok === true };

  /* רכבות-הכנסה: מדוד-נספר-רק-אם-measured; estimated-נשאר-מתויג ולעולם-לא-מתערבב */
  const rails = Array.isArray(economics?.rails) ? economics.rails : [];
  let sumMeasured = 0, hasMeasured = false, sumEstimated = 0, hasEstimated = false;
  out.rails = rails.map((r) => {
    if (!r || typeof r !== "object") return null;
    const row = { id: typeof r.id === "string" ? r.id : null, label: typeof r.label === "string" ? r.label : null, confidence: r.confidence === "measured" || r.confidence === "estimated" || r.confidence === "blocked" ? r.confidence : "blocked", measuredUsdPerDay: r.confidence === "measured" ? num(r.measuredUsdPerDay) : null, estimatedUsdPerDay: r.confidence === "estimated" ? num(r.estUsdPerDay) : null, note: typeof r.note === "string" ? r.note : null, evidence: railEvidence(r) };
    if (row.measuredUsdPerDay !== null) { sumMeasured += row.measuredUsdPerDay; hasMeasured = true; }
    if (row.estimatedUsdPerDay !== null) { sumEstimated += row.estimatedUsdPerDay; hasEstimated = true; }
    return row;
  }).filter(Boolean);
  out.totals = { measuredUsdPerDay: hasMeasured ? Math.round(sumMeasured * 10000) / 10000 : null, estimatedUsdPerDay: hasEstimated ? Math.round(sumEstimated * 10000) / 10000 : null };
  return out;
}

/* ── pure: הדף-הציבורי-בעברית — כנות-מלאה, בלי-עיטוף-מספרים-ישנים-כחיים */
export function publicPnlMarkdown(m) {
  const L = [];
  L.push("# מדידת-תשואה-ציבורית (SAOS)");
  L.push("");
  L.push(`> דפוס-Alpha-Arena: השוק משלם למי-שמודד בפומבי. כל-מספר כאן נשפך מהמנוע-בקוד (pnl-public.mjs) — מדוד-מול-מוערך מופרדים בברזל.`);
  L.push("");
  if (!m.measured) {
    L.push(`**אין-מדידה-פעילה** · סיבה: \`${m.reason}\` · נוצר: ${m.generatedAt}`);
    if (m.evidence && m.evidence.chain) L.push(`עוגן-שרשרת אחרון: txid \`${m.evidence.chain.txid ?? "?"}\` block ${m.evidence.chain.block ?? "?"}`);
    L.push("");
    L.push("fail-closed: אין-ראיה = אין-מספר. אין-המצאה.");
    return L.join("\n") + "\n";
  }
  L.push(`- חשבון-ציבורי: ${m.account ?? "?"} · נצפה: ${m.observedAt} (${m.ageHours}h)`);
  if (m.parity) L.push(`- parity: STEEM=$${m.parity.steemUsd} · SBD=$${m.parity.sbdUsd} · band-ok=${m.parity.bandOk} (${m.parity.bps}bps)`);
  if (m.inventory) L.push(`- מלאי-ציבורי: ${m.inventory.steem} STEEM · ${m.inventory.sbd} SBD · ${m.inventory.spOwn} SP · RC ${m.inventory.rcPct}%`);
  if (m.pnl && (m.pnl.realizedSbd !== null || m.pnl.realizedUsd !== null)) L.push(`- PnL-ממומש: ${m.pnl.realizedSbd ?? "?"} SBD ($${m.pnl.realizedUsd ?? "?"})`);
  L.push("");
  L.push("| מסילה | תיוג-אמון | מדוד $/יום | מוערך $/יום | ראיה | הערה |");
  L.push("|---|---|---|---|---|---|");
  for (const r of m.rails) L.push(`| ${r.label ?? r.id} | ${r.confidence} | ${r.measuredUsdPerDay ?? "—"} | ${r.estimatedUsdPerDay ?? "—"} | ${railEvidenceText(r.evidence)} | ${r.note ?? ""} |`);
  L.push("");
  L.push(`**סה"כ מדוד**: $${m.totals.measuredUsdPerDay ?? "0"}/יום · **סה"כ מוערך** (לא-מצטרף-למדוד): $${m.totals.estimatedUsdPerDay ?? "0"}/יום`);
  if (m.evidence && m.evidence.chain) L.push(`עוגן-שרשרת: txid \`${m.evidence.chain.txid ?? "?"}\` block ${m.evidence.chain.block ?? "?"}`);
  else if (m.evidence && m.evidence.txid) L.push(`עוגן-שרשרת: txid \`${m.evidence.txid ?? "?"}\` block ${m.evidence.block ?? "?"}`)
  if (m.evidence && m.evidence.commit) L.push(`ראש-custodian: \`${m.evidence.commit.sha}\``);
  if (m.evidence && m.evidence.push) L.push(`דחיפה-ריבונית: \`${m.evidence.push.sha}\` → ${m.evidence.push.branch ?? "?"} @ ${m.evidence.push.pushedAt ?? "?"}`);
  L.push("");
  L.push("*מדוד = נצבר-מפריטות/תשלומים-אמת. מוערך = מודל-עם-חלון-זמן-מתויג. אין-ערבוב. ראיה מוצמדת לכל-שורה; \"—\" = אין-ראיה-כנה.*");
  return L.join("\n") + "\n";
}

/* ── io: כתיבת-הדף-הציבורי (CLI) */
export function writePublicPnl(files = {}) {
  const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
  const observe = files.observe ?? readJson(path.join(DIR, "state", "observe.json"));
  const economics = files.economics ?? readJson(path.join(DIR, "state", "economics.json"));
  const custodian = files.custodian ?? readJson(path.join(DIR, "state", "custodian.json"));
  const custodyAnchor = files.custodyAnchor ?? readJson(path.join(DIR, "state", "custody-anchor.json"));
  const pushCustody = files.pushCustody ?? readJson(path.join(DIR, "state", "push-custody.json"));
  const m = buildPublicPnl({ observe, economics, custodian, custodyAnchor, pushCustody });
  fs.mkdirSync(MEASURED_DIR, { recursive: true });
  const jp = path.join(MEASURED_DIR, "pnl-latest.json");
  const mp = path.join(MEASURED_DIR, "PNL.md");
  const tmpJ = `${jp}.tmp.${process.pid}`, tmpM = `${mp}.tmp.${process.pid}`;
  fs.writeFileSync(tmpJ, JSON.stringify(m, null, 2) + "\n"); fs.renameSync(tmpJ, jp);
  fs.writeFileSync(tmpM, publicPnlMarkdown(m)); fs.renameSync(tmpM, mp);
  return { json: jp, md: mp, measured: m.measured, reason: m.reason };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const r = writePublicPnl();
  console.log(`PNL-PUBLIC ${r.measured ? "MEASURED" : `HONEST-NO-EVIDENCE (${r.reason})`} → ${r.json} + ${r.md}`);
  process.exit(0);
}
