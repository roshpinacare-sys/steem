/**
 * onekey-adopt.mjs — ONE-KEY ADOPTION (W-ONEKEY, owner order 2026-11-05,
 * trace 1a1ab989d8db0a91): "המפתח שלי יפתח הכול".
 *
 * Walks every sealed artifact in vault-home, opens each with ANY legitimately
 * held pass, re-seals IN PLACE with MAIN_KEY (AES-256-CBC · PBKDF2-300k),
 * documents old/irrelevant values as superseded (never blocking), writes
 * custody-intake/INDEX.json + vault-chain/CUSTODY-LEDGER.jsonl, then
 * self-verifies every MAIN_KEY seal BEFORE pushing. Ciphertext-only commit.
 *
 * USAGE (CI): node ops/onekey/onekey-adopt.mjs
 * EXIT: 0 = all primaries one-key-sealed + verified · 2 = honest wounds · 1 = error
 * Never prints key material — fingerprints (8 hex) and account NAMES only.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, renameSync, rmSync } from "node:fs";
import { buildPassPool, classify, openAny, sealWithMain, tryOpen, fp, sha256hex, ITER_STANDARD, LEGACY_ITERS, chainJudgeCustody } from "./onekey-lib.mjs";

const GH_PAT = process.env.GH_PAT || "";
const MAIN_KEY = (process.env.MAIN_KEY || "").trim();
if (!GH_PAT) { console.log("ONEKEY-ADOPT REFUSED no-GH_PAT"); process.exit(1); }
if (MAIN_KEY.length < 16) { console.log("ONEKEY-ADOPT REFUSED MAIN_KEY missing/short (owner key is required by law)"); process.exit(1); }

const VH = "/tmp/vh";
const now = () => new Date().toISOString();
const sh = (cmd, opts = {}) => execFileSync(cmd[0], cmd.slice(1), { stdio: "pipe", encoding: "utf8", ...opts });

rmSync(VH, { recursive: true, force: true });
sh(["git", "clone", "--depth", "1", `https://x-access-token:${GH_PAT}@github.com/roshpinacare-sys/vault-home.git`, VH]);
console.log(`onekey-adopt: vault-home cloned HEAD ${sh(["git", "-C", VH, "rev-parse", "--short", "HEAD"]).trim()}`);

/* ── pass pool (MAIN_KEY first, then everything we legitimately hold) ── */
const { pool, masterPassFp } = buildPassPool({ ...process.env, __VH__: VH });
console.log(`onekey-adopt: pass pool ${pool.length} pass(es) · wraps-P ${masterPassFp ? "OPENED (fp " + masterPassFp + ")" : "not-opened (honest)"}`);

/* ── enumerate artifacts ── */
const artifacts = [];
for (const f of ["keys.env.enc", "rails.env.enc", "fleet-rot2.keys.enc", "ssh-keys.tar.enc"]) {
  if (existsSync(`${VH}/${f}`)) artifacts.push(f);
}
for (const dir of ["intake", "custody-intake"]) {
  const d = `${VH}/${dir}`;
  if (!existsSync(d)) continue;
  for (const f of readdirSync(d).sort()) if (f.endsWith(".enc")) artifacts.push(`${dir}/${f}`);
}
/* latest CROWN-RECOVERY wins (primary); all older siblings become superseded */
const recoveryTs = artifacts
  .map((a) => (a.match(/^custody-intake\/CROWN-RECOVERY-(\d{8}T\d{6}Z)\.enc$/) || [])[1])
  .filter(Boolean)
  .sort();
const primaryRecoveryTs = recoveryTs.length ? recoveryTs[recoveryTs.length - 1] : null;
console.log(`onekey-adopt: ${artifacts.length} sealed artifact(s) · primary CROWN-RECOVERY ${primaryRecoveryTs ?? "NONE (honest)"}`);

/* ── adopt loop ── */
const entries = [];
const wounds = [];
let adopted = 0, alreadyOneKey = 0, unopened = 0;

