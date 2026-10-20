import { NextResponse } from "next/server"
import {
  rawFile,
  rawText,
  ghApi,
  repoCommits,
  recoveryAssets,
  secretSweep,
  signingHealth,
  enginePulse,
  sovereignDecisions,
  fabricQueue,
  irreversiblesQuote,
  ORGAN_NAMES,
  ORGAN_FRESHNESS_SEC,
  type Snapshot,
  type ArmyPublic,
  type VolumeVerify,
  type Klines,
  type MakerStats,
  type WorkflowRun,
  type Panel,
} from "@/lib/sovereign"

// מטמון בזיכרון 45 שניות — הענן פועל בקצב דקות; לא להציק ל-GitHub
type Cache = { at: number; payload?: unknown }
const g = globalThis as unknown as { __sovCache?: Cache }
const TTL = 45_000

function panel<T>(p: Promise<T>, label: string): Promise<Panel<T>> {
  return p
    .then((data) => ({ ok: true, data, at: new Date().toISOString() }))
    .catch((e: unknown) => ({
      ok: false,
      data: null,
      error: `${label}: ${e instanceof Error ? e.message : String(e)}`,
      at: new Date().toISOString(),
    }))
}

function normPools(st: Snapshot["state"]): Array<{ pair: string; detail: string; valueHint: string }> {
  const pools = st.pools ?? {}
  const out: Array<{ pair: string; detail: string; valueHint: string }> = []
  for (const [pair, raw] of Object.entries(pools)) {
    const r = raw as Record<string, number | string>
    const keys = Object.keys(r)
    // צורות אפשריות: {rA,rB} / {reserveBase,reserveQuote} / מיפוי טוקן→שריון
    const nums = keys.filter((k) => typeof r[k] === "number")
    let detail = ""
    let valueHint = ""
    if (nums.length >= 2) {
      const [a, b] = nums.slice(0, 2)
      detail = `${a}=${r[a]} · ${b}=${r[b]}`
      valueHint = `k=${r["k"] ?? "-"}`
    } else {
      detail = keys.slice(0, 4).join("·")
    }
    if (r["feeBps"] !== undefined) valueHint += ` fee=${String(r["feeBps"])}bps`
    out.push({ pair, detail, valueHint })
  }
  return out
}

