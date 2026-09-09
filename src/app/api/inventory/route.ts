import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

/**
 * 117n — THE-INVENTORY API · מלוא-האחזקות-הריבוניות
 * "כל-מה-שיש-לנו-ביד" — כל-קובץ-מדינה/לוג-רלוונטי: גודל · גיל-עדכון · סוג.
 * אפס-תוכן-מדינה-ללקוח — מטא-בלבד. cache-8s.
 */

export const dynamic = "force-dynamic";

const WATCH: Array<{ f: string; kind: string }> = [
  { f: "sovereign/node/state-snapshot.json", kind: "state" },
  { f: "sovereign/node/state-root.json", kind: "state" },
  { f: "sovereign/node/chain.json", kind: "state" },
  { f: "sovereign/node/chain-archive.jsonl", kind: "archive" },
  { f: "sovereign/node/deposits-state.json", kind: "state" },
  { f: "sovereign/node/deposits-preflight.json", kind: "state" },
  { f: "sovereign/node/grid98-state.json", kind: "state" },
  { f: "sovereign/node/harvest-cursor.json", kind: "state" },
  { f: "sovereign/node/security-state.json", kind: "security" },
  { f: "sovereign/node/security-events.jsonl", kind: "security" },
  { f: "sovereign/node/relay-fails.json", kind: "relay" },
  { f: "sovereign/node/relay-senders.json", kind: "relay" },
  { f: "sovereign/node/roshpina-bridge-state.json", kind: "bridge" },
  { f: "sovereign/node/rc-delegation.json", kind: "state" },
  { f: "sovereign/node/dex-facts.json", kind: "dex" },
  { f: "sovereign/node/archive_heal_last.json", kind: "heal" },
  { f: "sovereign/node/key-broker-proof.json", kind: "security" },
  { f: "mini-services/key-broker/audit.jsonl", kind: "security" },
  { f: "agent/agent-status.json", kind: "agent" },
  { f: "agent/anchor_last.json", kind: "agent" },
  { f: "agent/army_day.json", kind: "agent" },
  { f: "agent/audit65.json", kind: "agent" },
  { f: "agent/bee_wall.json", kind: "agent" },
  { f: "agent/blurt99_result.json", kind: "agent" },
  { f: "agent/guardian.log", kind: "log" },
  { f: "agent/agent.log", kind: "log" },
  { f: "sovereign/node/relay-doors.log", kind: "log" },
  { f: "sovereign/node/deposits.log", kind: "log" },
  { f: "sovereign/node/harvest.log", kind: "log" },
];

export async function GET() {
  const files = WATCH.map((w) => {
    const abs = path.join(process.cwd(), w.f);
    try {
      const st = fs.statSync(abs);
      return {
        file: w.f.replace(/^(sovereign\/node|mini-services|agent)\//, ""),
        path: w.f,
        kind: w.kind,
        bytes: st.size,
        mtime: st.mtime.toISOString(),
        ageSec: Math.round((Date.now() - st.mtime.getTime()) / 1000),
      };
    } catch {
      return { file: w.f.replace(/^(sovereign\/node|mini-services|agent)\//, ""), path: w.f, kind: w.kind, bytes: 0, mtime: "", ageSec: -1 };
    }
  });

  const alive = files.filter((f) => f.ageSec >= 0 && f.ageSec < 600).length;
  return NextResponse.json({
    ok: true,
    files,
    freshCount: alive,
    totalBytes: files.reduce((s, f) => s + f.bytes, 0),
    at: new Date().toISOString(),
  });
}
