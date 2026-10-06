import { db } from "@/lib/db";

async function main() {
  const accts = await (db as any).exchangeAccount.findMany();
  for (const t of accts) {
    const bal = JSON.parse(t.balances ?? "{}");
    const entries = Object.entries(bal).filter(([, v]) => Number(v) !== 0);
    if (entries.length) console.log("חשבון:", t.member, "|", JSON.stringify(Object.fromEntries(entries)));
  }
  const pools = await (db as any).exchangePool.findMany();
  for (const p of pools) console.log("בריכה:", p.pair, "| A:", Number(p.reserveA).toFixed(6), "| B:", Number(p.reserveB).toFixed(6));
  const evs = await (db as any).exchangeEvent.findMany({
    where: { kind: { in: ["TREASURY_UNWRAP", "LP_REMOVE"] } },
    orderBy: { seq: "desc" },
    take: 3,
  });
  for (const e of evs) console.log("אירוע חדש:", "seq#" + e.seq, "|", e.kind, "|", String(e.payload).slice(0, 150));
  process.exit(0);
}
main();
