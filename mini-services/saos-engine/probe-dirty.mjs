import { rpcCall } from "./measure.mjs";
for (const [acct, pl] of [["lsa", null], ["israelnews", null]]) {
  const r = await rpcCall("condenser_api.get_discussions_by_blog", [{ tag: acct, limit: 4 }]);
  for (const p of (r?.result ?? []).filter((x) => x.author === acct).slice(0, 3)) {
    const rr = await rpcCall("condenser_api.get_content_replies", [acct, p.permlink]);
    for (const c of (rr?.result ?? [])) if (["lsa", "israelnews"].includes(c.author)) {
      const b = String(c.body ?? "");
      if (b.includes("—") || ["cashmachine", "haran", "israelnews", "hcsoldier", "saos"].some((w) => b.toLowerCase().includes(w)))
        console.log(c.author, "|", b.slice(0, 200).replace(/\n/g, " "));
    }
  }
}
