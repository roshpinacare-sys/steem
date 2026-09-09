import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

/**
 * 117n — THE-DOORS API · הדלתות-והיתרה-החיה-מהרשת
 *
 * 8-דלתות-ברוקר (key-broker:3040 · x-kb-token) + 12-דלתות-רישום (wallets-registry · כתובות-ציבוריות-בלבד — אפס-pk-ללקוח!)
 * יתרות-חיות מ-TRON ריבוי-מארחים (getaccount) — נתוני-אמת-מהרשת.
 * cache-12s (יתרות-לא-משתנות-בכל-שנייה).
 */

export const dynamic = "force-dynamic";

const BROKER_TOKEN = path.join(process.cwd(), "agent", "keys", "key-broker.token");
const REGISTRY = path.join(process.cwd(), "agent", "keys", "wallets-registry.json");
const TRON_HOSTS = ["https://api.trongrid.io", "https://api.tronstack.io", "https://tron.stackwallet.com"];

type J = Record<string, unknown>;
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

type DoorRec = { id: string; family: string; address: string; path?: string; balSun: number | null; balTrx: number | null };

let cache: { at: number; body: J } | null = null;
const TTL = 30_000;

async function tronBalance(addr: string, hostIdx = 0): Promise<number | null> {
  const order = [TRON_HOSTS[hostIdx % 3], TRON_HOSTS[(hostIdx + 1) % 3], TRON_HOSTS[(hostIdx + 2) % 3]];
  let netFails = 0;
  for (const host of order) {
    try {
      const r = await fetch(host + "/wallet/getaccount", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: addr, visible: true }),
        signal: AbortSignal.timeout(4000),
      });
      if (!r.ok) {
        netFails++;
        continue;
      }
      const j = (await r.json()) as J;
      if (typeof j.balance === "number") return j.balance;
      // {} = החשבון-לא-קיים-בשרשרת (מעולם-לא-הופעל/נוקזה-ונמחק) → אפס-אמת, לא-כשל-מדידה
      if (j && typeof j === "object") return 0;
      return 0;
    } catch {
      netFails++;
    }
  }
  // אם-כל-המארחים-לא-ענו-ברשת — אז-בלבד זה "לא-נמדד"
  return netFails >= order.length ? null : 0;
}

async function brokerDoors(): Promise<DoorRec[]> {
  try {
    const token = fs.readFileSync(BROKER_TOKEN, "utf8").trim();
    const r = await fetch("http://127.0.0.1:3040/doors", {
      headers: { "x-kb-token": token },
      signal: AbortSignal.timeout(2500),
    });
    const j = (await r.json()) as { doors?: Array<{ id: string; address: string; family: string; path?: string }> };
    return (j.doors || []).map((d) => ({ id: d.id, family: d.family, address: d.address, path: d.path, balSun: null, balTrx: null }));
  } catch {
    return [];
  }
}

function registryDoors(): DoorRec[] {
  try {
    const r = JSON.parse(fs.readFileSync(REGISTRY, "utf8")) as { accounts?: Array<J> };
    return (r.accounts || [])
      .map((a, i) => {
        const t = (a.tron && typeof a.tron === "object" ? (a.tron as J) : {}) as J;
        const addr = String(t.address || a.tron || "");
        const agent = String(a.agent || "agent");
        return {
          id: "reg:" + i,
          family: "registry",
          address: addr,
          path: agent,
          balSun: null,
          balTrx: null,
        };
      })
      .filter((d) => d.address.length > 20);
  } catch {
    return [];
  }
}

export async function GET() {
  if (cache && Date.now() - cache.at < TTL) return NextResponse.json(cache.body);

  const [broker, registry] = await Promise.all([brokerDoors(), Promise.resolve(registryDoors())]);
  const all = [...broker, ...registry];
  const uniq = new Map<string, DoorRec>();
  for (const d of all) if (d.address && !uniq.has(d.address)) uniq.set(d.address, d);
  const doors = [...uniq.values()];

  // יתרות-חיות — סדרתי-עם-סבב-מארחים (אנטי-rate-limit · פיזור-עומס-על-3-צמתים)
  for (let i = 0; i < doors.length; i++) {
    const b = await tronBalance(doors[i].address, i);
    doors[i].balSun = b;
    doors[i].balTrx = b === null ? null : b / 1_000_000;
  }

  const body: J = {
    ok: true,
    brokerAlive: broker.length > 0,
    brokerDoors: broker.length,
    registryDoors: registry.length,
    doors,
    measured: doors.filter((d) => d.balSun !== null).length,
    totalTrx: doors.reduce((s, d) => s + (d.balTrx || 0), 0),
    at: new Date().toISOString(),
  };
  cache = { at: Date.now(), body };
  return NextResponse.json(body);
}
