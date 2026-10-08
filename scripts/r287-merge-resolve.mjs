/**
 * r287-merge-resolve.mjs — one-shot lawful conflict resolver for the
 * origin/saos-cockpit merge (R287). House laws:
 *   *.json  → live-wins (ours; this machine IS the live estate)
 *   *.jsonl → union-ts-ordered (nothing lost: base + theirs-new + ours-new,
 *             exact duplicates dropped, rows sorted by their at/ts ISO field)
 *   worklog.md → block union by Task ID (base + theirs-new + ours-new, mine newest last)
 * Usage: bun r287-merge-resolve.mjs
 */
import * as fs from "node:fs";
import { execSync } from "node:child_process";

const show = (stage, p) => {
  try { return execSync(`git show :${stage}:${JSON.stringify(p)}`, { encoding: "utf8", maxBuffer: 1 << 26 }); }
  catch { return null; }
};

const conflicted = execSync("git diff --name-only --diff-filter=U", { encoding: "utf8" })
  .split("\n").filter(Boolean);

let jsonCount = 0, jsonlCount = 0, mdCount = 0;
const tsOf = (line) => {
  try {
    const o = JSON.parse(line);
    const t = o.at ?? o.ts ?? o.time ?? null;
    if (typeof t === "string" && !isNaN(Date.parse(t))) return Date.parse(t);
  } catch { /* not json row */ }
  return null;
};

for (const p of conflicted) {
  if (p.endsWith(".json")) {
    const ours = show(2, p);
    if (ours !== null) { fs.writeFileSync(p, ours); }
    else { const theirs = show(3, p); if (theirs !== null) fs.writeFileSync(p, theirs); }
    execSync(`git add ${JSON.stringify(p)}`); jsonCount += 1;
  } else if (p.endsWith(".jsonl")) {
    const rows = [];
    const seen = new Set();
    for (const side of [1, 3, 2]) { /* base, theirs, ours — dedupe by exact row */
      const raw = show(side, p);
      if (raw === null) continue;
      for (const line of raw.split("\n")) {
        const t = line.trim();
        if (!t || seen.has(t)) continue;
        seen.add(t);
        rows.push({ t, ts: tsOf(t), side });
      }
    }
    /* union-ts-ordered: rows with a parseable ts come in ts order; rows
     * without keep their side order (base → theirs → ours), stable. */
    const dated = rows.filter((r) => r.ts !== null).sort((a, b) => a.ts - b.ts).map((r) => r.t);
    const undated = rows.filter((r) => r.ts === null).map((r) => r.t);
    fs.writeFileSync(p, [...undated, ...dated].join("\n") + "\n");
    execSync(`git add ${JSON.stringify(p)}`); jsonlCount += 1;
  } else if (p === "worklog.md") {
    const blocksOf = (raw) => {
      if (raw === null) return [];
      const out = [];
      const parts = raw.split(/^---$/m);
      for (const part of parts) {
        const t = part.trim();
        if (!t) continue;
        const id = /^Task ID:\s*(.+)$/m.exec(t);
        out.push({ key: id ? id[1].trim() + "::" + t.slice(0, 80) : t.slice(0, 120), body: t });
      }
      return out;
    };
    const base = blocksOf(show(1, p));
    const ours = blocksOf(show(2, p));
    const theirs = blocksOf(show(3, p));
    const baseKeys = new Set(base.map((b) => b.key));
    const oursKeys = new Set(ours.map((b) => b.key));
    const head = show(2, p)?.split(/^---$/m)[0] ?? "";
    const theirsNew = theirs.filter((b) => !baseKeys.has(b.key));
    const oursNew = ours.filter((b) => !baseKeys.has(b.key) && !theirsNew.some((t) => t.key === b.key));
    const merged = [head.trim(), ...theirsNew.map((b) => b.body), ...oursNew.map((b) => b.body)]
      .filter(Boolean).join("\n\n---\n\n") + "\n";
    fs.writeFileSync(p, merged);
    execSync(`git add worklog.md`); mdCount += 1;
  } else {
    console.log(`UNRESOLVED-BY-LAW: ${p} — manual`);
  }
}
console.log(JSON.stringify({ resolved: { json: jsonCount, jsonl: jsonlCount, worklog: mdCount } }));
