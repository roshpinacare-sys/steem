// R244 ground-truth interaction map via account_history (the API that works)
const NODES = ["https://api.justyy.com", "https://api.stem.fans", "https://api.steemit.com"];
let NODE = NODES[0];
async function rpc(method, params) {
  for (const n of NODES) {
    try {
      const r = await fetch(n, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(15000) });
      const j = await r.json();
      if (j.error) continue;
      NODE = n;
      return j.result;
    } catch { continue; }
  }
  return null;
}
const ARMY = ["headcorner","cashmachine","haran","israelnews","lsa","macrame","siq","tov","wic","wog","woq"];
const FLEET = new Set(ARMY);
const CUTOFF = Date.now() - 36 * 3600 * 1000; // 36h window
/* justyy caps get_account_history at 100 — paginate backwards (doctrine) */
async function historyBack(acc, pages = 4) {
  const ops = [];
  let from = -1;
  for (let p = 0; p < pages; p++) {
    const hist = await rpc("condenser_api.get_account_history", [acc, from, 100]);
    if (!hist || !hist.length) break;
    ops.push(...hist);
    const firstIdx = hist[0][0];
    if (firstIdx <= 0) break;
    const oldestTs = Date.parse(hist[0][1].timestamp + "Z");
    from = firstIdx - 1;
    if (oldestTs < CUTOFF) break;
  }
  return ops;
}
const edges = new Map(); // "a->b" -> count
const timeline = [];
let posts = 0;
for (const acc of ARMY) {
  const hist = await historyBack(acc);
  if (!hist) { timeline.push({ account: acc, error: "rpc" }); continue; }
  for (const [, ev] of hist) {
    const [type, op] = ev.op ?? [];
    const ts = Date.parse(ev.timestamp + "Z");
    if (ts < CUTOFF) continue;
    if (type === "comment") {
      if (op.parent_author && op.parent_author !== "") {
        const key = `${op.author}->${op.parent_author}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
        timeline.push({ at: ev.timestamp, from: op.author, to: op.parent_author, fleet: FLEET.has(op.parent_author), permlink: op.permlink.slice(0, 42) });
      } else posts++;
    } else if (type === "vote") {
      if (FLEET.has(op.voter) && FLEET.has(op.author) && op.voter !== op.author) {
        const key = `vote:${op.voter}->${op.author}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
  }
}
timeline.sort((a, b) => String(a.at ?? "").localeCompare(String(b.at ?? "")));
const summary = { node: NODE, windowHours: 36, posts, comments: timeline.filter(t => t.from).length, fleetComments: timeline.filter(t => t.fleet).length, externalComments: timeline.filter(t => t.from && !t.fleet).length, edges: Object.fromEntries([...edges.entries()].sort()) };
console.log(JSON.stringify({ summary, last20: timeline.slice(-20) }, null, 1));
