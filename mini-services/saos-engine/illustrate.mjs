/**
 * illustrate.mjs — R254 · LEGAL IMAGES FOR EVERY POST (תמונות לפי חוק).
 *
 * OPERATOR ORDER 2026-10-07 (verbatim intent): "שימוש בתמונות לפי חוק וכו
 * לשפר עניין תוכן מאוד".
 *
 * THE LAW OF THE SOURCE: images come ONLY from Wikimedia Commons with a
 * license from the free family (Public domain / CC0 / CC BY / CC BY-SA).
 * Every image carries a MANDATORY credit line (artist, license, link to the
 * Commons file page) appended to the post body, exactly the attribution
 * those licenses ask for. No scraping of unknown-license images, no hotlink
 * roulette: if the license is not in the allowlist, the image is rejected
 * and the post ships text-only. An image is enrichment, never a blocker.
 *
 * Pure halves here are selftest vectors; the fetch stays fail-soft.
 */

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
/* Wikimedia UA policy: a descriptive UA with contact URL (measured live
 * 2026-10-07: a bare bot UA gets 403, this one gets 200). */
const UA = "SAOS-ContentRail/1.0 (https://github.com/roshpinacare-sys/steem; sovereign-content-rail)";

/* licenses we may ship WITH attribution (or none needed for PD/CC0) */
const LICENSE_ALLOW = [
  "cc0", "public domain", "cc by 2.0", "cc by 3.0", "cc by 4.0",
  "cc by-sa 2.0", "cc by-sa 3.0", "cc by-sa 4.0", "attribution only",
];

/* ── pure: license verdict ─────────────────────────────────────────────────── */
export function licenseOk(licenseShortName) {
  const l = String(licenseShortName ?? "").toLowerCase().replace("©", "").trim();
  if (!l) return false;
  return LICENSE_ALLOW.some((ok) => l.includes(ok));
}

/* ── pure: pick the best candidate (prefer landscape, mid-size, seeded) ───── */
export function pickImage(candidates, seedNum = 0) {
  const list = (Array.isArray(candidates) ? candidates : []).filter((c) => c && c.url && licenseOk(c.license));
  if (!list.length) return null;
  const scored = list.map((c, i) => {
    let s = 0;
    const w = Number(c.width ?? 0), h = Number(c.height ?? 0);
    if (w >= 800 && w <= 3000) s += 2;           // big enough to look good
    if (h > 0 && w / h >= 1.2 && w / h <= 2.4) s += 2; // landscape-ish
    if (String(c.mimeType ?? "").includes("jpeg") || String(c.url).toLowerCase().endsWith(".jpg")) s += 1;
    s += (seedNum + i) % 2 * 0.5;                 // gentle seeded variety
    return { c, s, i };
  }).sort((a, b) => b.s - a.s || a.i - b.i);
  return scored[0].c;
}

/* ── pure: the credit line — attribution is LAW, not courtesy ─────────────── */
export function creditLine(img) {
  if (!img) return null;
  const artist = String(img.artist ?? "").replace(/<[^>]*>/g, "").trim().slice(0, 120) || "unknown author";
  const license = String(img.license ?? "").trim() || "free license";
  const page = String(img.page ?? "");
  const link = page ? `[${page}](${page})` : "Wikimedia Commons";
  return `Image: ${artist}, ${license}, via Wikimedia Commons: ${link}`;
}

/* ── pure: embed image + credit into a markdown body (idempotent) ─────────── */
export function embedImage(body, img) {
  if (!img || !img.url) return String(body ?? "");
  const alt = String(img.alt ?? "").replace(/[[\]]/g, "").slice(0, 160) || "illustration";
  const credit = creditLine(img);
  const block = `\n\n![${alt}](${img.url})\n\n*${credit}*\n`;
  const b = String(body ?? "");
  return b.includes(img.url) ? b : b + block;
}

