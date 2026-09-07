#!/usr/bin/env node
/**
 * scripts/manifest-drift-check.mjs
 *
 * Detects MANIFEST "החסר הבא" desync BEFORE an agent starts implementing.
 *
 * Problem: Agents implement "missing" items that were already merged, wasting
 * cycles and producing phantom commits. This pattern repeated 6+ times across
 * v160, v184, v206, v240, v241, v242, v243.
 *
 * What this script does:
 *   1. Parses MANIFEST.md to extract items under "### החסר הבא".
 *   2. For each item, extracts candidate symbols/file-paths from backtick spans.
 *   3. Greps `lib/`, `src/`, and `tests/` for each symbol.
 *   4. If found → prints ⚠ POSSIBLY SYNCED with grep evidence.
 *   5. If not found → prints ✓ OPEN (safe to implement).
 *   6. Exits with code 1 if any item appears synced (CI gate).
 *
 * Usage:
 *   node scripts/manifest-drift-check.mjs [--json] [--ci]
 *
 *   --json  Output machine-readable JSON (for CI reporting).
 *   --ci    Exit 1 if any POSSIBLY SYNCED item detected.
 *
 * Run from: artifacts/api-server/sovereign/
 */

import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dir, "..");   // artifacts/api-server/sovereign/
const MANIFEST = join(ROOT, "MANIFEST.md");

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const CI_MODE = args.includes("--ci");

// ── 1. Read manifest ──────────────────────────────────────────────────────────

if (!existsSync(MANIFEST)) {
  console.error("MANIFEST.md not found:", MANIFEST);
  process.exit(2);
}

const text = readFileSync(MANIFEST, "utf8");

// ── 2. Extract "החסר הבא" sections ───────────────────────────────────────────

/**
 * Find all numbered items under "### החסר הבא" blocks.
 * Each item looks like:
 *   1. **SomeLabel** — description with `symbols` and `paths/like.ts`
 * Collect all items from all "החסר הבא" blocks (oldest MANIFEST may have multiple).
 */
function extractNextItems(manifest) {
  const items = [];

  // Match each "### החסר הבא" section
  const sectionPattern = /^### החסר הבא[^\n]*\n([\s\S]*?)(?=^###|\Z)/gm;
  let sectionMatch;

  while ((sectionMatch = sectionPattern.exec(manifest)) !== null) {
    const section = sectionMatch[1];

    // Match numbered items: "1. **Label** — ..."
    // Items run until the next numbered item or blank line following indented text
    const itemPattern = /^(\d+)\.\s+\*\*([^*]+)\*\*\s+[—-]\s+([\s\S]*?)(?=^\d+\.\s+\*\*|^###|^\n*$(?!\s))/gm;
    let itemMatch;

    while ((itemMatch = itemPattern.exec(section)) !== null) {
      const num = parseInt(itemMatch[1], 10);
      const label = itemMatch[2].trim();
      const body = itemMatch[3].trim();
      items.push({ num, label, body });
    }
  }

  // Deduplicate by label (keep first occurrence — the freshest "החסר הבא" block)
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.label)) return false;
    seen.add(item.label);
    return true;
  });
}

// ── 3. Extract symbols/paths from item body ───────────────────────────────────

/**
 * Extract all backtick-quoted tokens from a string.
 * These are candidates for grep: function names, class names, file paths.
 */
