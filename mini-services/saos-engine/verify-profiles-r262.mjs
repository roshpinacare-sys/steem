import { rpcHive, HIVE_ROSTER } from "./hive.mjs";
const out = {};
for (const a of HIVE_ROSTER) {
  const r = await rpcHive("condenser_api.get_accounts", [[a]]);
  const g = r?.result?.[0];
  let prof = null;
  try { prof = JSON.parse(g?.posting_json_metadata || g?.json_metadata || "{}")?.profile ?? null; } catch {}
  out[a] = prof ? { name: prof.name, about: (prof.about ?? "").slice(0, 60), img: (prof.profile_image ?? "").slice(0, 60), cover: (prof.cover_image ?? "").slice(0, 40), location: prof.location ?? "", website: prof.website ?? "" } : null;
}
console.log(JSON.stringify(out, null, 1));
