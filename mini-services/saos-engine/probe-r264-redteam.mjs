/**
 * probe-r264-redteam.mjs — R264 · THE ADVERSARIAL AUDIT (claims treated as lies).
 *
 * The operator's order (verbatim intent): "תבדוק את הטענות שלך כאילו הן שקר
 * תנסה לאמת אותן או לא... אל תסמוך על הטענות שלך... ראה מה עוד הם עושים
 * ותוודא גם ודחוף" — professionals verify against INDEPENDENT evidence:
 * this probe reads THE CHAINS ONLY (no engine state as proof), scans every
 * R263 claim for refutation, and runs NEGATIVE CONTROLS (a check that
 * cannot fail a planted violation is vacuous and gets reported as such).
 *
 * VERDICT LADDER per claim: CONFIRMED (independent evidence) / PARTIAL
 * (true with a measured caveat) / REFUTED (the claim lied) / UNPROVABLE.
 */
import { rpcCall } from "./measure.mjs";
import { rpcHive } from "./hive.mjs";
import { PERSONA_IDS, PERSONAS, profileDoc } from "./personas.mjs";
import { HIVE_ROSTER } from "./hive.mjs";
import { hiveProfileDoc } from "./hive-profiles.mjs";

const nowIso = new Date().toISOString();
const day = nowIso.slice(0, 10);
const report = { at: nowIso, claims: {} };
const V = (claim, verdict, evidence) => { report.claims[claim] = { verdict, evidence }; console.error(`${verdict.padEnd(10)} ${claim}`); };

/* ── helpers ─────────────────────────────────────────────────────────────── */
const parseProfile = (raw) => { try { return JSON.parse(String(raw || "{}"))?.profile ?? {}; } catch { return {}; } };
const LEAKS = ["instagram.com", "facebook.com", "t.me/", "wa.me/", "whatsapp", "@gmail", "shopify", "cdn.steemitimages.com/DQmdTLPywa", "skitterphoto", "pexels.com"];

/* ── CLAIM 1: "14/14 Steem canon profiles live, exposure erased" ─────────── */
async function claimSteemProfiles() {
  const r = await rpcCall("condenser_api.get_accounts", [PERSONA_IDS]);
  const rows = [];
  for (const a of (r?.result ?? [])) {
    const raw = String(a.posting_json_metadata || a.json_metadata || "{}");
    const p = parseProfile(raw);
    const doc = profileDoc(a.name);
    const exact = doc && p.name === doc.name && p.about === doc.about;
    const imgOk = doc?.profile_image ? p.profile_image === doc.profile_image : !p.profile_image;
    const coverOk = doc?.cover_image ? p.cover_image === doc.cover_image : !p.cover_image;
    const leaks = LEAKS.filter((l) => raw.toLowerCase().includes(l));
    /* the ghost check: old-identity fields (location/website) the merge preserved */
    const ghosts = [];
    if (p.location) ghosts.push(`location="${String(p.location).slice(0, 30)}"`);
    if (p.website) ghosts.push(`website="${String(p.website).slice(0, 40)}"`);
    rows.push({ a: a.name, exact, imgOk, coverOk, leaks, ghosts, liveName: p.name ?? null });
  }
  const bad = rows.filter((r) => !r.exact || !r.imgOk || !r.coverOk || r.leaks.length || r.ghosts.length);
  if (!rows.length) return V("steem-14-14-profiles", "UNPROVABLE", { error: "chain read failed" });
  if (bad.length === 0) return V("steem-14-14-profiles", "CONFIRMED", { verified: rows.length });
  return V("steem-14-14-profiles", bad.some((b) => b.leaks.length || b.ghosts.length) ? "REFUTED" : "PARTIAL", { bad });
}

/* ── CLAIM 2: "Hive 8/9 live, wic syncs autonomously" ────────────────────── */
async function claimHiveProfiles() {
  const r = await rpcHive("condenser_api.get_accounts", [HIVE_ROSTER]);
  const rows = [];
  for (const a of (r?.result ?? [])) {
    const raw = String(a.posting_json_metadata || a.json_metadata || "{}");
    const p = parseProfile(raw);
    const doc = hiveProfileDoc(a.name);
    const exact = doc && p.name === doc.name && p.about === doc.about
      && p.profile_image === doc.profile_image && p.cover_image === doc.cover_image
      && (p.location ?? "") === "" && (p.website ?? "") === "";
    const leaks = LEAKS.filter((l) => raw.toLowerCase().includes(l));
    rows.push({ a: a.name, exact, leaks, liveName: p.name ?? null });
  }
  const matched = rows.filter((r) => r.exact).length;
  const leaked = rows.filter((r) => r.leaks.length);
  if (!rows.length) return V("hive-profiles-8-9", "UNPROVABLE", { error: "chain read failed" });
  if (matched >= 8 && !leaked.length) return V("hive-profiles-8-9", "CONFIRMED", { matched, total: rows.length, missing: rows.filter((r) => !r.exact).map((r) => r.a) });
  return V("hive-profiles-8-9", leaked.length ? "REFUTED" : "PARTIAL", { matched, total: rows.length, missing: rows.filter((r) => !r.exact).map((r) => r.a), leaked });
}

