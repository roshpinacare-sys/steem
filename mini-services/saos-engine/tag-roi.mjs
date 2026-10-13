/* ─────────────────────────────────────────────────────────────────────────
 * R291 · TAG-ROI LEARNING LOOP — which tags actually pay US.
 *
 * discovery.rankTags ranks GLOBAL tag payout volume (get_trending_tags) —
 * platform noise, not our realized returns. This module closes the loop on
 * OUR OWN chain truth: every settled curation_reward op names the post we
 * voted; the post's first tag is where the vote was spent. Aggregate SP by
 * tag over an accumulating window → order the voting rails' tag lists by
 * measured earning power. The rails keep their whitelist as the universe —
 * this only ORDERS it (reversible, data-thin fallback = policy order).
 *
 * Laws: accumulate + dedupe by op idx (union, never rewrite history);
 * per-run get_content batch ≤ 30 (RC-safe); day-guard = one full walk/day;
 * pure functions selftestable offline; zero keys.
 * ───────────────────────────────────────────────────────────────────────── */

import * as fs from "node:fs";
import * as path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const TR_FILE = path.join(STATE, "tag-roi.json");

const STEEM_NODES = ["https://api.steemit.com", "https://api.justyy.com"];
async function rpc(method, params, timeoutMs = 15000) {
  for (const base of STEEM_NODES) {
    try {
      const r = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const j = await r.json();
      if (j.error) continue;
      return { ok: true, result: j.result };
    } catch { /* next node */ }
  }
  return { ok: false, error: "all-nodes-failed" };
}

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); };
const num = (s) => parseFloat(String(s ?? "0").replace(/[^0-9.\-]/g, "")) || 0;

/* ── pure: first-tag extraction from a condenser content object ────────── */
export function firstTagOf(content) {
  if (!content || typeof content !== "object") return null;
  try {
    const meta = JSON.parse(content.json_metadata ?? "{}");
    const tags = Array.isArray(meta?.tags) ? meta.tags : [];
    const t = tags.find((x) => typeof x === "string" && x.length > 0);
    if (t) return t;
  } catch { /* fall through to community/parent */ }
  if (typeof content.community === "string" && content.community) return content.community;
  if (typeof content.parent_permlink === "string" && content.parent_permlink) return content.parent_permlink;
  return null;
}

/* ── pure: aggregate settled curation SP by tag (selftestable) ────────────
 * curationOps: [{idx, ts, sp, author, permlink}]
 * tagByPermlink: Map "author/permlink" -> tag                        */
export function aggregateTagRoi(curationOps, tagByPermlink, { vestsPerSp = 1612 } = {}) {
  const byTag = {};
  for (const op of (curationOps ?? [])) {
    const tag = tagByPermlink.get(`${op.author}/${op.permlink}`);
    if (!tag) continue; // un-resolved this run — stays pending, never guessed
    const row = (byTag[tag] ??= { tag, sp: 0, ops: 0 });
    row.sp += op.sp;
    row.ops += 1;
  }
  const rows = Object.values(byTag)
    .map((r) => ({ ...r, sp: Math.round(r.sp * 1000) / 1000, avgSpPerOp: Math.round((r.sp / Math.max(1, r.ops)) * 1000) / 1000 }))
    .sort((a, b) => (b.avgSpPerOp - a.avgSpPerOp) || (b.sp - a.sp) || a.tag.localeCompare(b.tag));
  return rows;
}

/* ── pure: order the policy tag whitelist by measured ROI (selftestable) ──
 * Law: whitelist = the universe (never add tags from the outside);
 * a tag earns promotion individually once it has ≥ minOps settled ops
 * (per-tag gate — no global quorum delaying the loop); ZERO qualifying tags
 * = data-thin fallback to policy order. Deterministic. */
export function orderTagsByRoi(policyTags, roiRows, { minOps = 3 } = {}) {
  const whitelist = (policyTags ?? []).map(String);
  const roiByTag = new Map((roiRows ?? []).map((r) => [r.tag, r]));
  const measured = whitelist.filter((t) => (roiByTag.get(t)?.ops ?? 0) >= minOps);
  if (measured.length === 0) return { tags: [...whitelist], basis: "policy-order (data-thin)" };
  const ranked = [...measured].sort((a, b) =>
    (roiByTag.get(b).avgSpPerOp - roiByTag.get(a).avgSpPerOp) || a.localeCompare(b));
  const rest = whitelist.filter((t) => !measured.includes(t));
  return { tags: [...ranked, ...rest], basis: `measured-roi (≥${minOps} ops/tag, ${measured.length} ranked)` };
}

