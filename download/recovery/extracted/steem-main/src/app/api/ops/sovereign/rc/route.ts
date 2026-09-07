import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * GET /api/ops/sovereign/rc — ריבונות-RC בתמונה-אחת (Task 50).
 *
 * מפת-דלק מלאה (אוצר+צי+Hive) · מטח-צי (חציית חומת 5-custom_json/בלוק)
 * · batch (4 ops/טרנזקציה + עלות-op נמדדת) · מנוע-עומסים (ריצות מקומיות
 * אפס-RC + עיגון מרוכז) · צ'אנקים (חציית חומת 8192B) · מכונת-ה-powerup
 * של הדמון. הכל מקבצי-תוצאה של ריצות אמיתיות. לעולם לא 500.
 */

const AGENT_DIR = path.join(process.cwd(), "agent");

interface AgentJson {
  [k: string]: unknown;
}

async function readAgentJson(name: string): Promise<AgentJson | null> {
  try {
    return JSON.parse(await readFile(path.join(AGENT_DIR, name), "utf8")) as AgentJson;
  } catch {
    return null;
  }
}

// חומות-הפרוטוקול שנמדדו חי (limits.json) והפתרון-הריבוני לכל אחת
const WALLS: { wall: string; measured: string; sovereign: string }[] = [
  { wall: "5 custom_json / חשבון / בלוק", measured: "REJECTED חי: already submitted 5 custom json (limits.json)", sovereign: "מטח-צי מקביל — 16 ops/בלוק מ-4 חותמים (מאומת בלוק 109271747), תקרת-צי 40" },
  { wall: "RC = f(SP) · רג'ן 5-ימים", measured: "custom_json 2000B = 18.7G RC · קומפקטי ≈55M", sovereign: "טבלת-תפוקה: ~300 ops/יום/חייל → צי ≈3,000/יום · עיגון-מרוכז 40 ריצות→4 ops" },
  { wall: "custom_json ≤ 8192B", measured: "REJECTED חי: 9000B נדחה", sovereign: "צ'אנקים-צי: מניפסט 20,409B דרך 4 חיילים, הרכבה מהשרשרת sha256 מתאים" },
  { wall: "memo ≤ 2048B", measured: "REJECTED חי: 2200B נדחה", sovereign: "ערוץ-פקודות מוצפן chunked + אוטובוס saos/v1" },
  { wall: "הקמת-חשבון = 6T RC", measured: "REJECTED חי: haran 37G RC (חייל-עשיר רחוק פי-160)", sovereign: "מפעל-דור-שני: claim דרך אוצר (8.9T) + מפתחות-דטרמיניסטיים + עוגן-חילוץ" },
  { wall: "Hive-RC אוזל (0.5%)", measured: "117M/34.6G אחרי 53 עוגנים", sovereign: "מכונת-powerup דמון: SWAP.HIVE→HP עם שער-RC ולמידת-וריאנט" },
  { wall: "עמלות/עלויות-DEX חיצוניים", measured: "hivepegged 0.75% · HE fees", sovereign: "AMM/ספר-משלנו על אוטובוס saos — אפס-עמלות פנימיות, עמלות נלכדות לבריכות שלנו" },
];

export async function GET() {
  try {
    const [rcMap, rcs, runner, powerup, powerState] = await Promise.all([
      readAgentJson("rc_map.json"),
      readAgentJson("rc_sovereign_result.json"),
      readAgentJson("sovereign_runner_result.json"),
      readAgentJson("he_powerup_result.json"),
      readAgentJson("hive_power_state.json"),
    ]);

    const map = (rcMap?.steem as AgentJson | undefined) ?? null;
    const accounts = (map?.accounts as AgentJson[] | undefined) ?? [];
    const soldiers = accounts.filter((a) => String(a.account).toLowerCase() !== "headcorner");
    const treasury = accounts.find((a) => String(a.account).toLowerCase() === "headcorner") ?? null;
    const hive = (rcMap?.hive as AgentJson | undefined) ?? null;
    const throughput = (rcMap?.throughput as AgentJson | undefined) ?? null;

    const salvo = (rcs?.salvo as AgentJson | undefined) ?? null;
    const batch = (rcs?.batch as AgentJson | undefined) ?? null;
    const run = (runner?.run as AgentJson | undefined) ?? null;
    const chunk = (runner?.chunk as AgentJson | undefined) ?? null;

    return NextResponse.json({
      ok: true,
      at: new Date().toISOString(),
      map: {
        at: rcMap?.at ?? null,
        treasury,
        soldiers,
        fleetRcNow: map?.fleetRcNow ?? null,
        treasuryRcNow: map?.treasuryRcNow ?? null,
        hive,
        throughput,
      },
      salvo: {
        crossed: salvo?.crossed ?? false,
        fired: salvo?.fired ?? 0,
        maxSameBlock: salvo?.maxSameBlock ?? 0,
        maxBlock: salvo?.maxBlock ?? null,
        blockEvidence: salvo?.blockEvidence ?? null,
        singleWall: salvo?.singleWall ?? 5,
        txids: Array.isArray(salvo?.txs) ? (salvo.txs as AgentJson[]).map((t) => ({ soldier: t.soldier, txid: t.txid, block: t.block, opsInTx: t.opsInTx })) : [],
      },
      batch: {
        verified: batch?.verified ?? false,
        soldier: batch?.soldier ?? null,
        txid: batch?.txid ?? null,
        block: batch?.block ?? null,
        opsInTx: batch?.opsInTx ?? null,
        rcCost: batch?.rcCost ?? null,
        rcCostPerOp: batch?.rcCostPerOp ?? null,
      },
      runner: {
        anchored: run?.verified ?? false,
        count: (run?.workloads as AgentJson | undefined)?.count ?? null,
        ms: (run?.workloads as AgentJson | undefined)?.ms ?? null,
        compression: run?.compression ?? null,
        digestOnChain: run?.digestOnChain ?? false,
        soldier: run?.soldier ?? null,
        txid: run?.txid ?? null,
        block: run?.block ?? null,
        opsInTx: run?.opsInTx ?? null,
        head: (run?.workloads as AgentJson | undefined)?.head ?? null,
      },
      chunk: {
        verified: chunk?.verified ?? false,
        reassembled: chunk?.reassembled ?? false,
        bytes: chunk?.bytes ?? null,
        chunks: chunk?.chunks ?? null,
        hash: chunk?.hash ?? null,
        txids: Array.isArray(chunk?.txids) ? (chunk.txids as AgentJson[]) : [],
      },
      powerup: {
        result: powerup
          ? {
              verified: powerup.verified === true,
              vestsDelta: powerup.vestsDelta ?? null,
              rcMaxBefore: powerup.rcMaxBefore ?? null,
              rcMaxAfter: powerup.rcMaxAfter ?? null,
              rcRegenGainPct: powerup.rcRegenGainPct ?? null,
              amountPowered: powerup.amountPowered ?? null,
              at: powerup.at ?? null,
              mode: powerup.mode ?? null,
            }
          : null,
        machine: powerState
          ? { stage: powerState.stage ?? "idle", variant: powerState.variant ?? "empty", sentAt: powerState.sentAt ?? null, staleAt: powerState.staleAt ?? null, poweredAt: powerState.poweredAt ?? null }
          : { stage: "idle", variant: "empty" },
      },
      walls: WALLS,
    });
  } catch (e) {
    return NextResponse.json({ ok: true, at: new Date().toISOString(), error: String((e as Error)?.message ?? e) });
  }
}
