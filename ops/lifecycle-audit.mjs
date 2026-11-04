// lifecycle-audit.mjs — R365 · REBUILT (2026-11-05, owner execution order).
// The lifecycle watch measured LIFECYCLE-REGRESSED partly because THIS audit
// file was absent from every reachable ref (wiped, never re-pushed). Rebuilt
// honest + local: no network writes, verdicts only, every check typed.
// Output: one verdict line + state/lifecycle-audit.json (full detail).
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

const DIR = path.dirname(new URL(import.meta.url).pathname).replace(/\/ops$/, "");
const ENG = path.join(DIR, "mini-services", "saos-engine");
const SECRETS = path.join(DIR, ".secrets"); /* secrets live at repo level, not in the engine dir */
const now = new Date().toISOString();
const checks = [];
const add = (name, ok, detail) => checks.push({ name, ok, detail: String(detail).slice(0, 160) });

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };

// 1 · custody manifest (chain-judged by master-judge on patrol)
const cm = readJson(path.join(SECRETS, "custody-manifest.json"));
const cmAgeH = cm?.at ? (Date.now() - Date.parse(cm.at)) / 36e5 : null;
add("custody-manifest", !!cm?.at && cmAgeH < 6, `at=${cm?.at ?? "absent"} fp=${cm?.judge ?? "?"} age=${cmAgeH == null ? "?" : cmAgeH.toFixed(1) + "h"}`);

// 2 · army custody verdict (vault-of-record adoption)
const ac = readJson(path.join(ENG, "state", "army-custody.json"));
add("army-custody", !!ac?.at && acAgeH(ac.at) < 12, `verdict=${ac?.verdict ?? "absent"} fullRoster=${ac?.after?.verified ?? "?"}/${ac?.denominator?.living ?? "?"}`);

function acAgeH(t) { return (Date.now() - Date.parse(t)) / 36e5; }

// 3 · signing armament (Gate-1 policy flags)
const ea = readJson(path.join(SECRETS, "exec-armed.json"));
add("exec-armed", !!ea, `armed=${ea?.armed ?? "?"} recorded=${ea?.["recorded-at"] ?? "?"}`);

// 4 · crown seal freshness (origin vault-home — fetch best-effort, honest UNKNOWN on failure)
let seal = { name: null, ageH: null };
try {
  const VR = "/home/z/my-project/fleet-restore/vault-repo";
  execFileSync("git", ["-C", VR, "fetch", "-q", "origin"], { timeout: 45000, stdio: "pipe" });
  const out = execFileSync("git", ["-C", VR, "ls-tree", "origin/main", "custody-intake/"], { encoding: "utf8" });
  const names = [...out.matchAll(/CROWN-RECOVERY-(\d{8})T(\d{6})Z\.enc/g)].map(m => m[0]);
  if (names.length) {
    const newest = names.sort().pop();
    const m = newest.match(/CROWN-RECOVERY-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/);
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    seal = { name: newest, ageH: (Date.now() - t) / 36e5 };
  }
} catch { /* offline — honest UNKNOWN below */ }
add("crown-seal", seal.ageH != null && seal.ageH < 48, `${seal.name ?? "unknown"} age=${seal.ageH == null ? "UNKNOWN" : seal.ageH.toFixed(1) + "h"}/48h`);

// 5 · engine file census (the files the rails need to exist)
const files = ["master-judge.mjs", "daily.mjs", "signer.mjs", "ci-cycle.mjs", "crown-vault-adopt.mjs", "cabinet.mjs", "state/events.jsonl"];
const missing = files.filter(f => !fs.existsSync(path.join(ENG, f)));
add("engine-files", missing.length === 0, missing.length ? `MISSING: ${missing.join(",")}` : `${files.length}/${files.length} present`);

// 6 · recent events (last 5, types only — verdicts, never payloads)
let evTail = [];
try {
  evTail = fs.readFileSync(path.join(ENG, "state", "events.jsonl"), "utf8").trim().split("\n").slice(-5)
    .map(l => { try { const e = JSON.parse(l); return `${e.at?.slice(11, 19) ?? "?"} ${e.type}`; } catch { return "?"; } });
} catch { /* absent state */ }
add("events-journal", evTail.length > 0, evTail.join(" | ") || "EMPTY");

const ok = checks.every(c => c.ok);
const doc = {
  at: now, verdict: ok ? "LIFECYCLE-OK" : "LIFECYCLE-REGRESSED",
  tool: "lifecycle-audit.mjs (R365 rebuild)",
  checks, seal, note: "verdicts only; every check typed; honest UNKNOWN beats a guess",
};
fs.mkdirSync(path.join(ENG, "state"), { recursive: true });
fs.writeFileSync(path.join(ENG, "state", "lifecycle-audit.json"), JSON.stringify(doc, null, 1));
console.log(`${doc.verdict} | ${checks.map(c => `${c.name}:${c.ok ? "ok" : "FAIL"}`).join(" ")}`);
for (const c of checks.filter(c => !c.ok)) console.log(`  FAIL ${c.name}: ${c.detail}`);
