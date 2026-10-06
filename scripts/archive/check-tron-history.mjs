/* ─────────────────────────────────────────────────────────────────────
 * THE WEAVE · check-tron-history — היסטוריה חיה מלאה של שלוש עמדות-כסף
 * (הארנק מהתמונה, המשמרת, תיבת-הפדיון) + זיהוי כל הצדדים-המקבילים.
 * ───────────────────────────────────────────────────────────────────── */
import bs58 from "bs58";
import { createHash } from "node:crypto";

const hexToT = (hex41) => {
  const payload = Buffer.from(hex41, "hex"); // 21 bytes, starts 0x41
  const chk = createHash("sha256").update(createHash("sha256").update(payload).digest()).digest().slice(0, 4);
  return bs58.encode(Buffer.concat([payload, chk]));
};
const TtoHex = (t) => Buffer.from(bs58.decode(t).slice(0, 21)).toString("hex");
const fmtDate = (ts) => ts ? new Date(ts).toISOString().slice(0, 19).replace("T", " ") + "Z" : "?";

const TARGETS = [
  { name: "ארנק-התמונה [0]", addr: "TAzZZkrwBXk59iRya7esnKVJeV1xLtqkGr" },
  { name: "משמרת (מה-active)", addr: "TYVwwuvdDmfy3shxT3cb3RKLrRCshaZxTy" },
  { name: "outbox-פדיון", addr: "TG6SrsMJjRqnqAyYM8kGZu1rgkpsgizKEn" },
];

const KNOWN = new Map([
  ["TAzZZkrwBXk59iRya7esnKVJeV1xLtqkGr", "ארנק-התמונה[0]"],
  ["TYVwwuvdDmfy3shxT3cb3RKLrRCshaZxTy", "משמרת"],
  ["TG6SrsMJjRqnqAyYM8kGZu1rgkpsgizKEn", "outbox"],
  ["TVESRr1TX1RaKzsN6TKszutJBFDPEGPx1e", "צבא-army"],
]);

for (const { name, addr } of TARGETS) {
  const addrHex = TtoHex(addr);
  console.log(`\n═══ ${name} · ${addr} (hex ${addrHex}) ═══`);
  const r = await fetch(`https://api.trongrid.io/v1/accounts/${addr}/transactions?limit=50&order_by=block_timestamp,desc&search_internal=true`);
  const j = await r.json();
  if (!j.success) { console.log("  API:", JSON.stringify(j).slice(0, 200)); continue; }
  for (const t of j.data || []) {
    const ct = t.raw_data?.contract?.[0] || {};
    const v = ct.parameter?.value || {};
    const when = fmtDate(t.block_timestamp);
    const isTo = v.to_address === addrHex;
    const IN = isTo ? "IN " : "OUT";
    if (ct.type === "TransferContract") {
      const otherHex = isTo ? v.owner_address : v.to_address;
      const other = hexToT(otherHex);
      console.log(`  ${when} ${IN} ${(v.amount / 1e6).toFixed(6)} TRX  ⟷ ${other} ${KNOWN.get(other) ? "★ " + KNOWN.get(other) : "(זר)"}`);
    } else if (ct.type === "TransferAssetContract") {
      const otherHex = isTo ? v.owner_address : v.to_address;
      const other = hexToT(otherHex);
      const asset = Buffer.from(v.asset_name || "?", "base64").toString();
      console.log(`  ${when} ${IN} asset=${asset} amount=${v.amount}  ⟷ ${other} ${KNOWN.get(other) ? "★ " + KNOWN.get(other) : "(זר)"}`);
    } else {
      console.log(`  ${when}    ${ct.type}`);
    }
  }
  await new Promise(r => setTimeout(r, 1500));
}

/* זיהוי כל הצדדים-המקבילים של ארנק-התמונה */
console.log("\n═══ זיהוי צדדים-מקבילים ═══");
const counterparties = new Set();
const r0 = await fetch("https://api.trongrid.io/v1/accounts/TAzZZkrwBXk59iRya7esnKVJeV1xLtqkGr/transactions?limit=50&order_by=block_timestamp,desc&search_internal=true");
const j0 = await r0.json();
for (const t of j0.data || []) {
  const ct = t.raw_data?.contract?.[0] || {};
  const v = ct.parameter?.value || {};
  for (const k of ["owner_address", "to_address"]) {
    if (v[k] && v[k].length === 42) counterparties.add(v[k]);
  }
}
for (const h of counterparties) {
  const t = hexToT(h);
  console.log(`  ${h} → ${t} ${KNOWN.get(t) ? "★ " + KNOWN.get(t) : ""}`);
}