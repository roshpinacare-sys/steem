const QUERIES = {
  hcsoldier5: ["night street photography", "empty street evening", "lamp post"],
  cashmachine: ["coins", "banknotes"],
  tov: ["dinner party", "meal table"],
  israelnews: ["newspaper coffee", "reading newspaper"],
};
const UA = "SAOS-ContentRail/1.0 (https://github.com/roshpinacare-sys/steem; sovereign-content-rail)";
const baseName = (u) => { try { const x = new URL(u); return decodeURIComponent(x.pathname.split("/").pop() ?? ""); } catch { return u; } };
const BAD_HINTS = ["logo", "plaque", "sign", "coat of arms", "flag", "map", "diagram", "chart", "clipart"];
async function search(query) {
  const u = new URL("https://commons.wikimedia.org/w/api.php");
  u.searchParams.set("action", "query"); u.searchParams.set("generator", "search");
  u.searchParams.set("gsrsearch", `filetype:bitmap ${query}`); u.searchParams.set("gsrlimit", "8");
  u.searchParams.set("gsrnamespace", "6"); u.searchParams.set("prop", "imageinfo");
  u.searchParams.set("iiprop", "url|mime"); u.searchParams.set("iiurlwidth", "512"); u.searchParams.set("format", "json");
  const r = await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) return [];
  const d = await r.json();
  return Object.values(d?.query?.pages ?? {}).map((p) => p.imageinfo?.[0]).filter(Boolean).filter((i) => i.mime === "image/jpeg");
}
async function headOk(url) {
  try { const r = await fetch(url, { method: "HEAD", headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12000) });
    return r.ok && (r.headers.get("content-type") ?? "").startsWith("image/"); } catch { return false; }
}
const out = {};
for (const [account, qs] of Object.entries(QUERIES)) {
  const picks = []; const seen = new Set();
  for (const q of qs) { if (picks.length >= 2) break;
    let infos = []; try { infos = await search(q); } catch { continue; }
    for (const i of infos) { if (picks.length >= 2) break;
      const thumb = (i.thumburl ?? i.url).split("?")[0]; const name = baseName(thumb);
      if (seen.has(name) || !/\.jpe?g$/i.test(name)) continue;
      if (BAD_HINTS.some((b) => name.toLowerCase().includes(b))) continue;
      seen.add(name);
      if (/^https:\/\/upload\.wikimedia\.org\//.test(thumb) && (await headOk(thumb))) picks.push({ url: thumb, from: q, file: name });
    } }
  out[account] = picks; console.error(`${account}: ${picks.length}`);
}
console.log(JSON.stringify(out, null, 1));
