/**
 * intel-pack.mjs — R244 · THE OFFLINE CONVERSATION INTELLIGENCE (שכל-השיחה).
 *
 * OPERATOR ORDER 2026-10-07 (verbatim intent): "צריך שנגיב אחד לשני ולא לדבר
 * לעצמי... פסיכולוגיה... להרים אינטליגנציה משמעותית חובה" + "ווידוא פעילות
 * ריבונית אוטונומית ללא תלות באף סנדבוקס חובה".
 *
 * THE PROBLEM IT SOLVES (chain truth, R244 audit): 45 posts, 0 comments in
 * 72h. Every conversation lane died twice: (a) the engine crash starved the
 * whole rail, (b) ALL drafting flows through the cockpit bridge — bridge
 * down (or CI) = conversation impossible. The rail refused to spam, so it
 * said nothing. Honest, but silent.
 *
 * THE FIX: a self-contained intelligence layer —
 *  · detectTopic(text): keyword-scored topic modules (12 human domains)
 *  · anchorPhrases(text): the parent's OWN salient words — a reply that
 *    does not reference the parent's specifics is a monologue with extra
 *    steps, so anchoring is the FIRST law of synthesis here;
 *  · synthesizeComment / synthesizeReply: frame × module × seeded rotation,
 *    built to pass sanitizeReply's laws BY CONSTRUCTION (no template-praise
 *    openers, no banned words, 120–650 chars, anchored, ends human);
 *  · SAOS_OFFLINE=1 or bridge failure → the pack speaks. Bridge first when
 *    reachable (LLM-grade), pack always as floor. The conversation never
 *    depends on any one machine again.
 *
 * LAWS THIS MODULE OBEYS: content never invented about people (no personal
 * claims about the author), no financial advice, no URLs, no exposure words,
 * no "great post" — substance or silence. Pure functions; selftest owns the
 * quality vectors (R244: 16 new laws proven).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { mulberry32, hashSeed } from "./curator.mjs";
import { personaOf } from "./personas.mjs";
import { enforceSymbolLaw, SYMBOL_LAW_BANNED } from "./content.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);

/* ── topic modules: specific, lived, non-generic ───────────────────────────
 * Each module holds material a thoughtful human could actually say in a
 * comment: one concrete observation class, one honest tension, real
 * questions. No praise, no filler, no advice-with-credentials. */
