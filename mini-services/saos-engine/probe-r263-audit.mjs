/**
 * probe-r263-audit.mjs — R263 OPENING AUDIT (chain truth, both chains).
 * Measures: profiles vs persona canon on Steem (14) + Hive (9), latest post
 * per account, posts today, RC on Hive, downvote scan on trial-era posts.
 * Verdicts only. No keys, no writes to ops state.
 */
import { rpcCall } from "./measure.mjs";
import { rpcHive } from "./hive.mjs";
import { PERSONA_IDS, profileDoc, profileDiffers } from "./personas.mjs";
import { HIVE_ROSTER } from "./hive.mjs";
import { hiveProfileDoc } from "./hive-profiles.mjs";
import * as fs from "node:fs";

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const now = new Date().toISOString();
const day = now.slice(0, 10);

const j = (o) => JSON.stringify(o);

/* ── Steem side ─────────────────────────────────────────────────────────── */
async function steemProfiles() {
  const r = await rpcCall("condenser_api.get_accounts", [PERSONA_IDS]);
  const accs = r?.result ?? [];
  const out = [];
  for (const a of accs) {
    const raw = String(a.posting_json_metadata || a.json_metadata || "{}");
    let profile = {};
    try { profile = JSON.parse(raw)?.profile ?? {}; } catch {}
    const doc = profileDoc(a.name);
    const differs = doc ? profileDiffers(raw, doc) : null;
    out.push({ account: a.name, chainName: profile.name ?? null, hasImage: Boolean(profile.profile_image), matchesCanon: doc ? !differs : "no-doc", img: String(profile.profile_image ?? "").slice(0, 60) || null });
  }
  return out;
}

async function steemPosts(acct) {
  const r = await rpcCall("condenser_api.get_discussions_by_blog", [{ tag: acct, limit: 3 }]);
  const posts = (r?.result ?? []).filter((p) => p.author === acct && p.id !== 0);
  const last = posts[0];
  const today = posts.filter((p) => String(p.created ?? "").slice(0, 10) === day).length;
  const flags = (last?.active_votes ?? []).filter((v) => Number(v.percent) < 0).length;
  return { last: last ? `${last.created} ${last.permlink.slice(0, 40)}` : null, today, lastFlags: flags };
}

/* ── Hive side ──────────────────────────────────────────────────────────── */
async function hiveProfiles() {
  const r = await rpcHive("condenser_api.get_accounts", [HIVE_ROSTER]);
  const accs = r?.ok ? (r.result ?? []) : [];
  const out = [];
  for (const a of accs) {
    const raw = String(a.posting_json_metadata || a.json_metadata || "{}");
    let profile = {};
    try { profile = JSON.parse(raw)?.profile ?? {}; } catch {}
    const doc = hiveProfileDoc(a.name);
    const differs = doc ? profileDiffers(raw, doc) : null;
    out.push({ account: a.name, chainName: profile.name ?? null, hasImage: Boolean(profile.profile_image), matchesCanon: doc ? !differs : "no-doc", img: String(profile.profile_image ?? "").slice(0, 60) || null });
  }
  return out;
}

async function hiveRc(acct) {
  const r = await rpcHive("rc_api.find_rc_accounts", { accounts: [acct] });
  const a = r?.result?.rc_accounts?.[0];
  if (!a) return null;
  const cur = Number(a.rc_manabar?.current_mana ?? 0);
  const max = Number(a.max_rc ?? 0);
  const upd = Number(a.rc_manabar?.last_update_time ?? 0);
  const elapsed = Math.max(0, Math.floor(Date.now() / 1000) - (Number.isFinite(upd) ? upd : 0));
  const avail = max > 0 ? Math.min(max, cur + (max * Math.min(elapsed, 432_000)) / 432_000) : cur;
  return { availB: +(avail / 1e9).toFixed(3), maxB: +(max / 1e9).toFixed(3) };
}

async function hivePosts(acct) {
  const r = await rpcHive("condenser_api.get_discussions_by_blog", [{ tag: acct, limit: 3 }]);
  const posts = (r?.ok ? (r.result ?? []) : []).filter((p) => p.author === acct && p.id !== 0);
  const last = posts[0];
  const today = posts.filter((p) => String(p.created ?? "").slice(0, 10) === day).length;
  const neg = [];
  for (const p of posts) for (const v of (p.active_votes ?? [])) if (Number(v.percent) < 0) neg.push({ p: p.permlink.slice(0, 30), v: v.voter });
  return { last: last ? `${last.created} ${last.permlink.slice(0, 40)}` : null, today, flags: neg };
}

/* ── run ────────────────────────────────────────────────────────────────── */
const report = { at: now, day, steem: {}, hive: {} };

try {
  const sp = await steemProfiles();
  for (const row of sp) {
    const posts = await steemPosts(row.account);
    report.steem[row.account] = { ...row, ...posts };
  }
} catch (e) { report.steem.error = String(e?.message ?? e).slice(0, 120); }

try {
  const hp = await hiveProfiles();
  for (const row of hp) {
    const [posts, rc] = await Promise.all([hivePosts(row.account), hiveRc(row.account)]);
    report.hive[row.account] = { ...row, ...posts, rc };
  }
} catch (e) { report.hive.error = String(e?.message ?? e).slice(0, 120); }

/* engine state snapshot */
const st = readJson(new URL("./state/content-ops.json", import.meta.url).pathname, null);
report.engine = {
  contentVerdict: st?.verdict ?? null, draftedAt: st?.draftedAt ?? null,
  draftedQueued: (st?.queue ?? []).filter((d) => d.status === "drafted").length,
  published: (st?.queue ?? []).filter((d) => d.status === "published").length,
  byChain: (st?.queue ?? []).filter((d) => d.status === "published").reduce((m, d) => { m[d.chain ?? "steem"] = (m[d.chain ?? "steem"] ?? 0) + 1; return m; }, {}),
};
report.hiveOps = readJson(new URL("./state/hive-ops.json", import.meta.url).pathname, null)?.verdict ?? null;
report.hiveSocialVerdict = readJson(new URL("./state/hive-social.json", import.meta.url).pathname, null)?.verdict ?? null;

fs.writeFileSync(new URL("./state/r263-audit.json", import.meta.url).pathname, j(report, null, 2));
console.log(j(report, null, 2));
