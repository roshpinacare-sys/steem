/**
 * fleet-visibility.mjs — R300 · THE MULTI-FRONTEND CENSUS (owner order 2026-10-14).
 *
 * OWNER MANDATE (verbatim): "יש עוד רשתות שמציגות בבלוקצ'יין של סטימיט בוא
 * נעבוד איתם עד שנדע שאנחנו ערוכים באמת לעבוד ברשת בלי להיחסם" — steemit.com
 * is ONE frontend among many. The shelling incident (R297-R299) proved the
 * network was blind to a frontend-level filter because it measured the chain
 * only. This census measures the roster across EVERY public vantage that
 * displays the Steem blockchain, so the network KNOWS WHERE it is visible —
 * and where it is not — independent of any single gatekeeper.
 *
 * SOURCES (all public, zero keys, read-only):
 *   chain   — condenser_api.get_accounts batched on 3 independent nodes
 *             (api.steemit.com · api.justyy.com · steem-rpc.publicnode.com)
 *   steemit — steemit.com profile pages (the R299 un-shell meter, reused)
 *   wallet  — steemitwallet.com (the official wallet UI — server-rendered
 *             condenser; measured 200+marker from a datacenter IP 2026-10-14)
 *   steemworld — steemworld.org profile pages
 *   steemdb — steemdb.io profile pages
 *   steemscan  — steemscan.com account pages (a JS SPA — honestly verdicts
 *             "spa" when the HTML cannot judge, never guessed)
 *
 * Verdicts per cell (fail-honest, never guessed):
 *   "rendered"  — HTTP 200 and the account marker appears in the payload
 *   "shell"     — HTTP 200 server-rendered WITHOUT the marker (account-specific hiding)
 *   "spa"       — HTTP 200 but the page is a JS shell (id="app"/"root"/tiny) —
 *                 HTML cannot judge; excluded from shell counts, honestly
 *   "challenge" — Cloudflare interstitial (cannot judge from this vantage)
 *   "http-N"    — any other status
 *   "error"     — network/timeout
 *
 * Overall verdict (summarizeCensus — pure, selftested):
 *   CHAIN-PROBLEM      — an account the chain nodes cannot see (never yet)
 *   CHAIN-DARK         — zero chain nodes answered
 *   CANNOT-JUDGE       — zero judgeable alt-frontend cells from this vantage
 *   STEEMIT-ONLY-SHELL — steemit shells ≥half the roster while ≥1 alt
 *                        frontend renders it (the measured 2026-10-14 state)
 *   FULLY-VISIBLE      — steemit renders + alt frontends render
 *   WIDE-SHELL         — hiding spread beyond steemit (alt shells ≥half)
 *   PARTIAL            — anything else, reported honestly per cell
 *
 * Zero secrets, zero broadcast. State → state/visibility-census.json
 * (committed with the heartbeat state like every honest book).
 */

import fs from "node:fs";
import path from "node:path";
import shellWatch from "./shell-watch.mjs";
const steemitProbe = shellWatch.probeOne; /* R299 reuse — one steemit meter, two consumers */

const CONTROL_ACCOUNT = "steemit";
const TIMEOUT_MS = 12000;
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export const CHAIN_NODES = [
  "https://api.steemit.com",
  "https://api.justyy.com",
  "https://steem-rpc.publicnode.com",
];

/* alt frontends — steemit.com is probed via shell-watch's probeOne (R299) */
export const FRONTENDS = {
  wallet: (a) => `https://steemitwallet.com/@${a}`,
  steemworld: (a) => `https://steemworld.org/@${a}`,
  steemdb: (a) => `https://steemdb.io/@${a}`,
  steemscan: (a) => `https://steemscan.com/account/${a}`,
};

/* ── pure: cell verdict ───────────────────────────────────────────────────── */
export function accountMarker(account, body) {
  try {
    return new RegExp(`@?${account}(?![a-z0-9-])`, "i").test(String(body ?? "")) ||
      String(body ?? "").includes(`"${account}"`);
  } catch { return false; }
}

export function isSpaShell(body) {
  const s = String(body ?? "");
  return /<div\s+id=["'](app|root)["']/.test(s) || /__NUXT__|__NEXT_DATA__/.test(s) || s.length < 2000;
}

/** fetch one frontend cell → verdict (fail-honest). */
export async function probeFrontend(name, url, account, { timeout = TIMEOUT_MS, ua = UA } = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": ua, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeout),
    });
    const body = await r.text();
    const ms = Date.now() - t0;
    if (r.status === 403 && /just a moment|challenges\.cloudflare/i.test(body)) {
      return { frontend: name, account, verdict: "challenge", http: 403, ms };
    }
    if (r.status !== 200) return { frontend: name, account, verdict: `http-${r.status}`, http: r.status, ms };
    if (accountMarker(account, body)) return { frontend: name, account, verdict: "rendered", http: 200, ms };
    if (isSpaShell(body)) return { frontend: name, account, verdict: "spa", http: 200, ms, htmlBytes: body.length };
    return { frontend: name, account, verdict: "shell", http: 200, ms, htmlBytes: body.length };
  } catch (e) {
    return { frontend: name, account, verdict: "error", error: String(e?.message ?? e).slice(0, 100), ms: Date.now() - t0 };
  }
}