for (const rel of artifacts) {
  const cls = classify(rel);
  const isPrimary = cls.primary === true || (cls.primary === "latest-wins" && rel.endsWith(`CROWN-RECOVERY-${primaryRecoveryTs}.enc`));
  const file = `${VH}/${rel}`;
  const stat = statSync(file);
  const entry = {
    path: rel,
    family: cls.family,
    status: isPrimary ? "primary" : "superseded",
    seal: "legacy",
    sha256: sha256hex(readFileSync(file)),
    bytes: stat.size,
    note: cls.note || "",
  };
  if (cls.primary === "latest-wins" && !isPrimary) entry.note += " · ערך-ישן-מתועד (superseded by the latest map) — לא-חוסם-שגרה";

  const cap = isPrimary ? 400 : 60; // honest caps: primaries get the full pool
  const hit = openAny(file, pool, { iters: LEGACY_ITERS, cap });
  if (!hit) {
    entry.seal = "unopened";
    wounds.push(`${rel}:UNOPENED(${cap}-tries)`);
    unopened++;
    entries.push(entry);
    console.log(`onekey-adopt:   ${rel} SEALED-UNOPENED (cap ${cap}) — documented, not blocking`);
    continue;
  }
  if (hit.passFp === fp(MAIN_KEY)) {
    entry.seal = "MAIN_KEY";
    entry.iter = hit.iter;
    entry.adoptedFrom = null;
    alreadyOneKey++;
  } else {
    /* re-seal IN PLACE with the owner's key — verify roundtrip BEFORE replace */
    const plain = hit.outFile;
    const dest = `${file}.onekey.tmp`;
    let sealed = false;
    if (sealWithMain(plain, dest, MAIN_KEY)) {
      const vout = "/tmp/_onekey.verify";
      if (tryOpen(dest, MAIN_KEY, ITER_STANDARD, vout)) {
        rmSync(vout, { force: true });
        sealed = true;
      }
      rmSync(dest + ".fail", { force: true });
    }
    if (sealed) {
      renameSync(dest, file);
      entry.seal = "MAIN_KEY";
      entry.adoptedFrom = hit.passFp;
      entry.iter = ITER_STANDARD;
      entry.sha256 = sha256hex(readFileSync(file));
      entry.bytes = statSync(file).size;
      entry.adoptedAt = now();
      adopted++;
    } else {
      rmSync(dest, { force: true });
      entry.seal = "legacy";
      wounds.push(`${rel}:RESEAL-FAILED`);
      console.log(`onekey-adopt:   ${rel} RESEAL-FAILED (original preserved) — honest wound`);
    }
    rmSync(plain, { force: true });
  }

  entries.push(entry);
}

/* custody coverage from the primary recovery map — re-open once, read names/roles */
let custody = null;
if (primaryRecoveryTs) {
  const f = `${VH}/custody-intake/CROWN-RECOVERY-${primaryRecoveryTs}.enc`;
  const hit = openAny(f, [MAIN_KEY], { iters: [ITER_STANDARD] });
  const legacyHit = hit ? null : openAny(f, pool, { iters: LEGACY_ITERS, cap: 400 });
  const src = hit || legacyHit;
  if (src) {
    try {
      const map = JSON.parse(readFileSync(src.outFile, "utf8"));
      const live = map?.live ?? map ?? {};
      const accounts = Object.entries(live)
        .filter(([k]) => !k.startsWith("_"))
        .map(([acc, roles]) => ({ account: acc, roles: Object.keys(roles ?? {}).sort() }));
      custody = { artifact: `custody-intake/CROWN-RECOVERY-${primaryRecoveryTs}.enc`, accounts, masterPresent: Boolean(map?._master) };
      rmSync(src.outFile, { force: true });
    } catch { /* honest skip */ }
    rmSync("/tmp/_onekey.out", { force: true });
  }
}
if (custody) console.log(`onekey-adopt: custody map covers ${custody.accounts.length} account(s): ${custody.accounts.map((a) => a.account + "[" + a.roles.join("+") + "]").join(" · ")}`);
rmSync("/tmp/_onekey.out", { force: true });

/* ── custody-rebuild (W-ONEKEY §2 — owner order 2026-11-05): if the primary
 * custody map cannot open (lost transport pass — measured 20261104T205522Z)
 * but the fleet relay (LIVE_FLEET_KEYS) holds the map, REBUILD it: every WIF
 * is re-judged LIVE against steem+hive authorities (fail-closed — the chain
 * is the only judge), then sealed with MAIN_KEY. The old map is marked
 * superseded WITH a pointer — nothing lost, nothing fabricated. */
