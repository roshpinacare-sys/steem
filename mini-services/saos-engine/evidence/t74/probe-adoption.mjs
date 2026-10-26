/**
 * T-74d · SIBLING ADOPTION PROBE (read-only, chain truth).
 * The delegated writer (the sibling agent on the git) owns siq/tov/wic/wog/woq.
 * DOCTRINE-HUMANITY-T73 was broadcast for it; the engine's gates now BLOCK its
 * template classes at our rails — but adoption means the sibling STOPS
 * EMITTING them. Measured here: every comment op of each delegate in the
 * last 3 days, judged by commentHumanityLaw + titleHumanityLaw, blocked-class
 * counts, and the fleet-spacing reality (same-minute clusters).
 * Zero signatures, zero capital — senses only.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { rpcCall } from "../../measure.mjs";
import { commentHumanityLaw, titleHumanityLaw } from "../../lib.mjs";

const DELEGATES = ["siq", "tov", "wic", "wog", "woq"];
const SINCE_DAYS = 3;
const now = Date.now();
const since = now - SINCE_DAYS * 86_400_000;

const accountHistory = async (account, limit = 300) => {
  const r = await rpcCall("condenser_api.get_account_history", [account, -1, limit]);
  if (!r.ok || !Array.isArray(r.result)) return { ok: false, err: String(r.error ?? "no-result").slice(0, 120) };
  return { ok: true, rows: r.result };
};

const out = { at: new Date(now).toISOString(), sinceDays: SINCE_DAYS, accounts: {}, verdict: null, law: "" };
let templateEmissions = 0, totalComments = 0, totalPosts = 0;
const allSocialTs = [];

for (const acc of DELEGATES) {
  const row = { comments: 0, posts: 0, blockedClasses: [], socialTs: [] };
  const h = await accountHistory(acc);
  if (!h.ok) { row.error = h.err; out.accounts[acc] = row; continue; }
  for (const [, ev] of h.rows) {
    const [name, body] = ev?.op ?? [];
    const ts = Date.parse(ev?.timestamp ?? "");
    if (!Number.isFinite(ts) || ts < since) continue;
    if (name === "comment") {
      const isRoot = body?.parent_author === "";
      if (isRoot) { row.posts += 1; totalPosts += 1; row.socialTs.push(ts); allSocialTs.push(ts);
        const t = titleHumanityLaw({ title: String(body?.title ?? ""), recentTitles: [] });
        if (t.verdict !== "PASS") row.blockedClasses.push(`POST:${t.verdict}`);
      } else { row.comments += 1; totalComments += 1; row.socialTs.push(ts); allSocialTs.push(ts);
        const c = commentHumanityLaw({ body: String(body?.body ?? ""), parentBody: String(body?.parent_permlink ?? "body") });
        if (c.verdict !== "PASS") row.blockedClasses.push(`COMMENT:${c.verdict}`);
      }
    }
  }
  templateEmissions += row.blockedClasses.length;
  out.accounts[acc] = row;
}

out.templateEmissions = templateEmissions;
out.totalComments = totalComments;
out.totalPosts = totalPosts;
out.verdict = templateEmissions === 0
  ? "ADOPTED-OR-SILENT (no blocked-class emissions in window)"
  : `NON-ADOPTED (${templateEmissions} blocked-class emissions in window)`;

fs.mkdirSync(new URL(".", import.meta.url).pathname, { recursive: true });
fs.writeFileSync(new URL("./probe-adoption-result.json", import.meta.url).pathname, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
