import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";

/**
 * GET /api/ops/saosnet — Task 68: SAOS-NET, הרשת-הריבונית שלנו.
 *
 * תיק-מצב-הרשת מהדיסק (הצומת הוא הסמכות; ה-API מציג בלבד, לעולם לא 500):
 *  · genesis   — הג'נזיס הנגזר-מראיות (genesisHash + מקורות)
 *  · node      — גובה, stateRoot, צ'קפוינטים, עיגונים, הצהרות-ולידטורים
 *  · blocks    — אוגר-הבלוקים (אחרונים) + heartbeat-אימפריה
 *  · recovery  — תוצאת phoenix האחרונה (תחייה-מסביבה-ריקה)
 */

const SOV = path.join(process.cwd(), "sovereign");
const AGENT = path.join(process.cwd(), "agent");

/* 99b — קריאה-סינכרונית לקובץ-מצב (תוצאות-עוגן/דופק) — null אם-אין */
function readFileSyncJson(p: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function readJson(p: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(p, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function shapeCp(cp: any) {
  if (!cp) return null;
  return {
    height: cp.height ?? null,
    stateRoot: cp.stateRoot ?? null,
    checkpointHash: cp.checkpointHash ?? null,
    anchors: cp.anchors ?? {},
    attests: (cp.attests ?? []).slice(0, 6),
    at: cp.at ?? null,
  };
}

export async function GET() {
  const [genesis, node, chain, phoenix, weave95, econ96, wrappedState, snapshot, recon102, rebal102, recon104] = await Promise.all([
    readJson(path.join(SOV, "genesis", "genesis.json")),
    readJson(path.join(SOV, "node", "state.json")),
    readJson(path.join(SOV, "node", "chain.json")),
    readJson(path.join(AGENT, "phoenix_state.json")),
    readJson(path.join(AGENT, "chaintalk95_result.json")),
    readJson(path.join(AGENT, "econ96_result.json")),
    readJson(path.join(AGENT, "wrapped_state.json")),
    Promise.resolve(readFileSyncJson(path.join(SOV, "node", "state-snapshot.json"))),
    Promise.resolve(readFileSyncJson(path.join(AGENT, "recon102_result.json"))),
    Promise.resolve(readFileSyncJson(path.join(AGENT, "rebalance102_result.json"))),
    Promise.resolve(readFileSyncJson(path.join(AGENT, "recon104_result.json"))),
  ]);

  /* ── 102 — אמת-שוק: הכל-נגזר-מהספר-עצמו · אף-מספר-לא-מומצא ──
   * SAOS-USD = מיד-ספר-ה-SAOS/STEEM × ציטוט-STEEM-על-הספר (coingecko חתום-ref)
   * סטיית-בריכה = (יחס-בריכה × SAOS-USD) ÷ אורקל-המטבע − 1
   * הסינתטיקה-הרדומים (WBTC/WETH/WXRP/WDOGE): יחידות-הבסיס-המקוריות-היו יחידות-ביטחונות
   * (STEEM) — פיוס recon102 שרף-והשבית; העדות (collateral/mintedTruth) מהמדידה-החיה. */
  const RETIRED = ["WBTC", "WETH", "WXRP", "WDOGE"];
  const market = (() => {
    const book = (node as any)?.book ?? null;
    const ask = book?.asks?.[0]?.price ?? null;
    const bid = book?.bids?.[0]?.price ?? null;
    const bookMid = ask && bid ? (ask + bid) / 2 : null;
    const steemQ = (node as any)?.assetPricesSummary?.WSTEEM ?? null;
    const steemUsd = steemQ ? steemQ.px / 1e9 : null;
    return {
      bookMid,
      ask,
      bid,
      steemUsd,
      saosUsd: bookMid && steemUsd ? bookMid * steemUsd : null,
      at: node?.updatedAt ?? null,
    };
  })();

  const kernelPrices = ((snapshot as any)?.st?.assetPrices ?? null) as Record<string, { px: number; src?: string; at?: string | null; ref?: string }> | null;
  const poolsX = (() => {
    const st = (snapshot as any)?.st;
    if (!st || !market.saosUsd) return null;
    const out: Record<string, unknown> = {};
    const row = (symA: string, aµ: number, bµ: number, lp: number, key: string) => {
      const a = aµ / 1000, b = bµ / 1000;
      const ratio = a > 0 ? b / a : 0;
      const oraclePx = kernelPrices?.[symA]?.px ? kernelPrices[symA].px / 1e9 : null;
      const impliedUsd = ratio * (market.saosUsd as number);
      const devPct = oraclePx && oraclePx > 0 ? ((impliedUsd - oraclePx) / oraclePx) * 100 : null;
      /* 102 — שלד = יחס-הבריכה לא-מייצג מחיר (אין-אורקל או מנותק >25%);
       * יחס-מעוגן גם-בעומק-אבק נשאר תקף — היחס הוא-המחיר, לא-העומק. */
      const skeleton = devPct === null || Math.abs(devPct) > 25;
      out[key] = {
        symA,
        a,
        b,
        ratio: Number(ratio.toFixed(2)),
        impliedUsd: impliedUsd > 0 ? Number(impliedUsd.toPrecision(4)) : null,
        oracleUsd: oraclePx,
        devPct: devPct !== null ? Number(devPct.toFixed(1)) : null,
        tvlUsd: Number((((a * (oraclePx ?? 0)) + b * (market.saosUsd as number))).toFixed(6)),
        skeleton,
        priceAt: kernelPrices?.[symA]?.at ?? null,
      };
    };
    for (const [key, p] of Object.entries((st.poolsX ?? {}) as Record<string, { a: number; b: number; lpSupply: number; symA: string }>)) {
      if (!p || !(p.lpSupply > 0)) continue;
      if (RETIRED.includes(p.symA)) continue; /* 102 — הסינתטיקה-הרדומים אינם-צמדים-כלל */
      row(p.symA, p.a, p.b, p.lpSupply, key);
    }
    if (st.poolW && st.poolW.lpSupply > 0) row("WTRX", st.poolW.wtrx, st.poolW.saos, st.poolW.lpSupply, "WTRX/SAOS(pw)");
    return out;
  })();

  const synthetic = (() => {
    const assets = ((wrappedState as any)?.assets ?? null) as Record<string, { lockRef?: string; lockedSteem?: number; lockedSbd?: number; lockedHive?: number; lockedSp?: number; minted?: number; coin?: string; oraclePrice?: number }> | null;
    if (!assets) return null;
    const wrapped = ((node as any)?.wrappedSummary ?? {}) as Record<string, { supply: number; locked: number }>;
    const out: Record<string, unknown> = {};
    for (const sym of RETIRED) {
      const ev = assets[sym];
      if (!ev) continue;
      out[sym] = {
        coin: ev.coin ?? sym.slice(1),
        collateral: ev.lockedSteem != null ? ev.lockedSteem + " STEEM" : null,
        lockRef: ev.lockRef ?? null,
        mintedTruth: ev.minted ?? null,
        chainSupply: wrapped[sym]?.supply ?? null,
        dormant: (wrapped[sym]?.supply ?? 1) <= 0.005,
      };
    }
    return out;
  })();

  const measured = (wrappedState as any)?.lastBeat?.measured
    ? {
        at: (wrappedState as any).lastBeat.at ?? (wrappedState as any).at ?? null,
        ...((wrappedState as any).lastBeat.measured as Record<string, number>),
        oracle: (wrappedState as any)?.oracle ? { at: (wrappedState as any).oracle.at, prices: (wrappedState as any).oracle.prices, divergencePct: (wrappedState as any).oracle.divergencePct } : null,
      }
    : null;

  const truth102 = {
    at: new Date().toISOString(),
    market,
    poolsX,
    synthetic,
    measured,
    unitRecon: recon104
      ? { at: recon104.at ?? null, allMatch: recon104.allMatch ?? false, summaryHe: recon104.summaryHe ?? null, retiredDormant: recon104.retiredDormant ?? null, redoOf: "recon102" }
      : recon102
        ? { at: recon102.at ?? null, allMatch: recon102.allMatch ?? false, summaryHe: recon102.summaryHe ?? null, retiredDormant: recon102.retiredDormant ?? null }
        : null,
    poolAnchor: rebal102 ? { at: rebal102.at ?? null, allMatch: rebal102.allMatch ?? false, summaryHe: rebal102.summaryHe ?? null } : null,
  };

  const blocks = ((chain as any)?.blocks ?? []).slice(-12).map((b: any) => ({
    height: b.height ?? null,
    time: b.time ?? null,
    hash: String(b.hash ?? "").slice(0, 16),
    txs: (b.txs ?? []).length,
    gasUsed: b.gasUsed ?? 0,
    heartbeat: (b.txs ?? []).find((t: any) => t.type === "heartbeat")?.note?.slice(0, 90) ?? null,
  }));

  const cps = ((node as any)?.checkpoints ?? []).map(shapeCp);
  const lastCp = cps[cps.length - 1] ?? null;

  const attestTotal = cps.reduce((s: number, c: any) => s + (c?.attests ?? []).length, 0);
  const attestVerified = cps.reduce(
    (s: number, c: any) => s + (c?.attests ?? []).filter((a: any) => a.verified).length,
    0
  );

  return NextResponse.json(
    {
      ok: true,
      at: new Date().toISOString(),
      net: "saos-net/0",
      genesis: genesis
        ? {
            genesisHash: genesis.genesisHash ?? null,
            time: genesis.time ?? null,
            counts: genesis.counts ?? null,
            supplySaos: ((genesis as any)?.state?.meta?.supply ?? 0) / 1000,
            issuer: (genesis as any)?.state?.meta?.issuer ?? null,
            sources: Object.keys((genesis as any)?.sources ?? {}),
          }
        : null,
      node: node
        ? {
            height: node.height ?? 0,
            stateRoot: node.stateRoot ?? null,
            genesisHash: node.genesisHash ?? null,
            beats: node.beats ?? 0,
            updatedAt: node.updatedAt ?? null,
            checkpoints: cps.slice(-6),
            lastCheckpoint: lastCp,
            verifiedCount: ((node as any)?.verified ?? []).length,
            pendingCount: ((node as any)?.pendingVerifies ?? []).length,
            mirror: (node as any)?.mirror ?? null,
            sov: (node as any)?.sov ?? null,
            book: (node as any)?.book ?? null,
            wrapped: (node as any)?.wrappedSummary ?? null,
            delegations: (node as any)?.delegationsSummary ?? null,
            assetMeta: (node as any)?.assetMetaSummary ?? null,
            assetPrices: (node as any)?.assetPricesSummary ?? null,
            /* 97 — GRID-PROFIT: יומן-הרווח-החי + מחזיקי-WTRX + יתרות-צף ריבוניות */
            grid97: (node as any)?.grid97 ?? null,
            /* 98 — GRID-98 ARENA: מנוע-הזרימה-הגבוהה — תפוקה · רווח-אוצר · זאן-חיילים · מדרגות-ערך */
            grid98: (node as any)?.grid98 ?? null,
            wrappedHolders: (node as any)?.wrappedHolders ?? null,
            floatBalances: (node as any)?.floatBalances ?? null,
            beeWall: (node as any)?.beeWall ?? null,
          } as any
        : null,
      econ96: econ96
        ? {
            at: econ96.at ?? null,
            allMatch: econ96.allMatch ?? false,
            summaryHe: econ96.summaryHe ?? null,
            steps: ((econ96.steps as any[]) ?? []).map((s) => ({
              id: s.id ?? null,
              label: s.label ?? null,
              match: s.match ?? false,
            })),
          }
        : null,
      weave95: weave95
        ? {
            at: weave95.at ?? null,
            allMatch: weave95.allMatch ?? false,
            summaryHe: weave95.summaryHe ?? null,
            steps: ((weave95.steps as any[]) ?? []).map((s) => ({
              id: s.id ?? null,
              net: s.net ?? null,
              label: s.label ?? null,
              match: s.match ?? false,
              measured: s.measured ?? null,
            })),
            completion: weave95.completion ?? null,
          }
        : null,
      blocks,
      quorum: { required: 3, attestTotal, attestVerified },
      /* 102 — אמת-שוק חיה למקטע-הריבונות: נגזרת-מהספר · סטיות-בריכות · מדידות-חוץ · עדות-פיוס */
      truth102,
      /* 103 — אמת-מנוע: פנקס-המנוע-החי (grid98-state.json) ישירות-מהדיסק —
       * לא-הייצוא-של-saosnet (היה-סטלה-והציג-רווח-מדומה-בן-שעות) · גיל-מוצהר */
      engine: (() => {
        const g = readFileSyncJson(path.join(SOV, "node", "grid98-state.json"));
        if (!g) return null;
        const at = (g.at as string) ?? null;
        const ageSec = at ? Math.round((Date.now() - new Date(at).getTime()) / 1000) : null;
        const lb = ((g.leaderboard as any[]) ?? []).map((l) => ({
          name: l.name,
          pnlSAOS: typeof l.pnlµ === "number" ? +(l.pnlµ / 1000).toFixed(3) : null,
        }));
        return {
          at,
          ageSec,
          source: "engine-ledger",
          height: (g.height as number) ?? null,
          stateRoot: (g.stateRoot as string) ?? null,
          treasuryPnlSAOS: typeof g.treasuryPnlµ === "number" ? +((g.treasuryPnlµ as number) / 1000).toFixed(3) : null,
          treasuryPnlTodaySAOS: typeof g.treasuryPnlTodayµ === "number" ? +((g.treasuryPnlTodayµ as number) / 1000).toFixed(3) : null,
          feeIncomeSAOS: typeof g.feeIncomeµ === "number" ? +((g.feeIncomeµ as number) / 1000).toFixed(3) : null,
          topUpsSAOS: typeof g.topUpsµ === "number" ? +((g.topUpsµ as number) / 1000).toFixed(3) : null,
          tradesToday: (g.tradesToday as number) ?? null,
          txsToday: (g.txsToday as number) ?? null,
          ratePerMin: (g.ratePerMin as number) ?? null,
          tradesTotal: (g.tradesTotal as number) ?? null,
          floor: (g.floor as number) ?? null,
          steps: (g.steps as any[]) ?? [],
          skippedForEdge: (g.skippedForEdge as number) ?? null,
          rejected: (g.rejected as number) ?? null,
          edgeLeak: (g.edgeLeak as number) ?? null,
          bench: (g.bench as any) ?? null,
          disk: (g.disk as any) ?? null,
          paused: (g.paused as string) ?? null,
          leaderboard: lb,
        };
      })(),
      /* 103 — חדר-החיילים: כל-חייל = קישוריות (linkage_report) + RC-חי (fleet_rc)
       * + רווח-דקס (מהמנוע) · הגדרות-מסודרות: רצפות-RC, קיבולת-מדודה, משימת-ההבראה */
      fleet: (() => {
        const link = readFileSyncJson(path.join(AGENT, "linkage_report.json"));
        const rc = readFileSyncJson(path.join(AGENT, "fleet_rc.json"));
        const heal = readFileSyncJson(path.join(AGENT, "hive_rc_heal.json"));
        const engineG = readFileSyncJson(path.join(SOV, "node", "grid98-state.json"));
        const rcAccs = ((rc?.accounts as Record<string, { pct?: number; hp?: number; maxRc?: number }>) ?? {});
        const linkBy = new Map<string, any>(
          (((link?.soldiers as any[]) ?? []).map((s) => [String(s.username ?? "").toLowerCase(), s]))
        );
        const pnlBy = new Map<string, number>(
          (((engineG?.leaderboard as any[]) ?? []).map((l) => [String(l.name).toLowerCase(), typeof l.pnlµ === "number" ? l.pnlµ / 1000 : 0]))
        );
        const seqBy = ((readFileSyncJson(path.join(AGENT, "fleet_state.json"))?.seqBy as Record<string, number>) ?? {});
        const names = new Set<string>([...linkBy.keys(), ...Object.keys(rcAccs), ...pnlBy.keys(), ...Object.keys(seqBy)]);
        const soldiers = [...names].map((n) => {
          const ch = linkBy.get(n)?.chains ?? null;
          const r = rcAccs[n] ?? null;
          return {
            username: n,
            steemLinked: ch?.steem?.linked ?? null,
            hiveLinked: ch?.hive?.linked ?? null,
            hiveRcPct: r?.pct != null ? +(r.pct * 100).toFixed(1) : null,
            hiveHp: r?.hp != null ? +r.hp.toFixed(2) : null,
            seqToday: seqBy[n] ?? 0,
            dexPnlSAOS: pnlBy.get(n) != null ? +pnlBy.get(n)!.toFixed(3) : null,
          };
        }).sort((a, b) => (b.hiveRcPct ?? -1) - (a.hiveRcPct ?? -1));
        const head = rcAccs["headcorner"] ?? null;
        const linkedHive = soldiers.filter((s) => s.hiveLinked).length;
        return {
          at: (rc?.at as string) ?? (link?.at as string) ?? null,
          rcAt: (rc?.at as string) ?? null,
          headRcPct: head?.pct != null ? +(head.pct * 100).toFixed(1) : null,
          headHp: head?.hp != null ? +head.hp.toFixed(2) : null,
          allLinked: (link?.allLinked as boolean) ?? null,
          linkedHive,
          soldiersTotal: soldiers.length,
          soldiers,
          settings: {
            rcFloorPct: 8,
            rcHeavyPct: 12,
            carryingCapacity: "≈86 HE-ops/יום לכל-הצי (regen 13B RC/יום ÷ 150M ל-op) — מדוד 2026-09-06",
            healGate: "head RC ≥ 12% · מתנה 1.5HP × ≤3 חיילים-רזים · רצפת-ראש 6HP · עדות-מנוף Δmax_rc ≥ 10%",
            healLeverWeak: (heal?.leverWeak as boolean) ?? false,
            healLastGate: (heal?.lastGate as any) ?? null,
            healAt: (heal?.at as string) ?? null,
          },
        };
      })(),
      /* 99b — ריבונות-חיה למקטע-ה-UI: גשר-Tron · עוגנים-תלת-שרשרתיים חיים · דופק-בלורט */
      tron: (node as any)?.tron
        ? {
            address: (node as any).tron.address ?? null,
            relay: (node as any).tron.relay ?? null,
            height: (node as any).tron.height ?? null,
            at: (node as any).tron.at ?? null,
            pulse: (node as any).tron.pulse ?? null,
            lastAnchor: (node as any).tron.lastAnchor ?? null,
            /* 107 — squad מהמקור-האמת (פנקס-הגשר): הצורה-הישנה הקרינה-אובייקט-סטטוס
             * כאילו-היה-רשימת-חיילים → השורה-על-הדף-הייתה-ריקה (דימום-תצוגה).
             * members = חיילים-אמתיים עם יתרה · squadRing = הטבעת-המאושרת-האחרונה. */
            squad: (() => {
              const tb = readFileSyncJson(path.join(SOV, "node", "tron-bridge-state.json"));
              const sq = ((tb as any)?.squad ?? {}) as Record<string, any>;
              const members = ((sq.members ?? []) as Record<string, any>[])
                .filter((m) => m?.address)
                .map((m) => ({ address: String(m.address), balanceTrx: typeof m.balanceTrx === "number" ? m.balanceTrx : null, activated: !!m.activated }));
              const lastRing = ((sq.rings ?? []) as Record<string, any>[]).find((r) => r.closed && r.verified && r.notedHeight) ?? null;
              const tronSquadOld = (node as any).tron.squad ?? null;
              return {
                members,
                activated: members.filter((m) => m.activated).length,
                ringsClosed: ((sq.rings ?? []) as Record<string, any>[]).filter((r) => r.closed && r.verified).length,
                lastRing: lastRing
                  ? {
                      id: lastRing.id ?? null,
                      legs: (lastRing.legs ?? []).length,
                      zeroFee: ((lastRing.legs ?? []) as Record<string, any>[]).every((l) => (l.netFeeSun ?? 0) === 0),
                      burnSun: lastRing.burnSun ?? 0,
                      notedHeight: lastRing.notedHeight ?? null,
                    }
                  : (tronSquadOld && !Array.isArray(tronSquadOld) && (tronSquadOld as any).lastRing ? (tronSquadOld as any).lastRing : null),
                at: sq.at ?? null,
              };
            })(),
          }
        : null,
      liveAnchors: (() => {
        try {
          const anchorLast = readFileSyncJson(path.join(AGENT, "anchor_last.json"));
          const weaveLast = readFileSyncJson(path.join(AGENT, "weave_last.json"));
          const blurt99 = readFileSyncJson(path.join(AGENT, "blurt99_result.json"));
          const revive = readFileSyncJson(path.join(AGENT, "blurt_revive_result.json"));
          const pick = (r: any, names: string[]) => {
            for (const n of names) {
              const st = (r?.steps ?? []).find((s: any) => s?.name === n);
              if (st) return { txid: st.txid ?? st?.data?.txid ?? null, at: st.at ?? null, endpoint: st.endpoint ?? st?.data?.endpoint ?? null };
            }
            return null;
          };
          return {
            anchorId: anchorLast ? { at: anchorLast.at ?? null, evm: anchorLast.evm ?? null, txids: anchorLast.txids ?? {} } : null,
            weaveSeal: weaveLast ? { at: (weaveLast as any).at ?? null, txids: ((weaveLast as any).txids ?? (weaveLast as any)?.anchored?.txids ?? {}) } : null,
            blurt99: blurt99
              ? {
                  at: blurt99.at ?? null,
                  ok: blurt99.ok ?? null,
                  anchor: pick(blurt99, ["anchor"]),
                  post: pick(blurt99, ["post"]),
                  vote: pick(blurt99, ["vote"]),
                  reconcile: (((blurt99 as any).steps ?? []) as any[]).find((s: any) => s?.name === "reconcile") ?? null,
                }
              : null,
            revive: revive ? { at: revive.at ?? null, ok: revive.ok ?? null, broadcast: pick(revive, ["broadcast"]) } : null,
          };
        } catch (_) {
          return null;
        }
      })(),
      recovery: phoenix
        ? {
            at: (phoenix.at as string | null) ?? null,
            verdict: (phoenix.verdict as string | null) ?? null,
            checks: ((phoenix.checks as { area: string; name: string; pass: boolean; detail: string }[]) ?? []).slice(0, 12),
          }
        : null,
      kernel: { present: fs.existsSync(path.join(SOV, "core", "kernel.cjs")), spec: "sovereign/spec/CHAIN_SPEC.md" },
    },
    { status: 200 }
  );
}
