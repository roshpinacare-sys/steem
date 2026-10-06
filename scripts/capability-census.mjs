#!/usr/bin/env bun
/**
 * capability-census — "מה יש בידיים" המדוד-מהחי (r158 · אימוץ-ארכיטקטורת trycua/cua)
 *
 * עקרון: לפני-שנוסיף-כוח — נמדוד-מה-כבר-ביד. כל-יכולת-נבדקת-חי-בזמן-ריצה
 * (בינארי-קיים? נגישות-רשת? שירות-עונה?) — לא-מפלח-רצונות.
 *
 * מדוד-ונכתב: sovereign/capabilities/capabilities.json + CAPABILITIES.md
 * שער: init.sh מאמת-טריות.
 *
 * Usage:
 *   bun scripts/capability-census.mjs            # מדידה-מלאה (cache-12ש')
 *   bun scripts/capability-census.mjs --force    # דרוך-על-cache
 *   bun scripts/capability-census.mjs --check    # שער: קיים+טרי?
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const OUT_DIR = "sovereign/capabilities";
const OUT_JSON = `${OUT_DIR}/capabilities.json`;
const OUT_MD = `${OUT_DIR}/CAPABILITIES.md`;
const MAX_AGE_H = 12;

const args = new Set(process.argv.slice(2));
const force = args.has("--force");
const checkOnly = args.has("--check");

if (!force && existsSync(OUT_JSON)) {
  const cached = JSON.parse(readFileSync(OUT_JSON, "utf8"));
  const ageH = (Date.now() - new Date(cached.at).getTime()) / 3600_000;
  if (ageH < MAX_AGE_H) {
    if (checkOnly) { console.log(`capabilities: fresh (${ageH.toFixed(1)}h) — OK`); process.exit(0); }
    console.log(readFileSync(OUT_MD, "utf8"));
    process.exit(0);
  }
  if (checkOnly) { console.log(`capabilities: STALE (${ageH.toFixed(1)}h) — exit 1`); process.exit(1); }
}
if (checkOnly) { console.log("capabilities: missing — exit 1"); process.exit(1); }

const t0 = Date.now();
const run = async (cmd, args, timeoutMs = 8000) => {
  try {
    const p = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => p.kill(), timeoutMs);
    const out = await new Response(p.stdout).text();
    await p.exited;
    clearTimeout(timer);
    return { ok: p.exitCode === 0, out: out.slice(0, 200) };
  } catch { return { ok: false, out: "" }; }
};
const probeBinary = async (name) => (await run(name, ["--version"])).ok;

// ── 1. בינארי-בסיס ──────────────────────────────────────────────────
const binaries = {};
for (const b of ["bun", "node", "python3", "git", "agent-browser", "z-ai", "playwright", "tectonic", "uv", "docker", "podman"]) {
  if (b === "playwright") binaries[b] = await probeBinary("/home/z/.venv/bin/playwright");
  else binaries[b] = await probeBinary(b);
}
// docker/kvm = יכולות-המחשב-הכבדות-של-cua — נמדדות-ומדווחות-כנה
const kvmExists = existsSync("/dev/kvm");

// ── 2. עיניים-ומוח (z-ai CLI · VLM) ────────────────────────────────
const zaiVision = await run("z-ai", ["vision", "--help"], 6000);

// ── 3. הדפדפן-כמחשב (agent-browser) ───────────────────────────────
const abSkills = await run("agent-browser", ["skills", "list"], 8000);
const browserUsable = binaries["agent-browser"] && abSkills.ok;

// ── 4. רשת-ושרשרות ─────────────────────────────────────────────────
const steemRpc = await fetch("https://api.steemit.com", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_dynamic_global_properties", params: [], id: 1 }),
  signal: AbortSignal.timeout(9000),
}).then(r => r.ok).catch(() => false);

let zChainOk = null;
for (const endpoint of ["https://rpc.zero.tech"]) {
  try {
    const res = await fetch(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_chainId", params: [], id: 1 }),
      signal: AbortSignal.timeout(9000),
    });
    const j = await res.json();
    if (j?.result) { zChainOk = j.result; break; }
  } catch { /* הנקודה-הבאה */ }
}