let rebuilt = null;
const primaryMapEntry = entries.find((e) => e.family === "crown-recovery-map" && e.status === "primary" && e.seal !== "MAIN_KEY");
if (primaryMapEntry && process.env.LIVE_FLEET_KEYS) {
  try {
    const relay = JSON.parse(process.env.LIVE_FLEET_KEYS);
    const live = relay?.live ?? null;
    const relayAccounts = live ? Object.keys(live).filter((k) => !k.startsWith("_")) : [];
    if (relayAccounts.length) {
      const { judged, dropped } = await chainJudgeCustody(live);
      const nAcc = Object.keys(judged).length;
      console.log(`onekey-adopt: custody-rebuild — relay ${relayAccounts.length} account(s), chain-judged live: ${nAcc} verified, ${dropped.length} dropped (fail-closed)`);
      if (nAcc > 0) {
        const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
        const mapPath = `/tmp/_crown-onekey-${ts}.json`;
        writeFileSync(mapPath, JSON.stringify({ live: judged, source: "onekey-rebuild: LIVE_FLEET_KEYS relay re-judged LIVE vs steem+hive authorities (fail-closed)", rebuiltAt: new Date().toISOString() }, null, 1), { mode: 0o600 });
        const relNew = `custody-intake/CROWN-ONEKEY-${ts}.enc`;
        if (sealWithMain(mapPath, `${VH}/${relNew}`, MAIN_KEY) && tryOpen(`${VH}/${relNew}`, MAIN_KEY, ITER_STANDARD, "/tmp/_onekey.v2")) {
          rmSync("/tmp/_onekey.v2", { force: true });
          entries.push({
            path: relNew, family: "crown-recovery-map", status: "primary", seal: "MAIN_KEY",
            adoptedFrom: null, iter: ITER_STANDARD,
            sha256: sha256hex(readFileSync(`${VH}/${relNew}`)), bytes: statSync(`${VH}/${relNew}`).size,
            adoptedAt: now(),
            note: "מפת-המשמורת-החיה — rebuilt מ-LIVE_FLEET_KEYS, שיפוט-חי-כפול מול-השרשרת, חתום-במפתח-הבעלים",
          });
          primaryMapEntry.status = "superseded";
          primaryMapEntry.note = (primaryMapEntry.note || "") + ` · superseded by ${relNew} (transport pass lost — honest) — התוכן-החי קיים-במפה-החדשה`;
          rebuilt = relNew;
          custody = { artifact: relNew, accounts: Object.entries(judged).map(([acc, roles]) => ({ account: acc, roles: Object.keys(roles ?? {}).sort() })), masterPresent: false };
          /* the old map's unopened wound is RESOLVED by the rebuilt map */
          const wi = wounds.findIndex((w) => w.startsWith(primaryMapEntry.path + ":UNOPENED"));
          if (wi >= 0) { wounds.splice(wi, 1); unopened = Math.max(0, unopened - 1); }
          sh(["git", "-C", VH, "add", relNew]);
          console.log(`onekey-adopt: custody-rebuild SEALED ${relNew} — MAIN_KEY-only, self-verified`);
        } else {
          rmSync(`${VH}/custody-intake/CROWN-ONEKEY-${ts}.enc`, { force: true });
          console.log("onekey-adopt: custody-rebuild seal/verify failed — honest wound, original preserved");
        }
        rmSync(mapPath, { force: true });
      }
    }
  } catch (e) {
    console.log(`onekey-adopt: custody-rebuild honest-fail ${String(e).slice(0, 140)}`);
  }
}

/* ── wraps index (infrastructure — listed, not re-sealed) ── */
if (existsSync(`${VH}/wraps`)) {
  for (const f of readdirSync(`${VH}/wraps`).sort()) {
    if (!f.endsWith(".enc")) continue;
    entries.push({
      path: `wraps/${f}`,
      family: "wrap-infrastructure",
      status: "wrap",
      seal: "sha256(C)-keyed",
      sha256: sha256hex(readFileSync(`${VH}/wraps/${f}`)),
      bytes: statSync(`${VH}/wraps/${f}`).size,
      note: classify("wraps/" + f).note,
    });
  }
}

