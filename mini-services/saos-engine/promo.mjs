/**
 * promo.mjs — the promotion rail: one honest public ledger per UTC day.
 *
 * R264 · REBUILT AFTER THE ADVERSARIAL AUDIT (the operator's order: "תבדוק
 * את הטענות שלך כאילו הן שקר... ראה מה עוד הם עושים ותוודא"). The red-team
 * found the old transparency post violating OUR OWN laws on chain:
 *  · the STYLE law — an em-dash in the title, a 140-word body (the spam-
 *    detector tier the R244 round was built to end);
 *  · the EXPOSURE law — the internal codename in the permlink, the title,
 *    AND the tags (a probe magnet: exactly what the operator's OPSEC order
 *    forbids — "שלא יחקרו פרטים"), plus internal jargon ("keyless-doctrine",
 *    "soldier fleet") no outsider should ever read.
 *
 * THE NEW LAW (pure builder, selftest-locked):
 *  · neutral, professional identity: "The Daily Ledger" — a workshop log of
 *    real numbers. No codenames anywhere (permlink, title, tags, body).
 *  · the body is dash-normalized, ≥300 words, opens with the lede (a real
 *    number), carries a markdown table (the R262 FORMAT law), and closes
 *    with an inviting question — craft, not a bare bullet dump.
 *  · every number stays EXACTLY as measured: honesty was never the problem;
 *    the wrapping was.
 *
 * Guards kept: 1/day (existence-checked on-chain), posting-key authority,
 * capped content, honest numbers only.
 */
import { rpcCall } from "./measure.mjs";
import { executeAs, masterAccount } from "./signer.mjs";
import { normalizeDashes } from "./content.mjs";

const dayOf = (iso) => String(iso ?? new Date().toISOString()).slice(0, 10).replace(/-/g, "");

function fmt(v, d = 2) { return v == null ? "?" : Number(v).toFixed(d); }

/** pure: internal decision kinds become neutral public labels — the ledger
 * never echoes codenames, and the ban list below enforces it (the builder
 * REFUSES to ship a body that leaked one; measured: the selftest fixture's
 * own "soldiers" kind was caught by this law, which is exactly the point). */
const KIND_LABELS = { soldiers: "order grid", curate: "curation", promo: "daily ledger", conversions: "token conversions", economics: "treasury", content: "writers' room", social: "community desk" };
const kindLabel = (k) => KIND_LABELS[String(k ?? "").toLowerCase()] ?? "system check";

/** pure (R264, selftest-locked): the craft-checked ledger body.
 * laws: dash-free, ≥MIN words, no banned/codename words, one table, one
 * closing question, numbers rendered exactly as passed (no invention). */
export function buildLedgerBody({ dayIso, parity, paritySource, lowConfidence, orders, fills, realizedSbd, curationUsd, authorUsd, gridVerdict, decisions }) {
  const day = String(dayIso ?? "").slice(0, 10);
  const conf = lowConfidence ? " (low-confidence reading, published anyway, labeled honestly)" : "";
  const publicize = (s) => String(s ?? "")
    .replace(/\|/g, "/")
    .replace(/fleet/gi, "the desk")
    .replace(/soldier[s]?/gi, "sub-account")
    .replace(/army/gi, "roster")
    .replace(/saos/gi, "the network")
    .replace(/sovereign/gi, "the network")
    .replace(/doctrine/gi, "policy");
  const decRows = (Array.isArray(decisions) ? decisions : []).slice(0, 6)
    .map((d) => `| ${publicize(kindLabel(d?.kind))} | ${publicize(d?.decision).slice(0, 60)} | ${publicize(d?.reason).slice(0, 80)} |`)
    .join("\n");
  const seed = daySeed(String(dayIso ?? ""));
  const ledeCore = `market parity between the two chain tokens closed the day at ${fmt(parity, 6)}${conf}, read from ${paritySource ?? "public feeds"}. The order book held ${orders ?? "?"} open orders and ${fills} real fills in the measured window. Realized result, accounted by average cost, no smoothing: ${fmt(realizedSbd, 6)} SBD.`;
  const body = [
    LEDE_VARIANTS[seed % LEDE_VARIANTS.length](ledeCore),
    "",
    "This page runs a small, patient experiment on the chain's own markets: a fixed ladder of offers, re-checked every cycle, with every fill and every decision written down where anyone can audit it. Nothing here is a promise and nothing here is advice. The only claim this ledger makes is that the numbers below are the same numbers the system acted on.",
    "",
    "**The day's ledger at a glance:**",
    "",
    "| Measure | Value | Notes |",
    "| --- | --- | --- |",
    `| Token parity (SBD/STEEM) | ${fmt(parity, 6)} | source: ${paritySource ?? "public feeds"}${lowConfidence ? ", low confidence" : ""} |`,
    `| Open orders | ${orders ?? "?"} | the working ladder |`,
    `| Fills in window | ${fills} | real executions, not intentions |`,
    `| Realized (avg cost) | ${fmt(realizedSbd, 6)} SBD | honest accounting, no smoothing |`,
    `| Curation fuel | ${fmt(curationUsd, 4)} $/day | measured, not estimated |`,
    `| Author fuel | ${fmt(authorUsd, 4)} $/day | measured, not estimated |`,
    `| Order grid | ${String(gridVerdict ?? "deploying").replace(/\|/g, "/")} | the ladder's own verdict |`,
    "",
    "**Decisions taken today, with the reason each one gave:**",
    "",
    decRows || "| (none recorded this cycle) | | |",
    "",
    "A note on method, because method is the honest part: every figure above is pulled from public chain data and the system's own execution log, then published as-is, including the readings that make the day look unremarkable. An unremarkable day that is reported truthfully is worth more than an exciting one that is dressed up. The ladder does not move on feelings; it moves on the arithmetic in this table, and when the arithmetic is wrong, the loss lands here in plain sight the same way the wins do.",
    "",
    "That is the whole practice: measure, act, write it down, repeat.",
    "",
    CLOSER_VARIANTS[seed % CLOSER_VARIANTS.length],
  ].join("\n");
  const out = normalizeDashes(body);
  const words = out.split(/\s+/).filter(Boolean).length;
  const banned = ["saos", "sovereign", "fleet", "soldier", "army", "doctrine", "keyless", "—", "–"];
  const low = out.toLowerCase();
  if (words < 300) throw new Error(`ledger-body-thin: ${words} words`);
  if (banned.some((b) => low.includes(b))) throw new Error("ledger-body-exposure");
  return out;
}

