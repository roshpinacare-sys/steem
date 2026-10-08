import { rpcCall } from "./measure.mjs";
import { PERSONA_IDS } from "./personas.mjs";
const found = [];
for (const acct of PERSONA_IDS.slice(0, 8)) {
  const r = await rpcCall("condenser_api.get_discussions_by_blog", [{ tag: acct, limit: 3 }]);
  for (const p of (r?.result ?? []).filter((x) => x.author === acct).slice(0, 2)) {
    const rr = await rpcCall("condenser_api.get_content_replies", [acct, p.permlink]);
    for (const c of (rr?.result ?? [])) if (PERSONA_IDS.includes(c.author)) {
      const b = String(c.body ?? "");
      const dirty = b.includes("—") || ["cashmachine", "haran", "israelnews", "hcsoldier", "saos"].some((w) => b.toLowerCase().includes(w));
      if (dirty) found.push({ a: c.author, under: `${acct}/${String(p.permlink).slice(0, 24)}`, why: b.includes("—") ? "dash" : "name", body: b.slice(0, 240).replace(/\n/g, " "), created: c.created });
    }
  }
}
console.log(JSON.stringify(found, null, 1));
