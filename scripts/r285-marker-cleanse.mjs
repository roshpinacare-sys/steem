/* R285 marker-cleanse resolver — runs from repo root.
 * For every tracked file still carrying conflict markers, rebuild a clean
 * body from the three available sources: merge-parent-local, merge-parent-
 * remote, and the current working tree. jsonl → ordered line union (local
 * first, then new remote lines, then new worktree lines). json → newest
 * parseable wins (alive-wins by its own timestamp field). Fallback for
 * unparseable json: local parent body verbatim.
 * Usage: bun scripts/r285-marker-cleanse.mjs <parentLocal> <parentRemote>
 */
import { execFileSync } from "child_process";

const [parentLocal, parentRemote] = process.argv.slice(2);
if (!parentLocal || !parentRemote) {
  console.error("need two merge-parent refs");
  process.exit(1);
}
const MARKER_RE = /^(<<<<<<< |=======\r?$|>>>>>>> )/;
const sh = (args) => execFileSync("git", args, { maxBuffer: 2e9 }).toString();

const marked = sh(["grep", "-l", "-E", "^(<<<<<<< |=======\\r?$|>>>>>>> )", "--", "."])
  .split("\n").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);

const stampOf = (obj) => obj?.at ?? obj?.pushedAt ?? obj?.updatedAt ?? obj?.finishedAt ?? obj?.timestamp ?? "";

let fixed = 0;
for (const f of marked) {
  const candidates = [];
  for (const ref of [parentLocal, parentRemote, null]) {
    let text = null;
    try { text = ref ? sh(["show", `${ref}:${f}`]) : (await Bun.file(f).text()); } catch { text = null; }
    if (text === null) continue;
    candidates.push({ ref: ref ?? "worktree", lines: text.split("\n").map((s) => s.replace(/\r$/, "")).filter((l) => !MARKER_RE.test(l)) });
  }
  if (!candidates.length) continue;
  let outText;
  if (f.endsWith(".jsonl")) {
    const seen = new Set(); const lines = [];
    for (const c of candidates) for (const l of c.lines) { const t = l.trim(); if (!t || seen.has(t)) continue; seen.add(t); lines.push(t); }
    outText = lines.join("\n") + "\n";
  } else {
    /* alive-wins: newest parseable candidate */
    let best = null;
    for (const c of candidates) {
      const body = c.lines.join("\n");
      try {
        const o = JSON.parse(body);
        const st = stampOf(o);
        if (!best) best = { st, body, ref: c.ref };
        else if (st && new Date(st) > new Date(best.st)) best = { st, body, ref: c.ref };
      } catch { /* next */ }
    }
    if (!best) best = { st: "", body: candidates[0].lines.join("\n"), ref: candidates[0].ref };
    outText = (best.body.endsWith("\n") ? best.body : best.body + "\n");
  }
  await Bun.write(f, outText);
  fixed++;
  console.log("cleansed:", f);
}
console.log(`TOTAL cleansed: ${fixed}`);