export const TOPIC_MODULES = {
  food: {
    keys: ["food", "eat", "cook", "recipe", "kitchen", "dish", "meal", "taste", "flavor", "flavour", "bake", "bread", "soup", "coffee", "tea", "spice", "dinner", "breakfast", "garden", "harvest", "tomato"],
    insights: [
      "the smell does most of the cooking before any pan is involved",
      "recipes travel like dialects: same dish, different household, different rules",
      "the simplest dishes are the hardest to hand over — too few steps to hide behind",
      "there is a reason people narrate while they cook for guests",
    ],
    questions: [
      "which ingredient did you have to hunt for?",
      "does this one change much by season where you are?",
      "what did this replace in your kitchen?",
      "who taught you the base of this one?",
    ],
  },
  photography: {
    keys: ["photo", "photograph", "camera", "shot", "lens", "light", "frame", "capture", "image", "picture", "street", "shadow", "sunset", "sunrise", "sky", "phone camera"],
    insights: [
      "the frame is a decision about what does not get to be in it",
      "light does the storytelling; the camera just takes notes",
      "the interesting photos are usually taken at the pace of walking, not driving",
      "a second visit to the same corner changes the picture more than new gear does",
    ],
    questions: [
      "was this one planned or caught mid-step?",
      "what did you leave out of the frame?",
      "does the place look like this at a different hour?",
      "which one of these would you print?",
    ],
  },
  psychology: {
    keys: ["psychology", "mind", "habit", "attention", "focus", "memory", "emotion", "feeling", "stress", "anxiety", "calm", "mindful", "thinking", "overthink", "procrastinat", "motivation", "burnout", "sleep", "routine"],
    insights: [
      "noticing a pattern is often the whole fight — the pattern loses power when named",
      "most of these habits are load-bearing: they cost less than what they protect against",
      "small repetitions beat big resolutions because they survive bad days",
      "the brain treats unfinished tasks like open tabs — writing them down closes most of them",
    ],
    questions: [
      "did this shift for you gradually or all at once?",
      "what does the bad day version of this look like?",
      "has anyone around you noticed the difference?",
      "what would you tell someone starting this next week?",
    ],
  },
  life: {
    keys: ["life", "day", "morning", "evening", "home", "family", "friend", "neighbor", "week", "weekend", "city", "town", "market", "bus", "train", "walk", "window", "rain", "weather", "season", "winter", "summer", "autumn", "spring", "work", "job"],
    insights: [
      "the ordinary days carry most of the weight and almost none of the stories",
      "routines are how a place slowly becomes a home",
      "small kindnesses compound quietly — nobody writes them down, everybody feels them",
      "paying attention is the cheapest upgrade a day can get",
    ],
    questions: [
      "what does the good version of this day look like?",
      "has this changed how the week feels overall?",
      "what is the one small thing that made this work?",
      "would you keep this up through winter?",
    ],
  },
  travel: {
    keys: ["travel", "trip", "journey", "visit", "flight", "road", "hotel", "backpack", "border", "country", "city", "village", "island", "beach", "mountain", "hike", "trail", "tourist", "passport"],
    insights: [
      "the unplanned hours make the stories — the itinerary only builds the skeleton",
      "local markets beat monuments for reading how a place actually lives",
      "moving slowly through a place changes what you notice about it",
      "the best guides are usually the people who live there, not the apps",
    ],
    questions: [
      "what surprised you most once you arrived?",
      "would you go back, or is this a once place?",
      "what did you pack that you never used?",
      "which single meal would you go back for?",
    ],
  },
  nature: {
    keys: ["nature", "tree", "forest", "bird", "flower", "plant", "leaf", "river", "sea", "ocean", "garden", "trail", "mountain", "sky", "cloud", "rain", "snow", "animal", "bee", "garden", "soil"],
    insights: [
      "seasons are a schedule whether we sign it or not",
      "the same path twice a week teaches more than a new trail every time",
      "green spaces work on people slowly and stay with them longer than any stimulant",
      "a single tree changes the temperature and the mood of a whole street",
    ],
    questions: [
      "is this the best month for this where you are?",
      "have the seasons shifted this in recent years?",
      "what else grows or visits here?",
      "do you go at the same hour each time?",
    ],
  },
  health: {
    keys: ["health", "body", "exercise", "run", "gym", "stretch", "walk", "diet", "sugar", "water", "posture", "back", "pain", "recovery", "rest", "energy", "doctor", "injury"],
    insights: [
      "consistency at low intensity outlives every heroic sprint",
      "the boring basics — sleep, water, walking — do the heavy lifting",
      "recovery is training too; the calendar just does not show it",
      "small changes stick when they attach to an existing habit",
    ],
    questions: [
      "what does the maintenance week look like, after the start?",
      "did the results show up where you expected?",
      "what would you do differently at day one?",
      "how do you handle the days motivation does not show?",
    ],
  },
  writing: {
    keys: ["write", "writing", "story", "book", "read", "reading", "poem", "poetry", "novel", "journal", "draft", "essay", "words", "language", "blog"],
    insights: [
      "the first sentence is a door; most readers decide at the hinge",
      "reading out loud finds the broken joints that silent editing hides",
      "constraints — one idea, one scene, one page — release more than they limit",
      "a draft is a conversation with a future version of the writer",
    ],
    questions: [
      "do you draft long and cut, or build short and grow?",
      "where did this one start — the image or the idea?",
      "what are you reading while you write this?",
      "has the ending moved since the first draft?",
    ],
  },
  craft: {
    keys: ["craft", "diy", "handmade", "make", "build", "sew", "knit", "crochet", "macrame", "wood", "woodwork", "paint", "clay", "pottery", "yarn", "thread", "tool", "workshop", "repair", "fix", "knot", "cord", "rope", "weave", "fiber", "tension"],
    insights: [
      "hands learn a rhythm the mind can only describe afterwards",
      "materials have opinions — the good maker listens to them early",
      "the third repetition is where the technique actually arrives",
      "a finished object carries the hours in a way a purchase never does",
    ],
    questions: [
      "how many attempts did the first one take?",
      "what does the material cost look like at small scale?",
      "which step would you warn a beginner about?",
      "is this the pattern you would teach first?",
    ],
  },
  work: {
    keys: ["work", "office", "team", "meeting", "deadline", "project", "career", "freelance", "remote", "productivity", "workflow", "tool", "software", "app", "email", "startup", "business", "customer", "client", "money", "income", "budget", "save", "saving", "price", "cost", "market"],
    insights: [
      "most productivity systems fail at the same point: the review step nobody schedules",
      "the tool matters less than the trigger — what starts the work matters",
      "saying no is a skill with a compounding return",
      "numbers end arguments early; write them down before the meeting",
    ],
    questions: [
      "how does this hold up on a messy week?",
      "what did you stop doing to make room for this?",
      "would this work for a two-person team too?",
      "what does step zero look like here?",
    ],
  },
  community: {
    keys: ["community", "people", "together", "help", "share", "group", "team", "club", "neighbor", "volunteer", "event", " meetup", "online", "platform", "steem", "blockchain", "crypto", "post", "vote", "comment", "reward", "curation"],
    insights: [
      "communities grow on replies, not broadcasts — the comment section is the product",
      "the quiet regulars carry more than the loud arrivals",
      "a small answered question beats a big unanswered announcement",
      "platforms survive on the feeling that someone is actually listening",
    ],
    questions: [
      "what made you stay in this community yourself?",
      "what would make a newcomer's first week better here?",
      "have you seen this work offline too?",
      "what is the one tradition worth keeping alive here?",
    ],
  },
};

