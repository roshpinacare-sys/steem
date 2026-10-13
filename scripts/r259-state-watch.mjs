// R259 event-driven witness: fs.watch on engine state dir — catches EVERY change instantly.
import fs from "node:fs";
const DIR = "/home/z/my-project/mini-services/saos-engine/state";
const LOG = "/tmp/witness-r259.log";
try { fs.mkdirSync(DIR, { recursive: true }); } catch {}
let prev = new Set();
const snap = () => new Set(fs.readdirSync(DIR));
prev = snap();
fs.watch(DIR, { persistent: true }, (ev, name) => {
  const now = snap();
  const gone = [...prev].filter((x) => !now.has(x));
  const born = [...now].filter((x) => !prev.has(x));
  if (gone.length || born.length) {
    const line = `${new Date().toISOString()} ev=${ev}${gone.length ? " GONE=" + gone.join(",") : ""}${born.length ? " BORN=" + born.join(",") : ""}`;
    fs.appendFileSync(LOG, line + "\n");
  }
  prev = now;
});
setInterval(() => { try { prev = snap(); } catch {} }, 30000);
