/* debug: raw history pages for one account, all nodes, show comment ops */
const NODES = ["https://api.justyy.com", "https://api.steemit.com", "https://api.stem.fans", "https://steemapi.boylikegirl.club"];
const acc = process.argv[2] ?? "wic";
async function rpc(node, method, params) {
  try {
    const res = await fetch(node, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }), signal: AbortSignal.timeout(12000) });
    const j = await res.json();
    if (j?.result !== undefined) return { ok: true, result: j.result };
    return { ok: false, err: j?.error?.message?.slice(0, 80) };
  } catch (e) { return { ok: false, err: String(e?.message ?? e).slice(0, 60) }; }
}
for (const node of NODES) {
  const head = await rpc(node, "condenser_api.get_account_history", [acc, -1, 1]);
  if (!head.ok) { console.log(node, "HEAD-ERR", head.err); continue; }
  const lastIdx = head.result?.[head.result.length - 1]?.[0] ?? 0;
  console.log(`\n${node} lastIdx=${lastIdx}`);
  let commentCount = 0;
  for (let step = 0; step < 4; step++) {
    const end = lastIdx - step * 100;
    const start = Math.max(0, end - 99);
    const hist = await rpc(node, "condenser_api.get_account_history", [acc, start, Math.min(100, end - start + 1)]);
    if (!hist.ok) { console.log(`  page ${step}: ERR ${hist.err}`); break; }
    const rows = hist.result ?? [];
    console.log(`  page ${step}: idx ${rows[0]?.[0]}..${rows[rows.length - 1]?.[0]}`);
    for (const [idx, op] of rows) {
      if (op?.op?.[0] !== "comment") continue;
      const d = op.op[1];
      if (!d.parent_author) continue;
      commentCount++;
      console.log(`    #${idx} ${op.timestamp}Z ${d.author}/${d.permlink.slice(0, 30)} p=${d.parent_author} :: ${String(d.body).slice(0, 60)}`);
    }
    if (start === 0) break;
  }
  console.log(`  comments in 4 pages: ${commentCount}`);
}
