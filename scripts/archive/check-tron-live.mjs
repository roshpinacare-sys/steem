/* ─────────────────────────────────────────────────────────────────────
 * THE WEAVE · check-tron-live — מדידה חיה של כל הכתובות הנגזרות
 * מה-mnemonic שבתמונה + כתובות הצי, מול רשת TRON (trongrid ציבורי, חסר-מפתחות).
 * ───────────────────────────────────────────────────────────────────── */
const ADDRS = [
  { src: "mnemonic m/44'/195'/0'/0/0", a: "TAzZZkrwBXk59iRya7esnKVJeV1xLtqkGr" },
  { src: "mnemonic m/44'/195'/0'/0/1", a: "TRKStC5HbWzqdnrWDfc4vYNfgQgyZuQKP4" },
  { src: "mnemonic m/44'/195'/0'/0/2", a: "TNd4aFZk1YUeP9uzUWCefJyadjCxZXBoBg" },
  { src: "mnemonic m/44'/195'/0'/0/3", a: "TDuyQNSm2XbVKNgdKgjCyHfxkzXAmo2YXG" },
  { src: "mnemonic m/44'/195'/0'/0/4", a: "TSJw2GYkmcsYNjALFaNYxySkgGfkvBD8sP" },
  { src: "mnemonic m/44'/195'/0'/0/5", a: "TLhp6hhm7RgB7xFsSTAatuWyEWpScVbJ4U" },
  { src: "mnemonic m/44'/195'/0'/0/6", a: "TWjNpvuNQwzH8yXs4hkX2NDvsdctp6xnCZ" },
  { src: "mnemonic m/44'/195'/0'/0/7", a: "TAdPSARwdBxBFFJ4vwvJfgYRpQshVwDAX6" },
  { src: "mnemonic m/44'/195'/0'/0/8", a: "TBE9pNYCGxmb3oVqE2MDb8tAVnFbCmU5ak" },
  { src: "mnemonic m/44'/195'/0'/0/9", a: "TSiDvCWZRNMzmsEiipxDQKYqgRqM69N11H" },
  { src: "mnemonic m/44'/195'/0'      ", a: "TUXAdzUFs6kC8nsfGFxhRbhnuX23JhMh5B" },
  { src: "mnemonic m/44'/195'        ", a: "TMSko2o9R4nerqVivjy5i3uDi4eZdafg9s" },
  { src: "mnemonic m/44'/60'/0'/0/0  ", a: "TME4N7veAFskgKw6XApk8hQqD1wpx3vfzb" },
  { src: "steem-active → custody       ", a: "TYVwwuvdDmfy3shxT3cb3RKLrRCshaZxTy" },
  { src: "צבא-army (watch.json)        ", a: "TVESRr1TX1RaKzsN6TKszutJBFDPEGPx1e" },
  { src: "פדיון-outbox                ", a: "TG6SrsMJjRqnqAyYM8kGZu1rgkpsgizKEn" },
];

const fmtDate = (ms) => ms > 0 ? new Date(ms).toISOString().slice(0, 19).replace("T", " ") + "Z" : "—";

console.log(`src                            address                        balance      created               last-op`);
console.log("─".repeat(120));
for (const { src, a } of ADDRS) {
  try {
    const r = await fetch("https://api.trongrid.io/wallet/getaccount", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: a, visible: true }),
    });
    const j = await r.json();
    const empty = Object.keys(j).length === 0;
    if (empty) {
      console.log(`${src.padEnd(30)} ${a}  —           לא-קיים בשרשרת (לא-נוצר מעולם)`);
    } else {
      const bal = (j.balance || 0) / 1e6;
      console.log(
        `${src.padEnd(30)} ${a}  ${String(bal.toFixed(6)).padStart(9)} TRX  ${fmtDate(j.create_time || 0)}  ${fmtDate(j.latest_opration_time || 0)}`
      );
    }
  } catch (e) {
    console.log(`${src.padEnd(30)} ${a}  שגיאה: ${e.message}`);
  }
  await new Promise(r => setTimeout(r, 250)); // נימוס מול ה-RPC הציבורי
}
