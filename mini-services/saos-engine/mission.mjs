/**
 * mission.mjs — T-25 · THE MISSION (learn-harness-engineering applied).
 * lecture-13: a loop needs a goal with (a) a statement of the END STATE,
 * (b) a VERIFICATION method, (c) a STOPPING condition, (d) an INDEPENDENT
 * evaluator — the one grading done is never the one doing. Our evaluator is
 * chain-truth via the measured-wins rails, never a self-report.
 * lecture-14: the flat 18-step loop is drawn as an explicit GRAPH — nodes,
 * edges, fan-out LEVELS (the honest parallelization plan), per-node rollback
 * (which parents re-run first on failure) and ONE human-approval node
 * (adopt-credential). The graph is MEASURED against the real wiring in
 * daily.mjs, not decorative.
 * State: state/mission.json → /mission → cockpit.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { missionCore, cycleGraph } from "./lib.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const MISSION_FILE = path.join(STATE, "mission.json");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); };

export const MISSION_LAW = "מטרה = משפט-סוף + אימות + תנאי-עצירה + שופט-עצמאי; השרשרת מדרגת, לא ההצהרה";

/* the REAL dependency wiring of daily.mjs (the 18-step cycle) — honest edges:
 * measurement steps fan OUT from observe; economics fans IN from the writers;
 * recruit reads the fresh evidence; report is the sink. */
export const CYCLE_SPEC = {
  steps: [
    { id: "observe" }, { id: "intel" }, { id: "tick" }, { id: "peg" },
    { id: "convert" }, { id: "curate" }, { id: "execute" }, { id: "soldiers" },
    { id: "learn" }, { id: "webintel" }, { id: "hive" }, { id: "content" }, { id: "digest" }, { id: "forge" }, { id: "hands" }, { id: "rctank" },
    { id: "payouts" }, { id: "weave" }, { id: "catalog" }, { id: "reclaim" }, { id: "workloads" }, { id: "selftest" },
    { id: "economics" }, { id: "recruit" }, { id: "report" },
  ],
  edges: [
    ["observe", "intel"], ["intel", "tick"], ["intel", "peg"], ["tick", "peg"],
    ["observe", "convert"], ["observe", "peg"], ["peg", "execute"], ["convert", "execute"],
    ["observe", "curate"], ["observe", "soldiers"], ["observe", "learn"],
    ["observe", "webintel"], ["observe", "hive"], ["observe", "content"], ["observe", "hands"], ["observe", "rctank"],
    ["webintel", "digest"], /* T-38: the digest reads the webintel findings, so the edge is real */
    ["observe", "forge"], /* T-40: the forge reads the repo + measured state, engineers candidates behind gates */
    ["observe", "payouts"], ["observe", "weave"], ["observe", "catalog"],
    ["observe", "reclaim"], /* T-59: the reclaim instrument reads the chain's delegation + promoted truth */
    ["observe", "workloads"],
    ["observe", "economics"], ["payouts", "economics"], ["rctank", "economics"],
    ["execute", "economics"], ["selftest", "recruit"], ["economics", "recruit"],
    ["weave", "recruit"], ["recruit", "report"],
  ],
  humanApproval: ["adopt-credential"],
};

export function missionState() { return readJson(MISSION_FILE, null); }

export function runMission({ now = new Date().toISOString() } = {}) {
  const econ = readJson(path.join(STATE, "economics.json"), null);
  const router = readJson(path.join(STATE, "router.json"), null);
  const core = missionCore({
    measuredTotal: econ?.totalMeasuredUsdPerDay ?? null,
    targetUsdPerDay: 1000,
  });
  const graph = cycleGraph(CYCLE_SPEC);
  const doc = {
    at: now,
    law: MISSION_LAW,
    ...core,
    binding: router?.binding ?? null,
    bindingNote: router?.verdictNote ?? null,
    nextRungUsdPerDay: router?.nextRungUsdPerDay ?? null,
    graph,
  };
  writeJson(MISSION_FILE, doc);
  return doc;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(runMission(), null, 2));
}
