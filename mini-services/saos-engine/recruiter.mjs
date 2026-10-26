/**
 * recruiter.mjs — T-21 · THE RECRUITER (הצבא מפתח את עצמו).
 * Operator order: "לברר איך האוטונומיה והריבונות מפתחת את הצבא ומגייסת
 * עוד תפקידים לבד". The recruiter runs every cycle: it inspects the
 * engine's OWN state files and recruits a named station (role) for every
 * capability whose enabling evidence exists — and demotes roles whose
 * evidence died. A role exists ONLY with named evidence in state; the
 * roster is therefore measured truth, never a wish list.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { recruitRoles } from "./lib.mjs";
import { webIntelEvidence } from "./webintel.mjs";
import { contentEvidence } from "./content.mjs";
import { payoutsEvidence } from "./payouts.mjs";
import { weaveEvidence } from "./weave.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const ROLES_FILE = path.join(STATE, "fleet-roles.json");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
};

/** evidence-gathering is the ONLY impure part: every key maps to a concrete
 * state artifact a human can open and verify. */
export function gatherEvidence() {
  const market = readJson(path.join(STATE, "market.json"), null);
  const hyper = readJson(path.join(STATE, "hyper-grid.json"), null);
  const observe = readJson(path.join(STATE, "observe.json"), null);
  const convert = readJson(path.join(STATE, "convert-plan.json"), null);
  const curator = readJson(path.join(STATE, "curator.json"), null);
  const selftest = readJson(path.join(STATE, "selftest-last-run.json"), null);

  const evidence = {};
  if (market?.class === "measured" && Number(market.tradesPerDay) > 0) {
    evidence.marketPulse = `state/market.json: ${market.tradesPerDay} trades/24h measured (vol ${market.volSteem} STEEM)`;
  }
  const opsPerDay = Number(hyper?.economics?.opsPerDay ?? 0);
  if (opsPerDay > 0) {
    evidence.rcEconomics = `state/hyper-grid.json: equilibrium ${opsPerDay} ops/day measured (RC governor live)`;
  }
  const fills = Number(observe?.fills ?? 0);
  if (fills > 0) {
    evidence.fillAudit = `state/observe.json: ${fills} chain-truth fills counted (last ${observe.lastFillAt ?? "?"})`;
  }
  if (convert?.verdict) {
    evidence.convert = `state/convert-plan.json: ${convert.verdict} (edge ${convert.edgeBps ?? "?"}bps)`;
  }
  /* promo evidence: the cycle's report step journals promo posting; the
   * doctrine block (armed conf promo.perDay ≥ 1) is the enabling evidence */
  const daily = readJson(path.join(STATE, "daily-report.json"), null);
  const promoStep = (daily?.steps ?? {})?.report;
  if (promoStep?.ok === true) {
    evidence.promo = "state/daily-report.json: report step ok (promo rail armed in doctrine, perDay ≥ 1)";
  }
  if (curator?.verdict) {
    evidence.curation = `state/curator.json: ${curator.verdict} (budgetCounted ${curator.budgetCounted ?? "?"}, basis ${curator.budgetBasis ?? "state"})`;
  }
  if (selftest?.pass != null && selftest.fail === 0) {
    evidence.selftest = `state/selftest-last-run.json: ${selftest.pass}/${selftest.pass + (selftest.fail ?? 0)} PASS at ${selftest.at}`;
  }
  /* T-22 · the standing teams: external recon + content drafts are evidence
   * like any other state artifact — fresh (<26h) = active, stale = demoted. */
  const webIntel = webIntelEvidence();
  if (webIntel) evidence.webIntel = webIntel;
  const content = contentEvidence();
  if (content && !evidence.promo) evidence.promo = content;
  else if (content) evidence.contentOps = content;
  /* T-23 · the two new stations: payout instrument + weave handshake */
  const payouts = payoutsEvidence();
  if (payouts) evidence.payouts = payouts;
  const weave = weaveEvidence();
  if (weave) evidence.weave = weave;
  evidence.recruiter = "this roster file — the recruiter ran and wrote it";
  return evidence;
}

export function runRecruiter(now = new Date().toISOString()) {
  const prior = readJson(ROLES_FILE, null);
  const roster = recruitRoles({ evidence: gatherEvidence(), now, prior });
  writeJson(ROLES_FILE, { ...roster, pid: process.pid });
  return roster;
}

export function recruiterState() {
  return readJson(ROLES_FILE, null);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(runRecruiter(), null, 2));
}
