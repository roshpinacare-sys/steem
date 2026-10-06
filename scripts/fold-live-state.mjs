import { readLiveEnvelopes } from "../src/lib/weave/saoslite.ts";
const SaosLive = await import("../console/saos-live.js");
const { envelopes, node } = await readLiveEnvelopes();
const r = await SaosLive.fold(envelopes.map(e => e.env));
console.log(`node=${node} envelopes=${envelopes.length} ok=${r.ok} valid=${r.valid} invalid=${r.invalid?.length ?? 0}`);
console.log("stateRoot:", r.stateRoot);
const st = r.state;
for (const [addr, tokens] of Object.entries(st.bal || {})) {
  for (const [sym, amt] of Object.entries(tokens)) {
    console.log(`BAL ${addr} ${sym}: ${Number(amt)/1000}`);
  }
}
console.log("wallets:", Object.keys(st.wallets||{}).map(w=>w.slice(0,18)+"…").join(", "));
console.log("supply:", Object.entries(st.supply||{}).map(([s,a])=>`${s}=${Number(a)/1000}`).join(", "));
console.log("treasury:", st.treasury);
