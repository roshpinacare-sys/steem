/**
 * probe-images2-r262.mjs — wave 2: fill the missing persona image slots.
 */
const QUERIES = {
  lsa: ["coffee cup wooden table", "old street corner", "cafe table window"],
  siq: ["rock pigeon", "park bench autumn", "city bench"],
  wic: ["forest path", "misty morning trees", "forest fog"],
  hcsoldier4: ["notebook", "fountain pen notebook", "open book pen"],
  hcsoldier5: ["street light", "street lamp night", "city night"],
  headcorner: ["toolbox", "workbench tools"],
  cashmachine: ["coins pile", "coins money"],
  macrame: ["rope knots", "rope coil"],
  tov: ["bread table", "family dinner table"],
  wog: ["magnifying glass", "test tubes"],
  woq: ["door handle", "doorway"],
  hcsoldier6: ["vegetable stall", "market vegetables"],
  israelnews: ["printing press", "newspaper reading"],
  haran: ["vise workbench", "tools wall"],
};

const UA = "SAOS-ContentRail/1.0 (https://github.com/roshpinacare-sys/steem; sovereign-content-rail)";
const baseName = (u) => { try { const x = new URL(u); return decodeURIComponent(x.pathname.split("/").pop() ?? ""); } catch { return u; } };
const BAD_HINTS = ["logo", "plaque", "sign", "coat of arms", "flag", "map", "diagram", "chart", "clipart"];

async function search(query) {
  const u = new URL("https://commons.wikimedia.org/w/api.php");
  u.searchParams.set("action", "query");
  u.searchParams.set("generator", "search");
  u.searchParams.set("gsrsearch", `filetype:bitmap ${query}`);
  u.searchParams.set("gsrlimit", "8");
  u.searchParams.set("gsrnamespace", "6");
  u.searchParams.set("prop", "imageinfo");
  u.searchParams.set("iiprop", "url|mime");
  u.searchParams.set("iiurlwidth", "512");
  u.searchParams.set("format", "json");
  const r = await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) return [];
  const d = await r.json();
  const pages = d?.query?.pages ?? {};
  return Object.values(pages).map((p) => p.imageinfo?.[0]).filter(Boolean).filter((i) => /^image\/(jpeg|png)$/.test(i.mime));
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
    if (picks.length >= 2) break;
    let infos = [];
    try { infos = await search(q); } catch { continue; }
    for (const i of infos) {
      if (picks.length >= 2) break;
      const thumb = (i.thumburl ?? i.url).split("?")[0];
      const name = baseName(thumb);
      if (seen.has(name)) continue;
      if (!/\.jpe?g$/i.test(name)) continue;
      if (BAD_HINTS.some((b) => name.toLowerCase().includes(b))) continue;
      seen.add(name);
      if (/^https:\/\/upload\.wikimedia\.org\//.test(thumb) && (await headOk(thumb))) picks.push({ url: thumb, from: q, file: name });
    }
  }
  out[account] = picks;
  console.error(`${account}: ${picks.length}`);
}
console.log(JSON.stringify(out, null, 1));
