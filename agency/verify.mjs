#!/usr/bin/env bun
/**
 * agency/verify.mjs — W28-c · THE AGENCY LIVENESS VERIFIER
 * (owner trace 1a15cc9fb5220725: "שלא יהיו חסימות מיותרות").
 *
 * Reads catalog.json, MEASURES every lane honestly:
 *   port   → GET http://127.0.0.1:{port}{probe} with a 2.5s timeout → UP/HTTP-N/DOWN
 *   module → file exists in the git home tree → PRESENT/MISSING
 *   repo   → localPath exists → PRESENT-LOCAL, else REMOTE-ONLY (honest)
 *   ci     → CI-LANE (judged by its own receipts lane — never faked locally)
 *
 * Exit: 0 if every port lane is UP, else 1. Output: verdict JSON.
 * Zero secrets, zero writes, zero network beyond loopback.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const HOME = path.resolve(DIR, "..");

const catalog = JSON.parse(fs.readFileSync(path.join(DIR, "catalog.json"), "utf8"));

const probePort = async (port, probe, ms) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(`http://127.0.0.1:${port}${probe || "/health"}`, { signal: ctl.signal });
    return res.ok ? "UP" : `HTTP-${res.status}`;
  } catch {
    return "DOWN";
  } finally { clearTimeout(t); }
};

const lanes = [];
for (const [division, entries] of Object.entries(catalog.divisions ?? {})) {
  for (const lane of entries ?? []) {
    let status = "UNKNOWN";
    let detail = "";
    if (lane.kind === "port") {
      status = await probePort(lane.port, lane.probe, 2500);
      detail = `127.0.0.1:${lane.port}${lane.probe || "/health"}`;
    } else if (lane.kind === "module") {
      const modPath = path.isAbsolute(lane.file) ? lane.file : path.join(HOME, lane.file);
      status = fs.existsSync(modPath) ? "PRESENT" : "MISSING";
      detail = lane.file;
    } else if (lane.kind === "repo") {
      status = lane.localPath && fs.existsSync(lane.localPath) ? "PRESENT-LOCAL" : "REMOTE-ONLY";
      detail = `${lane.remote ?? ""} ${lane.localPath ?? ""}`.trim();
    } else if (lane.kind === "ci") {
      status = "CI-LANE";
      detail = lane.lane ?? "";
    }
    lanes.push({ division, slug: lane.slug, kind: lane.kind, status, detail, mission: lane.mission });
  }
}

const portLanes = lanes.filter((l) => l.kind === "port");
const ok = portLanes.length > 0 && portLanes.every((l) => l.status === "UP");
const verdict = {
  schema: "saos-agency-verify-v1",
  ok,
  at: new Date().toISOString(),
  counts: {
    lanes: lanes.length,
    portsUp: portLanes.filter((l) => l.status === "UP").length,
    portsDown: portLanes.filter((l) => l.status !== "UP").length,
    modulesMissing: lanes.filter((l) => l.status === "MISSING").length,
  },
  lanes,
  note: "honest per-lane liveness · CI lanes are judged by their own receipts lanes (worklog pointers), never faked locally",
};
console.log(JSON.stringify(verdict, null, 2));
process.exit(ok ? 0 : 1);
