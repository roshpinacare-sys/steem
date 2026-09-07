#!/usr/bin/env node
'use strict';
/**
 * scripts/build-canonical-bundle.js — fold the canonical knowledge + ALL source into single
 * pasteable files, for AI agents that cannot accept a zip. Zero deps. Run AFTER
 * build-canonical-knowledge.js. Produces:
 *   ECOS_CANONICAL_KNOWLEDGE/ECOS_CANONICAL_BUNDLE.md   — knowledge layer in one file (understand)
 *   ECOS_CANONICAL_KNOWLEDGE/ECOS_FULL_SOURCE_BUNDLE.md — every source file inlined (lossless, edit)
 */
const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'); const OUT = path.join(ROOT, 'ECOS_CANONICAL_KNOWLEDGE');
const SKIP = new Set(['node_modules', '.git', 'ECOS_CANONICAL_KNOWLEDGE', '_archive_orphans_v497']);

// 1) Knowledge bundle = all generated docs/indices concatenated
const order = ['ECOS_BOOTSTRAP_FOR_AI.md','ECOS_INDEX.json','ECOS_ARCHITECTURE.md','ECOS_SYSTEM_MAP.md','ECOS_CAPABILITY_REGISTRY.json','ECOS_API_REGISTRY.md','ECOS_AGENT_ARCHITECTURE.md','ECOS_FINANCIAL_ARCHITECTURE.md','ECOS_ACTIVE_COMPONENTS.md','ECOS_DEPRECATED_COMPONENTS.md','ECOS_DEVELOPMENT_GUIDE.md','ECOS_DEPENDENCY_GRAPH.json','ECOS_MODULE_REGISTRY.json','ECOS_FILE_INDEX.json','ECOS_API_REGISTRY.json','ECOS_CANONICAL.md'];
let kb = `# ECOS CANONICAL KNOWLEDGE BUNDLE (single file)\n\nFor AI agents without zip support. Generated ${new Date().toISOString()}.\nThis bundle = the entire knowledge layer in one paste. For the actual editable code, see ECOS_FULL_SOURCE_BUNDLE.md.\n\n`;
for (const f of order) { const p = path.join(OUT, f); if (!fs.existsSync(p)) continue; const ext = f.endsWith('.json') ? 'json' : 'markdown'; kb += `\n\n${'='.repeat(70)}\n## FILE: ${f}\n${'='.repeat(70)}\n\n\`\`\`${ext}\n${fs.readFileSync(p, 'utf8')}\n\`\`\`\n`; }
fs.writeFileSync(path.join(OUT, 'ECOS_CANONICAL_BUNDLE.md'), kb);

// 2) Full source bundle = every text source file inlined with a clear path header + restore guide
function walk(dir, acc) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (e.name.startsWith('.')) continue; const full = path.join(dir, e.name); if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(full, acc); } else acc.push(path.relative(ROOT, full)); } return acc; }
const files = walk(ROOT, []).filter(f => /\.(js|mjs|json|md|txt|yml|yaml|sh)$/.test(f)).sort();
// put the most important first so truncated readers still get the core
const priority = ['package.json','ecos-api-server.js','lib/fiatLedger.js','lib/auditLog.js','lib/economicMutationGuard402.js','lib/moduleOrchestrator437.js','node_modules/vitest/index.mjs','scripts/audit-tests.js'];
files.sort((a, b) => { const pa = priority.indexOf(a), pb = priority.indexOf(b); if (pa !== -1 || pb !== -1) return (pa === -1 ? 999 : pa) - (pb === -1 ? 999 : pb); return a.localeCompare(b); });
let sb = `# ECOS FULL SOURCE BUNDLE (lossless, single file)\n\nGenerated ${new Date().toISOString()}. Version ${(() => { try { return require(path.join(ROOT,'package.json')).version; } catch { return '?'; } })()}.\n\nEvery source file below, in fenced blocks headed by\n  ===== FILE: <relative/path> =====\nTo reconstruct the repo: for each block, write its content to <relative/path>.\nSACRED files (lib/fiatLedger.js, lib/auditLog.js) must keep their exact bytes/MD5 — never edit.\n\nFile count: ${files.length}\n\n`;
let total = 0, included = 0, skipped = 0;
for (const rel of files) {
  let st; try { st = fs.statSync(path.join(ROOT, rel)); } catch { continue; }
  if (st.size > 2600000) { sb += `\n===== FILE: ${rel} =====\n[skipped: ${st.size} bytes too large — fetch from repo]\n`; skipped++; continue; }
  let src; try { src = fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { continue; }
  const fence = src.includes('```') ? '~~~~' : '```';
  sb += `\n===== FILE: ${rel} =====\n${fence}\n${src}\n${fence}\n`; total += st.size; included++;
}
sb += `\n\n[bundle end] included ${included} files (${Math.round(total / 1024)} KB), skipped ${skipped} oversize.\n`;
fs.writeFileSync(path.join(OUT, 'ECOS_FULL_SOURCE_BUNDLE.md'), sb);
console.log('knowledge bundle:', Math.round(kb.length / 1024), 'KB');
console.log('full source bundle:', Math.round(sb.length / 1024), 'KB, files included:', included, 'skipped:', skipped);