/* ── chain truth: batched get_accounts per node ───────────────────────────── */
async function chainNodeAccounts(node, accounts) {
  try {
    const r = await fetch(node, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_accounts", params: [accounts], id: 1 }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const j = await r.json();
    const arr = j?.result;
    if (!Array.isArray(arr)) return { node, ok: false, error: "no-result" };
    const byName = new Map(arr.map((a) => [String(a?.id !== undefined ? a.name : a?.name), a]));
    return {
      node, ok: true,
      accounts: Object.fromEntries(accounts.map((a) => {
        const acc = byName.get(a) ?? null;
        return [a, acc ? {
          ok: true,
          created: String(acc.created ?? "") || null,
          postCount: Number(acc.post_count ?? 0) || 0,
          lastVote: String(acc.last_vote_time ?? "") || null,
        } : { ok: false }];
      })),
    };
  } catch (e) {
    return { node, ok: false, error: String(e?.message ?? e).slice(0, 80) };
  }
}

/* ── pure: the verdict over the matrix ────────────────────────────────────── */
export function summarizeCensus({ roster, chain, frontends } = {}) {
  const names = (Array.isArray(roster) ? roster : []).filter(Boolean);
  const fe = frontends ?? {};
  const answering = Object.values(chain ?? {}).filter((n) => n?.ok);
  const chainOkAll = answering.length > 0 && names.every((a) =>
    answering.some((n) => n.accounts?.[a]?.ok === true));
  const chainVerdict = answering.length === 0 ? "CHAIN-DARK" : chainOkAll ? "ALL-EXISTS" : "MISSING";

  const count = (cell, v) => names.filter((a) => fe[cell]?.[a]?.verdict === v).length;
  const steemit = {
    shelled: count("steemit", "shell"), rendered: count("steemit", "rendered"),
    challenged: count("steemit", "challenge"), spa: count("steemit", "spa"),
  };
  const altCells = Object.keys(fe).filter((c) => c !== "steemit");
  const alt = {
    rendered: count("wallet", "rendered") + count("steemworld", "rendered") + count("steemdb", "rendered") + count("steemscan", "rendered"),
    shell: count("wallet", "shell") + count("steemworld", "shell") + count("steemdb", "shell") + count("steemscan", "shell"),
    spa: count("wallet", "spa") + count("steemworld", "spa") + count("steemdb", "spa") + count("steemscan", "spa"),
    challenge: count("wallet", "challenge") + count("steemworld", "challenge") + count("steemdb", "challenge") + count("steemscan", "challenge"),
    error: count("wallet", "error") + count("steemworld", "error") + count("steemdb", "error") + count("steemscan", "error"),
  };
  /* an account counts as alt-visible if ANY alt frontend renders it */
  const altRenderedAccounts = names.filter((a) => altCells.some((c) => fe[c]?.[a]?.verdict === "rendered")).length;
  const altShellAccounts = names.filter((a) => altCells.some((c) => fe[c]?.[a]?.verdict === "shell")).length;
  const judgedAlt = alt.rendered + alt.shell;
  const half = Math.max(1, Math.ceil(names.length / 2));

  let verdict;
  if (chainVerdict === "MISSING") verdict = "CHAIN-PROBLEM";
  else if (chainVerdict === "CHAIN-DARK") verdict = "CHAIN-DARK";
  else if (judgedAlt === 0) verdict = "CANNOT-JUDGE";
  else if (steemit.shelled >= half && altRenderedAccounts >= 1) verdict = "STEEMIT-ONLY-SHELL";
  else if (steemit.shelled === 0 && steemit.rendered >= half && altRenderedAccounts >= 1) verdict = "FULLY-VISIBLE";
  else if (altShellAccounts >= half) verdict = "WIDE-SHELL";
  else verdict = "PARTIAL";

  return {
    chain: chainVerdict,
    nodes: answering.length,
    steemit, alt,
    altRenderedAccounts, altShellAccounts,
    cells: { total: names.length * (1 + altCells.length), judged: judgedAlt + steemit.rendered + steemit.shelled },
    verdict,
  };
}

/** probe the whole census (chain ×3 + steemit + 4 alt frontends) → report. */
export async function runVisibilityCensus({ now = new Date().toISOString(), roster = [], stateDir } = {}) {
  const at = now;
  const accounts = [...new Set([...(Array.isArray(roster) ? roster : []), CONTROL_ACCOUNT])];
  const fleet = accounts.filter((a) => a !== CONTROL_ACCOUNT);

  const chainList = await Promise.all(CHAIN_NODES.map((n) => chainNodeAccounts(n, accounts)));
  const chain = Object.fromEntries(chainList.map((n) => [new URL(n.node).host, n]));

  /* steemit.com via the R299 probe (sequential — gentle on one host) */
  const steemitCells = {};
  for (const a of accounts) {
    const v = await steemitProbe(a);
    steemitCells[v.account] = { verdict: v.verdict, http: v.http ?? null, ms: v.ms ?? null, error: v.error ?? null };
  }
  /* alt frontends — one host at a time, accounts parallel within the host */
  const frontends = { steemit: steemitCells };
  for (const [name, urlOf] of Object.entries(FRONTENDS)) {
    const cells = await Promise.all(accounts.map((a) => probeFrontend(name, urlOf(a), a)));
    frontends[name] = Object.fromEntries(cells.map((c) => [c.account, { verdict: c.verdict, http: c.http ?? null, ms: c.ms ?? null, error: c.error ?? null, htmlBytes: c.htmlBytes ?? null }]));
  }

  const summary = summarizeCensus({ roster: fleet, chain, frontends });
  const report = { at, probe: "roshpinacare.fleet-visibility/1", roster: accounts, control: CONTROL_ACCOUNT, chain, frontends, summary };
  try {
    const dir = stateDir || process.env.SAOS_STATE_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), "state");
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, "visibility-census.json");
    const t = `${p}.tmp.${process.pid}`;
    fs.writeFileSync(t, JSON.stringify(report, null, 2));
    fs.renameSync(t, p);
  } catch { /* read-only state: the return value still carries the truth */ }
  return report;
}