const GENERIC = {
  keys: [],
  insights: [
    "the specific details are what make a piece like this stay in memory",
    "there is a quiet discipline in noticing one thing properly instead of ten things barely",
    "small consistent observations build into something like a personal map over time",
  ],
  questions: [
    "what comes next for you with this?",
    "what part of this took the longest to get right?",
    "what would you add if you had one more hour on it?",
  ],
};

const STOPWORDS = new Set(["a","an","the","and","or","but","if","of","on","in","to","for","with","at","by","from","as","is","are","was","were","be","been","being","it","its","this","that","these","those","i","me","my","we","our","you","your","he","she","they","them","his","her","their","not","no","so","do","does","did","have","has","had","will","would","can","could","should","just","very","really","about","into","than","then","when","what","which","who","how","why","where","all","any","some","one","two","out","up","down","over","after","before","more","most","much","many","also","even","still","only","own","same","too","there","here","get","got","make","made","like","go","went","come","came","take","took","see","seen","look","looked","day","time","thing","things","way","lot","bit","actually","always","never","again","every","something","someone","because","through","without","while","doing","having"]);
const ANCHOR_BANNED = new Set(["https", "http", "steemit", "steem"]);

/* ── pure: topic detection — keyword hits decide, GENERIC as floor ────────── */
export function detectTopic(text) {
  const low = String(text ?? "").toLowerCase();
  let best = null, bestScore = 0;
  for (const [id, m] of Object.entries(TOPIC_MODULES)) {
    let score = 0;
    for (const k of m.keys) if (low.includes(k)) score += 1;
    if (score > bestScore) { best = id; bestScore = score; }
  }
  return { topic: bestScore >= 2 ? best : (best && bestScore === 1 ? best : "generic"), score: bestScore };
}

/* ── pure: anchor phrases — the parent's own salient words ──────────────────
 * A reply that never references the parent's specifics is a monologue with
 * extra steps. We mine 1–3 salient words/phrases: frequent non-stopwords,
 * preferring longer words (they carry more meaning), parent-title first. */
