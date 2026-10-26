#!/usr/bin/env bun
/**
 * social-beat.mjs — G13 pacemaker for the posting stream (one process, self-looping).
 *
 * WHY: the streamer's gates (mode → armed → kill-switch → caps → gap → dedupe →
 * chain-uniqueness veto) are all inside runOnce; this wrapper adds ONLY the
 * cadence + honest logging. Restart after any reboot with ONE command:
 *
 *   cd mini-services/saos-engine && nohup bun social-beat.mjs >> state/social-beat.log 2>&1 &
 *
 * Caps stay inside the streamer (16/day fleet, ≤4/day account, 45min gap).
 * The beat never bypasses a gate — it just keeps time. Fail-soft: a cycle
 * error is logged and the loop continues; SIGTERM exits cleanly.
 */
import { runOnce } from "./social-streamer.mjs";
import * as fs from "node:fs";

const BEAT_MIN = Number(process.env.BEAT_MIN ?? 50);
const STATE = new URL("./state/", import.meta.url).pathname;
const log = (o) => {
  try { fs.appendFileSync(STATE + "social-beat.log", JSON.stringify({ t: new Date().toISOString(), ...o }) + "\n"); } catch { /* disk-full honest */ }
};

let beat = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.on("SIGTERM", () => { log({ beat, exit: "SIGTERM" }); process.exit(0); });

log({ started: true, beatMin: BEAT_MIN, pid: process.pid });
while (true) {
  beat += 1;
  try {
    const r = await runOnce();
    log({ beat, verdict: r?.verdict ?? null, ok: !!r?.ok, account: r?.account ?? null, txid: r?.txid ?? null });
  } catch (e) {
    log({ beat, error: String(e).slice(0, 160) });
  }
  await sleep(BEAT_MIN * 60_000);
}
