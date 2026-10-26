// chain-truth scan: recent blog posts of the roster + who commented on them
const NODES = ["https://api.steemit.com", "https://api.stem.fans"];
async function rpc(method, params, nodeIdx = 0) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const node = NODES[(nodeIdx + attempt) % NODES.length];
    try {
      const r = await fetch(node, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
        signal: AbortSignal.timeout(15000),
      });
      const j = await r.json();
      if (j.result !== undefined) return j.result;
    } catch {}
  }
  return null;
}
const ROSTER = ["headcorner", "cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq"];
const now = Date.now();
for (const acct of ROSTER) {
  const posts = await rpc("condenser_api.get_discussions_by_blog", [{ tag: acct, limit: 4 }]);
  if (!Array.isArray(posts)) { console.log(acct, "SCAN-FAIL"); continue; }
  for (const p of posts.filter(x => x.author === acct).slice(0, 2)) {
    const ageH = Math.round((now - Date.parse(p.created)) / 3600000);
    const replies = await rpc("condenser_api.get_content_replies", [acct, p.permlink]);
    const authors = (replies || []).map(c => c.author);
    const ext = authors.filter(a => !ROSTER.includes(a));
    console.log(`== ${acct} | +${ageH}h | ${p.title.slice(0, 60)} | children=${p.children} | commenters=[${authors.join(",")}] | external=${ext.length}`);
    console.log(`   body: ${String(p.body || "").replace(/\s+/g, " ").slice(0, 140)}`);
  }
}
console.log("SCAN-DONE");
