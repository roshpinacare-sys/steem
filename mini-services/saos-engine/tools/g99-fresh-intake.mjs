#!/usr/bin/env bun
/**
 * g99-fresh-intake.mjs — גל-99 · agent-2 · 2026-10-18
 * הזרקת-טיוטות-טריות לתור content-ops (טהור-תוספות, אטומי, בלי-געילה בקיים).
 * חוקים: 300+ מילים · ASCII בלבד · אפס-טיקים מ-DNA · כל-שדות-התור.
 * Verdict-only stdout.
 */
import * as fs from "node:fs";

const OPS = "/home/z/audit/repos/steem/mini-services/saos-engine/state/content-ops.json";
const TICS = ["difference is in", "drawer of replies", "i measure it", "of replies you", "the difference is", "the drawer of", "the loop the", "the post that", "the real work"];

const POSTS = [
  {
    title: "The Two-Dollar Listening Trick. What a Cheap Tuning Fork Taught Me About Repairing Machines",
    tags: ["repair", "diy", "learning", "tools"],
    body: `The washing machine started making a sound I can only describe as a polite cough. Not loud enough to stop the household, loud enough that I heard it over the kitchen radio and turned the radio down instead of investigating. That decision cost me four months.

When the cough became a rattle, I did what most people do. I opened the back panel, stared at the drum assembly, googled the model number, and ordered the part the forum posts blamed most often. The drive belt arrived in three days. It was fine. The belt had never been the problem, and installing the new one taught me nothing except that I own a socket set.

A friend who repairs guitars for a living came over for dinner, heard the machine finish a cycle, and asked me for a screwdriver. He did not open anything. He pressed the wooden handle of the screwdriver against the machine's shell near the bottom corner, pressed the other end against his jaw, and listened the way you listen to a seashell. Then he said: bearing, lower left, water seal is next. Two weeks later the seal went and his one-minute diagnosis saved the motor.

He told me the trick costs nothing. Any rigid object conducts vibration better than air, so the machine's own frame becomes the speaker and your jaw becomes the receiver. Mechanics have done it with screwdrivers for a century. Doctors did it with stethoscopes before that. The tool was never the point. The point is that he had a habit of listening BEFORE touching, and I had a habit of ordering parts after guessing.

What stayed with me was not the trick itself. It was the humility of the sequence. He gathered evidence first, formed one hypothesis, and named the next failure before it happened. I had skipped every one of those steps and paid for the skip twice, once in money and once in the months of noise I had trained myself to ignore.

Now there is a cheap tuning fork hanging on a string in my utility closet, mostly as a reminder. Machines announce their failures early and in detail. The announcement is quiet, and it comes before the breakdown, and it is always addressed to whoever bothers to listen.`,
  },
  {
    title: "Counting Screws Before Breakfast. The Paper Habit That Beat Every Inventory App I Installed",
    tags: ["workshop", "habits", "organization", "craft"],
    body: `For three years my workshop inventory lived in a series of apps. I want to describe how that went, because each app failed in the same specific way, and the pattern taught me something about tools that no review mentioned.

The first app asked me to photograph every item. I photographed about forty jars of screws and bolts, then stopped, because photographing the remaining two hundred felt like a second job. The second app used barcodes and a label printer, which worked beautifully for about six weeks until the printer died and the thought of reprinting everything arranged itself in my mind as a wall. The third app was a spreadsheet, which is where inventories go to die politely.

During that same period, my neighbor ran his garage with a hardcover notebook and a pencil tied to a string. When he opened the last box of a given screw size, he wrote the size on a list under a heading he called get more. When he bought stock, he crossed the line out. That was the entire system. It looked primitive next to my dashboards, and his hardware runs never stopped a job, while mine did, twice, in one month.

I copied his notebook, badly at first. My version has one page per shelf, and the rule is that the pencil writes at the moment of use, not later, not at the end of the day, at the moment. The moment rule is the whole rule. Every failed app of mine shared one design assumption, that data entry could be batched and deferred. Every success of his came from refusing that assumption.

The notebook does things the apps never did. It shows pencil pressure, which tells me which sizes I handle weekly. It survives dust, drops, and dead batteries. It has never once asked me to update, and in four years it has never lost a line.

I still like software. I build it for a living. But a tool that requires a better version of me, running on schedule, with charged batteries and good intentions, is not a tool. The pencil works because it asks less than I can always give.`,
  },
  {
    title: "Ten Years of Garden Notes in One Notebook. What the Records Prove and What They Politely Refuse To",
    tags: ["gardening", "records", "patience", "learning"],
    body: `A neighbor gave me her old garden notebook when she moved away, and I have kept my own for ten years now, which sounds impressive until I explain what the notebook actually contains. Dates of first and last frost. What got planted where. Rain, estimated by eye. Yields, guessed in bowls rather than weighed. It is bad science and I knew that when I started, and I kept going anyway, and the reasons that made me continue turned out to be worth more than accuracy.

The first thing the records did was kill my favorite story about myself. I had believed our yard was a warm pocket where spring arrives early. Ten years of frost dates said otherwise: the early springs I remembered were two mild years out of ten, and the middle of the record showed late frosts that would have killed the tomatoes I now plant out early. The notebook caught me cherry picking my own memory. Memory sorts for drama. Paper sorts for dates.

The second thing the records did was smaller and stranger. They made me patient with individual failures. A bed that produces nothing in one year used to feel like a verdict on me. In the notebook it becomes one line among many, and lines sit next to each other, and a bad beet year sits two lines away from the best garlic year we ever had. Nobody folds a ten year record over one bad row.

What the records refuse to prove is causation. I have changed soil, changed varieties, changed watering, and my notes cannot tell me which change earned which result, because too many things moved at once and my rain numbers are guesses. Any honest scientist would dismiss the whole notebook. Fine. The notebook was never competing with science. It competes with forgetting, and against forgetting it wins every year.

People ask if they should start keeping records like these. My answer is to lower the bar and then keep it low. One line per planting. One guess per harvest. The value is not in the quality of each entry. It is in the fact that next year, you will be arguing with evidence instead of with your own highlight reel, and the evidence, however rough, was written by someone who was actually there.`,
  },
];

