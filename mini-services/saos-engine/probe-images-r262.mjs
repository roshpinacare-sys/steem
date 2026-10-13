/**
 * probe-images-r262.mjs — R262: pick + verify persona profile images from
 * Wikimedia Commons (the legal image contract: upload.wikimedia.org only).
 * Read-only probe: search Commons, HEAD-verify thumbs, print verified picks.
 */
const QUERIES = {
  headcorner: ["workbench", "measuring tape tool"],
  cashmachine: ["cash register"],
  haran: ["screwdriver set"],
  israelnews: ["stack of newspapers"],
  lsa: ["cafe interior", "coffee shop table"],
  macrame: ["macrame"],
  siq: ["feral pigeon city", "city park bench"],
  tov: ["dinner table friends", "potluck"],
  wic: ["forest path mist"],
  wog: ["stopwatch"],
  woq: ["open door light"],
  hcsoldier4: ["open notebook pen", "notebook writing"],
  hcsoldier5: ["street lantern night", "night city lights"],
  hcsoldier6: ["market stall"],
};

const UA = "SAOS-ContentRail/1.0 (https://github.com/roshpinacare-sys/steem; sovereign-content-rail)";

const baseName = (u) => { try { const x = new URL(u); return decodeURIComponent(x.pathname.split("/").pop() ?? ""); } catch { return u; } };
const BAD_HINTS = ["logo", "plaque", "sign", "coat of arms", "flag", "map", "diagram", "chart"];

async function search(query) {
  const u = new URL("https://commons.wikimedia.org/w/api.php");
  u.searchParams.set("action", "query");
  u.searchParams.set("generator", "search");
  u.searchParams.set("gsrsearch", `filetype:bitmap ${query}`);
  u.searchParams.set("gsrlimit", "6");
  u.searchParams.set("gsrnamespace", "6");
  u.searchParams.set("prop", "imageinfo");
  u.searchParams.set("iiprop", "url|mime");
  u.searchParams.set("iiurlwidth", "512");
  u.searchParams.set("format", "json");
  const r = await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) return [];
  const d = await r.json();
  const pages = d?.query?.pages ?? {};
  return Object.values(pages)
    .map((p) => p.imageinfo?.[0])
    .filter(Boolean)
    .filter((i) => /^image\/(jpeg|png|webp)$/.test(i.mime));
}

async function headOk(url) {
  try {
    const r = await fetch(url, { method: "HEAD", headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12000) });
    const ct = r.headers.get("content-type") ?? "";
    return r.ok && ct.startsWith("image/");
  } catch { return false; }
}

const out = {};
for (const [account, qs] of Object.entries(QUERIES)) {
  const picks = [];
  const seen = new Set();
  for (const q of qs) {
    const infos = await search(q);
    for (const i of infos) {
      const thumb = (i.thumburl ?? i.url).split("?")[0];
      const name = baseName(thumb);
      if (seen.has(name)) continue;
      if (!/\.jpe?g$/i.test(name)) continue; // photos only, no logos/pngs
      if (BAD_HINTS.some((b) => name.toLowerCase().includes(b))) continue;
      seen.add(name);
      if (/^https:\/\/upload\.wikimedia\.org\//.test(thumb) && (await headOk(thumb))) picks.push({ url: thumb, from: q, file: name });
      if (picks.length >= 2) break;
    }
    if (picks.length >= 2) break;
  }
  out[account] = picks;
  console.error(`${account}: ${picks.length} verified`);
}
console.log(JSON.stringify(out, null, 1));