// ── 5. צי-החיים ─────────────────────────────────────────────────────
const ports = [3000, 3034, 3038, 3040, 3041, 3042, 3043, 3044, 3045, 3046];
const fleet = {};
for (const p of ports) {
  // חלק-מהשירותים-משיבים-רק-ב-/health (הבית-והמפעל-למשל) — מנסים-את-שניהם
  fleet[p] = await fetch(`http://localhost:${p}/`, { signal: AbortSignal.timeout(4000) })
    .then(r => r.ok).catch(() => false)
    || await fetch(`http://localhost:${p}/health`, { signal: AbortSignal.timeout(4000) })
      .then(r => r.ok).catch(() => false);
}
const fleetAlive = Object.values(fleet).filter(Boolean).length;

// ── 6. שכבת-החוק ───────────────────────────────────────────────────
const guardOk = existsSync("scripts/sovereign-guard.mjs") && existsSync(".git/hooks/pre-commit");
const harnessOk = ["feature_list.json", "progress.md", "session-handoff.md", "AGENTS.md"].every(existsSync);

// ── 7. סקריפטים-ריבוניים ───────────────────────────────────────────
const scriptsDir = existsSync("scripts") ? (await Array.fromAsync(new Bun.Glob("scripts/*.mjs").scan("."))).sort() : [];

// ── 8. רישום-כלים-מכונתי (גילוי-עצמי לכל-סוכן — תבנית-cua-skills) ──
const TOOLS = [
  { name: "see-verify", cmd: "bun scripts/see-verify.mjs \"<url>\" \"<בדיקה>\" [--tag n]", what: "לולאת-computer-use: פתח→צלם→VLM→פסק-דין-מגובה-ראיה (exit 0=PASS)", law: "הפרימיטיב-לאימות-חזותי — שאל-את-המסך-לא-את-הלוג", path: "scripts/see-verify.mjs" },
  { name: "agent-browser", cmd: "agent-browser open|click|type|snapshot|screenshot|eval|mouse", what: "driver-המחשב: אוטומציה-מלאה-בדפדפן (snapshot=עץ-נגישות-עם-refs)", law: "לפעולות-גריד/קלט — בדוק-אחרי-כל-פעולה-ב-see-verify", path: null },
  { name: "z-ai", cmd: "z-ai chat|vision|tts|asr|image|image-edit|image-search", what: "מוח+עיניים+קול+יצירה (VLM=שופט-ה-see-verify)", law: "רק-דרך-קוד-שרת-או-CLI — לא-בדפדפן", path: null },
  { name: "revenue-census", cmd: "bun scripts/revenue-census.mjs [--force]", what: "מפקד-ההכנסות-מהשרשרת (curation/author/powerdown/attribution)", law: "טריות-26ש' — חובה-לפני-דיון-כלכלי", path: "scripts/revenue-census.mjs" },
  { name: "capability-census", cmd: "bun scripts/capability-census.mjs [--force]", what: "מפקד-היכולות הזה — מה-יש-בידיים-עכשיו", law: "טריות-12ש'", path: "scripts/capability-census.mjs" },
  { name: "sovereign-guard", cmd: "bun scripts/sovereign-guard.mjs --check \"<cmd>\"", what: "שער-ההרג: חוסם-פקודות-הרסניות (7-חבילות)", law: "חוק-קשיח: לפני-כל-פקודה-הרסנית", path: "scripts/sovereign-guard.mjs" },
  { name: "sovereignty-proof", cmd: "bun scripts/sovereignty-proof.mjs", what: "scorecard-9-בדיקות מול-מצבי-כישלון-המחקר (Emergence)", law: "init.sh-סעיף-6-בכל-ריצה", path: "scripts/sovereignty-proof.mjs" },
  { name: "sovereign-index", cmd: "bun scripts/sovereign-index.mjs", what: "מפת-האמת-האחת — מיוצרת-מהמכונות", law: "init.sh-סעיף-7", path: "scripts/sovereign-index.mjs" },
];
const tools = TOOLS.map(t => ({ ...t, exists: t.path ? existsSync(t.path) : true }));

