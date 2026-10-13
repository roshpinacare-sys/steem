// R271 · STATE-WITNESS — event-driven watcher for the engine state dir.
// Mission: the silent state-eater (R258, measured once, root cause open) must
// never erase again without a same-second receipt. Logs every BORN/GONE to
// /tmp/state-witness.log (append-only) + keeps recent events in memory.
import fs from "node:fs";

const DIR = "/home/z/my-project/mini-services/saos-engine/state";
const LOG = "/tmp/state-witness.log";
const PORT = 3047;
let recent: Array<{ at: string; ev: string; gone?: string[]; born?: string[] }> = [];
let prev = new Set(fs.readdirSync(DIR));
const snapshot = () => new Set(fs.readdirSync(DIR));

function record(entry: { ev: string; gone?: string[]; born?: string[] }) {
  const e = { at: new Date().toISOString(), ...entry };
  recent.push(e);
  if (recent.length > 100) recent = recent.slice(-100);
  try { fs.appendFileSync(LOG, JSON.stringify(e) + "\n"); } catch {}
}

fs.watch(DIR, { persistent: true }, () => {
  let now: Set<string>;
  try { now = snapshot(); } catch { return; }
  const gone = [...prev].filter((x) => !now.has(x));
  const born = [...now].filter((x) => !prev.has(x));
  if (gone.length || born.length) record({ ev: "rename", ...(gone.length ? { gone } : {}), ...(born.length ? { born } : {}) });
  prev = now;
});
setInterval(() => { try { prev = snapshot(); } catch {} }, 30000);

Bun.serve({
  port: PORT,
  fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/health") return Response.json({ ok: true, service: "state-witness", at: new Date().toISOString(), watching: DIR, tracked: prev.size, recent: recent.length });
    if (u.pathname === "/events") return Response.json({ ok: true, events: recent });
    if (u.pathname === "/eats") return Response.json({ ok: true, eats: recent.filter((e) => (e.gone ?? []).some((g) => !g.startsWith("."))) });
    return Response.json({ ok: false, error: "not-found", routes: ["/health", "/events", "/eats"] }, { status: 404 });
  },
});
console.log(`[state-witness] up on :${PORT} — watching ${DIR} (${prev.size} files)`);
