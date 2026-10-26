import { rpcCall } from "./measure.mjs";
import { profileDoc } from "./personas.mjs";
const r = await rpcCall("condenser_api.get_accounts", [["macrame", "lsa", "siq", "tov", "wic", "wog", "woq", "hcsoldier4", "hcsoldier5", "hcsoldier6"]]);
for (const a of (r?.result ?? [])) {
  let p = {};
  try { p = JSON.parse(String(a.posting_json_metadata || "{}"))?.profile ?? {}; } catch {}
  const doc = profileDoc(a.name);
  console.log(a.name, "|", p.name ?? "EMPTY", "| img:", String(p.profile_image ?? "").includes("wikimedia") ? "wikimedia" : String(p.profile_image ?? "").slice(0, 40) || "none", "| canon:", doc?.name ?? "?");
}
