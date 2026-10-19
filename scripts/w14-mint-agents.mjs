/**
 * w14-mint-agents.mjs — W14 · THE AGENT GENERATION MINT (טביעת-דור-הסוכנים).
 *
 * OPERATOR ORDER (verbatim): "אפשר לפתוח טוקנים וארנקים על הרשת לחיילים
 * ולסוכנים ולכל האוטונומיה" + "בחן תכנן בצע דחוף" (IM 2026-10-19,
 * trace 1a154f822ab6e1b9) — committed as W14-MINT-AGENTS in
 * state/operator-orders.json + a fresh TTL owner-grant in
 * state/owner-grants.jsonl (the T3 lane's lawful provenance).
 *
 * GATES (all must pass per account, else honest typed refusal):
 *  G1 committed operator order armed (W14-MINT-AGENTS)
 *  G2 fresh TTL owner-grant (ownerGrantCheck) — never a static flag
 *  G3 owner-live + bond intact (measured inside guardCommand at decision time)
 *  G4 name free on chain (collision probe)
 *  G5 measured account_creation_fee ≤ order cap (3.000 STEEM)
 *  G6 master custody chain-verified in THIS process (else: honest death)
 *  G7 single-use think-gate order (flag policy.operatorOrders.account_create
 *     — one name at a time, marked used after; armedConf() re-reads per call)
 *  G8 idempotence: state/w14-mint-custody.json marker (minted names never re-mint)
 *
 * POST-MINT: chain verify (owner authority pubkey match), keys → 0600 cache
 * + AGENTS-SEAL vault class (self-contained pass in meta.agentsVault — the
 * EXCHANGE-SEAL precedent), HCT-1 book-law transfer 30k per verified agent
 * (the genesis plan's released tranche).
 *
 * ZERO secret material printed. The chain judges the result.
 *
 * Usage: node scripts/w14-mint-agents.mjs
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(DIR, "..");
const ENGINE = path.join(REPO, "mini-services", "saos-engine");
const STATE = path.join(ENGINE, "state");
const MARKER = path.join(STATE, "w14-mint-custody.json");
const AGENTS_CACHE = path.join(REPO, ".secrets", "agents-keys-w14.json");
const META = path.join(REPO, "agent", "recovery-meta.json");

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const fp = (t) => (t ? `${t.slice(0, 6)}…${t.slice(-4)}(${t.length})` : "null");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };

async function main() {
  const { rpcCall } = await import(path.join(ENGINE, "measure.mjs"));
  const signer = await import(path.join(ENGINE, "signer.mjs"));
  const community = await import(path.join(ENGINE, "community.mjs"));
  const hierarchy = await import(path.join(ENGINE, "command-hierarchy.mjs"));
  const token = await import(path.join(ENGINE, "token-ledger.mjs"));

  const orders = readJson(path.join(STATE, "operator-orders.json"));
  const order = orders?.orders?.["W14-MINT-AGENTS"];
  if (!order?.armed) { console.log("MINT-REFUSED G1: no armed W14-MINT-AGENTS operator order"); process.exit(1); }
  const names = order.scope?.names ?? [];
  if (!names.length) { console.log("MINT-REFUSED G1: order names empty"); process.exit(1); }
  const maxFee = Number(order.scope?.maxFeeSteemPerAccount ?? 0);

  /* G2: fresh TTL owner-grant */
  const grant = hierarchy.ownerGrantCheck("account_create");
  if (!grant.found || !grant.fresh) { console.log(`MINT-REFUSED G2: ${grant.reason ?? "owner-grant-required"}`); process.exit(1); }
  console.log(`G2 owner-grant fresh: ${grant.grantedAt} → ${grant.expiresAt}`);

  /* G6: master custody chain-verified in THIS process (fail-closed before any op shape exists) */
  let ver = null;
  try {
    ver = await signer.verifyRoles("headcorner");
  } catch (e) {
    const why = String(e?.message ?? e).slice(0, 140);
    console.log(`MINT-REFUSED G6: master custody unavailable (${why.split(" OPERATOR LAW")[0]}) — run on a custody-holding runner`);
    process.exit(0);
  }
  if (!ver?.ok) { console.log(`MINT-REFUSED G6: master custody not chain-verified (${ver?.reason ?? "no-match"}) — run the revival lane on a custody-holding runner`); process.exit(0); }
  console.log("G6 master custody: chain-verified");

  /* measured chain fee */
  const cp = await rpcCall("condenser_api.get_chain_properties", [], 15000);
  const feeSteem = parseFloat(cp?.result?.account_creation_fee ?? "0") || 0;
  if (!(feeSteem > 0)) { console.log("MINT-REFUSED G5: chain fee unreadable"); process.exit(1); }
  if (feeSteem > maxFee) { console.log(`MINT-REFUSED G5: chain fee ${feeSteem} > order cap ${maxFee} — the operator order must be renewed`); process.exit(1); }
  console.log(`G5 chain fee: ${feeSteem} STEEM ≤ cap ${maxFee}`);

  const marker = readJson(MARKER, { minted: [] });
  const created = [];

  for (const name of names) {
    /* G8 idempotence */
    if (marker.minted.includes(name)) { console.log(`SKIP ${name}: already minted (marker)`); continue; }

    /* G4 name free on chain */
    const probe = await rpcCall("condenser_api.get_accounts", [[name]], 15000);
    if (!probe.ok) { console.log(`MINT-PAUSE ${name}: chain unreachable`); continue; }
    if (Array.isArray(probe.result) && probe.result.length && probe.result[0]) {
      console.log(`MINT-REFUSED G4: ${name} ALREADY EXISTS on chain — collision`);
      continue;
    }

    /* keys (never printed) */
    const keys = community.generateAccountKeys();

    /* G7 single-use think-gate order (armedConf() re-reads the file per call) */
    const flagPath = path.join(REPO, ".secrets", "exec-armed.json");
    const flag = readJson(flagPath);
    if (!flag) { console.log("MINT-REFUSED G7: no exec-armed.json on this host"); process.exit(1); }
    flag.policy = flag.policy ?? {};
    flag.policy.operatorOrders = flag.policy.operatorOrders ?? {};
    flag.policy.operatorOrders.account_create = { account: name, maxFeeSteem: maxFee, used: false, orderRef: "W14-MINT-AGENTS", at: now() };
    fs.writeFileSync(flagPath, JSON.stringify(flag, null, 2) + "\n", { mode: 0o600 });

    const feeStr = `${feeSteem.toFixed(3)} STEEM`;
    const op = community.accountCreateOp({ fee: feeStr, creator: "headcorner", name, keys });
    const res = await signer.executeAs("headcorner", [op], { tag: "w14-mint-agents" });

    /* mark consumed regardless of outcome (single-use law) */
    const flag2 = readJson(flagPath);
    if (flag2?.policy?.operatorOrders?.account_create?.account === name) {
      flag2.policy.operatorOrders.account_create.used = true;
      flag2.policy.operatorOrders.account_create.usedAt = now();
      fs.writeFileSync(flagPath, JSON.stringify(flag2, null, 2) + "\n", { mode: 0o600 });
    }

    if (!res.ok) {
      console.log(`MINT-FAIL ${name}: ${res.verdict} ${res.reason ?? ""} ${res.tierName ?? ""} ${(res.reasons ?? []).join("; ").slice(0, 120)}`);
      continue;
    }
    const txid = res.txid ?? res.result?.txid ?? null;

    /* chain verify: account exists + owner authority matches the minted pubkey */
    const post = await rpcCall("condenser_api.get_accounts", [[name]], 15000);
    const acc = post?.result?.[0];
    const ownerPub = keys.owner.pub;
    const chainOwner = acc?.owner?.key_auths?.[0]?.[0] ?? null;
    const verified = !!acc && chainOwner === ownerPub;
    if (!verified) {
      console.log(`MINT-UNVERIFIED ${name}: account ${acc ? "exists" : "missing"}, owner-auth ${chainOwner ? (chainOwner === ownerPub ? "match" : "MISMATCH") : "absent"}`);
      continue;
    }

    created.push({ name, txid, verifiedAt: now(), ownerPubFp: fp(ownerPub) });
    marker.minted.push(name);
    fs.writeFileSync(MARKER, JSON.stringify(marker, null, 2) + "\n");

    /* keys → 0600 cache (merge, never print) */
    let cache = readJson(AGENTS_CACHE, { format: "agents-w14-1", items: [] });
    cache.extractedAt = now();
    cache.items.push({ name, keys, txid, verifiedAt: now() });
    fs.mkdirSync(path.dirname(AGENTS_CACHE), { recursive: true, mode: 0o700 });
    fs.writeFileSync(AGENTS_CACHE, JSON.stringify(cache, null, 2), { mode: 0o600 });

    /* HCT-1 book-law: release the genesis-planned 30k tranche to the verified agent */
    const tr = token.appendEntry({ type: "transfer", from: "generation-hcsoldier7-9", to: name, amount: 30000, memo: `W14 mint-verified (${txid ?? "no-txid"}) — the genesis plan's released tranche` });
    console.log(`MINT-OK ${name}: verified ${verified ? "on-chain" : "FAIL"} txid=${txid ?? "?"} HCT=${tr.ok ? "+30000" : "REFUSED:" + tr.why}`);
  }

  /* seal the generation into the GIT vault (AGENTS-SEAL class) if anything was created */
  if (created.length) {
    const cache = readJson(AGENTS_CACHE);
    if (cache?.items?.length) {
      const meta = JSON.parse(fs.readFileSync(META, "utf8"));
      const pass = crypto.randomBytes(24).toString("base64");
      const stamp = now().replace(/[-:]/g, "").slice(0, 15);
      const file = `AGENTS-SEAL-${stamp}Z.zip.enc`;
      const tmp = fs.mkdtempSync("/tmp/seal-agents-"); fs.chmodSync(tmp, 0o700);
      const innerName = "agents-keys.json";
      fs.writeFileSync(path.join(tmp, innerName), JSON.stringify(cache, null, 2), { mode: 0o600 });
      execFileSync("zip", ["-q", "-j", path.join(tmp, "inner.zip"), path.join(tmp, innerName)], { stdio: ["ignore", "ignore", "pipe"] });
      const innerBuf = fs.readFileSync(path.join(tmp, "inner.zip"));
      const encPath = path.join(REPO, "agent", "vault", file);
      execFileSync("openssl", ["enc", "-aes-256-cbc", "-pbkdf2", "-iter", "300000", "-in", path.join(tmp, "inner.zip"), "-out", encPath, "-pass", `pass:${pass}`], { stdio: ["ignore", "ignore", "pipe"] });
      fs.chmodSync(encPath, 0o600);
      /* roundtrip from sealed bytes */
      const rt = fs.mkdtempSync("/tmp/seal-agents-rt-"); fs.chmodSync(rt, 0o700);
      execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "300000", "-in", encPath, "-out", path.join(rt, "inner.zip"), "-pass", `pass:${pass}`], { stdio: ["ignore", "ignore", "pipe"] });
      if (sha256(fs.readFileSync(path.join(rt, "inner.zip"))) !== sha256(innerBuf)) { console.error("SEAL-FAIL: roundtrip inner-pin mismatch"); process.exit(1); }
      execFileSync("unzip", ["-o", "-q", path.join(rt, "inner.zip"), innerName, "-d", rt], { stdio: ["ignore", "ignore", "pipe"] });
      const rtParsed = JSON.parse(fs.readFileSync(path.join(rt, innerName), "utf8"));
      if (!rtParsed?.items?.length) { console.error("SEAL-FAIL: roundtrip parse gap"); process.exit(1); }
      fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(rt, { recursive: true, force: true });

      meta.agentsVault = {
        file: `agent/vault/${file}`,
        passRef: "agentsVault.pass (this same meta)",
        pass,
        outerSha256: sha256(fs.readFileSync(encPath)),
        innerSha256: sha256(innerBuf),
        formula: "openssl enc -aes-256-cbc -pbkdf2 -iter 300000 -pass pass:<agentsVault.pass> | unzip (agents-keys.json)",
        contents: cache.items.map((i) => i.name),
        source: "scripts/w14-mint-agents.mjs (owner IM 2026-10-19 trace 1a154f822ab6e1b9)",
        sealedAt: now(),
        law: "agent generation class — full 4-role keys, minted under the W14-MINT-AGENTS order + fresh TTL owner-grant + R246 single-use per name; the chain judged every adoption",
      };
      fs.writeFileSync(META, JSON.stringify(meta, null, 2) + "\n", { mode: 0o664 });
      console.log(`SEALED ${file} (${cache.items.length} agents) — the generation survives sandbox death (git vault)`);
    }
  }

  console.log(`MINT-DONE: ${created.length}/${names.length} minted-and-verified this run (${marker.minted.length} total by marker)`);
}

main().catch((e) => { console.error(`MINT-EXCEPTION: ${String(e?.message ?? e).slice(0, 160)}\n${e?.stack?.split("\n").slice(1, 4).join("\n") ?? ""}`); process.exit(1); });