export async function GET() {
  const now = Date.now()
  if (g.__sovCache && now - g.__sovCache.at < TTL && g.__sovCache.payload) {
    return NextResponse.json(g.__sovCache.payload)
  }

  const [snapP, armyP, volP, klinesP, makersP, gridP, runsP, claimsP, digestP, policiesP, feedP, recoveryP, sweepP, signingP, engineP, decisionsP, fabricP, irrevP] = await Promise.all([
    panel(rawFile("saos-dex", "db/state-snapshot.json").then((j) => j as Snapshot), "state-snapshot"),
    panel(rawFile("saos-dex", "grids/state/army-public.json").then((j) => j as ArmyPublic), "army-public"),
    panel(rawFile("saos-dex", "grids/state/volume-verify.json").then((j) => j as VolumeVerify), "volume-verify"),
    panel(rawFile("saos-dex", "db/klines.json").then((j) => j as Klines), "klines"),
    panel(rawFile("saos-dex", "db/maker-stats.json").then((j) => j as MakerStats), "maker-stats"),
    panel(rawFile("saos-dex", "db/grid-public.json"), "grid-public"),
    panel(
      ghApi<{ workflow_runs: WorkflowRun[] }>(`/repos/roshpinacare-sys/saos-runtime/actions/runs?per_page=60`).then(
        (d) => d.workflow_runs,
      ),
      "workflow-runs",
    ),
    panel(rawFile("saos-owner-channel", "CLAIMS.json"), "hub-claims"),
    panel(rawFile("FleetHQ", "digest.json", "office-pages"), "office-digest"),
    panel(rawFile("saos-dex", "grids/state/policy-gears.json"), "policy-gears"),
    // יומן-הריבונות: commit-ים אחרונים מ-5-הריפואים — ה-commit הוא הקבלה
    panel(
      Promise.all(
        (["saos-dex", "saos-runtime", "saos-owner-channel", "FleetHQ", "steem"] as const).map((r) => repoCommits(r, 10)),
      ).then((lists) => {
        // מיון-כרונולוגי + תקרת-גיוון: ≤6 לכל-ריפו — שריפו-רועש (pacemaker) לא יציף את הקיר
        const all = lists.flat().sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
        const per = new Map<string, number>()
        const out: typeof all = []
        for (const c of all) {
          if (out.length >= 20) break
          const n = (per.get(c.repo) ?? 0) + 1
          if (n > 6) continue
          per.set(c.repo, n)
          out.push(c)
        }
        return out
      }),
      "commit-feed",
    ),
    // מגן-השרידות: כלי-התחייה חייבים להיות על main ב-hub — חסר = אדום גלוי
    panel(recoveryAssets(), "recovery-assets"),
    // אפס-סודות בענן: חוק-מפתח של ה-owner — דליפה = אדום גלוי
    panel(secretSweep(), "secret-sweep"),
    // יד-החתימה: המד-האמיתי (G1..G4 מול-השרשרת) — חי ב-runtime, שעתי :43
    panel(signingHealth(), "signing-health"),
    // פעימת-יד-המנוע: המחזור-האמיתי-האחרון (SENSE→DECIDE→ACT→RECORD)
    panel(enginePulse(), "engine-pulse"),
    // המוח-הריבוני: מחזור-ההחלטות SOV-POLICY/1 (FleetHQ) — sense → decisions → record
    panel(sovereignDecisions(), "sovereign-decisions"),
    // תור-האשרורים: הצעות-fabric + הבלתי-הפיכים — מה-מחכה-להחלטת-הבעלים
    panel(fabricQueue(), "fabric-queue"),
    panel(irreversiblesQuote(), "irreversibles"),
  ])

  // קבלות-צבא: 8 השורות האחרונות מה-jsonl
  const receipts = await panel(
    rawText("saos-dex", "grids/state/army-receipts.jsonl").then((t) =>
      t
        .split("\n")
        .filter(Boolean)
        .slice(-8)
        .map((l) => {
          try {
            return JSON.parse(l) as Record<string, unknown>
          } catch {
            return { raw: l.slice(0, 200) }
          }
        }),
    ),
    "army-receipts",
  )

  // אורגנים: הריצה האחרונה לכל-workflow + כשלים ב-24h
  const runs = runsP.data ?? []
  const organMap = new Map<string, { run: WorkflowRun | null; fails24h: number }>()
  const dayAgo = Date.now() - 24 * 3600_000
  for (const name of ORGAN_NAMES) organMap.set(name, { run: null, fails24h: 0 })
  for (const r of runs) {
    const e = organMap.get(r.name)
    if (!e) continue
    if (!e.run || r.created_at > e.run.created_at) e.run = r
    if (r.conclusion === "failure" && new Date(r.created_at).getTime() > dayAgo) e.fails24h++
  }
  const organs = [...organMap.entries()].map(([name, { run, fails24h }]) => {
    const age = run ? Math.round((Date.now() - new Date(run.created_at).getTime()) / 1000) : null
    const fresh = ORGAN_FRESHNESS_SEC[name] ?? 93600
    const verdict =
      !run ? "never-seen" : age !== null && age <= fresh ? "fresh" : age !== null && age <= fresh * 1.6 ? "aging" : "stale"
    return {
      name,
      status: run?.status ?? null,
      conclusion: run?.conclusion ?? null,
      at: run?.created_at ?? null,
      url: run?.html_url ?? null,
      ageSec: age,
      freshSec: fresh,
      verdict,
      fails24h,
    }
  })

  // כלכלה: Σ credits + נזילות
  const snap = snapP.data
  const credits = snap?.state?.credits ?? {}
  const creditsSum = Object.values(credits).reduce((a, b) => a + b, 0)
  const balances = snap?.state?.balances?.treasury ?? {}
  const lpEntries = Object.entries(balances)
    .filter(([k]) => k.startsWith("LP|"))
    .map(([pair, v]) => ({ pair, balance: v }))

  const payload = {
    at: new Date().toISOString(),
    chain: {
      ok: snapP.ok,
      error: snapP.error,
      height: snap?.state?.height ?? null,
      savedAt: snap?.savedAt ?? null,
      creditsSum,
      creditsHolders: Object.entries(credits)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([k, v]) => ({ holder: k, mu: v })),
      feeMeter: snap?.state?.feeMeter ?? null,
      treasuryProfitEver: snap?.state?.treasuryProfitEver ?? null,
      gasUsed: snap?.state?.gasUsed ?? null,
      pools: normPools(snap?.state ?? ({} as Snapshot["state"])),
      lpTreasury: lpEntries,
    },
    army: { ...armyP, receipts },
    volume: volP,
    grid: gridP,
    klines: klinesP.ok
      ? {
          ok: true,
          at: klinesP.at,
          pairs: Object.fromEntries(Object.entries(klinesP.data?.pairs ?? {}).map(([p, arr]) => [p, arr.slice(-72)])),
        }
      : { ok: false, error: klinesP.error, at: klinesP.at },
    makers: makersP.ok
      ? {
          ok: true,
          at: makersP.at,
          top: Object.entries(makersP.data?.recs ?? {})
            .sort((a, b) => b[1].volMu - a[1].volMu)
            .slice(0, 8)
            .map(([name, s]) => ({ name, ...s })),
        }
      : { ok: false, error: makersP.error, at: makersP.at },
    policies: policiesP,
    organs,
    hub: claimsP,
    digest: digestP,
    feed: feedP,
    recovery: recoveryP,
    secrets: sweepP,
    signing: signingP,
    engine: engineP,
    decisions: decisionsP,
    fabric: fabricP,
    irreversibles: irrevP,
  }

  g.__sovCache = { at: Date.now(), payload }
  return NextResponse.json(payload)
}
