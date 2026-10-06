// R208-D post-fix re-verification: the three confirmed vulnerabilities must now fail closed.
import fs from "node:fs";
const H = "/home/z/my-project";
const LAB = `${H}/sovereign/tmp/r208/sensor-lab/postfix-world`;
fs.rmSync(LAB, { recursive: true, force: true });
fs.mkdirSync(`${LAB}/objectives`, { recursive: true });
fs.mkdirSync(`${LAB}/preferences`, { recursive: true });
for (const f of ["objectives.json", "options.json", "capabilities.json", "authority-map.json"]) fs.copyFileSync(`${H}/sovereign/objectives/${f}`, `${LAB}/objectives/${f}`);
fs.writeFileSync(`${LAB}/preferences/state.json`, JSON.stringify({ chain: { lastEntryHash: null, count: 0 }, suspended: false, conditionStreaks: {} }));
process.env.OBJ_DIR = `${LAB}/objectives`;
process.env.PREF_DIR = `${LAB}/preferences`;
const { objectiveDecisionView } = await import(`${H}/mini-services/objective-consumer.ts`);
const { waveDecision } = await import(`${H}/mini-services/wave-decision.ts`);
const at = new Date().toISOString();
const cases: Array<[string, { value: number; unit?: string; at: string } | null]> = [
  ["V6d-0.1041-no-unit", { value: 0.1041, at }],
  ["V6e-3.5-no-unit", { value: 3.5, at }],
  ["V8-3.5-bad-time", { value: 3.5, unit: "SBD", at: "not-a-date" }],
  ["V9c-1e308", { value: 1e308, unit: "SBD", at }],
  ["V9-neg", { value: -5, unit: "SBD", at }],
  ["V-healthy-0.015", { value: 0.015, unit: "SBD", at }],
];
for (const [name, m] of cases) {
  const { view, reject, detail } = objectiveDecisionView("grid-pool-seed", { measuredSbd: m, prefEvidence: [], requireResource: true });
  const wd = waveDecision({ now: at, today: "2030-01-01", measCredible: true, waveDelta: 220, idleNow: 210, totalSteemNow: 219.415, lastStreamDay: null, waveSteem: 200, share: 0.2, prefDown: null, view, viewRejectReason: reject });
  console.log(JSON.stringify({ name, reject, decision: wd.kind, safe: wd.kind !== "ACT" || name === "V-healthy-ok" }));
}
