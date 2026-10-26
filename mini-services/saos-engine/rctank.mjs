/**
 * rctank.mjs — T-22 · THE RC-TANK METER (המדידה היומית של חוק-100,000×).
 * T-19c named the real lever: ops/day ceiling ∝ RC ∝ SP. This module turns
 * that law into a MEASURED daily curve: max_rc (chain truth), the derived
 * equilibrium ops/day (the same RC economics the hyper governor uses), and
 * the day-over-day growth. Read-only — runs WITH or WITHOUT a credential.
 * state/rc-tank.json is the scaling-law evidence the cockpit plots.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { rpcCall } from "./measure.mjs";
import { rcEconomics } from "./lib.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const FILE = path.join(STATE, "rc-tank.json");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
};

export function rcTankState() { return readJson(FILE, null); }

export async function runRcTank({ now = new Date().toISOString(), account } = {}) {
  const acc = account || process.env.SAOS_ACCOUNT || "headcorner";
  const prev = readJson(FILE, null);
  const r = await rpcCall("rc_api.find_rc_accounts", { accounts: [acc] });
  const row = r?.ok ? r.result?.rc_accounts?.[0] : null;
  if (!row) {
    const out = { day: now.slice(0, 10), verdict: "RC-READ-FAILED", at: now, account: acc, ...(prev?.day === now.slice(0, 10) ? {} : { history: prev?.history ?? [] }) };
    writeJson(FILE, out);
    return out;
  }
  const maxRc = Number.parseInt(row.max_rc ?? "0", 10);
  const curRc = Number.parseInt(row.rc_manabar?.current_mana ?? "0", 10);
  const econ = rcEconomics({ maxRc }); // measured-costs economics — same core the governor uses
  const day = now.slice(0, 10);
  const prevEntry = (prev?.history ?? []).find((h) => h.day !== day) ?? (prev?.day && prev.day !== day ? { day: prev.day, maxRc: prev.maxRc ?? null } : null);
  const growthPct = prevEntry?.maxRc > 0 && maxRc > 0 ? Math.round(((maxRc - prevEntry.maxRc) / prevEntry.maxRc) * 1e4) / 100 : null;
  const history = [{ day, maxRc, opsPerDay: econ.opsPerDay ?? null }, ...(prev?.history ?? []).filter((h) => h.day !== day)].slice(0, 30);
  const out = {
    day, at: now, account: acc, verdict: "MEASURED",
    maxRc, rcPct: maxRc > 0 ? Math.round((curRc / maxRc) * 1000) / 10 : null,
    opsPerDayEquilibrium: econ.opsPerDay ?? null,
    prevDayMaxRc: prevEntry?.maxRc ?? null,
    growthPct,
    scalingLaw: "ops/day ∝ RC ∝ SP — העקומה הזאת מדודה יום-יום, לא מובטחת",
    history,
  };
  writeJson(FILE, out);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runRcTank({ now: new Date().toISOString() }).then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => { console.error("RCTANK-FAIL", e); process.exit(1); });
}
