const QUERIES = {
  cashmachine: ["euro coins", "coin stack", "loose change"],
  hcsoldier5: ["city skyline night", "night market", "harbor night"],
};
const UA = "SAOS-ContentRail/1.0 (https://github.com/roshpinacare-sys/steem; sovereign-content-rail)";
async function search(query) {
  const u = new URL("https://commons.wikimedia.org/w/api.php");
  u.searchParams.set("action", "query"); u.searchParams.set("generator", "search");
  u.searchParams.set("gsrsearch", `filetype:bitmap ${query}`); u.searchParams.set("gsrlimit", "10");
  u.searchParams.set("gsrnamespace", "6"); u.searchParams.set("prop", "imageinfo");
  u.searchParams.set("iiprop", "url|mime"); u.searchParams.set("iiurlwidth", "512"); u.searchParams.set("format", "json");
  const r = await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) return [];
  const d = await r.json();
  return Object.values(d?.query?.pages ?? {}).map((p) => p.imageinfo?.[0]).filter(Boolean).filter((i) => i.mime === "image/jpeg");
}
const out = {};
for (const [account, qs] of Object.entries(QUERIES)) {
  const picks = []; const seen = new Set();
  for (const q of qs) { if (picks.length >= 2) break;
    let infos = []; try { infos = await search(q); } catch { continue; }
    for (const i of infos) { if (picks.length >= 2) break;
      const thumb = (i.thumburl ?? i.url).split("?")[0];
      const name = decodeURIComponent(thumb.split("/").pop() ?? "");
      if (seen.has(name) || !/\.jpe?g$/i.test(name)) continue;
      if (["logo","map","diagram","chart","clipart","sign"].some((b) => name.toLowerCase().includes(b))) continue;
      seen.add(name);
      if (/^https:\/\/upload\.wikimedia\.org\//.test(thumb)) picks.push({ url: thumb, file: name });
    } }
  out[account] = picks; console.error(account, picks.length);
}
console.log(JSON.stringify(out, null, 1));