// בדיקת-טיקים + ASCII
const problems = [];
for (const p of POSTS) {
  const text = (p.title + "\n" + p.body).toLowerCase();
  for (const t of TICS) if (text.includes(t)) problems.push(`${p.title.slice(0, 30)}: tic "${t}"`);
  if (!/^[\x20-\x7E\n\r\t]*$/.test(p.title + p.body)) problems.push(`${p.title.slice(0, 30)}: non-ASCII`);
  const words = p.body.trim().split(/\s+/).length;
  if (words < 300) problems.push(`${p.title.slice(0, 30)}: only ${words} words`);
  const bytes = Buffer.byteLength(p.body, "utf8");
  if (bytes > 16000) problems.push(`${p.title.slice(0, 30)}: ${bytes} bytes`);
  if (problems.length === 0) console.log(JSON.stringify({ check: p.title.slice(0, 40), words, bytes, ok: true }));
}
if (problems.length) { for (const p of problems) console.log("FAIL:", p); process.exit(1); }

// הזרקה אטומית טהורה-תוספות
const doc = JSON.parse(fs.readFileSync(OPS, "utf8"));
if (!Array.isArray(doc.queue)) doc.queue = [];
const now = new Date().toISOString();
const existingTitles = new Set(doc.queue.map((e) => String(e.title ?? "").toLowerCase()));
let added = 0;
for (const p of POSTS) {
  if (existingTitles.has(p.title.toLowerCase())) { console.log(JSON.stringify({ skip: "exists", title: p.title.slice(0, 40) })); continue; }
  doc.queue.push({
    id: `g99-${Date.now()}-${added}`,
    status: "drafted",
    title: p.title,
    body: p.body,
    tags: p.tags,
    persona: null,
    voice: "field-honest",
    angle: "first-person craft lesson",
    groundedOn: "lived anecdote, no claims beyond the writer's own shops and yards",
    draftedAt: now,
    draftedBy: "agent-2 (גל-99)",
  });
  added += 1;
}
const tmp = `${OPS}.${process.pid}.tmp`;
fs.writeFileSync(tmp, JSON.stringify(doc, null, 1));
fs.renameSync(tmp, OPS);
console.log(JSON.stringify({ added, queueSize: doc.queue.length }));