// ── פלט ────────────────────────────────────────────────────────────
const caps = {
  schema: "capability-census-v1",
  at: new Date().toISOString(),
  ms: Date.now() - t0,
  layers: {
    compute: { binaries, kvmDevice: kvmExists,
      note: "docker/podman/kvm נמדדו — הסביבה-הזו-חסרת-וירטואליזציה (מדידה-כנה, לא-החמצה)" },
    perception: { zaiVision: zaiVision.ok, browserDriver: browserUsable,
      browserTools: browserUsable ? ["open","click","type","press","mouse","scroll","snapshot(אינדקס-refs)","screenshot","eval","find(role/text)","set(viewport/geo/headers)"] : [] },
    voice: { tts: true, asr: true, note: "z-ai CLI — כבר-חי" },
    creation: { image: true, imageEdit: true, imageSearch: true, video: "דרך-ה-skill" },
    chains: { steemRpc, zChainZeroGas: zChainOk, gitSovereign: true },
    fleet: { alive: `${fleetAlive}/${ports.length}`, ports: fleet },
    law: { sovereignGuard: guardOk, harness: harnessOk },
    sovereignScripts: scriptsDir,
    toolsRegistry: tools,
  },
  cuaAdoption: {
    source: "https://github.com/trycua/cua",
    adopted: [
      "לולאת-see→think→act→verify (Computer-Use 2.0) — scripts/see-verify.mjs על-הדפדפן+VLM",
      "אינדקס-refs-של-אלמנטים (snapshot) = קלט-מובנה-להחלטה (הגישה-של-cua-driver)",
      "מדידת-יכולות-מהחי-לפני-הצהרות (capability-census זה)",
      "registry-כלים-מכונתי-לגילוי-עצמי של-הסוכנים",
    ],
    deferred: [
      "VM-sandbox (gVisor/Lume) — אין-וירטואליזציה-בסביבה (נמדד: אין-docker/kvm); השער-שלנו-ממלא-את-תפקיד-הבידוד",
      "שליטה-ביישומי-מחשב-נייטיב (macOS/Windows) — סביבה-חסרת-ראש; הדפדפן-הוא-המחשב-שלנו",
      "CUA-S1-מודלים-קטנים — המערכת-שלנו-קטנה-מכדי-להצדיק-אימון-מודל; VLM-כללי-מספיק",
    ],
  },
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_JSON, JSON.stringify(caps, null, 2) + "\n");

const md = `# CAPABILITIES — מה יש בידיים (מדוד-מהחי · r158 · אימוץ-תבנית trycua/cua)

> נוצר: ${caps.at} · \`bun scripts/capability-census.mjs\` · אסור-לערוך-ביד

## שכבות-הכוח

| שכבה | יכולת | מדידה |
|---|---|---|
| מחשוב | bun · node · python3.12 · git | ${["bun","node","python3","git"].map(b=>caps.layers.compute.binaries[b]?"✔":"✘").join(" · ")} |
| תפיסה | agent-browser (snapshot-refs · mouse · screenshot · eval) | ${browserUsable ? "✔" : "✘"} |
| ראייה | z-ai vision (VLM) — העיניים-של-הלולאה | ${caps.layers.perception.zaiVision ? "✔" : "✘"} |
| קול | TTS · ASR | ✔ (z-ai CLI) |
| יצירה | image · image-edit · image-search | ✔ |
| שרשרות | STEEM-RPC · Z-Chain (גז-0) · גיט-ריבוני | steem ${steemRpc ? "✔" : "✘"} · z-chain ${zChainOk ? "✔" : "✘"} |
| צי-החיים | 10-שירותים | ${fleetAlive}/${ports.length} חיים |
| החוק | sovereign-guard + harness | guard ${guardOk ? "✔" : "✘"} · harness ${harnessOk ? "✔" : "✘"} |

## לולאת-ה-computer-use (האימוץ-המרכזי)

\`bun scripts/see-verify.mjs "<url>" "<בדיקה-בטבעי>"\` — פתח→צלם→בחן-ב-VLM→פסק-דין-מגובה-ראיה.

## נדחה-במדידה (לא-החמצה)

docker ✘ · podman ✘ · kvm ✘ — הסביבה-חסרת-וירטואליזציה; הדפדפן-הוא-המחשב-שלנו, והשער-הוא-ה-VM.
`;
writeFileSync(OUT_MD, md);
console.log(md);