/* ── self-verify: MAIN_KEY ONLY against every seal==MAIN_KEY entry (both tiers) ── */
let verified = 0;
const verifyWounds = [];
for (const e of entries.filter((x) => x.seal === "MAIN_KEY")) {
  const iters = [e.iter || ITER_STANDARD, ITER_STANDARD, 200000];
  let ok = false;
  for (const it of new Set(iters)) {
    if (tryOpen(`${VH}/${e.path}`, MAIN_KEY, it, "/tmp/_onekey.v")) { ok = true; rmSync("/tmp/_onekey.v", { force: true }); break; }
  }
  if (ok) verified++; else verifyWounds.push(e.path);
}
console.log(`onekey-adopt: self-verify MAIN_KEY-only ${verified}/${entries.filter((x) => x.seal === "MAIN_KEY").length} seal(s) OPEN`);
if (verifyWounds.length) {
  console.log(`onekey-adopt: SELF-VERIFY WOUNDS ${verifyWounds.join(",")}`);
  process.exit(1);
}

/* ── INDEX.json + ledger ── */
const index = {
  format: "onekey-index-1",
  generatedAt: now(),
  law: "W-ONEKEY owner order 2026-11-05: MAIN_KEY is the single live seal of every primary artifact; superseded values documented (never blocking); wraps stay sha256(C)-keyed by design",
  algorithm: { cipher: "aes-256-cbc", kdf: "pbkdf2", iter: ITER_STANDARD, seal: "MAIN_KEY (owner key — never logged)" },
  mainKeyFp: fp(MAIN_KEY),
  counts: { artifacts: artifacts.length, adopted, alreadyOneKey, unopened, superseded: entries.filter((e) => e.status === "superseded").length, wraps: entries.filter((e) => e.status === "wrap").length, rebuilt: rebuilt ? 1 : 0 },
  custody,
  entries,
  wounds,
};
writeFileSync(`${VH}/custody-intake/INDEX.json`, JSON.stringify(index, null, 1) + "\n");
const ledgerLine = JSON.stringify({
  ts: now(),
  event: "onekey-adopt",
  artifact: "custody-intake/INDEX.json",
  purpose: `W-ONEKEY: MAIN_KEY is the single live seal — adopted=${adopted} already=${alreadyOneKey} unopened=${unopened} superseded=${index.counts.superseded}; self-verify ${verified}/${entries.filter((x) => x.seal === "MAIN_KEY").length}`,
  sha256: sha256hex(readFileSync(`${VH}/custody-intake/INDEX.json`)),
  secrets: "NONE (ciphertext + fingerprints only)",
}) + "\n";
writeFileSync(`${VH}/vault-chain/CUSTODY-LEDGER.jsonl`, readFileSync(`${VH}/vault-chain/CUSTODY-LEDGER.jsonl`, "utf8") + ledgerLine);

/* ── commit + push (ciphertext + index + ledger only) ── */
sh(["git", "-C", VH, "add", "custody-intake/INDEX.json"]);
sh(["git", "-C", VH, "add", "vault-chain/CUSTODY-LEDGER.jsonl"]);
for (const e of entries) if (e.seal === "MAIN_KEY" && e.adoptedFrom) sh(["git", "-C", VH, "add", e.path]);
const msg = `onekey-adopt: MAIN_KEY is the single seal — adopted ${adopted}, already ${alreadyOneKey}, superseded ${index.counts.superseded}, unopened ${unopened} [skip ci]`;
sh(["git", "-C", VH, "-c", "user.email=sovereign@fleet", "-c", "user.name=sovereign-onekey", "commit", "-m", msg]);
try {
  sh(["git", "-C", VH, "pull", "--rebase", "origin", "HEAD"]);
} catch { /* rebase best-effort */ }
sh(["git", "-C", VH, "push"]);
const head = sh(["git", "-C", VH, "rev-parse", "HEAD"]).trim();
console.log(`onekey-adopt: PUSHED vault-home ${head.slice(0, 10)} — ${msg}`);
console.log(`onekey-adopt: DONE adopted=${adopted} alreadyOneKey=${alreadyOneKey} unopened=${unopened} wounds=${wounds.length}`);
process.exit(wounds.length ? 2 : 0);
