import { rpcHive } from "./hive.mjs";
import { hiveProfileDoc } from "./hive-profiles.mjs";
const r = await rpcHive("condenser_api.get_accounts", [["cashmachine", "haran", "wic"]]);
for (const a of (r?.result ?? [])) {
  let p = {};
  try { p = JSON.parse(String(a.posting_json_metadata || "{}"))?.profile ?? {}; } catch {}
  const doc = hiveProfileDoc(a.name);
  console.log(a.name, "|", p.name ?? "EMPTY", "| img:", String(p.profile_image ?? "").includes("wikimedia") ? "wikimedia" : "OLD/NONE", "| canon:", doc?.name ?? "?");
}