/* ── runner ─────────────────────────────────────────────────────────────── */
export async function runTagRoi({ now = new Date().toISOString(), pages = 60 } = {}) {
  const day = String(now).slice(0, 10);
  const prev = readJson(TR_FILE, { day: null, permlinks: {}, tags: {}, lastWalk: null });
  if (prev.day === day && prev.lastWalk) {
    return { verdict: "DAY-ALREADY-WALKED", day, tagsRanked: Object.keys(prev.tags ?? {}).length };
  }

  /* walk headcorner history (condenser shapes measured in R290) */
  const ops = [];
  let start = -1;
  for (let p = 0; p < pages; p++) {
    const r = await rpc("condenser_api.get_account_history", ["headcorner", start, 100]);
    if (!r.ok) break;
    const rows = r.result ?? [];
    if (!rows.length) break;
    for (const [idx, entry] of rows) {
      const rawOp = entry?.op;
      const [type, value] = Array.isArray(rawOp) ? rawOp : [rawOp?.type, rawOp?.value];
      if (type === "curation_reward" && value?.comment_author && value?.comment_permlink) {
        ops.push({ idx, ts: entry.timestamp, author: value.comment_author, permlink: value.comment_permlink, vests: num(value.reward) });
      }
    }
    const oldest = rows[0][0];
    if (rows.length < 100 || oldest <= 1) break;
    start = oldest - 1;
    if (start < 1) break;
  }

  /* resolve tags for unseen permlinks (batch ≤ 30 per run — RC-safe) */
  const permlinks = { ...(prev.permlinks ?? {}) };
  const pending = [];
  for (const op of ops) {
    const key = `${op.author}/${op.permlink}`;
    if (!(key in permlinks) && !pending.some((x) => x.key === key)) pending.push({ key, author: op.author, permlink: op.permlink });
  }
  let resolved = 0;
  for (const p of pending.slice(0, 30)) {
    const r = await rpc("condenser_api.get_content", [p.author, p.permlink]);
    const tag = r.ok ? firstTagOf(r.result) : null;
    if (tag) {
      permlinks[p.key] = tag;
      resolved += 1;
    }
    /* R291 hotfix: unresolved keys stay ABSENT (retried on a later day, the
     * ≤30 batch cap still bounds RC per run) — the old "?"-tombstone burned
     * 13/43 permlinks permanently (measured first walk). */
  }

  /* aggregate (last 30d window over resolved permlinks) */
  const since = Date.now() - 30 * 86400_000;
  const tagByPermlink = new Map(Object.entries(permlinks).filter(([, t]) => typeof t === "string" && !t.startsWith("?")).map(([k, t]) => [k, t]));
  const dgpo = await rpc("condenser_api.get_dynamic_global_properties", []);
  const vestsPerSp = dgpo.ok ? num(dgpo.result.total_vesting_shares) / num(dgpo.result.total_vesting_fund_steem) : 1612;
  const curationOps = ops
    .filter((o) => Date.parse(o.ts.endsWith("Z") ? o.ts : o.ts + "Z") >= since)
    .map((o) => ({ idx: o.idx, ts: o.ts, author: o.author, permlink: o.permlink, sp: o.vests / vestsPerSp }));
  const rows = aggregateTagRoi(curationOps, tagByPermlink);

  writeJson(TR_FILE, {
    day, lastWalk: now, windowDays: 30,
    permlinks,
    tags: Object.fromEntries(rows.map((r) => [r.tag, r])),
    opsSeen: ops.length, resolved, verdict: rows.length ? "MEASURED" : "NO-DATA-YET",
    note: "accumulating union — permlinks resolved once, never re-fetched; only the whitelist ORDER is influenced (never the universe)",
  });

  return { verdict: rows.length ? "MEASURED" : "NO-DATA-YET", day, tagsRanked: rows.length, opsSeen: ops.length, resolved, top: rows.slice(0, 5).map((r) => `${r.tag}:${r.avgSpPerOp}`) };
}

export function tagRoiState() { return readJson(TR_FILE, null); }
