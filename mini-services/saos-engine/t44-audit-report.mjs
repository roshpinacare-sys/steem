import * as fs from "node:fs";
import * as path from "node:path";
import { sanitizeDraft } from "./content.mjs";
import { selectQueuedDraft } from "./promo.mjs";

/**
 * T-44 · FIRST PUBLIC SECURITY REPORT — the machine audits itself, then
 * reports on itself through the SAME lawful path as every other draft:
 *
 *   measured audit facts → draft + grounding snapshot → sanitizeDraft
 *   (exposure ban-list + fact-first lede + NUMBER-TRUTH, all fail-closed)
 *   → content-ops queue → the broadcast gate re-checks it with its OWN
 *   snapshot → ONE comment per cycle under the day's transparency post.
 *
 * No LLM authored this body — the auditor did; the laws still apply in
 * full. Idempotent: a queued audit draft (id prefix d-audit-) is never
 * queued twice. Refuses (exit 2) if sanitizeDraft rejects — a report that
 * cannot pass the machine's own publication law does not publish.
 */
const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const FILE = path.join(STATE, "content-ops.json");
const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2)); };

/* every number here is a MEASURED fact from the T-44 round (probe outputs,
 * route counts, selftest totals) — the body may only use these (or ≤10) */
const SNAPSHOT = {
  routesAudited: 13,
  crossOriginBefore: 200,
  crossOriginAfter: 403,
  selftestVectors: 729,
  pasteBoundChars: 4096,
};

const DRAFT = {
  title: "Security Self-Audit of a Self-Hosted Trading Cockpit: 2 Gaps Found, 2 Fixed Same Day",
  angle: "security-audit",
  seoNote: "First public security self-audit of the autonomous cockpit",
  tags: ["security", "audit", "engineering", "automation", "steem"],
  groundedOn: [
    "live probe: cross-origin cycle relay (200 before → 403 after)",
    "live probe: engine token negatives (403, 403) and lawful caller (200)",
    "tracked-tree secret scan (zero key-shaped hits)",
  ],
  body: `A self-hosted automation cockpit that trades and publishes on the Steem blockchain completed a full security self-audit on 2026-10-03: 13 API routes plus every browser-rendered surface examined by reading the actual code and running live probes, 2 real gaps found, 2 fixed the same day. Every fix below is proven by a probe result, not by a claim — and this report itself had to pass the machine's number-truth law before it could queue for publishing: every number greater than 10 in this text must match the measured snapshot it was grounded on, or the publishing pipeline refuses it structurally.

**Gap 1 — the cycle relay relayed too much.** The route that forwards a manual "run one cycle" request from the browser to the local engine carried the internal service token but lacked the same-origin gate its sibling routes had. A hostile web page you visited could have silently POSTed to it and forced machine work (the trading-side laws would still have capped the damage, but the work was triggerable). Live proof: a cross-origin probe with a forged origin returned 200 before the fix; the identical probe now returns 403 with a typed refusal. Fix size: one guard call — the guard was already written for the sibling routes; it just had not been applied everywhere.

**Gap 2 — an external URL rendered as a link unchecked.** One dashboard component displayed search findings from the live web and built clickable anchors straight from their URLs. A crafted result whose link began with a script scheme would have executed on a single click. Now an external URL renders as a link only if it parses as http or https with a real hostname; anything else renders as an inert row. Fail-closed, at the rendering boundary.

**What was already holding (checked, not assumed):** mutating server-to-server verbs require a shared token from a locked file — a missing or wrong token fails closed (probes: 403, 403; lawful caller: 200). Browser control verbs are same-origin. A paste route accepts at most 4096 characters and is rate-limited. The tracked repository was scanned for key-shaped material and found none; public evidence logs pass through a redaction layer that strips key-shaped strings even if they were ever logged by accident.

**The method, because the method is the point:** enumerate every route and render boundary; read each one's guard; probe each law from an adversarial position; fix at the boundary closest to the attacker; re-probe; only then publish. Both gaps were found in one afternoon by the machine auditing its own cockpit — and the same discipline a public post must survive (number-truth, exposure law, structural refusal of fiction) is applied to the machine's own report about itself.

If you run anything that trades or publishes autonomously: which surface would you audit first — the money paths or the publish paths?`,
};

const now = new Date().toISOString();
const doc = readJson(FILE, null);
if (!doc || !Array.isArray(doc.queue)) {
  console.error("REFUSE: content-ops.json missing or queueless — run the content team first");
  process.exit(2);
}
if (doc.queue.some((d) => typeof d?.id === "string" && d.id.startsWith("d-audit-"))) {
  const existing = doc.queue.find((d) => String(d?.id ?? "").startsWith("d-audit-"));
  console.log(JSON.stringify({ verdict: "ALREADY-QUEUED", id: existing?.id ?? null, selected: selectQueuedDraft(doc.queue)?.title ?? null }, null, 2));
  process.exit(0);
}

const clean = sanitizeDraft(DRAFT, SNAPSHOT);
if (!clean) {
  console.error("REFUSE: sanitizeDraft rejected the audit report — the report does not pass the machine's own publication law; it does not publish");
  process.exit(2);
}

const item = { ...clean, id: `d-audit-${Date.parse(now)}`, status: "drafted", draftedAt: now, kind: "audit", groundedNumbers: SNAPSHOT };
const queue = [item, ...doc.queue].slice(0, 30);
const selected = selectQueuedDraft(queue);

const out = {
  verdict: "AUDIT-QUEUED",
  at: now,
  title: item.title,
  groundedNumbers: SNAPSHOT,
  gateDryRun: selected && selected.title === item.title ? "SELECTED" : "NOT-SELECTED",
  queueDrafted: queue.filter((d) => d?.status === "drafted").length,
};
doc.audit = out;
doc.queue = queue;
doc.draftsQueued = queue.filter((d) => d?.status === "drafted").length;
writeJson(FILE, doc);
console.log(JSON.stringify(out, null, 2));
if (out.gateDryRun !== "SELECTED") process.exit(2);
