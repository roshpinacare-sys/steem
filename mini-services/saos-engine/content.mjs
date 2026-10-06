/**
 * content.mjs — T-22 · THE CONTENT TEAM (דיונים-חכמים ברשת, בלי-חשיפה).
 * Operator order: "לדון בזה גם ברשת להעלות דברים וכו ולדון בהם עם כל
 * החשבונות בצורה חכמה ולא חושפנית שגם תקדם אותו seo וגם לא תחשוף שאנחנו
 * צבא אחד... וגם תומך בציבור הנרחב". The team DRAFTS (never broadcasts):
 * an LLM generates grounded discussion topics from the machine's own
 * measured telemetry + the web-intel findings, with an exposure law baked
 * into the system prompt. Drafts queue in state/content-ops.json; the promo
 * rail broadcasts ONLY after the credential verifies (signing gate) — the
 * pipeline is armed, the trigger is doctrine.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const FILE = path.join(STATE, "content-ops.json");
const BRIDGE = process.env.SAOS_AI_BRIDGE || "http://127.0.0.1:3000";
/* T-86: the fleet grew from 1 publisher to 11 — the drafts queue must feed
 * ≤11 posts/day, so the drafting cadence tightened from 12h to 4h
 * (3 drafts/round × 6 rounds = up to 18/day, caps still enforced downstream). */
const CADENCE_MS = Number(process.env.SAOS_CONTENT_CADENCE_MS) || 4 * 3600_000;

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
};

/** exposure law — every draft is checked AGAINST it in the pure normalizer */
const EXPOSURE_LAW = [
  "never reveal coordinated multi-account operations, internal codenames, or that accounts are connected",
  "no financial advice, no profit promises, no price targets",
  "supportive community tone — teach, ask, answer; public knowledge only",
  "SEO: concrete title, 3-5 topical tags, first paragraph must stand alone",
];

export function contentState() { return readJson(FILE, null); }

/** pure: validate one draft against the exposure law (selftest-vectorable) */
export function sanitizeDraft(d) {
  if (!d || typeof d !== "object") return null;
  const title = String(d.title ?? "").trim();
  const body = String(d.body ?? "").trim();
  if (title.length < 12 || body.length < 120) return null; // a real post, not a stub
  const tags = (Array.isArray(d.tags) ? d.tags : [])
    .map((t) => String(t).toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24))
    .filter(Boolean).slice(0, 5);
  if (tags.length < 2) return null;
  const blob = `${title}\n${body}`.toLowerCase();
  const banned = ["headcorner", "saos", "צבא", "army of accounts", "our accounts", "multi-account", "we control", "our fleet", "guaranteed profit", "price target"];
  if (banned.some((w) => blob.includes(w))) return null; // EXPOSURE-BLOCKED
  return {
    title: title.slice(0, 160), body: body.slice(0, 8000), tags,
    angle: String(d.angle ?? "").slice(0, 300) || null,
    seoNote: String(d.seoNote ?? "").slice(0, 300) || null,
    groundedOn: Array.isArray(d.groundedOn) ? d.groundedOn.slice(0, 4).map((g) => String(g).slice(0, 160)) : [],
  };
}

export async function runContent({ now = new Date().toISOString(), force = false } = {}) {
  const prev = readJson(FILE, null);
  const lastMs = prev?.draftedAt ? Date.parse(prev.draftedAt) : 0;
  if (!force && Number.isFinite(lastMs) && Date.now() - lastMs < CADENCE_MS) {
    return { verdict: "CADENCE-GATED", lastAt: prev.draftedAt, draftsQueued: (prev.queue ?? []).filter((d) => d.status === "drafted").length };
  }
  /* grounding: the drafts must stand on MEASURED state + sourced intel */
  const intel = readJson(path.join(STATE, "webintel.json"), null);
  const observe = readJson(path.join(STATE, "observe.json"), null);
  const economics = readJson(path.join(STATE, "economics.json"), null);
  const findings = (intel?.scans ?? []).flatMap((s) => (s.findings ?? []).slice(0, 2)).slice(0, 6)
    .map((f) => ({ title: f.title, host: f.host, url: f.url }));
  const telemetry = {
    parity: observe?.parity?.parity ?? null,
    venueFillsPerDay: economics?.context?.venueFillsPerDay ?? null,
    hyperOpsPerDay: (economics?.rails ?? []).find((r) => r.id === "hyper-presence")?.meta?.opsPerDay ?? null,
    curationEstUsdPerDay: (economics?.rails ?? []).find((r) => r.id === "curation")?.estUsdPerDay ?? null,
  };
  const t0 = Date.now();
  let raw = null, bridgeError = null;
  try {
    const r = await fetch(`${BRIDGE}/api/saos/ai/content`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ findings, telemetry, exposureLaw: EXPOSURE_LAW }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!r.ok) throw new Error(`bridge ${r.status}`);
    raw = await r.json();
  } catch (e) { bridgeError = String(e?.message ?? e).slice(0, 160); }

  const sanitized = (raw?.drafts ?? []).map(sanitizeDraft).filter(Boolean);
  const exposureBlocked = (raw?.drafts ?? []).length - sanitized.length;
  const queue = [
    ...sanitized.map((d, i) => ({ ...d, id: `d${Date.parse(now)}-${i}`, status: "drafted", draftedAt: now })),
    ...(Array.isArray(prev?.queue) ? prev.queue : []),
  ].slice(0, 30); // bounded queue — the rail posts per doctrine caps, never floods

  const doc = {
    draftedAt: now,
    verdict: sanitized.length > 0 ? "DRAFTS-QUEUED" : bridgeError ? "BRIDGE-DOWN" : "NO-DRAFTS",
    draftsQueued: sanitized.length, exposureBlocked,
    queue,
    law: "טיוטה נכתבת רק מקרקעין-מדודות + ממצאים-ממוקדים; חשיפה = נחסמת בטהרת-הנוסח; שידור רק אחרי אימות-חתימה (דוקטרינת-שער)",
    bridgeError,
    ms: Date.now() - t0,
  };
  writeJson(FILE, doc);
  return { verdict: doc.verdict, draftsQueued: sanitized.length, exposureBlocked, bridgeError };
}

/** recruiter evidence: fresh drafts queued = the content team is really running */
export function contentEvidence(nowMs = Date.now()) {
  const c = readJson(FILE, null);
  if (!c || !c.draftedAt) return null;
  const age = nowMs - Date.parse(c.draftedAt);
  if (!Number.isFinite(age) || age > 26 * 3600_000) return null;
  const n = (c.queue ?? []).filter((d) => d.status === "drafted").length;
  return n > 0 ? `state/content-ops.json: ${n} non-exposing drafts queued (exposure-blocked so far: ${c.exposureBlocked ?? 0}) — broadcast gated on credential` : null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runContent({ force: true }).then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => { console.error("CONTENT-FAIL", e); process.exit(1); });
}
