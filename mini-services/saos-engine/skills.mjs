/**
 * skills.mjs — T-34 · THE SKILLS REGISTRY (route/state layer).
 * The agentskills.io SKILL.md doctrine (adopted from alirezarezvani/
 * claude-skills, examined live): the machine's capability face becomes
 * MACHINE-READABLE — a manifest index (name / description-with-triggers /
 * laws / verification / when-not-to-use) that external agents can discover
 * at /skills, while the body stays progressive-disclosure (load on demand).
 * Every manifest is generated from REAL code laws — nothing invented — and
 * validated fail-closed (lib.validateSkillManifest). The 388-skill bulk
 * library, personas, and the 727 Python tools were REJECTED: noise for a
 * sovereign money-machine. Only the doctrine was adopted.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { buildSkillIndex } from "./lib.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const SKILLS_DIR = path.join(DIR, "skills");
const CACHE_MS = 60_000;
let cache = null; // { at, state }

export function skillsState() {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.state;
  let state;
  try {
    const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    const raws = entries.map((n) => {
      try { return fs.readFileSync(path.join(SKILLS_DIR, n, "SKILL.md"), "utf8"); } catch { return null; }
    });
    const idx = buildSkillIndex(raws);
    state = {
      at: new Date().toISOString(),
      count: idx.skills.length,
      skipped: idx.skipped,
      skills: idx.skills,
      law: "SKILL.md doctrine (agentskills.io, via alirezarezvani/claude-skills): manifest index machine-readable, body progressive-disclosure; manifests generated from real code laws, fail-closed; bulk library rejected as noise",
    };
  } catch (e) {
    state = {
      at: new Date().toISOString(), count: 0, skills: [],
      skipped: [{ at: -1, reason: String(e?.message ?? e).slice(0, 140) }],
      law: "registry read failed — honest empty",
    };
  }
  cache = { at: now, state };
  return state;
}