/* ── selftest (pure, zero network) ────────────────────────────────────────── */
export function selftest() {
  const out = [];
  // 1. marker: exact account name found, sibling names not
  out.push(["marker-hits", accountMarker("tov", 'hello @tov and "tov" rocks') === true]);
  out.push(["marker-sibling-no-false", accountMarker("tov", "welcome @tovname to the party") === false]);
  // 2. spa detection: JS shell vs server-rendered page
  out.push(["spa-app-root", isSpaShell('<html><body><div id="app"></div></body></html>') === true]);
  out.push(["spa-nuxt", isSpaShell("<script>window.__NUXT__={}</script>") === true]);
  out.push(["spa-tiny", isSpaShell("<html>tiny</html>") === true]);
  out.push(["spa-server-page-no", isSpaShell('<html><body class="page account">long content...'.padEnd(3000, "x") + "</body></html>") === false]);
  // 3. census verdicts
  const R = ["a", "b", "c", "d"];
  const chain = { "api.steemit.com": { ok: true, accounts: Object.fromEntries(R.map((a) => [a, { ok: true }])) } };
  const feShell = { steemit: Object.fromEntries(R.map((a) => [a, { verdict: "shell" }])) };
  const feRender = (name) => ({ [name]: Object.fromEntries(R.map((a) => [a, { verdict: "rendered" }])) });
  let s = summarizeCensus({ roster: R, chain, frontends: { ...feShell, ...feRender("wallet") } });
  out.push(["census-steemit-only-shell", s.verdict === "STEEMIT-ONLY-SHELL" && s.altRenderedAccounts === 4]);
  s = summarizeCensus({ roster: R, chain, frontends: { steemit: Object.fromEntries(R.map((a) => [a, { verdict: "rendered" }])), ...feRender("wallet") } });
  out.push(["census-fully-visible", s.verdict === "FULLY-VISIBLE"]);
  s = summarizeCensus({ roster: R, chain, frontends: { ...feShell, wallet: Object.fromEntries(R.map((a) => [a, { verdict: "shell" }])) } });
  out.push(["census-wide-shell", s.verdict === "WIDE-SHELL"]);
  s = summarizeCensus({ roster: R, chain, frontends: { ...feShell, wallet: Object.fromEntries(R.map((a) => [a, { verdict: "spa" }])) } });
  out.push(["census-cannot-judge-spa", s.verdict === "CANNOT-JUDGE" && s.alt.shell === 0]);
  const chainMiss = { "api.steemit.com": { ok: true, accounts: { a: { ok: true }, b: { ok: false }, c: { ok: true }, d: { ok: true } } } };
  s = summarizeCensus({ roster: R, chain: chainMiss, frontends: { ...feShell, ...feRender("wallet") } });
  out.push(["census-chain-problem", s.verdict === "CHAIN-PROBLEM"]);
  s = summarizeCensus({ roster: R, chain: {}, frontends: { ...feShell, ...feRender("wallet") } });
  out.push(["census-chain-dark", s.verdict === "CHAIN-DARK"]);
  /* spa cells never inflate shell counts — the honesty law */
  s = summarizeCensus({ roster: R, chain, frontends: { steemit: Object.fromEntries(R.map((a) => [a, { verdict: "spa" }])), wallet: Object.fromEntries(R.map((a) => [a, { verdict: "spa" }])) } });
  out.push(["census-spa-never-shell", s.alt.shell === 0 && s.steemit.shelled === 0 && s.verdict === "CANNOT-JUDGE"]);
  const failed = out.filter(([, ok]) => !ok);
  return { ok: failed.length === 0, passed: out.length - failed.length, total: out.length, failed: failed.map(([n]) => n) };
}

export default { runVisibilityCensus, summarizeCensus, probeFrontend, accountMarker, isSpaShell, selftest, FRONTENDS, CHAIN_NODES };