/* ── IO: search Commons for a free-license image ──────────────────────────── */
export async function fetchCommonsImages(query, { limit = 6, timeoutMs = 15000 } = {}) {
  const q = String(query ?? "").trim().slice(0, 120);
  if (!q) return [];
  const params = new URLSearchParams({
    action: "query", format: "json", generator: "search",
    gsrsearch: `filetype:bitmap ${q}`, gsrnamespace: "6", gsrlimit: String(limit),
    prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiurlwidth: "1200",
  });
  try {
    const r = await fetch(`${COMMONS_API}?${params}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return [];
    const d = await r.json();
    const pages = d?.query?.pages ?? {};
    const out = [];
    for (const p of Object.values(pages)) {
      const ii = Array.isArray(p.imageinfo) ? p.imageinfo[0] : null;
      if (!ii) continue;
      const meta = ii.extmetadata ?? {};
      const clean = (x) => String(x?.value ?? "").replace(/<[^>]*>/g, "").trim();
      out.push({
        title: String(p.title ?? "").replace(/^File:/, ""),
        url: ii.thumburl || ii.url,
        width: ii.thumbwidth ?? ii.width, height: ii.thumbheight ?? ii.height,
        mimeType: ii.mime,
        license: clean(meta.LicenseShortName),
        artist: clean(meta.Artist),
        page: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(String(p.title ?? "").replace(/^File:/, ""))}`,
        description: clean(meta.ImageDescription).slice(0, 200),
      });
    }
    return out;
  } catch { return []; }
}

/* query builder: tags are CONCRETE nouns (food, diy, photography) — the
 * measured lesson: abstract topic hints return 0 Commons hits. Two-tier
 * query: tags[0..1], then tags[0] alone. */
export function queryFor(topic, tags = [], title = "") {
  const t = (Array.isArray(tags) ? tags : []).map((x) => String(x).replace(/[^a-zA-Z\s]/g, " ").trim()).filter((x) => x.length > 2 && !/^(life|story|howto|psychology|education|philosophy|technology|health)$/i.test(x));
  return t.length >= 2 ? `${t[0]} ${t[1]}` : t.length === 1 ? t[0] : String(title ?? "").split(/\s+/).slice(0, 3).join(" ");
}

/* ── state: per-day cache so one post never re-fetches twice ──────────────── */
import * as fs from "node:fs";
import * as path from "node:path";
const DIR = path.dirname(new URL(import.meta.url).pathname);
const CACHE = path.join(DIR, "state", "illustrations.json");
const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); };

/** best-effort: one legal image for a draft (fail-soft → null = text-only) */
export async function illustrateDraft(draft, { seedNum = 0, now = new Date().toISOString() } = {}) {
  if (!draft || !draft.title) return null;
  const day = String(now).slice(0, 10);
  const cache = readJson(CACHE, { day, items: {} });
  const key = `${day}|${String(draft.title).slice(0, 60)}`;
  if (cache.items?.[key]) return cache.items[key].img ?? null;
  /* two-tier query: tags-pair, then tags[0] alone — the measured lesson */
  let cands = await fetchCommonsImages(queryFor(draft.topic ?? draft.angle ?? draft.title, draft.tags ?? [], draft.title));
  if (!cands.length && (draft.tags ?? []).length) cands = await fetchCommonsImages(String(draft.tags[0]));
  const img = pickImage(cands, seedNum);
  const doc = { ...cache, day, at: now, items: { ...(cache.items ?? {}), [key]: { query: queryFor(draft.topic ?? draft.angle ?? draft.title, draft.tags ?? [], draft.title), found: cands.length, img: img ? { ...img, alt: draft.title.slice(0, 140) } : null } } };
  /* keep the cache bounded: today's entries only, hard-capped */
  const items = Object.entries(doc.items ?? {}).filter(([k]) => k.startsWith(day)).slice(-40);
  writeJson(CACHE, { ...doc, items: Object.fromEntries(items) });
  if (!img) return null;
  return { ...img, alt: String(draft.title).slice(0, 140) };
}
