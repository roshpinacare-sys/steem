/* R210 RE-ANCHOR · verdict-only key miner.
 * Scans operator-delivered scroll(s) for credential candidates, validates them
 * against the CHAIN (the only judge), and on match writes upload/headcorner.txt
 * in the engine's standard revival format ("<account> <secret>") — the engine
 * then self-secures (0600) + self-adopts. KEY MATERIAL IS NEVER PRINTED. */
import fs from "fs";
import path from "path";
import { wifDecode, pubkeyFromSeed, derivePub, SEED_ORDERS } from "./steemtx.mjs";

const SCROLLS = [
  "/home/z/my-project/upload/הד.txt",
  "/home/z/my-project/upload/KEYS_BACKUP_README_HE (2).md",
];
const ACCOUNT = process.env.MINE_ACCOUNT || "headcorner";
const OUT = "/home/z/my-project/upload/headcorner.txt";
const RPC = "https://api.steemit.com";
const B58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

function chainAuthorities() {
  return fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_accounts", params: [[ACCOUNT]], id: 1 }),
  })
    .then((r) => r.json())
    .then((j) => {
      const a = j.result?.[0];
      if (!a) throw new Error("no-account");
      return {
        owner: a.owner.key_auths.map((k) => k[0]),
        active: a.active.key_auths.map((k) => k[0]),
        posting: a.posting.key_auths.map((k) => k[0]),
        memo: a.memo_key ? [a.memo_key] : [],
        balances: { steem: a.balance, sbd: a.sbd_balance, vests: a.vesting_shares, reward_steem: a.reward_steem_balance, reward_sbd: a.reward_sbd_balance, reward_vests: a.reward_vesting_balance },
      };
    });
}

// collect candidate secrets + (line,lineNo) provenance, deduped
function collect() {
  const seen = new Map(); // candidate → first lineNo
  for (const f of SCROLLS) {
    if (!fs.existsSync(f)) continue;
    const text = fs.readFileSync(f, "utf8");
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      const pats = [
        /P[1-9A-HJ-NP-Za-km-z]{50,52}/g,
        /5[JK][1-9A-HJ-NP-Za-km-z]{50}/g,
        /[KL][1-9A-HJ-NP-Za-km-z]{51}/g,
      ];
      for (const p of pats) {
        for (const m of line.matchAll(p)) {
          const c = m[0];
          if (!seen.has(c)) seen.set(c, { file: path.basename(f), lineNo: i + 1 });
        }
      }
    });
  }
  return seen;
}

// classify + derive STM pubkeys for one candidate (never returns the secret)
function classify(cand) {
  const bare = cand.startsWith("P") && cand.length >= 51 ? cand.slice(1) : cand;
  try {
    const seed = wifDecode(bare); // throws on checksum/format fail
    return { kind: "wif", stm: pubkeyFromSeed(seed), valid: true };
  } catch {
    return { kind: "wif", valid: false };
  }
}

function passwordVariants(cand) {
  // non-WIF strings → try steem role-key derivation with all documented seed orders
  const roles = ["posting", "active", "owner", "memo"];
  const out = [];
  for (const role of roles)
    for (const [order, fn] of Object.entries(SEED_ORDERS))
      out.push({ role, order, stm: derivePub(fn(ACCOUNT, role, cand)) });
  return out;
}

const auth = await chainAuthorities();
console.log("CHAIN AUTHORITIES (observed):");
for (const r of ["owner", "active", "posting", "memo"]) console.log(`  ${r}: ${auth[r].length} key(s)`);
console.log("BALANCES:", JSON.stringify(auth.balances));

const cands = collect();
console.log(`\nCANDIDATES: ${cands.size} unique`);
const matches = [];
let vi = 0, pi = 0;
for (const [cand, where] of cands) {
  const cls = classify(cand);
  if (cls.valid) {
    vi++;
    const roles = ["owner", "active", "posting", "memo"].filter((r) => auth[r].includes(cls.stm));
    console.log(`wif#${vi} @${where.file}:${where.lineNo} → ${roles.length ? "ROLE-MATCH: " + roles.join(",") : "no-authority-match"}`);
    if (roles.length) matches.push({ cand, roles, where, kind: "wif" });
  } else {
    pi++;
    const vars = passwordVariants(cand);
    const hits = vars.filter((v) => auth[v.role].includes(v.stm));
    console.log(`pw#${pi} @${where.file}:${where.lineNo} → ${hits.length ? "DERIVED-MATCH: " + hits.map((h) => `${h.role}/${h.order}`).join(",") : "no-derived-match"}`);
    if (hits.length) matches.push({ cand, roles: [...new Set(hits.map((h) => h.role))], where, kind: "password" });
  }
}

console.log(`\nVERDICT: ${matches.length} match(es)`);
if (matches.length) {
  // prefer posting/active usefulness: active > posting > owner-only (owner never adopted)
  const useful = matches.filter((m) => m.roles.some((r) => r === "active" || r === "posting"));
  const pick = useful[0] || null;
  if (pick) {
    fs.writeFileSync(OUT, `${ACCOUNT} ${pick.cand}\n`, { mode: 0o600 });
    fs.chmodSync(OUT, 0o600);
    console.log(`REVIVAL FILE WRITTEN → upload/headcorner.txt (roles: ${pick.roles.join(",")}, provenance ${pick.where.file}:${pick.where.lineNo}); engine will self-secure + self-adopt on next cycle. Secret never logged.`);
  } else {
    console.log("owner-only matches exist — NOT adopted (owner keys are never machine-held per doctrine).");
  }
} else {
  console.log("NO MATCH — scroll holds no live key for this account. Next sources: KEYS_BACKUP tar (needs chat-era password), operator drop.");
}