/* R270 · THE ANTI-GENERIC LAW (operator order, verbatim intent): "סליחה
 * שעצרתי אותך באמצע... ראיתי תגובות שלנו הן די דומות מאוד... אני לא מסוגל
 * לראות את הדבר הגנרי הזה... תשפר תבונה ואיכות ונראות". A ledger that opens
 * with the SAME sentence and closes with the SAME question every single day
 * is a template wearing a data hat. From now on the title, the lede and the
 * closing question each rotate through a small pool of hand-written variants,
 * chosen deterministically from the day string (same day = same text, so the
 * builder stays pure and reproducible; different day = different voice).
 * Every variant is dash-free, codename-free, and ≥ the craft floor. */
const daySeed = (day) => Array.from(String(day ?? "")).reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 100000, 7);

const TITLE_VARIANTS = [
  (day) => `The Daily Ledger, ${day}: real numbers, no promises`,
  (day) => `Ledger notes for ${day}: what the ladder actually did`,
  (day) => `Numbers over noise, the ${day} page`,
  (day) => `A day on the order book, written plainly (${day})`,
  (day) => `The quiet arithmetic of ${day}`,
  (day) => `${day}: the ledger, the ladder, and nothing dressed up`,
];

const LEDE_VARIANTS = [
  (core) => `**The numbers first, because that is the whole point of this ledger:** ${core}`,
  (core) => `**Measured, not promised. Here is what the day actually produced:** ${core}`,
  (core) => `**No preamble, just the readings the system acted on:** ${core}`,
  (core) => `**Plain figures from a patient, auditable experiment:** ${core}`,
  (core) => `**The day's evidence, exactly as the machines recorded it:** ${core}`,
];

const CLOSER_VARIANTS = [
  "If you run anything on this chain (a shop, a stake, a small bot of your own), how do you keep your own ledger honest, and what number do you check first each day?",
  "Honest ledgers grow boring on purpose. Which boring number do you track every single day, and what has it taught you about your own work?",
  "Every system like this lives or dies by what it writes down. If you had to publish one number about your own work each day, which one would you choose, and why?",
  "The ladder repeats the same small loop daily: measure, act, record. What does your own repeat-loop look like, and where do you keep it written down?",
  "Yesterday's plan met today's market and the table above is the receipt. When your own numbers disagree with your plan, which one do you trust, and how do you notice it?",
];

/** pure: the neutral ledger title (no codenames, no dashes, day-seeded variant) */
export function ledgerTitle(dayIso) {
  const day = String(dayIso ?? "").slice(0, 10);
  return TITLE_VARIANTS[daySeed(day) % TITLE_VARIANTS.length](day);
}

export async function postDailyReport({ obs, rollup, intel, now }) {
  const master = masterAccount();
  const day = dayOf(now);
  const permlink = `daily-ledger-${day}`; // R264: the neutral series (the old saos-* permlinks are history, not a template)
  // on-chain existence checks — the chain is the dedup source of truth.
  // R264: the legacy saos-transparency series ALSO counts as today's report
  // (one public ledger per day, whichever series wrote it).
  const legacy = await rpcCall("condenser_api.get_content", [master, `saos-transparency-${day}`]);
  if (legacy.ok && legacy.result && legacy.result.author) {
    return { verdict: "ALREADY-POSTED-LEGACY", permlink };
  }
  const exists = await rpcCall("condenser_api.get_content", [master, permlink]);
  if (exists.ok && exists.result && exists.result.author) {
    return { verdict: "ALREADY-POSTED", permlink };
  }
  const decisions = (intel?.decisions ?? []).map((d) => ({ kind: d.kind, decision: d.decision, reason: d.reason }));
  let body;
  try {
    body = buildLedgerBody({
      dayIso: now,
      parity: obs?.parity?.parity ?? null,
      paritySource: obs?.parity?.source ?? null,
      lowConfidence: Boolean(obs?.parity?.lowConfidence),
      orders: obs?.ordersOk ? (obs.orders?.length ?? 0) : null,
      fills: obs?.fills ?? 0,
      realizedSbd: rollup?.realizedSbd ?? null,
      curationUsd: obs?.fuel?.fuelUsdPerDay ?? null,
      authorUsd: obs?.fuel?.authorUsdPerDay ?? null,
      gridVerdict: intel?.decisions?.some((d) => d.kind === "soldiers" && d.decision === "grids-live") ? "live on the book" : "deploying",
      decisions,
    });
  } catch (e) {
    return { verdict: "LEDGER-CRAFT-REFUSED", error: String(e?.message ?? e).slice(0, 120), permlink };
  }
  const meta = JSON.stringify({ tags: ["steem", "economics", "transparency", "data", "workshop"], app: "daily-ledger" });
  const res = await executeAs(master, [[
    "comment",
    { parent_author: "", parent_permlink: "steem", author: master, permlink, title: ledgerTitle(now), body, json_metadata: meta },
  ]], { tag: "promo-daily", role: "posting" });
  return { ...res, permlink };
}
