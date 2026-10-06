import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const agents = await db.agent.count();
  const attest = await db.attestation.count();
  const checks = await db.checkpoint.count();
  console.log(JSON.stringify({ agents, attest, checks }));
  const recent = await db.attestation.findMany({ orderBy: { seq: "desc" }, take: 6, select: { seq: true, kind: true, subjectId: true, createdAt: true } });
  console.log("recent:", JSON.stringify(recent));
}
main().then(()=>db.$disconnect()).catch(e=>{console.error(String(e).slice(0,300)); process.exit(1);});