function extractCandidates(text) {
  const candidates = new Set();
  const re = /`([^`]+)`/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const tok = m[1].trim();
    // Skip trivially short tokens (e.g. `1`, `pg`) and known false-positive patterns
    if (tok.length >= 4 && !tok.includes(" ") && !tok.startsWith("//")) {
      candidates.add(tok);
    }
  }
  return [...candidates];
}

// ── 4. Grep a symbol in the codebase ─────────────────────────────────────────

const SEARCH_DIRS = ["lib", "src"].filter((d) => existsSync(join(ROOT, d)));

/**
 * Search for a token in TS files under SEARCH_DIRS.
 * Returns { found: boolean, evidence: string[] } where evidence is matching lines.
 */
function searchToken(token) {
  const evidence = [];

  for (const dir of SEARCH_DIRS) {
    const dirPath = join(ROOT, dir);
    try {
      // -r recursive, -l list files, --include only .ts, -m 3 max 3 matches per file
      const cmd = `grep -rl --include="*.ts" -m3 ${JSON.stringify(token)} ${JSON.stringify(dirPath)} 2>/dev/null`;
      const out = execSync(cmd, { encoding: "utf8", timeout: 5000 }).trim();
      if (out) {
        const files = out.split("\n").filter(Boolean);
        for (const f of files) {
          // Get the actual matching lines (max 2 per file for brevity)
          try {
            const lines = execSync(
              `grep -n --include="*.ts" -m2 ${JSON.stringify(token)} ${JSON.stringify(f)} 2>/dev/null`,
              { encoding: "utf8", timeout: 3000 }
            ).trim();
            if (lines) {
              const rel = f.replace(ROOT + "/", "");
              evidence.push(`  ${rel}: ${lines.split("\n")[0].trim()}`);
            }
          } catch { /* skip */ }
        }
      }
    } catch { /* not found or grep error */ }
  }

  return { found: evidence.length > 0, evidence };
}

// ── 5. Run checks ─────────────────────────────────────────────────────────────

const items = extractNextItems(text);

if (items.length === 0) {
  console.log("⚠  No 'החסר הבא' items found in MANIFEST.md. Check format.");
  process.exit(0);
}

const results = [];

for (const item of items) {
  const candidates = extractCandidates(item.body);
  const synced = [];
  const open = [];

  for (const token of candidates) {
    const { found, evidence } = searchToken(token);
    if (found) {
      synced.push({ token, evidence });
    } else {
      open.push(token);
    }
  }

  // Decision: if MOST symbols found → likely synced; if none found → open
  const foundCount = synced.length;
  const totalCount = candidates.length;
  const syncRatio = totalCount > 0 ? foundCount / totalCount : 0;

  // Heuristic: synced if >50% of candidates are found in codebase
  const likelySynced = totalCount > 0 && syncRatio > 0.5;

  results.push({
    num: item.num,
    label: item.label,
    candidates,
    synced,
    open,
    foundCount,
    totalCount,
    syncRatio: Math.round(syncRatio * 100),
    likelySynced,
  });
}

// ── 6. Output ─────────────────────────────────────────────────────────────────

if (JSON_OUT) {
  console.log(JSON.stringify({ results, checkedAt: new Date().toISOString() }, null, 2));
} else {
  const version = (text.match(/^# TFA — MANIFEST קנוני \(v(\d+)\)/) || [])[1] ?? "?";
  console.log(`\nTFA Manifest Drift Check — MANIFEST v${version}`);
  console.log("=".repeat(60));

  let syncedCount = 0;
  for (const r of results) {
    const icon = r.likelySynced ? "⚠  POSSIBLY SYNCED" : "✓  OPEN";
    const pct = r.totalCount > 0 ? `${r.syncRatio}% symbols found` : "no symbols to check";
    console.log(`\n${r.num}. ${r.label}`);
    console.log(`   Status : ${icon}  (${pct})`);

    if (r.likelySynced) {
      syncedCount++;
      console.log("   Evidence (first match per symbol):");
      for (const s of r.synced) {
        console.log(`     \`${s.token}\``);
        for (const line of s.evidence.slice(0, 2)) console.log(`       ${line}`);
      }
      console.log("   ⚡ Recommendation: grep + verify before implementing this item.");
    } else {
      if (r.candidates.length === 0) {
        console.log("   (no backtick symbols found — review body manually)");
      } else {
        console.log(`   Open symbols: ${r.open.map((s) => `\`${s}\``).join(", ")}`);
      }
    }
  }

  console.log("\n" + "=".repeat(60));
  const openCount = results.filter((r) => !r.likelySynced).length;
  console.log(`Summary: ${openCount} open, ${syncedCount} possibly-synced (of ${results.length} items)`);

  if (syncedCount > 0) {
    console.log("\n⚠  One or more items may already be implemented.");
    console.log("   Run  grep -rn '<symbol>' lib/ src/  to confirm before starting.");
    if (CI_MODE) {
      console.log("   Exiting 1 (--ci mode).");
      process.exit(1);
    }
  } else {
    console.log("\n✓  All checked items appear genuinely open. Safe to implement #1.");
  }
  console.log("");
}
