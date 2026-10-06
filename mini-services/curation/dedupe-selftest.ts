// r144-i2 · dedupe self-test — CLI proof (no side effects on the dedupe log)
// Run: bun mini-services/curation/dedupe-selftest.ts
import {
  FLEET_ACCOUNTS, VOICE_PROFILES, voiceProfileFor, gateCast, contentGate,
  NEAR_DUP_THRESHOLD, type MemoryEntry,
} from "./dedupe";

let fails = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fails++;
}

const mem: MemoryEntry[] = [
  { author: "haran", permlink: "re-x", created: "2026-10-01T10:00:00", body: "Your piece \"Derivation instead of paste\" stopped me, specifically the part with 4,616 SP. The ledger line reads: small positions, honest math.", source: "test" },
  { author: "tov", permlink: "re-y", created: "2026-10-01T10:05:00", body: "Your piece \"Derivation instead of paste\" stopped me, specifically the part with 4,616 SP. Things that worked this week: it worked; the numbers agree.", source: "test" },
  { author: "siq", permlink: "re-z", created: "2026-10-01T10:10:00", body: "Field note: the tide chart in the harbor office is drawn by hand every spring, and the clerk compares it against the satellite feed.", source: "test" },
];

// 1) near-duplicate cross-account text is SKIPped (candidate = haran's measured text + tiny tail)
const nearDupText = 'Your piece "Derivation instead of paste" stopped me, specifically the part with 4,616 SP. The ledger line reads: small positions, honest math. More soon.';
const v1 = gateCast("macrame", nearDupText, mem, 0);
check("gateCast SKIPs cross-account near-duplicate", v1.verdict === "SKIP" && v1.bestSim >= NEAR_DUP_THRESHOLD, `${v1.verdict} sim=${v1.bestSim.toFixed(3)} ${v1.reason.slice(0, 70)}`);

// 2) genuinely distinct text passes
const v2 = gateCast("macrame", "Field note: the baker on the corner salts the crust twice, once before the oven and once at the door, and keeps the timing written in pencil.", mem, 0);
check("gateCast PASSes distinct text", v2.verdict === "PASS", `sim=${v2.bestSim.toFixed(3)}`);

// 3) same-account texts are exempt (gate is cross-account)
const v3 = gateCast("haran", nearDupText, mem, 0);
check("same-account texts exempt", v3.verdict === "PASS", `sim=${v3.bestSim.toFixed(3)}`);

// 4) unknown account has no voice profile → SKIP (defensive)
const v4 = gateCast("stranger", "Anything", mem, 0);
check("no-voice-profile ⇒ SKIP", v4.verdict === "SKIP" && v4.reason === "no-voice-profile");

// 5) 11 distinct voice profiles, rotation deterministic within a day
const sigs = new Set(VOICE_PROFILES.map(p => `${p.tone}|${p.structure}|${p.openers.join("")}|${p.closers.join("")}`));
check("11 distinct voice profiles", VOICE_PROFILES.length === FLEET_ACCOUNTS.length && sigs.size === FLEET_ACCOUNTS.length, `${sigs.size}/${FLEET_ACCOUNTS.length}`);
const p1 = voiceProfileFor("tov", 3), p2 = voiceProfileFor("tov", 3);
check("rotation deterministic", JSON.stringify(p1) === JSON.stringify(p2));
const p3 = voiceProfileFor("tov", 4);
check("rotation varies by slot", p1?.openers[0] !== p3?.openers[0] || p1?.closers[0] !== p3?.closers[0]);

// 6) live gate run (real memory refresh + real scan) — additive, no vote-path touch
const state: { dedupe?: Awaited<ReturnType<typeof contentGate>> } = {};
const st = await contentGate(state);
check("contentGate runs fail-soft on live state", st.lastError === null && st.voiceDiversity === FLEET_ACCOUNTS.length, `memory=${st.memory} nearDups=${st.nearDups} live=${st.liveRefreshedAt}`);

console.log(fails === 0 ? "SELFTEST: ALL PASS" : `SELFTEST: ${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
