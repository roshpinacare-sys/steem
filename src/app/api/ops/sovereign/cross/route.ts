import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * GET /api/ops/sovereign/cross — סיבוב 51: ריבונות מעל-השרשראות.
 *
 * שלושת ההוכחות של Task 51 מקבצי-תוצאה של ריצות אמיתיות:
 *  1. cross-shard — אובייקט-מצב אחד שפורק לשברים על Steem+Hive והורכב
 *     מההיסטוריה הציבורית של שתי השרשראות עם התאמת sha256 (אף שרשרת
 *     לא מחזיקה את האובייקט לבדה; חתימות-חייל ראשונות על Hive).
 *  2. rebuild — שחזור-עולם מההיסטוריה הציבורית בלבד: מנוע-שידור-חוזר
 *     עצמאי שני והשוואה מול השרת (ספר/בריכה/יתרות/עמלות).
 *  3. perf — מדידות-ביצועים חיות: מרוץ-RPC, מנוע אפס-RC ב-swap/שנ׳,
 *     חבירה-לבלוק בשתי השרשראות, ועיגון-digest של הדוח על-השרשרת.
 *
 * לעולם לא 500 — תמיד 200 עם ok:true.
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

export async function GET() {
  try {
    const [cross, rebuild, perf] = await Promise.all([
      readAgentJson("cross_shard_result.json"),
      readAgentJson("rebuild_result.json"),
      readAgentJson("perf_bench_result.json"),
    ]);

    const shards = (Array.isArray(cross?.shards) ? (cross.shards as AgentJson[]) : []).map((s) => ({
      i: s.i,
      chain: s.chain,
      signer: s.signer,
      txid: s.txid ?? null,
      bytes: typeof s.chunk === "string" ? s.chunk.length : null,
    }));

    return NextResponse.json({
      ok: true,
      at: new Date().toISOString(),
      cross: cross
        ? {
            mode: cross.mode ?? null,
            root: cross.root ?? null,
            manifestBytes: cross.manifestBytes ?? null,
            reassembledBytes: cross.reconstructedBytes ?? null,
            shardCount: cross.shardCount ?? null,
            reassembled: cross.reassembled === true,
            rootMatch: cross.reassembledRootMatch === true,
            bothChains: cross.bothChains === true,
            firstSoldierHiveSignature: cross.firstSoldierHiveSignature === true,
            manifestSections: cross.manifest ? Object.keys(cross.manifest as AgentJson) : [],
            shards,
          }
        : null,
      rebuild: rebuild
        ? {
            corpus: rebuild.corpus ?? null,
            supply: rebuild.replay ? (rebuild.replay as AgentJson).supply : null,
            verdict: rebuild.verdict ?? null,
            passed: rebuild.passed ?? null,
            total: rebuild.total ?? null,
            allPass: rebuild.allPass === true,
            comparison: Array.isArray(rebuild.comparison) ? (rebuild.comparison as AgentJson[]) : [],
            bestAsk: rebuild.replay ? (rebuild.replay as AgentJson).bestAsk : null,
            pool: rebuild.replay ? (rebuild.replay as AgentJson).pools : null,
            trades: rebuild.replay ? (rebuild.replay as AgentJson).trades : null,
          }
        : null,
      perf: perf
        ? {
            rpc: perf.rpc ?? null,
            engine: perf.engine ?? null,
            inclusion: perf.inclusion ?? null,
            anchor: perf.anchor ?? null,
          }
        : null,
    });
  } catch (e) {
    return NextResponse.json({ ok: true, at: new Date().toISOString(), error: String((e as Error)?.message ?? e) });
  }
}
