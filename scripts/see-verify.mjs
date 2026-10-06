#!/usr/bin/env bun
/**
 * see-verify — לולאת-computer-use ריבונית (r158 · אימוץ-תבנית trycua/cua)
 *
 * "שאל-את-המסך, לא-את-הלוג" — הסוכן-פותח-דף, מצלם, וה-VLM שופט-את-הבדיקה.
 * זו-הלולאה של-cua (ראה→שפוט) מותאמת-לצי: הדפדפן-הוא-המחשב-שלנו,
 * agent-browser-הוא-ה-driver, ו-z-ai-vision-הן-העיניים.
 *
 * פסק-הדין-מגובה-ראיה: צילום-מסך + JSON-שיפוט ב-sovereign/see/.
 * exit 0 = PASS · exit 1 = FAIL/UNKNOWN (שימושי-כשער!)
 *
 * Usage:
 *   bun scripts/see-verify.mjs "<url>" "<בדיקה-בטבעי>" [--tag <שם>] [--json]
 * דוגמה:
 *   bun scripts/see-verify.mjs "http://localhost:3000" "האם-הדף-מציג-באדג'-powerdown-ואת-הכותרת-WEAVE?"
 */

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";

const [url, check] = process.argv.slice(2).filter(a => !a.startsWith("--"));
const argList = process.argv.slice(2);
const tag = (argList[argList.indexOf("--tag") + 1] || "check").replace(/[^a-z0-9-]/gi, "-").slice(0, 40);
const wantJson = argList.includes("--json");

if (!url || !check) {
  console.error("Usage: bun scripts/see-verify.mjs \"<url>\" \"<check>\" [--tag name] [--json]");
  process.exit(2);
}

const at = new Date().toISOString();
const dir = "sovereign/see";
mkdirSync(dir, { recursive: true });
const ts = Date.now();
const shot = `${dir}/${ts}-${tag}.png`;

async function sh(cmd, args, timeoutMs = 45_000) {
  const p = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => p.kill(), timeoutMs);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited;
  clearTimeout(timer);
  return { code, out: out.trim(), err: err.trim() };
}

// 1) פתח-את-הדף (ה-driver)
const openRes = await sh("agent-browser", ["open", url, "--session", "see-verify"]);
if (openRes.code !== 0 && !openRes.out.includes("already")) {
  console.error(`agent-browser open failed: ${openRes.err || openRes.out}`);
  process.exit(1);
}
await sh("agent-browser", ["set", "viewport", "1280", "900", "--session", "see-verify"]);
await sh("agent-browser", ["wait", "1500", "--session", "see-verify"]);

// 2) צלם (ראה)
const shotRes = await sh("agent-browser", ["screenshot", shot, "--session", "see-verify"]);
if (shotRes.code !== 0) {
  console.error(`screenshot failed: ${shotRes.err || shotRes.out}`);
  process.exit(1);
}

// 3) שפוט ב-VLM (חשוב) — פסק-דין-מובנה: PASS/FAIL/UNKNOWN + מה-נראה
const prompt = `You are the verification judge of an autonomous sovereign fleet.
Look at this screenshot and answer ONE question, strictly, in this exact JSON format and nothing else:
{"verdict":"PASS|FAIL|UNKNOWN","seen":"<what you actually see, one sentence>"}
Question: ${check}`;
const vlm = await sh("z-ai", ["vision", "--prompt", prompt, "--image", shot, "-o", `${dir}/${ts}-${tag}.vlm.json`], 90_000);

let verdict = "UNKNOWN", seen = vlm.err || "vlm-unavailable";
try {
  const raw = JSON.parse(readFileSync(`${dir}/${ts}-${tag}.vlm.json`, "utf8"));
  const content = raw?.choices?.[0]?.message?.content ?? raw?.content ?? raw?.response ?? raw?.text ?? JSON.stringify(raw);
  const m = String(content).match(/\{[\s\S]*\}/);
  if (m) {
    const j = JSON.parse(m[0]);
    verdict = ["PASS", "FAIL", "UNKNOWN"].includes(j.verdict) ? j.verdict : "UNKNOWN";
    seen = j.seen ?? seen;
  }
} catch { /* שמור-UNKNOWN-כנה */ }

const evidence = { schema: "see-verify-v1", at, url, check, tag, verdict, seen, screenshot: shot };
writeFileSync(`${dir}/${ts}-${tag}.json`, JSON.stringify(evidence, null, 2) + "\n");

if (wantJson) console.log(JSON.stringify(evidence, null, 2));
else {
  const icon = verdict === "PASS" ? "✔" : verdict === "FAIL" ? "✘" : "◌";
  console.log(`${icon} see-verify [${tag}] ${verdict}\n  בדיקה: ${check}\n  נראה: ${seen}\n  ראיה: ${shot}`);
}
process.exit(verdict === "PASS" ? 0 : 1);
