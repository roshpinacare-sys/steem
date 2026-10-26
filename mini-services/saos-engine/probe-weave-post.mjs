import { rpcCall } from "./measure.mjs";
const r = await rpcCall("condenser_api.get_content", ["headcorner", "the-weave-2026-10-07-muy8f0e5"]);
const p = r?.result;
if (p?.author) {
  console.log("author:", p.author, "| created:", p.created);
  console.log("parent_permlink:", p.parent_permlink, "| app:", (() => { try { return JSON.parse(p.json_metadata).app; } catch { return "?"; } })());
  console.log("body head:", String(p.body ?? "").slice(0, 300).replace(/\n/g, " | "));
} else console.log("not found");
