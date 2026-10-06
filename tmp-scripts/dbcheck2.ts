import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const byType = await db.attestation.groupBy({ by: ["claimType"], _count: { _all: true } });
  console.log("byType:", JSON.stringify(byType));
  const byStatus = await db.attestation.groupBy({ by: ["status"], _count: { _all: true } });
  console.log("byStatus:", JSON.stringify(byStatus));
  // search boundary-crossing related claims
  const boundary = await db.attestation.findMany({
    where: { OR: [{ claim: { contains: "גבול" } }, { claim: { contains: "boundary" } }, { claim: { contains: "R208" } }, { claim: { contains: "ACT" } }] },
    select: { seq: true, claimType: true, status: true, claim: true, createdAt: true },
    orderBy: { seq: "desc" }, take: 20,
  });
  console.log("boundary-ish count:", boundary.length);
  for (const b of boundary) console.log(`#${b.seq} [${b.claimType}/${b.status}] ${b.claim.slice(0, 150)}`);
  const lastCp = await db.checkpoint.findFirst({ orderBy: { index: "desc" } });
  console.log("lastCheckpoint:", JSON.stringify(lastCp ? { index: lastCp.index, attFrom: lastCp.attFrom, attTo: lastCp.attTo, root: lastCp.root.slice(0, 18), anchorStatus: lastCp.anchorStatus } : null));
  const anchors = await db.localAnchor.count();
  console.log("localAnchors:", anchors);
}
main().then(()=>db.$disconnect()).catch(e=>{console.error(String(e).slice(0,400)); process.exit(1);});