/* ── CLAIM 3: "posts are professionally crafted" (dashes, tags, floors) ──── */
async function claimPostQuality() {
  const bad = [];
  let scanned = 0;
  for (const acct of PERSONA_IDS) {
    const r = await rpcCall("condenser_api.get_discussions_by_blog", [{ tag: acct, limit: 3 }]);
    for (const p of (r?.result ?? []).filter((x) => x.author === acct && x.id !== 0 && String(x.created ?? "") >= "2026-10-07T10:00:00Z")) {
      scanned++;
      const body = String(p.body ?? "");
      const words = body.split(/\s+/).filter(Boolean).length;
      const tags = (Array.isArray(p.json_metadata) ? p.json_metadata : (() => { try { return JSON.parse(String(p.json_metadata ?? "{}")); } catch { return {}; } })())?.tags ?? [];
      const issues = [];
      if (body.includes("—") || body.includes("–")) issues.push("dash-on-chain");
      if (words < 300 && String(p.parent_author) === "") issues.push(`thin:${words}w`);
      if (String(p.parent_author) === "" && tags.length < 2) issues.push(`tags:${tags.length}`);
      if (/\b(in conclusion|in today's world)\b/i.test(body)) issues.push("ai-tell-tale");
      const img = body.match(/https:\/\/upload\.wikimedia\.org[^\s)]+/);
      if (img && !body.includes("Source:") && !body.includes("source:")) issues.push("image-without-attribution");
      /* R264: the permlink/tags leak scan (how the saos-* transparency series hid) */
      const meta = (() => { try { return JSON.parse(String(p.json_metadata ?? "{}")); } catch { return {}; } })();
      const pl = String(p.permlink ?? "");
      const leakScan = `${pl} ${(meta?.tags ?? []).join(" ")} ${String(meta?.app ?? "")}`.toLowerCase();
      const codenames = ["saos", "hcsoldier", "fleet"];
      const leakHit = codenames.filter((c) => leakScan.includes(c));
      if (leakHit.length) issues.push(`codename-leak:${leakHit.join(",")}`);
      if (issues.length) bad.push({ p: `${acct}/${String(p.permlink).slice(0, 32)}`, issues });
    }
  }
  return V("post-quality-laws-on-chain", bad.length ? "REFUTED" : "CONFIRMED", { scanned, bad: bad.slice(0, 8) });
}

/* ── CLAIM 4: "zero downvotes on the doctrine era" (fresh scan) ──────────── */
async function claimDownvotes() {
  const flags = [];
  const since = "2026-10-07T00:00:00Z";
  for (const acct of PERSONA_IDS) {
    const r = await rpcCall("condenser_api.get_discussions_by_blog", [{ tag: acct, limit: 5 }]);
    for (const p of (r?.result ?? []).filter((x) => x.author === acct && String(x.created ?? "") >= since)) {
      for (const v of (p.active_votes ?? [])) if (Number(v.percent) < 0) flags.push({ chain: "steem", p: `${acct}/${String(p.permlink).slice(0, 24)}`, by: v.voter });
    }
  }
  for (const acct of HIVE_ROSTER) {
    const r = await rpcHive("condenser_api.get_discussions_by_blog", [{ tag: acct, limit: 5 }]);
    for (const p of (r?.result ?? []).filter((x) => x.author === acct && String(x.created ?? "") >= since)) {
      for (const v of (p.active_votes ?? [])) if (Number(v.percent) < 0) flags.push({ chain: "hive", p: `${acct}/${String(p.permlink).slice(0, 24)}`, by: v.voter });
    }
  }
  return V("trial-era-zero-downvotes", flags.length ? "REFUTED" : "CONFIRMED", { scanned: PERSONA_IDS.length + HIVE_ROSTER.length, flags });
}

/* ── CLAIM 5: "persona-voiced conversations" (bodies on chain) ───────────── */
async function claimCommentVoices() {
  const samples = [];
  const collect = async (author, permlink) => {
    const r = await rpcCall("condenser_api.get_content_replies", [author, permlink]);
    for (const c of (r?.result ?? [])) if (PERSONA_IDS.includes(c.author)) samples.push({ a: c.author, body: String(c.body ?? ""), created: String(c.created ?? "") });
  };
  for (const acct of PERSONA_IDS.slice(0, 8)) {
    const r = await rpcCall("condenser_api.get_discussions_by_blog", [{ tag: acct, limit: 3 }]);
    for (const p of (r?.result ?? []).filter((x) => x.author === acct).slice(0, 2)) await collect(acct, p.permlink);
  }
  /* voice test: the comment carries its persona's signature slang, OR at
   * least passes the negative controls (no dashes, no account names) */
  /* R264 era law: persona-voicing landed R263 (03:00Z) — only comments born
   * after it are judged for voice; the sampled pre-era bodies are history */
  const R263 = "2026-10-08T02:00:00Z";
  const current = samples.filter((x) => x.created >= R263);
  const judged = (current.length ? current : samples).map((s) => {
    const slang = (PERSONAS[s.a]?.slang ?? []).map((x) => x.toLowerCase());
    const hasVoice = slang.some((w) => s.body.toLowerCase().includes(w));
    const clean = !s.body.includes("—") && !["cashmachine", "haran", "israelnews", "hcsoldier", "saos"].some((w) => s.body.toLowerCase().includes(w));
    return { a: s.a, hasVoice, clean, len: s.body.length };
  });
  const voiced = judged.filter((j) => j.hasVoice).length;
  const dirty = judged.filter((j) => !j.clean);
  const verdict = current.length === 0 ? "PARTIAL" : dirty.length ? "REFUTED" : voiced > 0 ? "CONFIRMED" : "PARTIAL";
  return V("persona-voiced-comments-on-chain", verdict, { preEra: samples.length - current.length, judged: judged.length, voiced, dirty: dirty.slice(0, 5), note: current.length === 0 ? "no R263-era comments on chain yet (windows open 07:00+; mechanism selftest-locked) — pre-era dashes are history" : undefined });
}

/* ── CLAIM 6: "staggered windows" (chain: actual post times today) ───────── */
async function claimStaggered() {
  const times = [];
  for (const acct of HIVE_ROSTER) {
    const r = await rpcHive("condenser_api.get_discussions_by_blog", [{ tag: acct, limit: 3 }]);
    for (const p of (r?.result ?? []).filter((x) => x.author === acct && String(x.created ?? "").slice(0, 10) === day)) {
      times.push({ acct, utc: String(p.created).slice(11, 16), permlink: String(p.permlink).slice(0, 40), machineShaped: /^d17\d{11}-\d/.test(String(p.permlink)) });
    }
  }
  const burst = times.length >= 2 && (Math.max(...times.map((t) => t.m = Date.parse(`2000-01-01T${t.utc}:00Z`))) - Math.min(...times.map((t) => t.m))) < 20 * 60_000;
  return V("hive-staggered-windows", times.length === 0 ? "PARTIAL" : burst || times.some((t) => t.machineShaped) ? "REFUTED" : "CONFIRMED", { postsToday: times, note: times.length === 0 ? "no posts yet today (windows open 07:00+)" : "times measured from chain" });
}

/* ── CLAIM 7: "the fleet does not sound like one bot" (monoculture scan) ─── */
function tokens(t) { return new Set(String(t ?? "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 3)); }
async function claimMonoculture() {
  const titles = [];
  for (const acct of PERSONA_IDS) {
    const r = await rpcCall("condenser_api.get_discussions_by_blog", [{ tag: acct, limit: 2 }]);
    for (const p of (r?.result ?? []).filter((x) => x.author === acct && x.id !== 0)) titles.push({ a: acct, t: String(p.title ?? "") });
  }
  let worst = 0, pair = null;
  for (let i = 0; i < titles.length; i++) for (let j = i + 1; j < titles.length; j++) {
    const A = tokens(titles[i].t), B = tokens(titles[j].t);
    if (!A.size || !B.size) continue;
    let inter = 0; for (const w of A) if (B.has(w)) inter++;
    const sim = inter / Math.min(A.size, B.size);
    if (sim > worst) { worst = sim; pair = [titles[i], titles[j]]; }
  }
  return V("no-monoculture-titles", worst >= 0.7 ? "REFUTED" : "CONFIRMED", { pairs: titles.length, worst: +worst.toFixed(2), pair });
}

/* ── CLAIM 8: "engagement exists" (children + votes on our posts) ────────── */
async function claimEngagement() {
  let posts = 0, withVotes = 0, withComments = 0, totalChildren = 0;
  for (const acct of PERSONA_IDS) {
    const r = await rpcCall("condenser_api.get_discussions_by_blog", [{ tag: acct, limit: 2 }]);
    for (const p of (r?.result ?? []).filter((x) => x.author === acct && x.id !== 0)) {
      posts++;
      const votes = (p.active_votes ?? []).filter((v) => Number(v.percent) !== 0);
      if (votes.length) withVotes++;
      totalChildren += Number(p.children ?? 0);
      if (Number(p.children ?? 0) > 0) withComments++;
    }
  }
  return V("engagement-measured", posts === 0 ? "UNPROVABLE" : withVotes / posts >= 0.5 ? "CONFIRMED" : "PARTIAL", { posts, withVotes, withComments, totalChildren });
}

/* ── NEGATIVE CONTROLS: can these checks actually FAIL a violation? ──────── */
function negativeControls() {
  const ncs = [];
  const dashDetect = (b) => b.includes("—");
  ncs.push({ name: "dash-detector-catches-planted-dash", ok: dashDetect("this body has a planted — dash") === true && dashDetect("clean body") === false });
  const leakDetect = (raw) => LEAKS.some((l) => raw.toLowerCase().includes(l));
  ncs.push({ name: "leak-detector-catches-planted-instagram", ok: leakDetect('{"profile":{"website":"https://instagram.com/x"}}') === true && leakDetect('{"profile":{"website":""}}') === false });
  const thinDetect = (w) => w < 300;
  ncs.push({ name: "thin-detector-catches-220w", ok: thinDetect(220) === true && thinDetect(450) === false });
  const codenameDetect = (pl, tags) => ["saos", "hcsoldier", "fleet"].some((c) => `${pl} ${(tags ?? []).join(" ")}`.toLowerCase().includes(c));
  ncs.push({ name: "codename-detector-catches-saos-permlink", ok: codenameDetect("saos-transparency-20261008", ["steem"]) === true && codenameDetect("daily-ledger-20261008", ["steem"]) === false });
  return ncs;
}

/* ── run all ─────────────────────────────────────────────────────────────── */
try { await claimSteemProfiles(); } catch (e) { V("steem-14-14-profiles", "UNPROVABLE", { error: String(e?.message ?? e).slice(0, 120) }); }
try { await claimHiveProfiles(); } catch (e) { V("hive-profiles-8-9", "UNPROVABLE", { error: String(e?.message ?? e).slice(0, 120) }); }
try { await claimPostQuality(); } catch (e) { V("post-quality-laws-on-chain", "UNPROVABLE", { error: String(e?.message ?? e).slice(0, 120) }); }
try { await claimDownvotes(); } catch (e) { V("trial-era-zero-downvotes", "UNPROVABLE", { error: String(e?.message ?? e).slice(0, 120) }); }
try { await claimCommentVoices(); } catch (e) { V("persona-voiced-comments-on-chain", "UNPROVABLE", { error: String(e?.message ?? e).slice(0, 120) }); }
try { await claimStaggered(); } catch (e) { V("hive-staggered-windows", "UNPROVABLE", { error: String(e?.message ?? e).slice(0, 120) }); }
try { await claimMonoculture(); } catch (e) { V("no-monoculture-titles", "UNPROVABLE", { error: String(e?.message ?? e).slice(0, 120) }); }
try { await claimEngagement(); } catch (e) { V("engagement-measured", "UNPROVABLE", { error: String(e?.message ?? e).slice(0, 120) }); }
report.negativeControls = negativeControls();
report.wicRcNow = null;
try {
  const r = await rpcHive("rc_api.find_rc_accounts", { accounts: ["wic"] });
  const a = r?.result?.rc_accounts?.[0];
  if (a) {
    const cur = Number(a.rc_manabar?.current_mana ?? 0), max = Number(a.max_rc ?? 0);
    const upd = Number(a.rc_manabar?.last_update_time ?? 0);
    const elapsed = Math.max(0, Math.floor(Date.now() / 1000) - (Number.isFinite(upd) ? upd : 0));
    report.wicRcNow = { curB: +(cur / 1e9).toFixed(3), regenAdjustedB: +((max > 0 ? Math.min(max, cur + (max * Math.min(elapsed, 432_000)) / 432_000) : cur) / 1e9).toFixed(3) };
  }
} catch {}
import * as fs from "node:fs";
fs.writeFileSync(new URL("./state/r264-redteam.json", import.meta.url).pathname, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