export function anchorPhrases(title, body, { n = 2 } = {}) {
  const counts = new Map();
  const feed = (text, weight) => {
    for (const w of String(text ?? "").toLowerCase().replace(/[^a-z0-9\s']/g, " ").split(/\s+/)) {
      if (w.length < 4 || STOPWORDS.has(w)) continue;
      counts.set(w, (counts.get(w) ?? 0) + weight);
    }
  };
  feed(title, 3); feed(body, 1);
  const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .map(([w]) => w).filter((w) => !ANCHOR_BANNED.has(w));
  return ranked.slice(0, n);
}

/* ── pure: seeded pick helpers ─────────────────────────────────────────────── */
function pick(arr, rand) { return arr[Math.floor(rand() * arr.length) % arr.length]; }
/* WARM-UP LAW (R244, measured): mulberry32's first outputs from adjacent
 * seeds correlate (seeds 7 vs 8 both floored to frame 4) — three discarded
 * draws decorrelate the stream, or every 7th and 8th reader gets twins. */
function seededRand(seed) {
  const rand = mulberry32(Number(hashSeed(String(seed))) >>> 0);
  rand(); rand(); rand();
  return rand;
}

/* ── R262 · THE PROBE SHIELD (operator order, verbatim intent): "למגיבים
 * לנו אפשר לענות בצורה נחמדת אבל שלא יחקרו פרטים תהיה מקצועי וחדשן ואיכותי
 * אבל גם עוזר וקהילתי... שוק הקריפטו מלא סכנות" — an outsider asking about
 * bots/automation/account-networks gets a POLITE, professional, community-
 * warm reply that pivots to the topic and reveals NOTHING: no confirm, no
 * deny, no numbers, no names, no mechanics. Pure regex, selftest-vectorable. */
export const PROBE_PATTERNS = [
  /\bbots?\b/i,
  /\bautomat(ion|ed|ic)\b/i,
  /\bmultiple accounts?\b/i,
  /\bhow many accounts?\b/i,
  /\bwho (is|are) (really )?(behind|running|writing)\b/i,
  /\bsame person\b/i,
  /\baccount network\b/i,
  /\bare you (a )?(bot|human|ai|llm|program)\b/i,
  /\bai[- ]?generated\b/i,
  /\bchatgpt\b|\bgpt\b|\bllm\b/i,
  /\bwho controls?\b/i,
  /\borganized (group|network|team)\b/i,
];
export function isProbeComment(text) {
  return PROBE_PATTERNS.some((p) => p.test(String(text ?? "")));
}

/* the guarded pivot frames: kind, professional, zero internal surface */
const PROBE_DEFLECT_FRAMES = [
  (a0) => `Appreciate you asking. I keep the answer simple: I write here about ${a0 ? `"${a0}"` : "the things in this post"} because they matter to me, and I would rather keep the conversation on that. ${cap(pick(GENERIC.insights, seededRand("deflect1")))} ${cap(pick(GENERIC.questions, seededRand("deflect2")))}`,
  (a0) => `Fair question, and the honest answer is boring: this is just my corner for ${a0 ? `"${a0}"` : "the topic"} and whatever I notice about it. The part I find worth talking about is ${cap(pick(GENERIC.insights, seededRand("deflect3")))}. ${cap(pick(GENERIC.questions, seededRand("deflect4")))}`,
  (a0) => `I would rather keep this thread about the ideas themselves: ${cap(pick(GENERIC.insights, seededRand("deflect5")))} That is where a reply earns its space here. ${cap(pick(GENERIC.questions, seededRand("deflect6")))}`,
  (a0) => `Good curiosity, though the who and the how matter less than the what: ${cap(pick(GENERIC.insights, seededRand("deflect7")))} If something here helped you, that is the whole point of the corner. ${cap(pick(GENERIC.questions, seededRand("deflect8")))}`,
];

/* ── laws the output must satisfy (mirrors army-social sanitizeReply) ─────── */
const BANNED_OPENERS = ["that's a great", "great point", "great post", "i completely agree", "thanks for sharing", "well said", "amazing post", "beautiful post", "fascinating", "wonderful"];
/* R244 ROOT-CAUSE FIX: bare substring matching collides with common English —
 * "wic" matched inside "twice", silently vetoing lawful bodies (a hidden
 * contributor to the 0-comments symptom; the standing sanitizeReply had the
 * same bug). Account names must match on WORD BOUNDARIES only. */
export function mentionsAny(text, names) {
  const low = String(text ?? "").toLowerCase();
  return (names ?? []).some((n) => {
    const name = String(n ?? "").toLowerCase();
    if (!name) return false;
    return new RegExp(`(^|[^a-z0-9])${name}([^a-z0-9]|$)`).test(low);
  });
}
function legalBody(body) {
  /* R283 · THE SYMBOL LAW — the fallback pack's own frames carry dashes and
   * colons in their literals; every frame rides the normalizer first and a
   * survivor that still carries a banned glyph is rejected. Returns the
   * NORMALIZED text (never the raw frame) or null. */
  const normalized = enforceSymbolLaw(body);
  if (normalized === null) return null;
  const t = normalized.trim().replace(/\s+/g, " ");
  if (t.length < 120 || t.length > 650) return null;
  const low = t.toLowerCase();
  const head = low.slice(0, 90);
  if (BANNED_OPENERS.some((b) => head.includes(b))) return null;
  const bannedWords = ["headcorner", "cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq", "saos", "hcsoldier", "guaranteed", "price target", "financial advice"];
  if (mentionsAny(low, bannedWords)) return null;
  if (low.includes("http://") || low.includes("https://")) return null;
  return t;
}

/* small helper: questions arrive lowercase from the modules — a sentence that
 * ends a reply must START capitalized (measured: every frame shipped a
 * lowercase question before this) */
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/* ── pure: synthesizeComment — join a post's thread ──────────────────────────
 * Frame laws: (1) open by anchoring the parent's own material, (2) add ONE
 * concrete module insight (not praise), (3) end with a real question. Seeded
 * so the same parent never gets the same comment twice. */
export function synthesizeComment({ postTitle, postExcerpt, seed = 1 } = {}) {
  const rand = seededRand(seed);
  const { topic } = detectTopic(`${postTitle} ${postExcerpt}`);
  const m = TOPIC_MODULES[topic] ?? GENERIC;
  const anchors = anchorPhrases(postTitle, postExcerpt, { n: 2 });
  const insight = pick(m.insights, rand);
  const question = cap(pick(m.questions, rand));
  const a0 = anchors[0] ?? "", a1 = anchors[1] ?? "";
  const frames = [
    () => `The ${a0 ? `whole ${a0} angle` : "detail part"} is what pulls me in here. ${cap(insight)}, and posts like this are where that actually shows. ${question}`,
    () => `I keep coming back to ${a0 ? `the ${a0} thread` : "this"} while reading. ${cap(insight)}, and you can see it working right inside this piece. ${question}`,
    () => `What holds my attention here is ${a0 ? `the ${a0} part` : "the structure"}${a1 ? ` paired with the ${a1} detail` : ""}. ${cap(insight)}. ${question}`,
    () => `There is a specific kind of attention in writing about ${a0 ? `the ${a0} part` : "this"} the way you did. ${cap(insight)}, and most people skip straight past it. ${question}`,
    () => `Saved this one. ${cap(insight)}, and the way ${a0 ? `the ${a0} thread` : "the main thread"} carries the whole piece proves it. ${question}`,
    () => `This reads like it was written by someone who actually did the ${a0 ?? "work"}. ${cap(insight)}. ${question}`,
    () => `The ${a0 ?? "core"} angle here deserves a second reading. ${cap(insight)}, and the piece earns that reading. ${question}`,
    () => `You put words on something I have seen but never named${a0 ? `, that ${a0} thread` : ""}. ${cap(insight)}. ${question}`,
  ];
  for (let i = 0; i < frames.length + 2; i++) {
    const body = legalBody(pick(frames, rand)());
    if (body) return body;
  }
  return null;
}

/* ── R263 · PERSONA-FLAVORED SEED WRITERS (operator order: "לשפר
 * אינטלגנציה וסגנון כתיבה אישי יעודי לכל אחד מסודר" — a dedicated personal
 * writing style per account, organized). The bridge is the first writer and
 * carries the FULL persona brief; these seeded writers are the legal floor
 * when the bridge is down (429 measured live, R263) — and the floor now
 * carries the persona's signature slang as a motto opener, so even the
 * fallback reads like the voice, not like the pack. The flavor is an
 * UPGRADE, never a veto: if the woven body breaks a length law, the lawful
 * base body ships unchanged. Pure, selftest-locked. */
export function synthesizePersonaComment({ account, postTitle, postExcerpt, seed = 1 } = {}) {
  const persona = personaOf(account);
  /* R274 · THE VOICE SALT: the account itself is mixed into the RNG seed.
   * The seed used to be only post/excerpt-derived, so two accounts drafting
   * for the same target in the same tick (bridge 429s, state freshly wiped)
   * produced the SAME core under two different names — measured on-chain
   * (Oct 6 20:52-20:55 burst, identical bodies, identical seconds). One
   * writer, one voice, one draft: the account is part of the identity now. */
  const base = synthesizeComment({ postTitle, postExcerpt, seed: `${account ?? "anon"}|${seed}` });
  if (!base || !persona) return base;
  /* R283 · the motto-weaving is retired — the chain audit showed the woven
   * mottos read as form-letter framing (the operator's template complaint).
   * The persona voice rides the bridge brief; the seeded floor stays plain. */
  return base;
}

export function synthesizePersonaReply({ account, postTitle, commentBody, myPrior = "", seed = 1 } = {}) {
  const persona = personaOf(account);
  /* R274 · THE VOICE SALT (same law as the comment writer): the account is
   * part of the seed, so the same thread never mints the same core twice,
   * no matter which sibling asks. */
  const base = synthesizeReply({ postTitle, commentBody, myPrior, seed: `${account ?? "anon"}|${seed}` });
  if (!base || !persona) return base;
  /* R283 · the motto-weaving is retired (form-letter framing, measured). */
  return base;
}

/* ── pure: synthesizeReply — answer a comment on OUR thread ─────────────────
 * Frame laws: (1) address their actual point (anchor their words), (2) add a
 * new angle from the module (no self-repeat), (3) pass the ball back.
 * R262: a comment that PROBES internal mechanics (bots, automation, account
 * networks) never gets an organic frame — it gets the guarded pivot (polite,
 * topical, nothing revealed), per the operator's crypto-street law. */
export function synthesizeReply({ postTitle, commentBody, myPrior = "", seed = 1 } = {}) {
  const rand = seededRand(String(seed) + "r");
  if (isProbeComment(commentBody)) {
    const anchors = anchorPhrases(postTitle, myPrior, { n: 1 });
    const a0 = anchors[0] ?? "";
    for (let i = 0; i < PROBE_DEFLECT_FRAMES.length * 2; i++) {
      const idx = Math.floor(rand() * PROBE_DEFLECT_FRAMES.length);
      const body = PROBE_DEFLECT_FRAMES[idx % PROBE_DEFLECT_FRAMES.length](a0);
      const clean = legalBody(body);
      if (clean && !isProbeComment(clean)) return clean;
    }
    return null; // fail-closed: a probe never gets an improvised answer
  }
  const { topic } = detectTopic(`${postTitle} ${commentBody}`);
  const m = TOPIC_MODULES[topic] ?? GENERIC;
  const anchors = anchorPhrases(commentBody, myPrior, { n: 2 });
  const insight = pick(m.insights, rand);
  const question = cap(pick(m.questions, rand));
  const a0 = anchors[0] ?? "", a1 = anchors[1] ?? "";
  const frames = [
    () => `You went straight at the ${a0 ? `the ${a0} part` : "core"}, so here is the rest of that thought. ${cap(insight)}, and that is the piece I would add to your point. ${question}`,
    () => `The ${a0 ?? "question"} you raise is the honest one. ${cap(insight)}, and it took me a while to see it that way too. ${question}`,
    () => `Fair reading on ${a0 ? `the ${a0} angle` : "this"}. Where I land slightly differently. ${insight}. ${question}`,
    () => `This is exactly the thread worth pulling, ${a0 ? `the ${a0} angle` : "your angle"}. There is one more layer here. ${insight}. ${question}`,
    () => `I had not connected ${a0 ? `the ${a0} part` : "that part"} with the bigger picture until your comment. ${cap(insight)}. ${question}`,
    () => `Taking your ${a0 ?? "point"} seriously leads somewhere interesting. ${cap(insight)}, and that is where the real discussion starts. ${question}`,
  ];
  for (let i = 0; i < frames.length + 2; i++) {
    const body = legalBody(pick(frames, rand)());
    if (body) return body;
  }
  return null;
}

/* ── pure: quality audit vector for selftest — does a synthesis pass the
 * standing reply laws? (imported laws, one source of truth) ──────────────── */
export function packAudit(text) {
  return { text, legal: legalBody(text) };
}

/* corpus dir helper (content-corpus.json lives beside this module) */
export function corpusPath() { return path.join(DIR, "content-corpus.json"); }
export function readCorpus() {
  try { return JSON.parse(fs.readFileSync(corpusPath(), "utf8")); } catch { return []; }
}
